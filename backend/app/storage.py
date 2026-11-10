"""Conversation storage: save, load, and delete each visitor's chats in SQLite.

Every query is scoped by visitor ID and NPC ID through the thread, so one visitor can
never read another visitor's messages, and one NPC's history never mixes with another's.
"""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel

from app.citations import Citation

# "visitor" for what the visitor wrote, "npc" for the NPC's checked reply.
MessageRole = Literal["visitor", "npc"]

# One thread per visitor and NPC for now. The thread ID exists so more threads can be
# added later without changing how messages are stored.
# Message order comes from the message ID, which only grows, rather than from timestamps,
# because two messages can be saved within the same second.
SCHEMA = """
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    npc_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (visitor_id, npc_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('visitor', 'npc')),
    content TEXT NOT NULL,
    citations_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS messages_by_thread ON messages (thread_id, id);
"""


class SavedMessage(BaseModel):
    """One saved message, as it was shown to the visitor."""

    role: MessageRole
    content: str
    # Empty for visitor messages and for NPC replies without sources.
    citations: list[Citation]


class ConversationStore:
    """Reads and writes conversations in one SQLite file."""

    def __init__(self, database_path: Path) -> None:
        """Create the database file and its tables if they don't exist yet.

        Args:
            database_path: Where the SQLite file lives. Its folder is created if needed.
        """
        self.database_path = database_path
        database_path.parent.mkdir(parents=True, exist_ok=True)

        with self.connect() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Open a short-lived connection, commit if all went well, and always close it.

        A new connection per call is simplest here: FastAPI runs routes on several
        threads, and a SQLite connection should not be shared between threads.
        """
        connection = sqlite3.connect(self.database_path)
        try:
            # SQLite leaves foreign keys off unless asked, and deletes rely on them.
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:  # Commits on success, rolls back on an error.
                yield connection
        finally:
            connection.close()

    def save_exchange(
        self,
        visitor_id: UUID,
        npc_id: str,
        visitor_message: str,
        npc_answer: str,
        citations: list[Citation],
    ) -> None:
        """Save a visitor's message and the NPC's reply together.

        Both are saved in one transaction, and only after a reply succeeded, so a
        failed send leaves nothing behind and a retry doesn't save the message twice.

        Args:
            visitor_id: The anonymous ID the browser created.
            npc_id: The NPC the visitor talked to.
            visitor_message: What the visitor wrote.
            npc_answer: The checked answer shown to the visitor.
            citations: The checked citations shown under the answer.
        """
        citations_json = json.dumps([citation.model_dump() for citation in citations])

        with self.connect() as connection:
            thread_id = find_or_create_thread(connection, visitor_id, npc_id)
            connection.execute(
                "INSERT INTO messages (thread_id, role, content) VALUES (?, 'visitor', ?)",
                (thread_id, visitor_message),
            )
            connection.execute(
                "INSERT INTO messages (thread_id, role, content, citations_json)"
                " VALUES (?, 'npc', ?, ?)",
                (thread_id, npc_answer, citations_json),
            )

    def load_messages(
        self, visitor_id: UUID, npc_id: str, limit: int | None = None
    ) -> list[SavedMessage]:
        """Load one visitor's conversation with one NPC, oldest message first.

        Args:
            visitor_id: The anonymous ID the browser created.
            npc_id: The NPC whose conversation to load.
            limit: If given, only the most recent messages, up to this many.

        Returns:
            The saved messages, or an empty list if they have never talked.
        """
        # Newest first, so LIMIT keeps the most recent. SQLite treats -1 as no limit.
        query = """
            SELECT messages.role, messages.content, messages.citations_json
            FROM messages
            JOIN threads ON threads.id = messages.thread_id
            WHERE threads.visitor_id = ? AND threads.npc_id = ?
            ORDER BY messages.id DESC
            LIMIT ?
        """
        row_limit = -1 if limit is None else limit

        with self.connect() as connection:
            rows = connection.execute(query, (str(visitor_id), npc_id, row_limit)).fetchall()

        messages = [
            SavedMessage(
                role=role,
                content=content,
                citations=[Citation.model_validate(item) for item in json.loads(citations_json)],
            )
            for role, content, citations_json in rows
        ]
        messages.reverse()  # Back to oldest first, the order they are shown in.

        return messages

    def delete_conversations(self, visitor_id: UUID) -> None:
        """Delete every conversation of one visitor, with all their messages.

        Args:
            visitor_id: The anonymous ID the browser created.
        """
        with self.connect() as connection:
            # Messages go too, through ON DELETE CASCADE.
            connection.execute("DELETE FROM threads WHERE visitor_id = ?", (str(visitor_id),))


def find_or_create_thread(connection: sqlite3.Connection, visitor_id: UUID, npc_id: str) -> str:
    """Return the ID of the visitor's thread with this NPC, creating it on first use.

    Args:
        connection: An open connection, so this runs inside the caller's transaction.
        visitor_id: The anonymous ID the browser created.
        npc_id: The NPC the visitor is talking to.

    Returns:
        The thread's ID.
    """
    # INSERT OR IGNORE does nothing if the pair already has a thread, so two requests
    # arriving at once can't create two threads for the same visitor and NPC.
    connection.execute(
        "INSERT OR IGNORE INTO threads (id, visitor_id, npc_id) VALUES (?, ?, ?)",
        (str(uuid4()), str(visitor_id), npc_id),
    )
    row = connection.execute(
        "SELECT id FROM threads WHERE visitor_id = ? AND npc_id = ?",
        (str(visitor_id), npc_id),
    ).fetchone()

    return row[0]
