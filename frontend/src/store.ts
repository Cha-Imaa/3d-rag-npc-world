/** State shared by the 3D scene and the interface, which React context cannot easily do. */
import { create } from 'zustand'
import { fetchNpcs, type Npc } from './api/npcs'

export type NpcListStatus = 'loading' | 'ready' | 'failed'

type VillageState = {
  npcs: Npc[]
  npcListStatus: NpcListStatus
  /** The NPC close enough to talk to, or null for none. */
  nearbyNpcId: string | null
  /** The NPC in conversation with the visitor, or null for none. */
  talkingNpcId: string | null
  loadNpcs: () => Promise<void>
  setNearbyNpc: (npcId: string | null) => void
  startTalking: (npcId: string) => void
  stopTalking: () => void
}

export const useVillageStore = create<VillageState>((set) => ({
  npcs: [],
  npcListStatus: 'loading',
  nearbyNpcId: null,
  talkingNpcId: null,

  /** Fetch the NPCs. A failure leaves the village walkable and offers a retry. */
  loadNpcs: async () => {
    set({ npcListStatus: 'loading' })

    try {
      set({ npcs: await fetchNpcs(), npcListStatus: 'ready' })
    } catch {
      set({ npcListStatus: 'failed' })
    }
  },

  setNearbyNpc: (npcId) => set({ nearbyNpcId: npcId }),
  startTalking: (npcId) => set({ talkingNpcId: npcId }),
  stopTalking: () => set({ talkingNpcId: null }),
}))

/** Find an NPC in the list by ID. A null ID means no NPC. */
function findNpc(npcs: Npc[], npcId: string | null): Npc | null {
  return npcs.find((npc) => npc.id === npcId) ?? null
}

/** Pick the NPC in talking range out of the store, or null for none. */
export function selectNearbyNpc(state: VillageState): Npc | null {
  return findNpc(state.npcs, state.nearbyNpcId)
}

/** Pick the NPC being talked to out of the store, or null for none. */
export function selectTalkingNpc(state: VillageState): Npc | null {
  return findNpc(state.npcs, state.talkingNpcId)
}
