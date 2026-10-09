/**
 * What the companion decides to show, and in what order.
 *
 * The rule this file pins is a priority order, and the reason it is worth a suite
 * of its own is that every way of getting it wrong is invisible in use: a
 * companion that reported "transferring" while an offer was waiting on a person
 * would be telling the user to wait at the one moment they are the only thing the
 * transfer is waiting for, and a companion that stayed pleased all afternoon
 * would stop meaning anything at all. Neither is a crash. Both are just wrong,
 * quietly, in the corner of the header.
 *
 * @module dsh-local-send/tests/companion
 */

import { describe, expect, it } from 'vitest'
import { AFTERGLOW_MS, companionView } from '../src/client/companion.ts'
import type { ClientState } from '../src/client/state.ts'
import type { LocalSendState, TransferRow } from '../src/types.ts'

/** A fixed clock, so the afterglow window can be tested without waiting. */
const NOW = 1_700_000_000_000

/** One transfer row with the boring fields defaulted. */
function transfer(
  overrides: Partial<TransferRow> & Pick<TransferRow, 'id' | 'status'>,
): TransferRow {
  const bytesTotal = overrides.bytesTotal ?? 100
  return {
    direction: 'incoming',
    peerAlias: 'Pixel 8',
    peerFingerprint: 'p1',
    peerAddress: '192.168.1.24',
    peerType: 'mobile',
    files: [
      {
        id: 'f1',
        fileName: 'note.txt',
        size: bytesTotal,
        fileType: 'text/plain',
        status: 'done',
        bytesDone: bytesTotal,
      },
    ],
    bytesTotal,
    bytesDone: bytesTotal,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    ...overrides,
  }
}

/** A ready read of the store, over the given transfers. */
function ready(transfers: readonly TransferRow[]): ClientState {
  const state: LocalSendState = {
    device: {
      alias: 'This Mac',
      fingerprint: 'self',
      port: 53317,
      protocol: 'http',
      deviceType: 'desktop',
      addresses: ['192.168.1.7'],
      serving: true,
    },
    peers: [],
    transfers,
    inbox: '/Users/Admin/.dsh/local-send/inbox',
    discovery: { active: true },
    busy: transfers.length > 0,
  }
  return { status: 'ready', state }
}

