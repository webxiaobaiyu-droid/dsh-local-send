/**
 * Which offer, if any, the receive notification should surface.
 *
 * The rule has one subtlety that is easy to get wrong and impossible to see in
 * use: a notification the reader has already dismissed must stay dismissed while
 * the same offer is still waiting, or it reappears the instant it fades and
 * becomes something to fight rather than something to read. A *different* offer
 * is a different matter — that is news, and it has to be shown.
 *
 * Kept apart from the component so that rule can be tested without a DOM, and so
 * the component holds no latch of its own: the dismissed id is an input, and the
 * answer is a function of it.
 *
 * @module dsh-local-send/client/notice
 */
import type { ClientState } from './state.ts';
import type { TransferRow } from '../types.ts';
/**
 * The incoming offer worth notifying about.
 *
 * Only `awaiting` qualifies. An offer that has been answered is no longer
 * waiting on anyone, and one that is transferring is already visible as progress
 * in the panel — a notification for it would be telling the reader something
 * they did not need to act on.
 *
 * @param read - the current state.
 * @param dismissed - the id of an offer the reader has already dismissed, if any.
 * @returns the offer to surface, or `undefined` when there is nothing to say.
 */
export declare function noticeOffer(read: ClientState, dismissed: string | undefined): TransferRow | undefined;
