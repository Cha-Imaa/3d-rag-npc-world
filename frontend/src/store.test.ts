import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Npc } from './api/npcs'
import { selectNearbyNpc, selectTalkingNpc, useVillageStore } from './store'

const NPC: Npc = { id: 'test-npc', display_name: 'Test NPC', scene_position: { q: 1, r: 0 } }

/** Make the next fetch answer with the given status and body. */
function stubFetchResponse(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })))
}

beforeEach(() => {
  useVillageStore.setState({
    npcs: [],
    npcListStatus: 'loading',
    nearbyNpcId: null,
    talkingNpcId: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadNpcs', () => {
  it('keeps the NPCs the backend sends', async () => {
    stubFetchResponse(200, [NPC])

    await useVillageStore.getState().loadNpcs()

    expect(useVillageStore.getState().npcs).toEqual([NPC])
    expect(useVillageStore.getState().npcListStatus).toBe('ready')
  })

  it('reports a failure when the backend answers with an error', async () => {
    stubFetchResponse(500, {})

    await useVillageStore.getState().loadNpcs()

    expect(useVillageStore.getState().npcListStatus).toBe('failed')
  })

  it('reports a failure when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await useVillageStore.getState().loadNpcs()

    expect(useVillageStore.getState().npcListStatus).toBe('failed')
  })

  it('recovers when a retry succeeds', async () => {
    stubFetchResponse(500, {})
    await useVillageStore.getState().loadNpcs()

    stubFetchResponse(200, [NPC])
    await useVillageStore.getState().loadNpcs()

    expect(useVillageStore.getState().npcListStatus).toBe('ready')
  })
})

describe('talking', () => {
  it('tracks the NPC being talked to until the conversation ends', () => {
    useVillageStore.setState({ npcs: [NPC] })

    useVillageStore.getState().startTalking(NPC.id)
    expect(selectTalkingNpc(useVillageStore.getState())).toEqual(NPC)

    useVillageStore.getState().stopTalking()
    expect(selectTalkingNpc(useVillageStore.getState())).toBeNull()
  })

  it('tracks the NPC in talking range', () => {
    useVillageStore.setState({ npcs: [NPC] })

    useVillageStore.getState().setNearbyNpc(NPC.id)
    expect(selectNearbyNpc(useVillageStore.getState())).toEqual(NPC)

    useVillageStore.getState().setNearbyNpc(null)
    expect(selectNearbyNpc(useVillageStore.getState())).toBeNull()
  })
})
