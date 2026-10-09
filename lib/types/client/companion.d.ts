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
import type { LocalSendLocaleKey } from './locales.ts';
import type { ClientState } from './state.ts';
import type { TransferRow } from '../types.ts';
import type { FishCarrying, FishMood } from './fish.tsx';
/**
 * How long a finished transfer keeps the companion's attention.
 *
 * Deliberately short — about two polls — because the state is what expires it:
 * the store re-renders on its own cadence and this window is measured against
 * the clock at render time, so no timer of this module's own is involved.
 */
export declare const AFTERGLOW_MS = 8000;
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
    readonly visible: boolean;
    /** Which posture to draw. */
    readonly mood: FishMood;
    /** What the fish is holding. */
    readonly carrying: FishCarrying;
    /** Fraction complete, for the ring; present only while bytes are moving. */
    readonly progress?: number;
    /** Dictionary key for the one-line summary. */
    readonly labelKey: LocalSendLocaleKey;
    /** Placeholders for that key. */
    readonly labelParams?: Readonly<Record<string, string | number>>;
    /** Whether the mark should be drawing attention to itself. */
    readonly tone: 'calm' | 'attention' | 'busy' | 'good' | 'bad';
    /** The row the summary describes, when there is one worth acting on. */
    readonly focus?: TransferRow;
}
/**
 * Work out what the companion should be showing.
 *
 * @param read - the state as the shared store last published it.
 * @param now - the clock at render time, so the afterglow can be tested without waiting.
 * @returns the view, never undefined: the companion is present whether or not anything is happening.
 */
export declare function companionView(read: ClientState, now: number): CompanionView;
