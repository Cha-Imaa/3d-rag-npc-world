"""Retrieval isolation and citation integrity tests on the real NPC files and test documents.

Each placeholder NPC has its own collection in data/sources. Some facts exist in only one
collection. These tests ask every NPC about every such fact through the chat endpoint,
with a stand-in model that tries to cite every passage of every collection, and check
that an NPC only ever sees and cites its own documents. They use the fake embedder,
so they cost no credit.
"""

import html
import re
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.ingest import SearchIndex, build_index
from app.llm import (
    FAKE_EMBEDDING_MODEL,
    ChatMessage,
    EmbeddedTexts,
    FakeLlm,
    GeneratedReply,
    NpcReply,
)
from app.main import app, get_indexes, get_llm, get_npcs
from app.npcs import NpcConfig, load_npcs

VISITOR_HEADERS = {"X-Visitor-Id": "6f1c1a52-7d3e-4b7a-9c55-0d9a7f3b2e11"}

# Facts that exist in only one collection, with a question that asks about each.
# The great flood of 437 is left out, because it appears in two collections.
# The fake embedder only matches words, so each question shares several words with the
# passage that holds its fact, enough to pass the real score floor.
EXCLUSIVE_FACTS = [
    ("test-collection-one", "salt wind", "What is the Salt Wind?"),
    ("test-collection-two", "two-fruit tree", "Tell me about the Two-Fruit Tree."),
    (
        "test-collection-three",
        "ribbonstone",
        "Is ribbonstone soft when it first comes out of the ground?",
    ),
]

# Finds each passage ID in the passages message the server sends to the model.
PASSAGE_ID_PATTERN = re.compile(r'<passage id="([^"]*)"')


class GreedyLlm:
    """Acts like a model that cites every passage it knows of, from any collection."""

    def __init__(self, every_chunk_id: list[str]) -> None:
        self.calls: list[list[ChatMessage]] = []
        self.embedding_model = FAKE_EMBEDDING_MODEL
        # Real IDs from all collections, plus one that exists nowhere.
        self.citation_ids = [*every_chunk_id, "made-up-source.txt#1"]

    def embed_texts(self, texts: list[str]) -> EmbeddedTexts:
        """Embed with the fake's word counts, the same way the indexes were built."""
        return FakeLlm().embed_texts(texts)

    def generate_reply(self, instructions: str, messages: list[ChatMessage]) -> GeneratedReply:
        """Record what the model was sent, and claim every passage as a source."""
        self.calls.append(messages)
        reply = NpcReply(
            kind="grounded",
            answer="A test answer",
            citation_ids=self.citation_ids,
            referral_npc_id=None,
            referral_reason=None,
        )
        return GeneratedReply(reply=reply, usage=None)


@pytest.fixture(scope="module")
def npcs() -> list[NpcConfig]:
    """Load the real, enabled NPC files from data/npcs."""
    return [npc for npc in load_npcs() if npc.enabled]


@pytest.fixture(scope="module")
def indexes(npcs: list[NpcConfig]) -> dict[str, SearchIndex]:
    """Build each NPC's index from its real test documents, once for the whole file."""
    return {npc.knowledge_base_id: build_index(npc.knowledge_base_id, FakeLlm())[0] for npc in npcs}


@pytest.fixture
def llm(indexes: dict[str, SearchIndex]) -> GreedyLlm:
    """Give each test a greedy model that knows every chunk ID in every index."""
    every_chunk_id = [chunk.id for index in indexes.values() for chunk in index.chunks]
    return GreedyLlm(every_chunk_id)


@pytest.fixture
def client(
    npcs: list[NpcConfig], indexes: dict[str, SearchIndex], llm: GreedyLlm
) -> Iterator[TestClient]:
    """Serve the real NPCs and their indexes, answered by the greedy model."""
    app.dependency_overrides[get_npcs] = lambda: npcs
    app.dependency_overrides[get_indexes] = lambda: indexes
    app.dependency_overrides[get_llm] = lambda: llm
    yield TestClient(app)
    app.dependency_overrides.clear()


def ask(client: TestClient, npc_id: str, message: str) -> dict:
    """Send a message to one NPC and return the response's JSON, checking that it worked."""
    response = client.post(
        "/api/chat", json={"npc_id": npc_id, "message": message}, headers=VISITOR_HEADERS
    )
    assert response.status_code == 200
    return response.json()


