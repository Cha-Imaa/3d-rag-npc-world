"""NPC configuration: load one TOML file per NPC from data/npcs and check it is valid."""

import tomllib
from collections import Counter
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

NPC_DIRECTORY = Path(__file__).resolve().parents[2] / "data" / "npcs"

# IDs become URL parts and folder names, so they are limited to safe characters.
SAFE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]*$"


class NpcConfigError(Exception):
    """An NPC file is missing, unreadable, or breaks a configuration rule."""


class ScenePosition(BaseModel):
    """A tile on the village's hexagon grid."""

    q: int
    r: int


class NpcConfig(BaseModel):
    """Everything configured for one NPC, including fields the browser must never see."""

    # Rejecting unknown fields means a misspelled setting fails loudly instead of being ignored.
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=SAFE_ID_PATTERN)
    display_name: str = Field(min_length=1, max_length=60)
    enabled: bool
    personality_instructions: str = Field(min_length=1)
    expertise: str = Field(min_length=1)
    knowledge_base_id: str = Field(pattern=SAFE_ID_PATTERN)
    scene_position: ScenePosition
    # Optional until real models are chosen. The scene draws a neutral stand-in without one.
    model_asset_path: str | None = None


class PublicNpc(BaseModel):
    """The only NPC fields the browser receives."""

    id: str
    display_name: str
    scene_position: ScenePosition


def read_npc_file(path: Path) -> NpcConfig:
    """Read and validate one NPC file.

    Args:
        path: The TOML file to read.

    Returns:
        The validated NPC.

    Raises:
        NpcConfigError: If the file is not valid TOML or breaks a field rule.
    """
    try:
        with path.open("rb") as file:
            return NpcConfig.model_validate(tomllib.load(file))
    except (tomllib.TOMLDecodeError, ValidationError) as error:
        raise NpcConfigError(f"{path.name}: {error}") from error


def find_repeats(values: list) -> list:
    """List the values that appear more than once."""
    return [value for value, count in Counter(values).items() if count > 1]


def check_npcs_work_together(npcs: list[NpcConfig]) -> None:
    """Check the rules that involve more than one NPC.

    Args:
        npcs: Every configured NPC, enabled or not.

    Raises:
        NpcConfigError: If two NPCs clash.
    """
    repeated_ids = find_repeats([npc.id for npc in npcs])
    if repeated_ids:
        raise NpcConfigError(f"NPC IDs are used more than once: {repeated_ids}")

    # Sharing a knowledge base would let one NPC search another NPC's documents.
    repeated_knowledge_bases = find_repeats([npc.knowledge_base_id for npc in npcs])
    if repeated_knowledge_bases:
        raise NpcConfigError(f"Knowledge bases are shared: {repeated_knowledge_bases}")

    # Disabled NPCs are not drawn, so they may share a tile with an enabled one.
    tiles = [(npc.scene_position.q, npc.scene_position.r) for npc in npcs if npc.enabled]
    repeated_tiles = find_repeats(tiles)
    if repeated_tiles:
        raise NpcConfigError(f"Enabled NPCs share a tile: {repeated_tiles}")


def load_npcs(directory: Path = NPC_DIRECTORY) -> list[NpcConfig]:
    """Load every NPC file in a folder.

    Args:
        directory: The folder holding one TOML file per NPC.

    Returns:
        All NPCs, in file name order so the list is always the same.

    Raises:
        NpcConfigError: If any file is invalid, or two NPCs clash.
    """
    npcs = [read_npc_file(path) for path in sorted(directory.glob("*.toml"))]
    check_npcs_work_together(npcs)

    return npcs


def list_public_npcs(npcs: list[NpcConfig]) -> list[PublicNpc]:
    """Keep enabled NPCs, with only the fields that are safe to send to the browser.

    Args:
        npcs: The configured NPCs.

    Returns:
        The public version of each enabled NPC.
    """
    return [
        PublicNpc(id=npc.id, display_name=npc.display_name, scene_position=npc.scene_position)
        for npc in npcs
        if npc.enabled
    ]
