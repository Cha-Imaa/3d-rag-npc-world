"""Loreland API entry point: creates the FastAPI app and registers its routes."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.chat import (
    LLM_ERROR_MESSAGES,
    ChatRequest,
    ChatResponse,
    build_instructions,
    build_messages,
)
from app.llm import FakeLlm, LlmError, OpenAiLlm, TokenUsage, create_llm
from app.npcs import NpcConfig, PublicNpc, find_enabled_npc, list_public_npcs, load_npcs
from app.settings import Settings

logger = logging.getLogger(__name__)

# Uvicorn only sets up its own loggers, so without this the app's info lines are hidden.
# The format matches Uvicorn's, so both read the same in the terminal.
app_logger = logging.getLogger("app")
app_logger.setLevel(logging.INFO)
if not app_logger.handlers:
    log_handler = logging.StreamHandler()
    log_handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
    app_logger.addHandler(log_handler)


class NpcNotFoundError(Exception):
    """The visitor asked for an NPC that does not exist or is disabled."""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load NPC files once at startup, so a broken file stops the server with a clear error."""
    app.state.npcs = load_npcs()
    app.state.llm = create_llm(Settings())
    yield


app = FastAPI(title="Loreland API", lifespan=lifespan)


def get_npcs(request: Request) -> list[NpcConfig]:
    """Give a route the NPCs loaded at startup. Tests replace this with their own list."""
    return request.app.state.npcs


def get_llm(request: Request) -> OpenAiLlm | FakeLlm:
    """Give a route the LLM chosen at startup. Tests replace this with their own."""
    return request.app.state.llm


def log_token_usage(npc_id: str, usage: TokenUsage | None) -> None:
    """Record what one reply cost, to keep track of the API credit.

    Only the NPC and the counts are logged. Message text and the visitor ID are left
    out, so the log never holds what visitors wrote or who wrote it.

    Args:
        npc_id: The NPC that replied.
        usage: The reply's token counts, or None if OpenAI did not report them.
    """
    if usage is None:
        logger.info("Chat reply: npc_id=%s tokens unknown", npc_id)
        return

    logger.info(
        "Chat reply: npc_id=%s input_tokens=%d output_tokens=%d",
        npc_id,
        usage.input_tokens,
        usage.output_tokens,
    )


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """Build the one error shape the interface understands.

    Args:
        status_code: The HTTP status.
        code: A stable name the interface can respond to.
        message: Plain-language text for the visitor.

    Returns:
        The JSON response to send.
    """
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


@app.exception_handler(RequestValidationError)
def handle_invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
    """Answer a badly formed request, without repeating what was sent."""
    return error_response(422, "invalid_request", "That message couldn't be sent. Please check it.")


@app.exception_handler(NpcNotFoundError)
def handle_npc_not_found(request: Request, error: NpcNotFoundError) -> JSONResponse:
    """Answer a request for an NPC the visitor can't talk to."""
    return error_response(404, "npc_not_found", "That character isn't available.")


@app.exception_handler(LlmError)
def handle_llm_error(request: Request, error: LlmError) -> JSONResponse:
    """Answer a failed reply with an error, so it can never look like an NPC's answer."""
    return error_response(503, error.code, LLM_ERROR_MESSAGES[error.code])


@app.get("/api/health")
def read_health() -> dict[str, str]:
    """Report that the API is running.

    Returns:
        A small JSON object the frontend uses to show the backend status.
    """
    return {"status": "ok"}


@app.get("/api/npcs")
def read_npcs(npcs: Annotated[list[NpcConfig], Depends(get_npcs)]) -> list[PublicNpc]:
    """List the enabled NPCs.

    Args:
        npcs: The configured NPCs.

    Returns:
        Public fields only. Instructions and knowledge base IDs stay on the server.
    """
    return list_public_npcs(npcs)


# A plain def, not async: FastAPI then runs it on a worker thread, so a slow LLM call
# doesn't stop the server from answering other requests.
@app.post("/api/chat")
def send_chat_message(
    chat_request: ChatRequest,
    # Required and checked now, so the browser is ready for when conversations are saved.
    visitor_id: Annotated[UUID, Header(alias="X-Visitor-Id")],
    npcs: Annotated[list[NpcConfig], Depends(get_npcs)],
    llm: Annotated[OpenAiLlm | FakeLlm, Depends(get_llm)],
) -> ChatResponse:
    """Send the visitor's message to an NPC and return its reply.

    Args:
        chat_request: The NPC's ID and the visitor's message.
        visitor_id: The anonymous ID the browser created.
        npcs: The configured NPCs.
        llm: What produces the reply.

    Returns:
        The NPC's answer.

    Raises:
        NpcNotFoundError: If the NPC does not exist or is disabled.
        LlmError: If no usable reply was produced, including a "grounded" reply while
            there are no documents.
    """
    npc = find_enabled_npc(npcs, chat_request.npc_id)
    if npc is None:
        raise NpcNotFoundError

    # Only the new message for now. Earlier messages are added once they are saved.
    messages = build_messages(chat_request.message, passages=[])
    generated = llm.generate_reply(build_instructions(npc), messages)
    # Logged before any check below, because a rejected reply is still paid for.
    log_token_usage(npc.id, generated.usage)

    # There are no documents yet, so a "grounded" reply claims evidence it cannot have.
    # It fails like any unusable reply, which lets the visitor try again.
    if generated.reply.kind == "grounded":
        logger.warning("Chat reply rejected: npc_id=%s claimed grounded", npc.id)
        raise LlmError("llm_bad_reply")

    return ChatResponse(answer=generated.reply.answer)
