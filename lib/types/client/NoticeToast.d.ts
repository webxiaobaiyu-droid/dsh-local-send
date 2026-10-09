/**
 * The notification surface: the one thing this plugin has to say to somebody who
 * is not looking at it.
 *
 * Two messages want the top of the window, and they overlap in exactly the way
 * that argues for one component owning both:
 *
 * - **An offer.** The sender is holding a connection open and a person has to
 *   answer, so this has to fire wherever the user happens to be — including
 *   inside a conversation with the transfer panel nowhere on screen. The hold is
 *   deliberately long: the host gives a sender ninety seconds, and a toast that
 *   vanished after the usual three would take the only Accept button with it
 *   while the offer was still live.
 * - **A confirmation.** "Added to the composer", "copied", "sent to…". These are
 *   short, and they exist because the gesture that earned them took the surface
 *   that would otherwise have shown them away — see `flash.ts`.
 *
 * Two independent toasts would be two banners drawn in the same place, one
 * across the other. So one component arbitrates, and the rule is that **an offer
 * always wins**: it is a request from another person with a deadline, and a
 * three-second acknowledgement of something the user already watched happen can
 * afford to lose. A confirmation that arrives while an offer is on screen is
 * discarded rather than queued — by the time the offer is answered, the
 * connection between the gesture and the message would be gone, and a stale
 * confirmation is worse than none.
 *
 * It is the product's own `Toast` primitive rather than a bespoke surface,
 * because a notification that looked unlike every other notification in the
 * window would read as an interruption instead of as the application talking. It
 * also portals itself to the document body, which is what lets it escape the
 * overlay layer's own box.
 *
 * @module dsh-local-send/client/NoticeToast
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TransferStore } from './state.ts';
/** Registration-side face the notification reads. */
export interface NoticeToastInjected {
    /** The shared state store. */
    store: TransferStore;
    /** Answer an offer. */
    answer: (transferId: string, accept: boolean, fileIds?: readonly string[]) => Promise<void>;
}
/** Full component props assembled by the overlay renderer. */
export type NoticeToastProps = PropsRuntime<'shell.overlay'> & PropsLocale<'localSend'> & InjectFace<NoticeToastInjected>;
/**
 * Show an offer, a confirmation, or nothing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function NoticeToast(props: NoticeToastProps): ReactNode;
