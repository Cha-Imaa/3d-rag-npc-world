"""Tests for building, saving, and loading search indexes. All use the fake embedder."""

import json
from pathlib import Path

import numpy as np
import pytest

from app.ingest import (
    CHUNKS_FILE_NAME,
    EMBEDDINGS_FILE_NAME,
    IngestError,
    build_index,
    choose_knowledge_bases,
    load_index,
    main,
    save_index,
    scale_rows_to_length_one,
)
from app.llm import FAKE_EMBEDDING_MODEL, FakeLlm


def test_scale_rows_to_length_one_leaves_zero_rows_alone() -> None:
    matrix = np.array([[3.0, 4.0], [0.0, 0.0]])

    scaled = scale_rows_to_length_one(matrix)

    assert np.allclose(scaled, [[0.6, 0.8], [0.0, 0.0]])


def test_build_index_gives_one_unit_row_per_chunk() -> None:
    index, input_tokens = build_index("test-collection-one", FakeLlm())

    assert index.knowledge_base_id == "test-collection-one"
    assert index.embedding_model == FAKE_EMBEDDING_MODEL
    assert index.embeddings.shape[0] == len(index.chunks)
    assert np.allclose(np.linalg.norm(index.embeddings, axis=1), 1.0)
    assert input_tokens == 0


def test_build_index_refuses_a_missing_folder() -> None:
    with pytest.raises(IngestError):
        build_index("no-such-collection", FakeLlm())


def test_saved_index_loads_back_unchanged(tmp_path: Path) -> None:
    index, _ = build_index("test-collection-two", FakeLlm())

    folder = save_index(index, indexes_directory=tmp_path)
    loaded = load_index("test-collection-two", FAKE_EMBEDDING_MODEL, indexes_directory=tmp_path)

    assert folder == tmp_path / "test-collection-two"
    assert loaded.chunks == index.chunks
    assert np.array_equal(loaded.embeddings, index.embeddings)


def test_load_index_refuses_a_different_embedding_model(tmp_path: Path) -> None:
    index, _ = build_index("test-collection-two", FakeLlm())
    save_index(index, indexes_directory=tmp_path)

    with pytest.raises(IngestError, match="text-embedding-3-small"):
        load_index("test-collection-two", "text-embedding-3-small", indexes_directory=tmp_path)


def test_load_index_explains_a_missing_index(tmp_path: Path) -> None:
    with pytest.raises(IngestError, match="uv run python -m app.ingest test-collection-one"):
        load_index("test-collection-one", FAKE_EMBEDDING_MODEL, indexes_directory=tmp_path)


def test_load_index_refuses_damaged_chunk_details(tmp_path: Path) -> None:
    index, _ = build_index("test-collection-two", FakeLlm())
    folder = save_index(index, indexes_directory=tmp_path)
    (folder / CHUNKS_FILE_NAME).write_text("{ not json", encoding="utf-8")

    with pytest.raises(IngestError, match="damaged"):
        load_index("test-collection-two", FAKE_EMBEDDING_MODEL, indexes_directory=tmp_path)


def test_load_index_refuses_a_row_count_mismatch(tmp_path: Path) -> None:
    index, _ = build_index("test-collection-two", FakeLlm())
    folder = save_index(index, indexes_directory=tmp_path)
    # Drop one chunk, as if the two files came from different builds.
    details = json.loads((folder / CHUNKS_FILE_NAME).read_text(encoding="utf-8"))
    details["chunks"] = details["chunks"][:-1]
    (folder / CHUNKS_FILE_NAME).write_text(json.dumps(details), encoding="utf-8")

    with pytest.raises(IngestError, match="mismatched"):
        load_index("test-collection-two", FAKE_EMBEDDING_MODEL, indexes_directory=tmp_path)


def test_saved_embeddings_cannot_hold_pickled_objects(tmp_path: Path) -> None:
    index, _ = build_index("test-collection-two", FakeLlm())
    folder = save_index(index, indexes_directory=tmp_path)
    # An object array can only be read with pickle, which load_index never allows.
    np.save(folder / EMBEDDINGS_FILE_NAME, np.array([{"a": 1}], dtype=object), allow_pickle=True)

    with pytest.raises(IngestError, match="damaged"):
        load_index("test-collection-two", FAKE_EMBEDDING_MODEL, indexes_directory=tmp_path)


def test_choose_knowledge_bases_defaults_to_every_configured_one() -> None:
    assert choose_knowledge_bases([], ["one", "two"]) == ["one", "two"]
    assert choose_knowledge_bases(["two"], ["one", "two"]) == ["two"]


def test_choose_knowledge_bases_refuses_an_unknown_name() -> None:
    with pytest.raises(IngestError, match="unknown"):
        choose_knowledge_bases(["unknown"], ["one", "two"])


def test_main_stops_with_a_message_for_an_unknown_name(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = main(["unknown-collection"])

    assert exit_code == 1
    assert "unknown-collection" in capsys.readouterr().err
