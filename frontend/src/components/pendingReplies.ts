/** A message that got no reply, and the plain reason to show the visitor. */
export type FailedReply = {
  message: string
  reason: string
}

/**
 * How an unfinished reply ended: null when it arrived (so the server saved it), or the
 * message that failed and why. It never rejects, so waiting for it can't throw.
 */
export type PendingReply = Promise<FailedReply | null>

// Each NPC's reply that hasn't arrived yet. A plain map, not the store, because nothing
// on screen reacts to it. Only a panel that opens later looks it up.
const pendingRepliesByNpc = new Map<string, PendingReply>()

/**
 * Remember an NPC's reply until it settles, so a chat reopened before then can wait for it.
 * Input: the NPC's ID, and the reply. A newer reply for the same NPC replaces an older one.
 */
export function rememberPendingReply(npcId: string, reply: PendingReply): void {
  pendingRepliesByNpc.set(npcId, reply)

  reply.then(() => {
    // Only remove our own entry. A newer reply may have replaced it meanwhile.
    if (pendingRepliesByNpc.get(npcId) === reply) {
      pendingRepliesByNpc.delete(npcId)
    }
  })
}

/**
 * Find an NPC's reply that hasn't settled yet.
 * Input: the NPC's ID. Output: the reply, or null when none is on its way.
 */
export function findPendingReply(npcId: string): PendingReply | null {
  return pendingRepliesByNpc.get(npcId) ?? null
}

/** Forget every reply. Tests use this, since some leave a reply unfinished on purpose. */
export function forgetAllPendingReplies(): void {
  pendingRepliesByNpc.clear()
}
