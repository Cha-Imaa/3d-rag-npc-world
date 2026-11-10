"""Shared test setup: keep saved conversations out of the real data folder."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.main import app, get_store
from app.storage import ConversationStore


@pytest.fixture(autouse=True)
def conversation_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[ConversationStore]:
    """Give every test its own empty conversation database in a temporary folder.

    The setting covers tests that start the whole app, and the override covers tests
    that replace the app's parts, so no test writes to data/conversations.db.
    """
    database_path = tmp_path / "conversations.db"
    monkeypatch.setenv("DATABASE_PATH", str(database_path))

    store = ConversationStore(database_path)
    app.dependency_overrides[get_store] = lambda: store
    yield store
    app.dependency_overrides.pop(get_store, None)
