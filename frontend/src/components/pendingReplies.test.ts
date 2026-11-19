import { beforeEach, describe, expect, it } from 'vitest'
import {
  findPendingReply,
  forgetAllPendingReplies,
  rememberPendingReply,
  type FailedReply,
} from './pendingReplies'

/**
 * Make a reply that settles only when the test says so.
 * Output: the reply, and a function that settles it with the given outcome.
 */
function makeControlledReply() {
  let settle: (outcome: FailedReply | null) => void = () => {}
  const reply = new Promise<FailedReply | null>((resolve) => {
    settle = resolve
  })

  return { reply, settle }
}

/** Let the clean-up that runs after a reply settles happen. */
async function letRepliesSettle() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  forgetAllPendingReplies()
})

describe('pending replies', () => {
  it('finds nothing when no reply is on its way', () => {
    expect(findPendingReply('npc-a')).toBeNull()
  })

  it('finds an NPC reply until it settles', async () => {
    const { reply, settle } = makeControlledReply()

    rememberPendingReply('npc-a', reply)

    expect(findPendingReply('npc-a')).toBe(reply)
    expect(findPendingReply('npc-b')).toBeNull()

    settle(null)
    await letRepliesSettle()

    expect(findPendingReply('npc-a')).toBeNull()
  })

  it('also forgets a reply that settles as failed', async () => {
    const { reply, settle } = makeControlledReply()
    rememberPendingReply('npc-a', reply)

    settle({ message: 'Hello', reason: 'The model is unavailable.' })
    await letRepliesSettle()

    expect(findPendingReply('npc-a')).toBeNull()
  })

  it('keeps a newer reply when an older one settles', async () => {
    const older = makeControlledReply()
    const newer = makeControlledReply()
    rememberPendingReply('npc-a', older.reply)
    rememberPendingReply('npc-a', newer.reply)

    older.settle(null)
    await letRepliesSettle()

    expect(findPendingReply('npc-a')).toBe(newer.reply)
  })

  it('forgets every reply when asked', () => {
    rememberPendingReply('npc-a', makeControlledReply().reply)
    rememberPendingReply('npc-b', makeControlledReply().reply)

    forgetAllPendingReplies()

    expect(findPendingReply('npc-a')).toBeNull()
    expect(findPendingReply('npc-b')).toBeNull()
  })
})
