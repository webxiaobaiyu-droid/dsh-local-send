/**
 * The floating companion: a small fish that carries the transfer's progress and
 * stays out of the way of everything else.
 *
 * This is the surface that replaced the header mark **and** the strip above the
 * composer. Both of those lived inside the conversation's own layout, which meant
 * a transfer was only visible while the user happened to be looking at that
 * conversation — and the offer banner, in particular, sat *between* the user and
 * the thing they were typing, in the one place the product deliberately keeps
 * quiet. One floating mark answers for the whole window instead: it is drawn in
 * the frame-wide overlay, so it is present whichever panel or conversation is
 * open, and it is never in the typing path.
 *
 * Four decisions worth stating:
 *
 * - **It is absent when there is nothing to say.** The rule is `companionView`'s,
 *   unchanged and shared with the tests that already pin it: an offer waiting on a
 *   person, bytes moving, or something that just finished. An idle fish sitting in
 *   the corner all day would be a control with no content.
 * - **It is draggable, and it remembers where you put it.** A floating element
 *   that covers the thing you are reading is worse than no floating element, so
 *   the position is the user's and is kept across reloads. Dragging is not a
 *   click: movement past a small threshold suppresses the press, or every attempt
 *   to move the fish out of the way would also open the panel.
 * - **It shows the progress as a number and a rail, not only as a ring.** The
 *   ring is the fish's own posture (`fish.tsx`) and reads at a glance across the
 *   room; the rail and the percentage are for when the user actually looks at it.
 *   A transfer with an unknowable total gets no percentage rather than a
 *   confident zero.
 * - **It can be put away.** `×` hides it until the next *different* event — an
 *   offer, a new transfer — so dismissing one thing cannot swallow the next one.
 *
 * @module dsh-local-send/client/FloatingBuddy
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TransferStore } from './state.ts';
/** Registration-side face the floating companion reads and acts through. */
export interface FloatingBuddyInjected {
    /** The shared state store; the companion also keeps it polling. */
    store: TransferStore;
    /** Answer an offer, taking or refusing every file on it. */
    answer: (transferId: string, accept: boolean) => Promise<void>;
    /** Stop a transfer this device is part of. */
    cancel: (transferId: string) => Promise<void>;
    /** Bring the transfer panel forward. */
    openPanel: () => void;
}
/** Full component props assembled by the overlay renderer. */
export type FloatingBuddyProps = PropsRuntime<'shell.overlay'> & PropsLocale<'localSend'> & InjectFace<FloatingBuddyInjected>;
/**
 * Show the companion, and let the user act on whatever it is showing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function FloatingBuddy(props: FloatingBuddyProps): ReactNode;
