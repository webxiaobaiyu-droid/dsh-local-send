/**
 * One shared read of the host state, for everything that draws from it.
 *
 * Two surfaces need this state and they are mounted independently: the panel,
 * which is only present while its own main column is selected, and the receive
 * notification, which has to fire wherever the user happens to be. Giving each
 * its own polling loop would mean two requests per tick to read one document,
 * and two answers that could momentarily disagree about whether an offer is
 * still waiting.
 *
 * So there is one loop, and it runs only while something is watching. That is
 * what {@link TransferStore.retain} is for: the notification retains for as long
 * as it is mounted, the panel retains while it is open, and a deployment where
 * neither exists reads nothing at all.
 *
 * The cadence follows the answer, not a fixed period. A device with no peers and
 * no transfers is a still picture and is re-read on a slow tick; a transfer in
 * flight is re-read fast enough that its progress bar moves smoothly; and a
 * hidden tab is re-read slowly enough to be impolite to nobody.
 *
 * @module dsh-local-send/client/state
 */

import { useSyncExternalStore } from 'react'
import type { LocalSendState } from '../types.ts'

/** How often to re-read while something is moving. */
const ACTIVE_MS = 500

/**
 * How often to re-read while nothing is.
 *
 * Slow enough to be invisible, fast enough that a file sent from a phone appears
 * while the sender is still looking at the screen they sent it from.
 */
const IDLE_MS = 2_500

/** How often to re-read while the tab is in the background. */
const HIDDEN_MS = 8_000

/** What a reader sees: the last good state, or why there is none. */
export type ClientState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly state: LocalSendState }
  | { readonly status: 'error'; readonly message: string }

/** The store both surfaces read through. */
export interface TransferStore {
  /** Subscribe to changes, for `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void
  /** Read the current snapshot; the object identity is stable between changes. */
  getSnapshot(): ClientState
  /**
   * Keep the loop running until the returned function is called.
   *
   * Reference-counted: the loop starts when the first holder arrives and stops
   * when the last one leaves, so an unloaded plugin and a closed panel both cost
   * nothing. The first holder also triggers an immediate read, so a surface that
   * mounts does not wait a full interval for its first paint.
   *
   * @returns the release function.
   */
  retain(): () => void
  /** Read once, now. Used after an action so its effect is on screen at once. */
  refresh(): Promise<void>
}

/** One line describing an error, for the failure state. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the store over one reader.
 *
 * @param read - performs the actual host request.
 * @returns the store.
 */
export function createTransferStore(read: () => Promise<LocalSendState>): TransferStore {
  const listeners = new Set<() => void>()
  let snapshot: ClientState = { status: 'loading' }
  let holders = 0
  let timer: number | undefined
  /** Whether a read is in flight, so a refresh cannot stack behind the loop. */
  let reading = false
  /** Set while the loop is torn down mid-read, so a late answer is dropped. */
  let generation = 0

  const publish = (next: ClientState): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const schedule = (delay: number): void => {
    if (timer !== undefined) window.clearTimeout(timer)
    if (holders === 0) return
    const mine = generation
    timer = window.setTimeout(() => {
      // A loop that was torn down and restarted while this timer was pending
      // must not run under the new generation's identity.
      if (mine !== generation) return
      void tick()
    }, delay)
  }

  const tick = async (): Promise<void> => {
    if (reading) {
      schedule(ACTIVE_MS)
      return
    }
    reading = true
    try {
      const state = await read()
      if (holders === 0) return
      publish({ status: 'ready', state })
      schedule(document.hidden ? HIDDEN_MS : state.busy ? ACTIVE_MS : IDLE_MS)
    } catch (error: unknown) {
      if (holders === 0) return
      // A successful read clears an earlier failure, so the error is republished
      // rather than left beside good data.
      publish({ status: 'error', message: describe(error) })
      // A failed read is retried on the idle cadence: a host that is briefly
      // restarting should not be hammered, but should also not be abandoned.
      schedule(IDLE_MS)
    } finally {
      reading = false
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    retain() {
      holders += 1
      if (holders === 1) void tick()
      let released = false
      return () => {
        if (released) return
        released = true
        holders -= 1
        if (holders === 0) {
          generation += 1
          if (timer !== undefined) window.clearTimeout(timer)
          timer = undefined
        }
      }
    },
    async refresh() {
      try {
        const state = await read()
        publish({ status: 'ready', state })
      } catch (error: unknown) {
        publish({ status: 'error', message: describe(error) })
      }
    },
  }
}

/**
 * Read the store as React state.
 * @param store - the shared store.
 * @returns the current snapshot, re-rendering on every change.
 */
export function useTransferState(store: TransferStore): ClientState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
