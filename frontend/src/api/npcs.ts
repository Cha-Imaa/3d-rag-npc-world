import type { HexCoordinate } from '../scene/villageLayout'

/** The public details of one NPC, as sent by GET /api/npcs. */
export type Npc = {
  id: string
  display_name: string
  scene_position: HexCoordinate
}

/**
 * Load the enabled NPCs.
 *
 * @returns the NPCs, which may be an empty list.
 * @throws if the backend cannot be reached or answers with an error.
 */
export async function fetchNpcs(): Promise<Npc[]> {
  const response = await fetch('/api/npcs')

  if (!response.ok) {
    throw new Error(`Loading NPCs failed with status ${response.status}`)
  }

  return response.json()
}
