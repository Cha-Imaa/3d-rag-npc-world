"""Loreland API entry point: creates the FastAPI app and registers its routes."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request

from app.npcs import NpcConfig, PublicNpc, list_public_npcs, load_npcs


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load NPC files once at startup, so a broken file stops the server with a clear error."""
    app.state.npcs = load_npcs()
    yield


app = FastAPI(title="Loreland API", lifespan=lifespan)


def get_npcs(request: Request) -> list[NpcConfig]:
    """Give a route the NPCs loaded at startup. Tests replace this with their own list."""
    return request.app.state.npcs


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
