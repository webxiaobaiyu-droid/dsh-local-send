/**
 * "Add to conversation": the rules and the handoff.
 *
 * This is the gesture the whole plugin exists for — a file arrives on the disk
 * and the conversation is pointed at it — and it is the one piece that spans two
 * components that never see each other. So both halves are tested here: the
 * decision (pure, in `reference-action.ts`) and the store that carries the
 * request from the panel to the composer, including the two failure modes that
 * would be invisible in use — an insert that happens twice, and a request that
 * outlives the moment it was made for.
 *
 * @module dsh-local-send/tests/reference
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { noticeOffer } from '../src/client/notice.ts'
import { referenceAction } from '../src/client/reference-action.ts'
import { formatMention } from '../src/client/mention.ts'
import {
  consumeReference,
  readReference,
  requestReference,
  subscribeReference,
} from '../src/client/pending.ts'

/** An inbox path, which is what a received file's absolute path looks like. */
const RECEIVED = '/Users/Admin/.dsh/local-send/inbox/IMG_0042.jpg'

afterEach(() => {
  // The store is module state, so a lingering request would leak into the next
  // test rather than fail this one.
  consumeReference()
  vi.useRealTimers()
})

describe('the decision', () => {
  it('waits when there is nothing to do', () => {
    expect(referenceAction(undefined, true)).toEqual({ kind: 'wait' })
    expect(referenceAction(undefined, false)).toEqual({ kind: 'wait' })
  })

  it('waits rather than drops when no conversation is bound yet', () => {
    // The request is made from the transfer panel and carried out by the
    // composer, which only exists once the centre column has switched back. So
    // "no session yet" is the normal state for a moment, not a reason to give up.
    expect(referenceAction(RECEIVED, false)).toEqual({ kind: 'wait' })
  })

  it('inserts a mention with a trailing space', () => {
    // The space is load-bearing: the `@` grammar ends a token at whitespace, so
    // without it the next character typed would extend the path.
    expect(referenceAction(RECEIVED, true)).toEqual({
      kind: 'insert',
      text: `@${RECEIVED} `,
    })
  })

  it('quotes a path that contains whitespace', () => {
    const spaced = '/Users/Admin/.dsh/local-send/inbox/my photo.jpg'
    expect(referenceAction(spaced, true)).toEqual({
      kind: 'insert',
      text: `@"${spaced}" `,
    })
  })

  it('drops a path the grammar cannot represent', () => {
    // Carrying a quote or a control character, this would be inserted as a token
    // that parses as two and hands the agent half a path — worse than doing
    // nothing, because it looks like it worked.
    expect(referenceAction('/tmp/a"b.jpg', true)).toEqual({ kind: 'drop' })
    expect(referenceAction('/tmp/a\u0000b.jpg', true)).toEqual({ kind: 'drop' })
  })

  it('agrees with the mention formatter it is built on', () => {
    // A path is either representable by both or by neither; a disagreement
    // would mean the decision and the text it produces could drift apart.
    for (const path of [RECEIVED, '/tmp/a b.jpg', '/tmp/a"b.jpg', '']) {
      const mention = formatMention(path)
      const action = referenceAction(path, true)
      if (mention === undefined) expect(action.kind).toBe('drop')
      else expect(action).toEqual({ kind: 'insert', text: `${mention} ` })
    }
  })
})

