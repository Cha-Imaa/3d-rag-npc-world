"""LLM access: the only module that talks to OpenAI."""

from typing import Literal

import httpx2
from openai import AuthenticationError, OpenAI, OpenAIError, RateLimitError
from pydantic import BaseModel, ValidationError

from app.settings import Settings

# The visitor watches a thinking indicator, so a stuck call should fail soon.
# The SDK would otherwise wait up to 10 minutes.
REQUEST_TIMEOUT_SECONDS = 30

# One retry covers a brief network problem without keeping the visitor waiting much longer.
MAX_RETRIES = 1

# Limits what one reply can cost. Replies are short, so this is rarely reached.
MAX_OUTPUT_TOKENS = 1000

# The reasons a reply can fail. The interface picks its plain-language message from these.
LlmErrorCode = Literal[
    "llm_not_configured",  # The API key is missing, or OpenAI rejected it.
    "llm_out_of_credit",  # The API credit has run out.
    "llm_unavailable",  # OpenAI could not be reached, was busy, or returned an error.
    "llm_bad_reply",  # The model answered, but not with a usable reply.
]


class LlmError(Exception):
    """A reply could not be produced, so the visitor must see an error and not an answer."""

    def __init__(self, code: LlmErrorCode) -> None:
        super().__init__(code)
        self.code = code


class ChatMessage(BaseModel):
    """One earlier or new message in a conversation."""

    role: Literal["user", "assistant"]
    content: str


class NpcReply(BaseModel):
    """The structured reply the model must return. ARCHITECTURE.md explains each field."""

    kind: Literal["casual", "grounded", "no_evidence"]
    answer: str
    citation_ids: list[str]
    referral_npc_id: str | None
    referral_reason: str | None


class OpenAiLlm:
    """Gets NPC replies from OpenAI."""

    def __init__(self, settings: Settings, http_client: httpx2.Client | None = None) -> None:
        """Prepare the OpenAI client.

        Args:
            settings: The model settings and the API key.
            http_client: Replaces the network connection. Tests use this to avoid real calls.
        """
        self.settings = settings
        self.client = None

        # Without a key the server still starts, and only chat fails. See generate_reply.
        if settings.openai_api_key is not None:
            self.client = OpenAI(
                api_key=settings.openai_api_key.get_secret_value(),
                timeout=REQUEST_TIMEOUT_SECONDS,
                max_retries=MAX_RETRIES,
                http_client=http_client,
            )

    def generate_reply(self, instructions: str, messages: list[ChatMessage]) -> NpcReply:
        """Ask the model for one structured reply.

        Args:
            instructions: The rules and personality the model must follow.
            messages: The conversation so far, ending with the visitor's new message.

        Returns:
            The model's reply, in the required structure.

        Raises:
            LlmError: If no usable reply was produced. Its code says why.
        """
        if self.client is None:
            raise LlmError("llm_not_configured")

        try:
            response = self.client.responses.parse(
                model=self.settings.openai_chat_model,
                reasoning={"effort": self.settings.openai_reasoning_effort},
                instructions=instructions,
                input=[message.model_dump() for message in messages],
                text_format=NpcReply,
                max_output_tokens=MAX_OUTPUT_TOKENS,
                # Conversations are saved locally, so OpenAI has no need to keep a copy.
                store=False,
            )
        except AuthenticationError as error:
            raise LlmError("llm_not_configured") from error
        except RateLimitError as error:
            # OpenAI uses the same status for "too many requests" and "no credit left",
            # and only the second one needs the owner to act.
            if error.code == "insufficient_quota":
                raise LlmError("llm_out_of_credit") from error
            raise LlmError("llm_unavailable") from error
        except OpenAIError as error:
            raise LlmError("llm_unavailable") from error
        except ValidationError as error:
            # A reply cut off by the token limit is broken JSON, which lands here.
            raise LlmError("llm_bad_reply") from error

        reply = response.output_parsed

        # A refusal has no parsed reply, and a blank answer would look like a silent NPC.
        if reply is None or not reply.answer.strip():
            raise LlmError("llm_bad_reply")

        return reply
