"""Tests for the citation rules: only retrieved passages can be shown as sources."""

import logging

import pytest

from app.citations import check_reply, find_valid_citations
from app.ingest import Chunk
from app.llm import NpcReply, ReplyKind
from app.npcs import NpcConfig, ScenePosition
from app.retrieval import RetrievedPassage

NPC = NpcConfig(
    id="test-npc",
    display_name="Test NPC",
    enabled=True,
    personality_instructions="Test personality",
    expertise="Test expertise",
    knowledge_base_id="test-collection",
    no_evidence_message="My records don't say.",
    scene_position=ScenePosition(q=0, r=0),
)


def make_passage(chunk_id: str) -> RetrievedPassage:
    """Build a retrieved passage whose text names its ID."""
    chunk = Chunk(
        id=chunk_id,
        source_file="notes.pdf",
        title="Notes",
        page=2,
        section=None,
        text=f"Text of {chunk_id}",
    )
    return RetrievedPassage(chunk=chunk, score=0.5)


PASSAGES = [make_passage("notes.pdf#1"), make_passage("notes.pdf#2")]


def make_reply(kind: ReplyKind, citation_ids: list[str]) -> NpcReply:
    """Build a model reply with the given kind and citations."""
    return NpcReply(
        kind=kind,
        answer="The model's answer",
        citation_ids=citation_ids,
        referral_npc_id=None,
        referral_reason=None,
    )


def test_valid_citations_keep_model_order_without_repeats() -> None:
    citations = find_valid_citations(["notes.pdf#2", "notes.pdf#1", "notes.pdf#2"], PASSAGES)

    assert [citation.id for citation in citations] == ["notes.pdf#2", "notes.pdf#1"]


def test_a_citation_carries_the_source_details() -> None:
    [citation] = find_valid_citations(["notes.pdf#1"], PASSAGES)

    assert citation.title == "Notes"
    assert citation.source_file == "notes.pdf"
    assert citation.page == 2
    assert citation.text == "Text of notes.pdf#1"


def test_grounded_reply_keeps_only_retrieved_citations(caplog: pytest.LogCaptureFixture) -> None:
    reply = make_reply("grounded", ["notes.pdf#1", "made-up.txt#9"])

    with caplog.at_level(logging.WARNING, logger="app"):
        checked = check_reply(NPC, reply, PASSAGES)

    assert checked.kind == "grounded"
    assert checked.answer == "The model's answer"
    assert [citation.id for citation in checked.citations] == ["notes.pdf#1"]
    assert "Citations removed: npc_id=test-npc invalid=1" in caplog.messages


def test_grounded_reply_without_valid_citations_uses_the_npc_message() -> None:
    """An answer whose sources can't be checked must never look sourced."""
    for citation_ids in ([], ["made-up.txt#9"]):
        checked = check_reply(NPC, make_reply("grounded", citation_ids), PASSAGES)

        assert checked.kind == "no_evidence"
        assert checked.answer == "My records don't say."
        assert checked.citations == []


def test_grounded_reply_cannot_cite_a_passage_from_another_search() -> None:
    """A real chunk ID that was not retrieved for this message is still rejected."""
    checked = check_reply(NPC, make_reply("grounded", ["notes.pdf#3"]), PASSAGES)

    assert checked.citations == []


@pytest.mark.parametrize("kind", ["casual", "no_evidence"])
def test_other_kinds_show_no_citations(kind: ReplyKind) -> None:
    checked = check_reply(NPC, make_reply(kind, ["notes.pdf#1"]), PASSAGES)

    assert checked.kind == kind
    assert checked.answer == "The model's answer"
    assert checked.citations == []
