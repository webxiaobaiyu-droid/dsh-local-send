/**
 * The "send this file to…" menu, opened where the user right-clicked.
 *
 * DSH has no plugin-extensible context menu, so this is not an item added to
 * somebody else's menu: it is a listener on the document plus a menu of this
 * plugin's own, and the whole feature rests on one property — **it must be
 * invisible everywhere it does not apply.** So the listener resolves a target
 * first (`context-target.ts`) and returns without touching the event when there
 * is none. Only a right-click that landed on a path this plugin can actually act
 * on has its default suppressed and a menu drawn over it.
 *
 * That is why this lives in the frame-wide overlay rather than beside the panel:
 * the file tree, the document preview, and a sent message are three different
 * parts of the window owned by three different packages, and the only place they
 * have in common is the document.
 *
 * Three decisions worth stating:
 *
 * - **The menu closes before the transfer starts.** The host runs a path send to
 *   completion before it answers, so a menu left open across a large file would
 *   look like a hang. The transfer then reports itself through the notification
 *   surface — first as "sending", then as the outcome — which is also what
 *   `flash.ts` exists for.
 * - **A folder is offered nothing to send.** The protocol and the host's own
 *   resolution both work in files, so the send rows are replaced by a line
 *   saying so rather than by a round trip that comes back as an error. Adding a
 *   folder to the conversation is still offered, because that one works.
 * - **"Show in folder" appears only for a file this device received.** The host
 *   route deliberately refuses anything outside the receive directory — it
 *   spawns a process with the path as an argument — so offering the row for an
 *   arbitrary workspace file would be offering a button whose only outcome is a
 *   403.
 *
 * @module dsh-local-send/client/ContextSendMenu
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TransferStore } from './state.ts';
import type { SendPathsResponse } from '../types.ts';
/** Registration-side face the menu reads and acts through. */
export interface ContextSendMenuInjected {
    /** The shared state store, for the peer list and the receive directory. */
    store: TransferStore;
    /** Offer absolute paths this machine already has. */
    sendLocalPaths: (peer: string, paths: readonly string[]) => Promise<SendPathsResponse>;
    /** Show a received file in the platform's file manager. */
    revealFile: (path: string) => Promise<void>;
    /** Ask for the file to be referenced in the composer. */
    addToConversation: (path: string) => void;
}
/** Full component props assembled by the overlay renderer. */
export type ContextSendMenuProps = PropsRuntime<'shell.overlay'> & PropsLocale<'localSend'> & InjectFace<ContextSendMenuInjected>;
/**
 * Listen for a right-click on a file, and offer to send it.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function ContextSendMenu(props: ContextSendMenuProps): ReactNode;
