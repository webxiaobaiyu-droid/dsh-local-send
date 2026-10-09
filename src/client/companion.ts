/**
 * What the companion is showing, worked out from the transfer state.
 *
 * The companion in the conversation header is a single small mark that has to
 * answer a question with no room in it: *is anything happening, and do I need to
 * do something?* This module is that answer, as a pure function, for the usual
 * reason — a priority order is the part with judgement in it and the part that
 * goes wrong invisibly. A companion that showed "transferring" while an offer was
 * waiting on a person would be telling the user to wait at the one moment they
 * are the only thing the transfer is waiting for.
 *
 * The order is therefore fixed here and is the whole content of the module:
 *
 * 1. **An offer waiting on a person.** Nothing outranks a question addressed to
 *    the user, and the sender is holding a connection open until it is answered.
 * 2. **Bytes moving.** Then transfers actually in flight.
 * 3. **A recent outcome.** Then something that just finished, so the user can see
 *    how it went without having opened anything. It expires, because a mark that
 *    stayed pleased all afternoon would stop meaning anything.
 * 4. **Nothing.** Then the companion is not on screen at all.
 *
 * @module dsh-local-send/client/companion
 */

import type { LocalSendLocaleKey } from './locales.ts'
import { percentOf } from './format.ts'
import type { ClientState } from './state.ts'
import type { TransferRow } from '../types.ts'
import type { FishCarrying, FishMood } from './fish.tsx'

/**
 * How long a finished transfer keeps the companion's attention.
 *
 * Deliberately short — about two polls — because the state is what expires it:
 * the store re-renders on its own cadence and this window is measured against
 * the clock at render time, so no timer of this module's own is involved.
 */
export const AFTERGLOW_MS = 8_000

/** What the companion shows, once the state has been read. */
export interface CompanionView {
  /**
   * Whether the companion should be on screen at all.
   *
   * A field on the view rather than a check in the component, because "should
   * this be drawn" is a rule with judgement in it and this module is where the
   * plugin's rules live: the component's job is to carry the answer out, and a
   * test can pin the rule without a DOM to render into.
   */
  readonly visible: boolean
  /** Which posture to draw. */
  readonly mood: FishMood
  /** What the fish is holding. */
  readonly carrying: FishCarrying
  /** Fraction complete, for the ring; present only while bytes are moving. */
  readonly progress?: number
  /** Dictionary key for the one-line summary. */
  readonly labelKey: LocalSendLocaleKey
  /** Placeholders for that key. */
  readonly labelParams?: Readonly<Record<string, string | number>>
  /** Whether the mark should be drawing attention to itself. */
  readonly tone: 'calm' | 'attention' | 'busy' | 'good' | 'bad'
  /** The row the summary describes, when there is one worth acting on. */
  readonly focus?: TransferRow
}

/** The number of files an offer carries, for the label and the load. */
function carryingOf(files: number): FishCarrying {
  if (files === 0) return 'none'
  return files === 1 ? 'one' : 'many'
}

/** Whether a settled transfer is recent enough to still be worth mentioning. */
function isFresh(transfer: TransferRow, now: number): boolean {
  return now - transfer.updatedAt <= AFTERGLOW_MS
}

/** Whether a transfer is over, whichever way it went. */
function isSettled(transfer: TransferRow): boolean {
  return transfer.status !== 'transferring' && transfer.status !== 'awaiting'
}

/**
 * Work out what the companion should be showing.
 *
 * @param read - the state as the shared store last published it.
 * @param now - the clock at render time, so the afterglow can be tested without waiting.
 * @returns the view, never undefined: the companion is present whether or not anything is happening.
 */
export function companionView(read: ClientState, now: number): CompanionView {
  // A store that has nothing yet — loading, or a host that is not answering — is
  // no news at all rather than an error. A fish that turned into a failure
  // warning because the panel's poll had not landed yet would be alarming about
  // nothing, and one that stayed on screen while saying nothing would be a
  // control with no content.
  if (read.status !== 'ready') {
    return {
      visible: false,
      mood: 'idle',
      carrying: 'none',
      labelKey: 'buddyIdleHint',
      tone: 'calm',
    }
  }
  const { transfers } = read.state

  // 1. A question addressed to the user.
  const offered = transfers.find(transfer =>
    transfer.direction === 'incoming' && transfer.status === 'awaiting')
  if (offered !== undefined) {
    const count = offered.files.length
    const name = offered.files[0]?.fileName ?? ''
    return {
      mood: 'offered',
      carrying: carryingOf(count),
      labelKey: count === 1 ? 'buddyOfferedOne' : 'buddyOffered',
      labelParams: count === 1 ? { name } : { count },
      tone: 'attention',
      focus: offered,
      visible: true,
    }
  }

  // 2. Bytes moving. The most recently touched row, so a batch of several shows
  //    the one that actually moved rather than whichever was opened first.
  const moving = transfers
    .filter(transfer => transfer.status === 'transferring')
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (moving !== undefined) {
    const percent = percentOf(moving.bytesDone, moving.bytesTotal)
    return {
      mood: 'moving',
      // Empty-handed while it swims. The ring already says bytes are moving, and
      // a fish plus a document plus a ring is three ideas in an eighteen-pixel
      // mark — the count belongs in the popover, which has room to say it.
      carrying: 'none',
      progress: percent,
      labelKey: 'buddyBusy',
      labelParams: { percent },
      tone: 'busy',
      focus: moving,
      visible: true,
    }
  }

  // 3. Something that just finished. A row is only mentioned once it is over, so
  //    a transfer that is about to be trimmed out of the history cannot leave
  //    the mark stuck on a state nothing is in any more.
  //
  //    Ordered by `updatedAt` rather than by the row order the registry hands
  //    over: that order is newest-*created* first, and the thing being reported
  //    here is when a transfer *ended*. A batch opened ten minutes ago that
  //    finished a second ago is the news, and a row opened since is not.
  const settled = [...transfers]
    .filter(transfer => isSettled(transfer) && isFresh(transfer, now))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (settled !== undefined) {
    const good = settled.status === 'done'
    return {
      mood: good ? 'landed' : 'lost',
      // Put down either way: the transfer is over, and a fish still holding a
      // file would be saying bytes were in flight when none are.
      carrying: 'none',
      labelKey: good ? 'buddyDone' : 'buddyFailed',
      tone: good ? 'good' : 'bad',
      focus: settled,
      visible: true,
    }
  }

  // 4. Nothing. Off screen, rather than dimmed: an idle fish is a control with
  //    nothing to say, and the conversation header already carries three other
  //    controls. Hidden is the honest reading of "idle", and it is a rule here
  //    rather than a stylesheet decision so that a test can pin it.
  return {
    visible: false,
    mood: 'idle',
    carrying: 'none',
    labelKey: 'buddyIdleHint',
    tone: 'calm',
  }
}
