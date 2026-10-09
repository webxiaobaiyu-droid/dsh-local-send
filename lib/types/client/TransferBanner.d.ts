/**
 * The offer banner: an incoming transfer, offered where the user is typing.
 *
 * This is the narrow answer to a narrow problem. A file arrives while somebody is
 * in the middle of writing, and the places the offer could otherwise appear are
 * both wrong for that moment: the notification is a banner at the top of the
 * window that fades, and the panel is a different screen entirely. So the offer
 * is also offered directly above the composer — full width, one line, between the
 * user and the thing they were about to send.
 *
 * It shows **only offers**. Progress and outcomes belong to the companion in the
 * header, and duplicating them here would turn the strip above the composer into
 * a second panel — the one place in the window that has to stay quiet, because
 * everything the user writes passes through it.
 *
 * No file list, deliberately: a batch of twenty files cannot be ticked off in one
 * line, and the panel is where choosing happens. Accept here takes the lot, which
 * is what "yes, send them" means when the details are a click away.
 *
 * @module dsh-local-send/client/TransferBanner
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TransferStore } from './state.ts';
/** Registration-side face the banner reads. */
export interface TransferBannerInjected {
    /** The shared state store. */
    store: TransferStore;
    /** Answer an offer, taking or refusing every file on it. */
    answer: (transferId: string, accept: boolean) => Promise<void>;
    /** Bring the transfer panel forward, for the details this line cannot carry. */
    openPanel: () => void;
}
/** Full component props assembled by the composer-dock renderer. */
export type TransferBannerProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'localSend'> & InjectFace<TransferBannerInjected>;
/**
 * Offer the waiting transfer, or draw nothing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function TransferBanner(props: TransferBannerProps): ReactNode;
