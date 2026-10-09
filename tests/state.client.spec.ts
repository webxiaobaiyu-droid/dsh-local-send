/**
 * The shared state store: when it reads, how often, and when it stops.
 *
 * This is the part of the browser half with a performance claim attached to it,
 * and every way it can go wrong is invisible on screen: a store that never stops
 * polling spends a request per tick forever, one that polls on a fixed interval
 * makes a progress bar look broken, and one that publishes a late answer after
 * being released repaints a panel the user has already closed.
 *
 * So the timers are driven explicitly here rather than waited on, and the
 * globals the module reads are stubbed — it uses `window.setTimeout` and
 * `document.hidden`, which a Node test does not have.
 *
 * @module dsh-local-send/tests/state
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransferStore } from '../src/client/state.ts'
import type { LocalSendState } from '../src/types.ts'

/** A state with the fields the store's cadence depends on. */
function stateOf(overrides: Partial<LocalSendState> = {}): LocalSendState {
  return {
    device: {
      alias: 'Mac',
      fingerprint: 'f',
      port: 53317,
      protocol: 'http',
      deviceType: 'desktop',
      addresses: [],
      serving: true,
    },
    peers: [],
    transfers: [],
    inbox: '/tmp/inbox',
    discovery: { active: true },
    busy: false,
    ...overrides,
  }
}

beforeEach(() => {
  // The module reads these off the global scope, the way any browser module
  // would; a Node test has neither.
  //
  // The wrappers delegate rather than capture: a test installs its fake timers
  // *after* this runs, so a stub holding the real `setTimeout` would leave the
  // loop running on a clock nothing advances.
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (handle: number) => { clearTimeout(handle as unknown as NodeJS.Timeout) },
  })
  vi.stubGlobal('document', { hidden: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the shared state store', () => {
  it('reads nothing until somebody is watching', () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => stateOf())
    createTransferStore(read)
    // A plugin whose panel is closed and whose notification is unmounted should
    // cost the host nothing at all.
    vi.advanceTimersByTime(60_000)
    expect(read).not.toHaveBeenCalled()
  })

  it('reads immediately on the first holder, so a mounting panel does not wait', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => stateOf())
    const store = createTransferStore(read)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('stops when the last holder leaves', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => stateOf())
    const store = createTransferStore(read)
    const release = store.retain()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(60_000)
    // Still one: the loop ended with the last holder.
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps reading while another holder is still there', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => stateOf())
    const store = createTransferStore(read)
    const first = store.retain()
    const second = store.retain()
    await vi.advanceTimersByTimeAsync(0)
    first()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read.mock.calls.length).toBeGreaterThan(1)
    second()
  })

  it('polls fast while a transfer is moving and slowly when it is not', async () => {
    vi.useFakeTimers()
    let busy = false
    const read = vi.fn(async () => stateOf({ busy }))
    const store = createTransferStore(read)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)

    // Idle: half a second of ticks should not produce a second read.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(read).toHaveBeenCalledTimes(1)

    // A transfer starts. The window is allowed to run until the tick already
    // scheduled on the idle cadence has landed, so what is measured next is the
    // active cadence alone rather than a blend of the two.
    busy = true
    await vi.advanceTimersByTimeAsync(2_500)
    read.mockClear()

    // Five seconds at half a second apiece: ten reads. The bounds are wide
    // enough not to pin the phase and tight enough that an idle cadence would
    // fail them by a factor of four.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(9)
    expect(read.mock.calls.length).toBeLessThanOrEqual(11)
  })

  it('backs off while the tab is hidden', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { hidden: true })
    const read = vi.fn(async () => stateOf({ busy: true }))
    const store = createTransferStore(read)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(4_000)
    // A background tab has nobody looking at it; the work it is describing can
    // wait.
    expect(read.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('publishes a failure rather than leaving the last good state up', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => { throw new Error('host went away') })
    const store = createTransferStore(read)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)
    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.status === 'error' ? snapshot.message : '').toContain('host went away')
  })

  it('recovers from a failure without a reload', async () => {
    vi.useFakeTimers()
    let fail = true
    const read = vi.fn(async () => {
      if (fail) throw new Error('down')
      return stateOf()
    })
    const store = createTransferStore(read)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().status).toBe('error')
    fail = false
    await vi.advanceTimersByTimeAsync(10_000)
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('does not stack reads when one is slow', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const read = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return stateOf({ busy: true })
    })
    const store = createTransferStore(read)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    // A read that has not answered yet must not be joined by more of itself.
    expect(read).toHaveBeenCalledTimes(1)
    release?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(read.mock.calls.length).toBeGreaterThan(1)
  })

  it('drops an answer that arrives after the last holder left', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const read = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return stateOf()
    })
    const store = createTransferStore(read)
    const release1 = store.retain()
    await vi.advanceTimersByTimeAsync(0)
    release1()
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    // Repainting a panel the user has closed is the bug this prevents.
    expect(store.getSnapshot().status).toBe('loading')
  })

  it('notifies subscribers on every change', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => stateOf())
    const store = createTransferStore(read)
    const seen = vi.fn()
    const stop = store.subscribe(seen)
    store.retain()
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toHaveBeenCalled()
    stop()
    const before = seen.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(seen.mock.calls.length).toBe(before)
  })

  it('answers a manual refresh without waiting for the loop', async () => {
    const read = vi.fn(async () => stateOf())
    const store = createTransferStore(read)
    // No holder: an action's own refresh is not a subscription.
    await store.refresh()
    expect(store.getSnapshot().status).toBe('ready')
  })
})
