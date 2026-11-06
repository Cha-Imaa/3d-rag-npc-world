/**
 * For tests only: where the NPC files in data/npcs place their NPCs.
 * In the app, positions come from the API. Reading the same files here means a new NPC
 * on a blocked or unreachable tile fails the tests, with no code change needed to cover it.
 */
import type { HexCoordinate } from './villageLayout'

const NPC_FILES = import.meta.glob<string>('../../../data/npcs/*.toml', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const SCENE_POSITION_LINE = /^scene_position\s*=\s*\{\s*q\s*=\s*(-?\d+)\s*,\s*r\s*=\s*(-?\d+)\s*\}/m

/** Find the tile in the text of one NPC file. */
function readSpot(fileName: string, text: string): HexCoordinate {
  const match = text.match(SCENE_POSITION_LINE)

  if (!match) {
    throw new Error(`${fileName} has no scene_position line in the form { q = 0, r = 0 }`)
  }

  return { q: Number(match[1]), r: Number(match[2]) }
}

export const CONFIGURED_NPC_SPOTS: HexCoordinate[] = Object.entries(NPC_FILES).map(
  ([fileName, text]) => readSpot(fileName, text),
)
