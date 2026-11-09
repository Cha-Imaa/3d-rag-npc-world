"""Citation checks: make sure a reply only shows sources that were really retrieved."""

import logging

from pydantic import BaseModel

from app.llm import NpcReply, ReplyKind
from app.npcs import NpcConfig
from app.retrieval import RetrievedPassage

logger = logging.getLogger(__name__)


class Citation(BaseModel):
    """A source shown under an answer, so the visitor can check it themselves."""

    id: str
    title: str
    source_file: str
    page: int | None
    section: str | None
    # The passage's full text, so the visitor can read what the answer relied on.
    text: str


class CheckedReply(BaseModel):
    """A reply after the server's rules are applied, ready to show the visitor."""

    kind: ReplyKind
    answer: str
    citations: list[Citation]


def citation_from_passage(passage: RetrievedPassage) -> Citation:
    """Copy a retrieved passage's source details into a citation."""
    chunk = passage.chunk
    return Citation(
        id=chunk.id,
        title=chunk.title,
        source_file=chunk.source_file,
        page=chunk.page,
        section=chunk.section,
        text=chunk.text,
    )


def find_valid_citations(
    citation_ids: list[str], passages: list[RetrievedPassage]
) -> list[Citation]:
    """Keep only the cited IDs that match a passage retrieved for this message.

    Args:
        citation_ids: The IDs the model cited. They are unchecked model output.
        passages: The passages actually given to the model.

    Returns:
        One citation per matching ID, in the model's order, with repeats removed.
    """
    passages_by_id = {passage.chunk.id: passage for passage in passages}

    citations = []
    for citation_id in dict.fromkeys(citation_ids):  # dict.fromkeys drops repeats, in order.
        passage = passages_by_id.get(citation_id)
        if passage is not None:
            citations.append(citation_from_passage(passage))

    return citations


def check_reply(npc: NpcConfig, reply: NpcReply, passages: list[RetrievedPassage]) -> CheckedReply:
    """Apply the citation rules from ARCHITECTURE.md to the model's reply.

    - A casual or no_evidence reply shows no citations.
    - A grounded reply keeps only citations that match a retrieved passage.
    - A grounded reply with none left is replaced by the NPC's no_evidence_message,
      so an unsupported answer is never shown as sourced.

    Args:
        npc: The NPC that replied, for its no_evidence_message and the log.
        reply: The model's structured reply.
        passages: The passages given to the model for this message.

    Returns:
        The reply to show the visitor.
    """
    if reply.kind != "grounded":
        return CheckedReply(kind=reply.kind, answer=reply.answer, citations=[])

    citations = find_valid_citations(reply.citation_ids, passages)

    dropped = len(set(reply.citation_ids)) - len(citations)
    if dropped:
        # Counts only, so the log never holds what the visitor asked about.
        logger.warning("Citations removed: npc_id=%s invalid=%d", npc.id, dropped)

    if not citations:
        logger.warning("Grounded reply replaced: npc_id=%s had no valid citations", npc.id)
        return CheckedReply(kind="no_evidence", answer=npc.no_evidence_message, citations=[])

    return CheckedReply(kind="grounded", answer=reply.answer, citations=citations)
