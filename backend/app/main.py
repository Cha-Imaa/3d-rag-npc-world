"""Loreland API entry point: creates the FastAPI app and registers its routes."""

from fastapi import FastAPI

app = FastAPI(title="Loreland API")


@app.get("/api/health")
def read_health() -> dict[str, str]:
    """Report that the API is running.

    Returns:
        A small JSON object the frontend uses to show the backend status.
    """
    return {"status": "ok"}
