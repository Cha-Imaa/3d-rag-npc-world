"""The messages the browser and the server exchange through POST /api/chat."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.llm import LlmErrorCode
from app.npcs import SAFE_ID_PATTERN

# Every character is paid for, and a real question fits well within this.
MAX_MESSAGE_CHARACTERS = 2000

# Longer than any sensible ID, so an oversized value is turned away early.
MAX_NPC_ID_CHARACTERS = 100

# Shown to the visitor when a reply fails, so each one avoids technical words.
LLM_ERROR_MESSAGES: dict[LlmErrorCode, str] = {
    "llm_not_configured": "Characters can't reply yet, because the AI service isn't set up.",
    "llm_out_of_credit": "Characters can't reply right now, because the AI credit has run out.",
    "llm_unavailable": "The AI service couldn't be reached. Please try again.",
    "llm_bad_reply": "That reply didn't come through properly. Please try again.",
}


class ChatRequest(BaseModel):
    """What the browser may send. The NPC's knowledge base always comes from configuration."""

    # Rejecting unknown fields means the browser can't try to choose private settings.
    model_config = ConfigDict(extra="forbid")

    npc_id: str = Field(pattern=SAFE_ID_PATTERN, max_length=MAX_NPC_ID_CHARACTERS)
    message: Annotated[
        str,
        # Spaces are removed first, so a message of only spaces counts as empty.
        StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_CHARACTERS),
    ]


class ChatResponse(BaseModel):
    """What the browser receives.

    Citations and referrals are added once the server can check them. Until then, the
    model's unchecked values must not reach the visitor.
    """

    answer: str
