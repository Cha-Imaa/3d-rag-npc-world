"""Tests for the fake LLM and for how the server chooses between it and the real one."""

import pytest
from fastapi.testclient import TestClient

from app.chat import build_messages
from app.ingest import Chunk
from app.llm import (
    FAKE_EMBEDDING_DIMENSIONS,
    FAKE_REPLY_DELAY_SECONDS,
    ChatMessage,
    FakeLlm,
    LlmError,
    OpenAiLlm,
    TokenUsage,
    create_llm,
    fake_embedding,
)
from app.main import app
from app.retrieval import RetrievedPassage
from app.settings import Settings


def visitor_says(text: str) -> list[ChatMessage]:
    """Build a conversation that ends with the given visitor message."""
    return [
        ChatMessage(role="user", content="Hello"),
        ChatMessage(role="assistant", content="Good day."),
        ChatMessage(role="user", content=text),
    ]


def code_of_failed_reply(llm: FakeLlm, text: str) -> str:
    """Send a message that should fail, and return the error code."""
    with pytest.raises(LlmError) as error_info:
        llm.generate_reply("Test instructions", visitor_says(text))

    return error_info.value.code


def test_a_reply_is_labelled_as_fake_and_repeats_the_message() -> None:
    generated = FakeLlm().generate_reply("Test instructions", visitor_says("What do you do here?"))
    reply = generated.reply

    assert reply.answer == "[Fake reply] You said: What do you do here?"


def test_a_reply_claims_no_sources_or_referrals() -> None:
    reply = FakeLlm().generate_reply("Test instructions", visitor_says("Hello again")).reply

    assert reply.kind == "casual"
    assert reply.citation_ids == []
    assert reply.referral_npc_id is None
    assert reply.referral_reason is None


def test_a_reply_cites_every_passage_the_server_sent() -> None:
    """Uses the server's own passage format, so the fake keeps up if that format changes."""
    passages = [
        RetrievedPassage(
            chunk=Chunk(
                id=chunk_id,
                source_file="notes.txt",
                title="Notes",
                page=None,
                section=None,
                text="Some text.",
            ),
            score=0.5,
        )
        for chunk_id in ["notes.txt#1", 'odd"name.txt#2']
    ]
    messages = build_messages("How deep is the well?", passages)

    reply = FakeLlm().generate_reply("Test instructions", messages).reply

    assert reply.kind == "grounded"
    assert reply.citation_ids == ["notes.txt#1", 'odd"name.txt#2']
    assert reply.answer == "[Fake reply] Found 2 passages. You said: How deep is the well?"


def test_a_reply_uses_no_tokens() -> None:
    generated = FakeLlm().generate_reply("Test instructions", visitor_says("Hello"))

    assert generated.usage == TokenUsage(input_tokens=0, output_tokens=0)


@pytest.mark.parametrize(
    "code",
    ["llm_not_configured", "llm_out_of_credit", "llm_unavailable", "llm_bad_reply"],
)
def test_each_error_code_can_be_requested(code: str) -> None:
    assert code_of_failed_reply(FakeLlm(), code) == code


def test_a_message_that_only_mentions_a_code_gets_a_normal_reply() -> None:
    generated = FakeLlm().generate_reply("Test instructions", visitor_says("Is llm_bad_reply bad?"))
    reply = generated.reply

    assert reply.kind == "casual"


def test_a_retry_of_the_same_code_succeeds() -> None:
    llm = FakeLlm()
    code_of_failed_reply(llm, "llm_unavailable")

    reply = llm.generate_reply("Test instructions", visitor_says("llm_unavailable")).reply

    assert reply.kind == "casual"


def test_a_code_fails_again_after_a_successful_retry() -> None:
    llm = FakeLlm()
    code_of_failed_reply(llm, "llm_unavailable")
    llm.generate_reply("Test instructions", visitor_says("llm_unavailable"))

    assert code_of_failed_reply(llm, "llm_unavailable") == "llm_unavailable"


def test_a_different_code_still_fails_after_a_failure() -> None:
    llm = FakeLlm()
    code_of_failed_reply(llm, "llm_unavailable")

    assert code_of_failed_reply(llm, "llm_bad_reply") == "llm_bad_reply"


def test_the_setting_chooses_the_fake_with_a_visible_delay() -> None:
    llm = create_llm(Settings(_env_file=None, use_fake_llm=True))

    assert isinstance(llm, FakeLlm)
    assert llm.reply_delay_seconds == FAKE_REPLY_DELAY_SECONDS


def test_the_real_llm_is_the_default() -> None:
    llm = create_llm(Settings(_env_file=None))

    assert isinstance(llm, OpenAiLlm)


@pytest.mark.parametrize(("setting", "expected_class"), [("true", FakeLlm), ("false", OpenAiLlm)])
def test_the_server_starts_with_the_chosen_llm(
    setting: str, expected_class: type, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("USE_FAKE_LLM", setting)

    with TestClient(app):
        assert isinstance(app.state.llm, expected_class)


def similarity(first: list[float], second: list[float]) -> float:
    """Compare two fake vectors. They have length 1, so this is cosine similarity."""
    return sum(a * b for a, b in zip(first, second, strict=True))


def test_a_fake_embedding_has_the_set_length_and_is_scaled_to_one() -> None:
    vector = fake_embedding("The Salt Wind blows in spring")

    assert len(vector) == FAKE_EMBEDDING_DIMENSIONS
    assert similarity(vector, vector) == pytest.approx(1.0)


def test_the_same_text_always_gets_the_same_fake_embedding() -> None:
    assert fake_embedding("Lantern Hill") == fake_embedding("Lantern Hill")


def test_capitals_and_punctuation_do_not_change_a_fake_embedding() -> None:
    assert fake_embedding("Salt Wind!") == fake_embedding("salt wind")


def test_texts_sharing_words_are_more_similar_than_unrelated_texts() -> None:
    question = fake_embedding("When does the Salt Wind blow?")
    related = fake_embedding("The Salt Wind blows from the sea every spring.")
    unrelated = fake_embedding("Graft the apple branch in early March.")

    assert similarity(question, related) > similarity(question, unrelated)


def test_a_text_without_words_gets_a_zero_fake_embedding() -> None:
    assert fake_embedding("?!  ...") == [0.0] * FAKE_EMBEDDING_DIMENSIONS


def test_the_fake_embeds_each_text_in_order_using_no_tokens() -> None:
    embedded = FakeLlm().embed_texts(["first text", "second text"])

    assert embedded.vectors == [fake_embedding("first text"), fake_embedding("second text")]
    assert embedded.input_tokens == 0
