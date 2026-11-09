"""Tests for searching one knowledge base. All use the fake embedder, which matches words."""

import logging
from pathlib import Path

import numpy as np
import pytest

from app.ingest import SearchIndex, build_index, save_index
from app.llm import FAKE_EMBEDDING_MODEL, FakeLlm
from app.npcs import NpcConfig, ScenePosition
from app.retrieval import load_indexes, search_index


def make_npc(npc_id: str, knowledge_base_id: str, enabled: bool) -> NpcConfig:
    """Build an NPC that uses the given knowledge base."""
    return NpcConfig(
        id=npc_id,
        display_name="Test NPC",
        enabled=enabled,
        personality_instructions="Test personality",
        expertise="Test expertise",
        knowledge_base_id=knowledge_base_id,
        no_evidence_message="Nothing in my records.",
        scene_position=ScenePosition(q=0, r=0),
    )


@pytest.fixture(scope="module")
def indexes() -> dict[str, SearchIndex]:
    """Build each test collection's index once for the whole file."""
    names = ["test-collection-one", "test-collection-two", "test-collection-three"]
    return {name: build_index(name, FakeLlm())[0] for name in names}


def test_search_finds_the_passage_that_holds_the_fact(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(indexes["test-collection-one"], "What is the Salt Wind?", FakeLlm())

    assert passages
    assert "Salt Wind" in passages[0].chunk.text


def test_search_returns_best_first_and_respects_the_limit(
    indexes: dict[str, SearchIndex],
) -> None:
    passages = search_index(
        indexes["test-collection-two"],
        "bees hives orchard keepers",
        FakeLlm(),
        max_passages=2,
        score_floor=0.0,
    )

    assert len(passages) == 2
    assert passages[0].score >= passages[1].score


def test_search_drops_passages_below_the_floor(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(
        indexes["test-collection-one"], "Salt Wind", FakeLlm(), score_floor=1.01
    )

    assert passages == []


def test_a_question_with_no_words_finds_nothing(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(indexes["test-collection-one"], "?!", FakeLlm())

    assert passages == []


def test_search_only_returns_passages_from_the_given_index(
    indexes: dict[str, SearchIndex],
) -> None:
    # Ribbonstone only appears in collection three, so collection one must not return it.
    passages = search_index(
        indexes["test-collection-one"], "ribbonstone", FakeLlm(), score_floor=0.0
    )
    own_ids = {chunk.id for chunk in indexes["test-collection-one"].chunks}

    assert all(passage.chunk.id in own_ids for passage in passages)
    assert all("ribbonstone" not in passage.chunk.text.lower() for passage in passages)


def test_scores_are_cosine_similarities(indexes: dict[str, SearchIndex]) -> None:
    passages = search_index(
        indexes["test-collection-three"], "ribbonstone quarry", FakeLlm(), score_floor=-1.0
    )

    assert all(-1.0 <= passage.score <= 1.0 + 1e-6 for passage in passages)
    assert np.isfinite([passage.score for passage in passages]).all()


def test_load_indexes_skips_missing_and_disabled_ones(
    tmp_path: Path, indexes: dict[str, SearchIndex], caplog: pytest.LogCaptureFixture
) -> None:
    """A missing index is logged, not fatal, so the server still starts without one."""
    save_index(indexes["test-collection-one"], indexes_directory=tmp_path)
    save_index(indexes["test-collection-three"], indexes_directory=tmp_path)
    npcs = [
        make_npc("one", "test-collection-one", enabled=True),
        make_npc("two", "test-collection-two", enabled=True),
        make_npc("three", "test-collection-three", enabled=False),
    ]

    with caplog.at_level(logging.WARNING, logger="app"):
        loaded = load_indexes(npcs, FAKE_EMBEDDING_MODEL, indexes_directory=tmp_path)

    assert list(loaded) == ["test-collection-one"]
    assert any("No search index for two" in message for message in caplog.messages)