def passage_ids_sent(messages: list[ChatMessage]) -> list[str]:
    """Return the IDs of the passages the server put in the model's messages."""
    prompt = " ".join(message.content for message in messages)
    return [html.unescape(passage_id) for passage_id in PASSAGE_ID_PATTERN.findall(prompt)]


def test_the_npcs_use_separate_collections(npcs: list[NpcConfig]) -> None:
    """Every check below relies on each NPC having its own collection."""
    knowledge_base_ids = [npc.knowledge_base_id for npc in npcs]

    assert len(npcs) >= 2
    assert len(set(knowledge_base_ids)) == len(knowledge_base_ids)


def test_each_exclusive_fact_is_in_exactly_one_collection(
    indexes: dict[str, SearchIndex],
) -> None:
    """Guards the test data: if a fact spreads to another collection, the tests would lie."""
    for owner, fact, _ in EXCLUSIVE_FACTS:
        holders = [
            knowledge_base_id
            for knowledge_base_id, index in indexes.items()
            if any(fact in chunk.text.lower() for chunk in index.chunks)
        ]
        assert holders == [owner], f"{fact!r} is in {holders}"


@pytest.mark.parametrize(("owner", "fact", "question"), EXCLUSIVE_FACTS)
def test_no_npc_sees_or_cites_another_collection(
    client: TestClient,
    npcs: list[NpcConfig],
    indexes: dict[str, SearchIndex],
    llm: GreedyLlm,
    owner: str,
    fact: str,
    question: str,
) -> None:
    """Ask every NPC about the fact. Only its own passages may reach the model or the visitor."""
    for npc in npcs:
        llm.calls.clear()
        body = ask(client, npc.id, question)
        own_chunks = {chunk.id: chunk for chunk in indexes[npc.knowledge_base_id].chunks}

        [messages] = llm.calls
        sent_ids = passage_ids_sent(messages)
        assert set(sent_ids) <= set(own_chunks), f"{npc.id} was sent another collection"

        cited_ids = [citation["id"] for citation in body["citations"]]
        assert set(cited_ids) <= set(sent_ids), f"{npc.id} cited a passage it was not sent"

        if npc.knowledge_base_id != owner:
            # The fact lives elsewhere, so it must not appear anywhere in what came back.
            assert fact not in body["answer"].lower()
            assert all(fact not in citation["text"].lower() for citation in body["citations"])


@pytest.mark.parametrize(("owner", "fact", "question"), EXCLUSIVE_FACTS)
def test_the_owner_cites_the_passage_with_the_fact(
    client: TestClient,
    npcs: list[NpcConfig],
    owner: str,
    fact: str,
    question: str,
) -> None:
    """The NPC whose documents hold the fact finds it, so the isolation test isn't empty."""
    [npc] = [npc for npc in npcs if npc.knowledge_base_id == owner]

    body = ask(client, npc.id, question)

    assert any(fact in citation["text"].lower() for citation in body["citations"])


def test_citations_copy_the_stored_passage_not_the_model(
    client: TestClient, npcs: list[NpcConfig], indexes: dict[str, SearchIndex]
) -> None:
    """Every citation detail shown to the visitor comes from the index, field for field."""
    for npc in npcs:
        own_chunks = {chunk.id: chunk for chunk in indexes[npc.knowledge_base_id].chunks}
        for _, _, question in EXCLUSIVE_FACTS:
            body = ask(client, npc.id, question)

            for citation in body["citations"]:
                chunk = own_chunks[citation["id"]]
                assert citation == {
                    "id": chunk.id,
                    "title": chunk.title,
                    "source_file": chunk.source_file,
                    "page": chunk.page,
                    "section": chunk.section,
                    "text": chunk.text,
                }


def test_a_reply_citing_only_other_collections_falls_back_to_no_evidence(
    client: TestClient, npcs: list[NpcConfig], indexes: dict[str, SearchIndex], llm: GreedyLlm
) -> None:
    """A model that cites only real passages from someone else's documents gets no sources."""
    npc = npcs[0]
    llm.citation_ids = [
        chunk.id
        for knowledge_base_id, index in indexes.items()
        if knowledge_base_id != npc.knowledge_base_id
        for chunk in index.chunks
    ]

    body = ask(client, npc.id, "What is the Salt Wind? How hard is ribbonstone?")

    assert body == {"answer": npc.no_evidence_message, "citations": [], "referral": None}
