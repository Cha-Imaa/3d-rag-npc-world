"""Tests for the chat endpoint: what it accepts, what it sends on, and how it fails."""

import logging
from collections.abc import Iterator
from typing import get_args

import pytest
from fastapi.testclient import TestClient

from app.chat import (
    LLM_ERROR_MESSAGES,
    MAX_MESSAGE_CHARACTERS,
    MAX_NPC_ID_CHARACTERS,
    SHARED_RULES,
    build_instructions,
)
from app.llm import (
    ChatMessage,
    FakeLlm,
    GeneratedReply,
    LlmErrorCode,
    NpcReply,
    ReplyKind,
    TokenUsage,
)
from app.main import app, get_llm, get_npcs
from app.npcs import NpcConfig, ScenePosition

VISITOR_HEADERS = {"X-Visitor-Id": "6f1c1a52-7d3e-4b7a-9c55-0d9a7f3b2e11"}


class RecordingLlm:
    """Gives a set reply and remembers what it was asked."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[ChatMessage]]] = []
        # A test can set this to None to act like OpenAI leaving the counts out.
        self.usage: TokenUsage | None = TokenUsage(input_tokens=100, output_tokens=20)
        # A test can set this to "grounded" to act like the model breaking the rules.
        self.kind: ReplyKind = "no_evidence"

    def generate_reply(self, instructions: str, messages: list[ChatMessage]) -> GeneratedReply:
        """Record the call, and answer with values the server has not checked."""
        self.calls.append((instructions, messages))

        reply = NpcReply(
            kind=self.kind,
            answer="A test answer",
            citation_ids=["made-up-citation"],
            referral_npc_id="made-up-npc",
            referral_reason="A made-up reason",
        )

        return GeneratedReply(reply=reply, usage=self.usage)


def make_npc(npc_id: str, tile_q: int, enabled: bool = True) -> NpcConfig:
    """Build an NPC whose instructions name it, so a test can tell which one was used."""
    return NpcConfig(
        id=npc_id,
        display_name="Test NPC",
        enabled=enabled,
        personality_instructions=f"Instructions for {npc_id}",
        expertise="Test expertise",
        knowledge_base_id=f"collection-{npc_id}",
        scene_position=ScenePosition(q=tile_q, r=0),
    )


@pytest.fixture
def llm() -> RecordingLlm:
    """Give each test its own LLM to inspect."""
    return RecordingLlm()


@pytest.fixture
def client(llm: RecordingLlm) -> Iterator[TestClient]:
    """Serve two enabled NPCs and a disabled one, answered by the recording LLM."""
    npcs = [make_npc("first", 0), make_npc("second", 1), make_npc("hidden", 2, enabled=False)]
    app.dependency_overrides[get_npcs] = lambda: npcs
    app.dependency_overrides[get_llm] = lambda: llm
    yield TestClient(app)
    app.dependency_overrides.clear()


def send(client: TestClient, npc_id: str = "first", message: str = "Hello") -> dict:
    """Send a valid message and return the response's JSON, checking that it worked."""
    response = client.post(
        "/api/chat",
        json={"npc_id": npc_id, "message": message},
        headers=VISITOR_HEADERS,
    )
    assert response.status_code == 200

    return response.json()


def test_returns_only_the_answer(client: TestClient) -> None:
    """Unchecked citations and referrals from the model must not reach the browser."""
    assert send(client) == {"answer": "A test answer"}


def test_uses_the_chosen_npcs_instructions(client: TestClient, llm: RecordingLlm) -> None:
    """The LLM should get the chosen NPC's instructions and the visitor's message."""
    send(client, npc_id="second", message="Who are you?")

    [(instructions, messages)] = llm.calls
    assert instructions == build_instructions(make_npc("second", 1))
    assert "Instructions for first" not in instructions
    assert messages == [ChatMessage(role="user", content="Who are you?")]


