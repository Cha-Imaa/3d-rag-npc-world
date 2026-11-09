"""Retrieval: find the passages in one NPC's index that best match a visitor's question."""

import numpy as np
from pydantic import BaseModel

from app.ingest import Chunk, SearchIndex, scale_rows_to_length_one
from app.llm import FakeLlm, OpenAiLlm

# How many passages the model sees at most. Enough to answer from, and each one costs tokens.
MAX_PASSAGES = 4

# Passages scoring below this are clearly unrelated and are dropped. It is deliberately
# loose, because the model makes the final call on whether a passage answers the question.
# A starting value, to be tuned on the test questions with real embeddings.
SCORE_FLOOR = 0.2


class RetrievedPassage(BaseModel):
    """One passage found for a question, and how closely it matched."""

    chunk: Chunk
    # Cosine similarity, from -1 to 1. Higher means a closer match.
    score: float


def score_passages(index: SearchIndex, question_vector: list[float]) -> np.ndarray:
    """Score every passage in an index against a question.

    Args:
        index: The knowledge base to search. Its rows already have length 1.
        question_vector: The embedded question, from the same model as the index.

    Returns:
        One cosine similarity per chunk, in chunk order.
    """
    question = np.array([question_vector], dtype=np.float32)
    # A question with no words embeds as all zeros, which this leaves at zero.
    question = scale_rows_to_length_one(question)

    # One matrix multiplication scores every chunk at once.
    return index.embeddings @ question[0]


def search_index(
    index: SearchIndex,
    question: str,
    llm: OpenAiLlm | FakeLlm,
    max_passages: int = MAX_PASSAGES,
    score_floor: float = SCORE_FLOOR,
) -> list[RetrievedPassage]:
    """Find the best passages for a question in one knowledge base only.

    Args:
        index: The NPC's own index. Other NPCs' indexes are never searched.
        question: The text to search for.
        llm: What embeds the question. It must use the same model as the index.
        max_passages: The most passages to return.
        score_floor: Passages scoring below this are left out.

    Returns:
        Up to max_passages passages, best first. Empty if nothing scores high enough.

    Raises:
        LlmError: If the question could not be embedded.
    """
    question_vector = llm.embed_texts([question]).vectors[0]
    scores = score_passages(index, question_vector)

    # Sort best first. A stable sort keeps document order between equal scores.
    best_first = np.argsort(-scores, kind="stable")

    passages = []
    for position in best_first[:max_passages]:
        score = float(scores[position])
        if score < score_floor:
            # Every later passage scores lower still.
            break
        passages.append(RetrievedPassage(chunk=index.chunks[position], score=score))

    return passages