describe('the handoff between the panel and the composer', () => {
  it('carries a request from one to the other', () => {
    expect(readReference()).toBeUndefined()
    requestReference(RECEIVED)
    expect(readReference()).toBe(RECEIVED)
  })

  it('notifies subscribers, which is how the composer re-renders', () => {
    const seen = vi.fn()
    const stop = subscribeReference(seen)
    requestReference(RECEIVED)
    expect(seen).toHaveBeenCalledTimes(1)
    stop()
    // An unsubscribed listener must not be called: the composer unmounts when
    // the user leaves the conversation, and a stale listener would keep it alive.
    requestReference('/tmp/other.jpg')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('reads without consuming, so a repeated snapshot read is stable', () => {
    // `useSyncExternalStore` may read more than once per render, and a snapshot
    // that vanished on the first read would make the composer render an empty
    // state on its second pass.
    requestReference(RECEIVED)
    expect(readReference()).toBe(RECEIVED)
    expect(readReference()).toBe(RECEIVED)
  })

  it('consumes exactly once', () => {
    // The insert takes the request before writing, so a failing edit cannot leave
    // it to re-fire on the next render and append the reference a second time.
    requestReference(RECEIVED)
    expect(consumeReference()).toBe(RECEIVED)
    expect(consumeReference()).toBeUndefined()
    expect(readReference()).toBeUndefined()
  })

  it('lets a newer request replace an older one', () => {
    // Two impatient clicks mean "this file", and the second click is the one
    // that counts. Queueing them would append a reference the user did not ask
    // for.
    requestReference('/tmp/first.jpg')
    requestReference('/tmp/second.jpg')
    expect(consumeReference()).toBe('/tmp/second.jpg')
  })

  it('expires a request that nobody acted on', () => {
    // A request crosses a panel switch, so it cannot be consumed synchronously —
    // but a request left over from a conversation the user has since left must
    // not insert a path into an unrelated draft minutes later.
    vi.useFakeTimers()
    requestReference(RECEIVED)
    vi.advanceTimersByTime(14_000)
    expect(readReference()).toBe(RECEIVED)
    vi.advanceTimersByTime(2_000)
    expect(readReference()).toBeUndefined()
  })

  it('re-arms a fresh request after an expired one', () => {
    vi.useFakeTimers()
    requestReference('/tmp/stale.jpg')
    vi.advanceTimersByTime(20_000)
    expect(readReference()).toBeUndefined()
    requestReference('/tmp/fresh.jpg')
    expect(readReference()).toBe('/tmp/fresh.jpg')
  })
})

describe('the receive notification', () => {
  /** One incoming transfer in the given state. */
  function offer(id: string, status: 'awaiting' | 'transferring' | 'done', direction: 'incoming' | 'outgoing' = 'incoming') {
    return {
      id,
      direction,
      peerAlias: 'Pixel 8',
      peerFingerprint: 'p1',
      peerAddress: '192.168.1.24',
      peerType: 'mobile' as const,
      status,
      files: [],
      bytesTotal: 0,
      bytesDone: 0,
      createdAt: 0,
      updatedAt: 0,
    }
  }

  /** A ready state carrying the given transfers. */
  function ready(transfers: ReturnType<typeof offer>[]) {
    return {
      status: 'ready' as const,
      state: {
        device: {
          alias: 'Mac', fingerprint: 'f', port: 53317, protocol: 'http' as const,
          deviceType: 'desktop' as const, addresses: [], serving: true,
        },
        peers: [],
        transfers,
        inbox: '/tmp/inbox',
        discovery: { active: true },
        busy: true,
      },
    }
  }

  it('says nothing before the first read', () => {
    expect(noticeOffer({ status: 'loading' }, undefined)).toBeUndefined()
  })

  it('surfaces an offer that is waiting', () => {
    expect(noticeOffer(ready([offer('t1', 'awaiting')]), undefined)?.id).toBe('t1')
  })

  it('ignores a transfer nobody is waiting on', () => {
    // A transfer already moving is visible as progress in the panel; a
    // notification for it would be telling the reader something they cannot act
    // on.
    expect(noticeOffer(ready([offer('t1', 'transferring')]), undefined)).toBeUndefined()
    expect(noticeOffer(ready([offer('t1', 'done')]), undefined)).toBeUndefined()
  })

  it('ignores an outgoing transfer', () => {
    expect(noticeOffer(ready([offer('t1', 'awaiting', 'outgoing')]), undefined)).toBeUndefined()
  })

  it('keeps a dismissed offer dismissed', () => {
    // Otherwise the notification returns the instant it fades, and becomes
    // something to fight rather than something to read.
    expect(noticeOffer(ready([offer('t1', 'awaiting')]), 't1')).toBeUndefined()
  })

  it('still surfaces a different offer after one was dismissed', () => {
    // A new offer is news, and the dismissal was about the previous one.
    const state = ready([offer('t1', 'awaiting'), offer('t2', 'awaiting')])
    expect(noticeOffer(state, 't1')?.id).toBe('t2')
  })
})
