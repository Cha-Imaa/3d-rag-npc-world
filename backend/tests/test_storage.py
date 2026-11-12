"""Tests for conversation storage: saving, loading, limits, deleting, and separation."""

import sqlite3
from pathlib import Path
from uuid import UUID

import pytest

from app.citations import Citation
from app.referrals import Referral
from app.storage import ConversationStore, SavedMessage

VISITOR = UUID("6f1c1a52-7d3e-4b7a-9c55-0d9a7f3b2e11")
OTHER_VISITOR = UUID("0b8e2f4c-3a1d-4e6f-8b2a-9c7d5e1f3a20")

CITATION = Citation(
    id="weather-record.txt#2",
    title="Weather Record",
    source_file="weather-record.txt",
    page=None,
    section="Storms",
    text="The Salt Wind blows from the east.",
)


@pytest.fixture
def store(conversation_store: ConversationStore) -> ConversationStore:
    """Use the empty database file each test gets from conftest.py."""
    return conversation_store


def visitor_message(content: str) -> SavedMessage:
    """Build the saved form of a visitor's message."""
    return SavedMessage(role="visitor", content=content, citations=[])


def npc_message(content: str, citations: list[Citation] | None = None) -> SavedMessage:
    """Build the saved form of an NPC's reply."""
    return SavedMessage(role="npc", content=content, citations=citations or [])


def test_a_new_conversation_is_empty(store: ConversationStore) -> None:
    assert store.load_messages(VISITOR, "first") == []


def test_saves_and_loads_an_exchange_with_its_citations(store: ConversationStore) -> None:
    """A restored reply must show the same sources as when it was first shown."""
    store.save_exchange(VISITOR, "first", "Which wind?", "The Salt Wind.", [CITATION])

    assert store.load_messages(VISITOR, "first") == [
        visitor_message("Which wind?"),
        npc_message("The Salt Wind.", [CITATION]),
    ]


def test_saves_and_loads_a_reply_with_its_referral(store: ConversationStore) -> None:
    """A restored reply must show the same referral card as when it was first shown."""
    referral = Referral(npc_id="second", reason="They keep the boat records.")

    store.save_exchange(VISITOR, "first", "Who knows boats?", "Not me.", [], referral)

    assert store.load_messages(VISITOR, "first") == [
        visitor_message("Who knows boats?"),
        SavedMessage(role="npc", content="Not me.", citations=[], referral=referral),
    ]


def test_loads_messages_oldest_first(store: ConversationStore) -> None:
    store.save_exchange(VISITOR, "first", "One", "Reply one", [])
    store.save_exchange(VISITOR, "first", "Two", "Reply two", [])

    contents = [message.content for message in store.load_messages(VISITOR, "first")]

    assert contents == ["One", "Reply one", "Two", "Reply two"]


def test_a_limit_keeps_the_most_recent_messages(store: ConversationStore) -> None:
    """Only recent messages go to the model, still in the order they were written."""
    store.save_exchange(VISITOR, "first", "One", "Reply one", [])
    store.save_exchange(VISITOR, "first", "Two", "Reply two", [])

    contents = [message.content for message in store.load_messages(VISITOR, "first", limit=3)]

    assert contents == ["Reply one", "Two", "Reply two"]


def test_each_npc_has_its_own_conversation(store: ConversationStore) -> None:
    store.save_exchange(VISITOR, "first", "To first", "From first", [])
    store.save_exchange(VISITOR, "second", "To second", "From second", [])

    assert store.load_messages(VISITOR, "first") == [
        visitor_message("To first"),
        npc_message("From first"),
    ]
    assert store.load_messages(VISITOR, "second") == [
        visitor_message("To second"),
        npc_message("From second"),
    ]


def test_visitors_never_see_each_others_messages(store: ConversationStore) -> None:
    store.save_exchange(VISITOR, "first", "Mine", "Reply to me", [])

    assert store.load_messages(OTHER_VISITOR, "first") == []


def test_reuses_one_thread_per_visitor_and_npc(store: ConversationStore) -> None:
    """Several exchanges with the same NPC belong to a single thread."""
    store.save_exchange(VISITOR, "first", "One", "Reply one", [])
    store.save_exchange(VISITOR, "first", "Two", "Reply two", [])
    store.save_exchange(VISITOR, "second", "Three", "Reply three", [])

    with store.connect() as connection:
        [(thread_count,)] = connection.execute("SELECT COUNT(*) FROM threads").fetchall()

    assert thread_count == 2


def test_deleting_clears_every_conversation_of_one_visitor(store: ConversationStore) -> None:
    store.save_exchange(VISITOR, "first", "One", "Reply one", [CITATION])
    store.save_exchange(VISITOR, "second", "Two", "Reply two", [])
    store.save_exchange(OTHER_VISITOR, "first", "Theirs", "Reply to them", [])

    store.delete_conversations(VISITOR)

    assert store.load_messages(VISITOR, "first") == []
    assert store.load_messages(VISITOR, "second") == []
    # Another visitor's conversation is untouched.
    assert len(store.load_messages(OTHER_VISITOR, "first")) == 2


def test_deleting_removes_the_messages_too(store: ConversationStore) -> None:
    """Deleted text must not stay behind in the file, even if nothing can load it."""
    store.save_exchange(VISITOR, "first", "Private", "Reply", [])

    store.delete_conversations(VISITOR)

    with store.connect() as connection:
        [(message_count,)] = connection.execute("SELECT COUNT(*) FROM messages").fetchall()

    assert message_count == 0


def test_a_failed_save_leaves_nothing_behind(store: ConversationStore) -> None:
    """If saving the reply fails, the visitor's message must not be saved alone."""
    store.save_exchange(VISITOR, "first", "Earlier", "Earlier reply", [])

    # A missing answer breaks the NOT NULL rule on the second insert, after the
    # visitor's message was already inserted in the same transaction.
    with pytest.raises(sqlite3.IntegrityError):
        store.save_exchange(VISITOR, "first", "Later", None, [])  # type: ignore[arg-type]

    assert [message.content for message in store.load_messages(VISITOR, "first")] == [
        "Earlier",
        "Earlier reply",
    ]


def test_keeps_conversations_after_reopening_the_file(tmp_path: Path) -> None:
    """Conversations live in the file, so they survive a server restart."""
    database_path = tmp_path / "conversations.db"
    ConversationStore(database_path).save_exchange(VISITOR, "first", "Hello", "Hi", [])

    reopened = ConversationStore(database_path)

    assert len(reopened.load_messages(VISITOR, "first")) == 2


def test_adds_the_referral_column_to_an_older_database(tmp_path: Path) -> None:
    """A database made before referrals were saved keeps its messages and gains the column."""
    database_path = tmp_path / "conversations.db"
    ConversationStore(database_path).save_exchange(VISITOR, "first", "Old", "Old reply", [])
    with sqlite3.connect(database_path) as connection:
        connection.execute("ALTER TABLE messages DROP COLUMN referral_json")
    connection.close()

    reopened = ConversationStore(database_path)
    reopened.save_exchange(
        VISITOR, "first", "New", "New reply", [], Referral(npc_id="second", reason="Ask them.")
    )

    messages = reopened.load_messages(VISITOR, "first")
    assert [message.content for message in messages] == ["Old", "Old reply", "New", "New reply"]
    assert messages[1].referral is None
    assert messages[3].referral == Referral(npc_id="second", reason="Ask them.")


def test_creates_the_database_folder(tmp_path: Path) -> None:
    database_path = tmp_path / "new-folder" / "conversations.db"

    ConversationStore(database_path)

    assert database_path.exists()
