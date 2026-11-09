"""Tests for loading NPC files and for the NPC list endpoint."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_npcs
from app.npcs import NpcConfig, NpcConfigError, load_npcs


def npc_file_text(
    npc_id: str = "test-npc",
    knowledge_base_id: str = "test-collection",
    q: int = 0,
    enabled: bool = True,
    no_evidence_message: str = "Nothing in my records.",
    extra_line: str = "",
) -> str:
    """Build the text of a valid NPC file, with the given values changed."""
    return f"""
id = "{npc_id}"
display_name = "Test NPC"
enabled = {str(enabled).lower()}
personality_instructions = "Secret instructions"
expertise = "Test expertise"
knowledge_base_id = "{knowledge_base_id}"
no_evidence_message = "{no_evidence_message}"
scene_position = {{ q = {q}, r = 1 }}
{extra_line}
"""


def write_npc_file(directory: Path, name: str, text: str) -> None:
    """Save NPC text as a TOML file in a test folder."""
    (directory / f"{name}.toml").write_text(text, encoding="utf-8")


def test_real_npc_files_are_valid() -> None:
    """The files in data/npcs should load, with at least the three the PRD asks for."""
    assert len([npc for npc in load_npcs() if npc.enabled]) >= 3


def test_loads_a_valid_file(tmp_path: Path) -> None:
    """A valid file should load with its values intact."""
    write_npc_file(tmp_path, "one", npc_file_text())

    [npc] = load_npcs(tmp_path)

    assert npc.id == "test-npc"
    assert npc.scene_position.r == 1


def test_a_new_file_adds_an_npc_with_no_code_change(tmp_path: Path) -> None:
    """Each file in the folder should become an NPC, in file name order."""
    write_npc_file(tmp_path, "b", npc_file_text("second", "collection-b", q=1))
    write_npc_file(tmp_path, "a", npc_file_text("first", "collection-a", q=2))

    assert [npc.id for npc in load_npcs(tmp_path)] == ["first", "second"]


@pytest.mark.parametrize(
    "text",
    [
        "this is not toml",
        'id = "only-an-id"',
        npc_file_text(npc_id="Not Safe/../id"),
        npc_file_text(knowledge_base_id="../other-collection"),
        npc_file_text(extra_line='misspelled_setting = "value"'),
        npc_file_text(no_evidence_message=""),
    ],
    ids=[
        "bad-toml",
        "missing-fields",
        "unsafe-id",
        "unsafe-knowledge-base",
        "unknown-field",
        "blank-no-evidence-message",
    ],
)
def test_rejects_an_invalid_file_and_names_it(tmp_path: Path, text: str) -> None:
    """A broken file should stop loading, and the error should say which file it was."""
    write_npc_file(tmp_path, "broken", text)

    with pytest.raises(NpcConfigError, match=r"broken\.toml"):
        load_npcs(tmp_path)


def test_rejects_a_repeated_id(tmp_path: Path) -> None:
    """Two NPCs with one ID would mix up their conversations."""
    write_npc_file(tmp_path, "a", npc_file_text("same", "collection-a", q=1))
    write_npc_file(tmp_path, "b", npc_file_text("same", "collection-b", q=2))

    with pytest.raises(NpcConfigError, match="IDs"):
        load_npcs(tmp_path)


def test_rejects_a_shared_knowledge_base(tmp_path: Path) -> None:
    """Two NPCs must never search the same documents."""
    write_npc_file(tmp_path, "a", npc_file_text("first", "shared", q=1))
    write_npc_file(tmp_path, "b", npc_file_text("second", "shared", q=2))

    with pytest.raises(NpcConfigError, match="Knowledge bases"):
        load_npcs(tmp_path)


def test_rejects_enabled_npcs_on_one_tile(tmp_path: Path) -> None:
    """Two enabled NPCs on one tile would stand inside each other."""
    write_npc_file(tmp_path, "a", npc_file_text("first", "collection-a"))
    write_npc_file(tmp_path, "b", npc_file_text("second", "collection-b"))

    with pytest.raises(NpcConfigError, match="tile"):
        load_npcs(tmp_path)


def test_allows_a_disabled_npc_to_share_a_tile(tmp_path: Path) -> None:
    """A disabled NPC is not drawn, so it cannot get in the way."""
    write_npc_file(tmp_path, "a", npc_file_text("first", "collection-a"))
    write_npc_file(tmp_path, "b", npc_file_text("second", "collection-b", enabled=False))

    assert len(load_npcs(tmp_path)) == 2


@pytest.fixture
def api_with_two_npcs(tmp_path: Path):
    """Give a test client that serves one enabled and one disabled NPC."""
    write_npc_file(tmp_path, "a", npc_file_text("shown", "collection-a", q=1))
    write_npc_file(tmp_path, "b", npc_file_text("hidden", "collection-b", q=2, enabled=False))
    npcs: list[NpcConfig] = load_npcs(tmp_path)

    app.dependency_overrides[get_npcs] = lambda: npcs
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_list_has_only_enabled_npcs_and_public_fields(api_with_two_npcs: TestClient) -> None:
    """The browser should get exactly these fields, which leaves out everything private."""
    response = api_with_two_npcs.get("/api/npcs")

    assert response.status_code == 200
    assert response.json() == [
        {"id": "shown", "display_name": "Test NPC", "scene_position": {"q": 1, "r": 1}}
    ]


def test_server_startup_loads_the_real_npcs() -> None:
    """Starting the app should load data/npcs and serve it, with nothing replaced."""
    with TestClient(app) as client:
        response = client.get("/api/npcs")

    assert response.status_code == 200
    assert len(response.json()) >= 3
