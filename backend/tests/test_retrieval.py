"""Tests for searching one knowledge base. All use the fake embedder, which matches words."""

import numpy as np
import pytest

from app.ingest import SearchIndex, build_index
from app.llm import FakeLlm
from app.retrieval import search_index


@pytest.fixture(scope="module")
def indexes() -> dict[str, SearchIndex]:
    """Build each test collection's index once for the whole file."""
    names = ["test-collection-one", "test-collection-two", "test-collection-three"]
    return {name: build_index(name, FakeLlm())[0] for name in names}


def test_search_finds_the_passage_that_holds_the_fact(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(indexes["test-collection-one"], "What is the Salt Wind?", FakeLlm())

    assert passages
    assert "Salt Wind" in passages[0].chunk.text


def test_search_returns_best_first_and_respects_the_limit(
    indexes: dict[str, SearchIndex],
) -> None:
    passages = search_index(
        indexes["test-collection-two"],
        "bees hives orchard keepers",
        FakeLlm(),
        max_passages=2,
        score_floor=0.0,
    )

    assert len(passages) == 2
    assert passages[0].score >= passages[1].score


def test_search_drops_passages_below_the_floor(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(
        indexes["test-collection-one"], "Salt Wind", FakeLlm(), score_floor=1.01
    )

    assert passages == []


def test_a_question_with_no_words_finds_nothing(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(indexes["test-collection-one"], "?!", FakeLlm())

    assert passages == []


def test_search_only_returns_passages_from_the_given_index(
    indexes: dict[str, SearchIndex],
) -> None:
    # Ribbonstone only appears in collection three, so collection one must not return it.
    passages = search_index(
        indexes["test-collection-one"], "ribbonstone", FakeLlm(), score_floor=0.0
    )
    own_ids = {chunk.id for chunk in indexes["test-collection-one"].chunks}

    assert all(passage.chunk.id in own_ids for passage in passages)
    assert all("ribbonstone" not in passage.chunk.text.lower() for passage in passages)


def test_scores_are_cosine_similarities(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(
        indexes["test-collection-three"], "ribbonstone quarry", FakeLlm(), score_floor=-1.0
    )

    assert all(-1.0 <= passage.score <= 1.0 + 1e-6 for passage in passages)
    assert np.isfinite([passage.score for passage in passages]).all()
