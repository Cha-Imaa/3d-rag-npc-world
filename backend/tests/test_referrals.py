"""Tests for referral checks: only real, enabled, other NPCs may be suggested."""

import logging

import pytest

from app.llm import NpcReply
from app.npcs import NpcConfig, ScenePosition
from app.referrals import MAX_REFERRAL_REASON_CHARACTERS, Referral, check_referral


def make_npc(npc_id: str, tile_q: int, enabled: bool = True) -> NpcConfig:
    """Build a neutral placeholder NPC."""
    return NpcConfig(
        id=npc_id,
        display_name=f"Placeholder {npc_id}",
        enabled=enabled,
        personality_instructions="Neutral placeholder.",
        expertise=f"Topics of {npc_id}",
        knowledge_base_id=f"collection-{npc_id}",
        no_evidence_message="No records.",
        scene_position=ScenePosition(q=tile_q, r=0),
    )


REPLYING_NPC = make_npc("first", 0)
ALL_NPCS = [REPLYING_NPC, make_npc("second", 1), make_npc("hidden", 2, enabled=False)]


def reply_with_referral(npc_id: str | None, reason: str | None = "They know this.") -> NpcReply:
    """Build a no_evidence reply that suggests another NPC."""
    return NpcReply(
        kind="no_evidence",
        answer="My records don't cover that.",
        citation_ids=[],
        referral_npc_id=npc_id,
        referral_reason=reason,
    )


def test_keeps_a_referral_to_another_enabled_npc() -> None:
    referral = check_referral(REPLYING_NPC, reply_with_referral("second"), ALL_NPCS)

    assert referral == Referral(npc_id="second", reason="They know this.")


def test_no_referral_stays_none() -> None:
    assert check_referral(REPLYING_NPC, reply_with_referral(None, None), ALL_NPCS) is None


@pytest.mark.parametrize(
    "target",
    [
        "made-up-npc",  # Not configured at all.
        "hidden",  # Configured, but the visitor can't talk to it.
        "first",  # The NPC that is replying.
        "Second",  # IDs must match exactly.
    ],
)
def test_drops_a_referral_to_an_npc_the_visitor_cant_be_sent_to(target: str) -> None:
    assert check_referral(REPLYING_NPC, reply_with_referral(target), ALL_NPCS) is None


@pytest.mark.parametrize("reason", [None, "", "   ", "x" * (MAX_REFERRAL_REASON_CHARACTERS + 1)])
def test_drops_a_referral_without_a_usable_reason(reason: str | None) -> None:
    assert check_referral(REPLYING_NPC, reply_with_referral("second", reason), ALL_NPCS) is None


def test_trims_spaces_around_the_reason() -> None:
    referral = check_referral(
        REPLYING_NPC, reply_with_referral("second", "  Ask them.  "), ALL_NPCS
    )

    assert referral is not None
    assert referral.reason == "Ask them."


def test_the_log_leaves_out_the_made_up_target_and_reason(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="app"):
        check_referral(
            REPLYING_NPC, reply_with_referral("secret-target", "A private reason"), ALL_NPCS
        )

    assert "Referral removed: npc_id=first" in caplog.text
    assert "secret-target" not in caplog.text
    assert "A private reason" not in caplog.text