def test_logs_the_token_counts_of_a_reply(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app"):
        send(client, npc_id="second")

    assert "Chat reply: npc_id=second input_tokens=100 output_tokens=20" in caplog.messages


def test_logs_unknown_token_counts_as_unknown(
    client: TestClient, llm: RecordingLlm, caplog: pytest.LogCaptureFixture
) -> None:
    llm.usage = None

    with caplog.at_level(logging.INFO, logger="app"):
        send(client)

    assert "Chat reply: npc_id=first tokens unknown" in caplog.messages


def test_the_log_leaves_out_the_message_and_the_visitor(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app"):
        send(client, message="A private question")

    assert "A private question" not in caplog.text
    assert VISITOR_HEADERS["X-Visitor-Id"] not in caplog.text


def test_instructions_describe_the_npc() -> None:
    """The model needs the NPC's name, personality, and expertise to speak as it."""
    instructions = build_instructions(make_npc("first", 0))

    assert "Test NPC" in instructions
    assert "Instructions for first" in instructions
    assert "Test expertise" in instructions


def test_shared_rules_come_after_the_character_notes() -> None:
    """The rules go last, so a personality can't talk the model out of them."""
    instructions = build_instructions(make_npc("first", 0))

    assert instructions.endswith(SHARED_RULES)


def test_instructions_leave_out_the_knowledge_base() -> None:
    """The model has no use for the private knowledge base ID."""
    assert "collection-first" not in build_instructions(make_npc("first", 0))


def test_removes_spaces_around_a_message(client: TestClient, llm: RecordingLlm) -> None:
    """Spaces around a message should not reach the LLM."""
    send(client, message="  Hello  ")

    [(_, messages)] = llm.calls
    assert messages[0].content == "Hello"


def test_accepts_a_message_at_the_limit(client: TestClient) -> None:
    """The longest allowed message should still be sent."""
    send(client, message="a" * MAX_MESSAGE_CHARACTERS)


@pytest.mark.parametrize("npc_id", ["hidden", "not-configured"])
def test_rejects_an_npc_the_visitor_cant_talk_to(
    client: TestClient, llm: RecordingLlm, npc_id: str
) -> None:
    """A disabled or unknown NPC should give the same error, with no LLM call."""
    response = client.post(
        "/api/chat",
        json={"npc_id": npc_id, "message": "Hello"},
        headers=VISITOR_HEADERS,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "npc_not_found"
    assert llm.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {"npc_id": "first"},
        {"message": "Hello"},
        {"npc_id": "first", "message": ""},
        {"npc_id": "first", "message": "   \n "},
        {"npc_id": "first", "message": "a" * (MAX_MESSAGE_CHARACTERS + 1)},
        {"npc_id": "first", "message": 5},
        {"npc_id": "../first", "message": "Hello"},
        {"npc_id": "a" * (MAX_NPC_ID_CHARACTERS + 1), "message": "Hello"},
        {"npc_id": "first", "message": "Hello", "knowledge_base_id": "collection-second"},
    ],
)
def test_rejects_a_bad_body(client: TestClient, llm: RecordingLlm, body: dict) -> None:
    """A bad body should get the shared error shape, and should cost nothing."""
    response = client.post("/api/chat", json=body, headers=VISITOR_HEADERS)

    assert response.status_code == 422
    assert list(response.json()) == ["error"]
    assert response.json()["error"]["code"] == "invalid_request"
    assert llm.calls == []


def test_rejects_broken_json(client: TestClient, llm: RecordingLlm) -> None:
    """A body that is not JSON should get the shared error shape."""
    response = client.post(
        "/api/chat",
        content="not json",
        headers={**VISITOR_HEADERS, "Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert llm.calls == []


@pytest.mark.parametrize("headers", [{}, {"X-Visitor-Id": "not-a-uuid"}])
def test_rejects_a_missing_or_bad_visitor_id(
    client: TestClient, llm: RecordingLlm, headers: dict
) -> None:
    """The visitor header must be present and must be a UUID."""
    response = client.post(
        "/api/chat",
        json={"npc_id": "first", "message": "Hello"},
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert llm.calls == []


@pytest.mark.parametrize("code", get_args(LlmErrorCode))
def test_a_failed_reply_is_an_error_and_a_retry_can_recover(
    client: TestClient, code: LlmErrorCode
) -> None:
    """Each failure should show its code and message, and never look like an answer."""
    fake_llm = FakeLlm()
    app.dependency_overrides[get_llm] = lambda: fake_llm
    body = {"npc_id": "first", "message": code}

    failed = client.post("/api/chat", json=body, headers=VISITOR_HEADERS)
    retried = client.post("/api/chat", json=body, headers=VISITOR_HEADERS)

    assert failed.status_code == 503
    assert failed.json() == {"error": {"code": code, "message": LLM_ERROR_MESSAGES[code]}}
    assert retried.status_code == 200


def test_rejects_a_grounded_reply_while_there_are_no_documents(
    client: TestClient, llm: RecordingLlm, caplog: pytest.LogCaptureFixture
) -> None:
    """A reply claiming document evidence must not reach the visitor before documents exist."""
    llm.kind = "grounded"

    with caplog.at_level(logging.INFO, logger="app"):
        response = client.post(
            "/api/chat", json={"npc_id": "first", "message": "Hello"}, headers=VISITOR_HEADERS
        )

    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "llm_bad_reply", "message": LLM_ERROR_MESSAGES["llm_bad_reply"]}
    }
    # The rejected reply was still paid for, so its cost is logged too.
    assert "Chat reply: npc_id=first input_tokens=100 output_tokens=20" in caplog.messages
    assert "Chat reply rejected: npc_id=first claimed grounded" in caplog.messages
