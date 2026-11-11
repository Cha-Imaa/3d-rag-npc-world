"""Referral checks: only suggest another NPC that really exists and the visitor can visit."""

import logging

from pydantic import BaseModel

from app.llm import NpcReply
from app.npcs import NpcConfig, find_enabled_npc

logger = logging.getLogger(__name__)

# The reason is shown on a small card, so a long one is more likely a broken reply.
MAX_REFERRAL_REASON_CHARACTERS = 200


class Referral(BaseModel):
    """A checked suggestion to talk to another NPC, shown to the visitor as a card."""

    npc_id: str
    reason: str


def check_referral(npc: NpcConfig, reply: NpcReply, all_npcs: list[NpcConfig]) -> Referral | None:
    """Keep the model's referral only if it points to another NPC the visitor can talk to.

    The model's referral is unchecked output, so it is dropped when:
    - the target is not a configured, enabled NPC,
    - the target is the NPC that is replying,
    - or the reason is empty or too long to show on a card.

    Args:
        npc: The NPC that replied.
        reply: The model's structured reply.
        all_npcs: Every configured NPC, enabled or not.

    Returns:
        The checked referral, or None when there is none or it failed a check.
    """
    if reply.referral_npc_id is None:
        return None

    target = find_enabled_npc(all_npcs, reply.referral_npc_id)
    reason = (reply.referral_reason or "").strip()

    if target is None or target.id == npc.id:
        # Only the replying NPC's ID goes in the log, never the made-up target or the reason.
        logger.warning("Referral removed: npc_id=%s target is not another enabled NPC", npc.id)
        return None

    if not reason or len(reason) > MAX_REFERRAL_REASON_CHARACTERS:
        logger.warning("Referral removed: npc_id=%s reason is empty or too long", npc.id)
        return None

    return Referral(npc_id=target.id, reason=reason)
