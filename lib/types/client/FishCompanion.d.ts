/**
 * The companion: a small fish in the conversation header that is the transfer's
 * presence while the user is working.
 *
 * It exists because the two surfaces the plugin already had are both somewhere
 * else. The panel is a different screen, and the notification is a banner that
 * fades — so a transfer in flight, or one that just landed, had nothing to say
 * for itself in the place the user actually spends their time. This is that
 * place, and the mark is the answer to "is anything happening?" without opening
 * anything.
 *
 * Three decisions worth stating:
 *
 * - **It hides when there is nothing to say.** A companion that sat in the
 *   header all day would be a control with no content, beside three controls
 *   that have plenty. So idle is *absent* rather than dimmed, and the rule lives
 *   in `companion.ts` where the plugin's other rules live — it is a field on the
 *   view, not a check here. When something does happen it arrives with the news
 *   already on it, which is the part a status dot cannot do.
 * - **It never decides anything by itself.** Everything it can do — take an
 *   offer, stop a transfer, add a received file to the conversation — is one
 *   press away in its popover, and every one of those is a decision the user
 *   makes. The mark reports; it does not act.
 * - **The popover is the product's own menu.** It already carries the keyboard
 *   walk, Escape, outside-click dismissal, and focus return, and a bespoke
 *   popover in the header would have had to reimplement all four to look like the
 *   ones beside it.
 *
 * What is *not* here: a file list for an offer. That can be twenty rows, and the
 * banner above the composer and the panel both show it. The popover offers the
 * choice — take them, refuse them, go and look — and nothing more.
 *
 * @module dsh-local-send/client/FishCompanion
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TransferStore } from './state.ts';
/** Registration-side face the companion reads and acts through. */
export interface FishCompanionInjected {
    /** The shared state store; the companion also keeps it polling. */
    store: TransferStore;
    /** Answer an offer, taking or refusing every file on it. */
    answer: (transferId: string, accept: boolean) => Promise<void>;
    /** Stop a transfer this device is part of. */
    cancel: (transferId: string) => Promise<void>;
    /** Show a received file in the platform's file manager. */
    revealFile: (path: string) => Promise<void>;
    /** Ask for a received file to be referenced in the composer. */
    addToConversation: (path: string) => void;
    /** Bring the transfer panel forward. */
    openPanel: () => void;
}
/** Full component props assembled by the header renderer. */
export type FishCompanionProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'localSend'> & InjectFace<FishCompanionInjected>;
/**
 * Show the companion, and offer what can be done about whatever it is showing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function FishCompanion(props: FishCompanionProps): ReactNode;