describe('the companion view', () => {
  it('puts an offer ahead of a transfer already in flight', () => {
    // The whole priority order in one assertion. A sender is holding a
    // connection open for the offer, so it outranks bytes that are moving on
    // their own.
    const view = companionView(ready([
      transfer({ id: 'moving', status: 'transferring', updatedAt: NOW - 100 }),
      transfer({ id: 'offer', status: 'awaiting', updatedAt: NOW - 9_000 }),
    ]), NOW)
    expect(view.mood).toBe('offered')
    expect(view.focus?.id).toBe('offer')
    expect(view.tone).toBe('attention')
  })

  it('names the file when one is offered and counts them when several are', () => {
    const single = companionView(ready([
      transfer({ id: 'a', status: 'awaiting' }),
    ]), NOW)
    expect(single.labelKey).toBe('buddyOfferedOne')
    expect(single.labelParams).toEqual({ name: 'note.txt' })
    expect(single.carrying).toBe('one')

    const batch = companionView(ready([
      transfer({
        id: 'b',
        status: 'awaiting',
        files: [
          { id: 'f1', fileName: 'one.jpg', size: 5, fileType: 'image/jpeg', status: 'offered', bytesDone: 0 },
          { id: 'f2', fileName: 'two.jpg', size: 5, fileType: 'image/jpeg', status: 'offered', bytesDone: 0 },
          { id: 'f3', fileName: 'three.jpg', size: 5, fileType: 'image/jpeg', status: 'offered', bytesDone: 0 },
        ],
      }),
    ]), NOW)
    expect(batch.labelKey).toBe('buddyOffered')
    expect(batch.labelParams).toEqual({ count: 3 })
    // The stack, so "several" is visible without reading the popover.
    expect(batch.carrying).toBe('many')
  })

  it('reports the fraction of a transfer in flight, empty-handed', () => {
    const view = companionView(ready([
      transfer({ id: 'a', status: 'transferring', bytesTotal: 800, bytesDone: 200 }),
    ]), NOW)
    expect(view.mood).toBe('moving')
    expect(view.progress).toBe(25)
    // The ring says bytes are moving; a fish holding a document as well would be
    // three ideas in an eighteen-pixel mark.
    expect(view.carrying).toBe('none')
    expect(view.tone).toBe('busy')
  })

  it('follows the row that moved most recently when several are in flight', () => {
    const view = companionView(ready([
      transfer({ id: 'older', status: 'transferring', bytesTotal: 400, bytesDone: 100, updatedAt: NOW - 5_000 }),
      transfer({ id: 'newer', status: 'transferring', bytesTotal: 400, bytesDone: 300, updatedAt: NOW - 200 }),
    ]), NOW)
    expect(view.focus?.id).toBe('newer')
    expect(view.progress).toBe(75)
  })

  it('mentions a finished transfer while it is fresh, and forgets it after', () => {
    const just = companionView(ready([
      transfer({ id: 'a', status: 'done', updatedAt: NOW - 2_000 }),
    ]), NOW)
    expect(just.mood).toBe('landed')
    expect(just.tone).toBe('good')

    // The same row, read a window later. A mark that stayed pleased all afternoon
    // would stop meaning anything, which is why this expires with the clock
    // rather than with an event.
    const stale = companionView(ready([
      transfer({ id: 'a', status: 'done', updatedAt: NOW - AFTERGLOW_MS - 1 }),
    ]), NOW)
    expect(stale.mood).toBe('idle')
    // And gone, not dimmed: the whole point of expiring the afterglow is that
    // the mark stops being there once it has nothing to say.
    expect(stale.visible).toBe(false)
    expect(stale.focus).toBeUndefined()
  })

  it('is on screen in every state that has something to say', () => {
    // Pinned as one test rather than implied by the others, because this is the
    // rule that decides whether the header gains a control at all: an offer, a
    // transfer in flight, and a fresh outcome each put the companion there, and
    // nothing else does.
    const cases: readonly ClientState[] = [
      ready([transfer({ id: 'a', status: 'awaiting' })]),
      ready([transfer({ id: 'b', status: 'transferring' })]),
      ready([transfer({ id: 'c', status: 'done', updatedAt: NOW - 1_000 })]),
    ]
    for (const read of cases) {
      expect(companionView(read, NOW).visible, JSON.stringify(
        read.status === 'ready' ? read.state.transfers.map(row => row.status) : [],
      )).toBe(true)
    }
  })

  it('reports the outcome that ended most recently, not the row opened most recently', () => {
    // The registry hands its rows over newest-*created* first, and what the
    // afterglow is about is when a transfer *ended*. A batch opened ten minutes
    // ago that finished half a second ago is the news.
    const view = companionView(ready([
      transfer({
        id: 'opened-later',
        status: 'failed',
        createdAt: NOW - 30_000,
        updatedAt: NOW - 6_000,
      }),
      transfer({
        id: 'ended-later',
        status: 'done',
        createdAt: NOW - 600_000,
        updatedAt: NOW - 500,
      }),
    ]), NOW)
    expect(view.focus?.id).toBe('ended-later')
    expect(view.mood).toBe('landed')
  })

  it('reads every way a transfer can fail as the same flat fish', () => {
    for (const status of ['failed', 'partial', 'canceled', 'declined'] as const) {
      const view = companionView(ready([
        transfer({ id: 'a', status, updatedAt: NOW - 1_000 }),
      ]), NOW)
      expect(view.mood, status).toBe('lost')
      expect(view.tone, status).toBe('bad')
    }
  })

  it('is off screen, not alarmed, when there is nothing at all', () => {
    const view = companionView(ready([]), NOW)
    expect(view.visible).toBe(false)
    expect(view.mood).toBe('idle')
    expect(view.tone).toBe('calm')
    expect(view.labelKey).toBe('buddyIdleHint')
  })

  it('is idle rather than a warning when the store has no answer yet', () => {
    // A store that is still loading, or whose host is not answering, is not news
    // about a transfer: the companion is a presence, and a fish that turned into
    // a failure because a poll had not landed would be alarming about nothing.
    for (const read of [{ status: 'loading' }, { status: 'error', message: 'offline' }] as const) {
      const view = companionView(read, NOW)
      expect(view.visible).toBe(false)
      expect(view.mood).toBe('idle')
      expect(view.tone).toBe('calm')
    }
  })
})
