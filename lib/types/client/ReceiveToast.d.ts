/**
 * The receive notification.
 *
 * An offer is the one thing this plugin has to say to somebody who is not
 * looking at it: the sender is holding a connection open and a person has to
 * answer. So this lives in the frame-wide overlay rather than in the panel, and
 * it fires wherever the user happens to be — including inside a conversation
 * with the transfer panel nowhere on screen.
 *
 * It is the product's own `Toast` primitive rather than a bespoke surface,
 * because a notification that looked unlike every other notification in the
 * window would read as an interruption instead of as the application talking. It
 * also portals itself to the document body, which is what lets it escape the
 * overlay layer's own box.
 *
 * The hold is deliberately long. The host gives a sender ninety seconds before
 * answering for the user, and a toast that vanished after the usual three would
 * take the only Accept button with it while the offer was still live.
 *
 * @module dsh-local-send/client/ReceiveToast
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { LocalSendLocaleKey } from './locales.ts';
import { type TransferStore } from './state.ts';
/** Registration-side face the notification reads. */
export interface ReceiveToastInjected {
    /** The shared state store. */
    store: TransferStore;
    /** Answer an offer. */
    answer: (transferId: string, accept: boolean) => Promise<void>;
}
/** Full component props assembled by the overlay renderer. */
export type ReceiveToastProps = PropsRuntime<'shell.overlay'> & PropsLocale<'localSend'> & InjectFace<ReceiveToastInjected>;
/**
 * Show one notification per offer that is waiting.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function ReceiveToast(props: ReceiveToastProps): ReactNode;
export type { LocalSendLocaleKey };
