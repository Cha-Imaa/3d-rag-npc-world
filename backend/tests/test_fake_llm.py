"""Tests for the fake LLM and for how the server chooses between it and the real one."""

import pytest
from fastapi.testclient import TestClient

from app.llm import FAKE_REPLY_DELAY_SECONDS, ChatMessage, FakeLlm, LlmError, OpenAiLlm, create_llm
from app.main import app
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
    reply = FakeLlm().generate_reply("Test instructions", visitor_says("What do you do here?"))

    assert reply.answer == "[Fake reply] You said: What do you do here?"


def test_a_reply_claims_no_sources_or_referrals() -> None:
    reply = FakeLlm().generate_reply("Test instructions", visitor_says("Hello again"))

    assert reply.kind == "casual"
    assert reply.citation_ids == []
    assert reply.referral_npc_id is None
    assert reply.referral_reason is None


@pytest.mark.parametrize(
    "code",
    ["llm_not_configured", "llm_out_of_credit", "llm_unavailable", "llm_bad_reply"],
)
def test_each_error_code_can_be_requested(code: str) -> None:
    assert code_of_failed_reply(FakeLlm(), code) == code


def test_a_message_that_only_mentions_a_code_gets_a_normal_reply() -> None:
    reply = FakeLlm().generate_reply("Test instructions", visitor_says("Is llm_bad_reply bad?"))

    assert reply.kind == "casual"


def test_a_retry_of_the_same_code_succeeds() -> None:
    llm = FakeLlm()
    code_of_failed_reply(llm, "llm_unavailable")

    reply = llm.generate_reply("Test instructions", visitor_says("llm_unavailable"))

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
