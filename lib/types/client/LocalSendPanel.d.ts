/**
 * The Nearby transfer panel: who is around, what is moving, and what arrived.
 *
 * The panel owns presentation and nothing else. Every read and every action goes
 * through its injected face, so the component can be rendered against a fixture
 * and the wiring can be tested without one.
 *
 * Behaviours worth stating because they are not obvious from the markup:
 *
 * - **It owns no polling.** The state arrives from a shared store that the
 *   notification and the companion also read, and the panel merely retains it
 *   while mounted. See `state.ts` for why the cadence follows the host's own work.
 * - **A drop lands on a device, and anywhere else on the panel.** The tiles are
 *   the precise targets, but dropping onto empty space used to do nothing at all,
 *   which is indistinguishable from the panel being broken — so a drop anywhere
 *   is staged, and sent straight away when there is exactly one device it could
 *   possibly mean. The counter that tracks dragging exists because `dragleave`
 *   fires when the pointer crosses into a child element, so a boolean would
 *   flicker the whole panel on every internal boundary.
 * - **A received file is offered to the conversation, not committed to it.** The
 *   "add" action leaves a reference for the composer to insert; whether to send
 *   is still the user's.
 *
 * @module dsh-local-send/client/LocalSendPanel
 */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { type PathCandidate, type SendPathsResponse } from '../types.ts';
import { type TransferStore } from './state.ts';
/** Registration-side face the panel reads and acts through. */
export interface LocalSendPanelInjected {
    /** Key this panel occupies in the main column, matching the sidebar entry. */
    panelId: MainPanelId;
    /** Active locale id, read at call time so a locale switch re-renders figures. */
    locale: () => string;
    /**
     * The shared state store.
     *
     * Shared rather than owned, because the notification reads the same document
     * from a different mount point; one loop serves both.
     */
    store: TransferStore;
    /** Offer browser-held files to a peer and stream them. */
    sendFiles: (peer: string, files: readonly File[]) => Promise<void>;
    /**
     * Offer paths that already exist on this machine.
     *
     * The outcome comes back with the answer rather than through the next poll,
     * because the host runs a path send to completion before it responds: by then
     * the transfer is over, and the panel puts the figures on screen at once
     * instead of one poll behind.
     */
    sendLocalPaths: (peer: string, paths: readonly string[]) => Promise<SendPathsResponse>;
    /** Answer an incoming offer, optionally taking only some of its files. */
    answer: (transferId: string, accept: boolean, fileIds?: readonly string[]) => Promise<void>;
    /** Stop a transfer this device is part of, in either direction. */
    cancel: (transferId: string) => Promise<void>;
    /** Send a settled outgoing transfer again, from its files on this machine. */
    retry: (transferId: string) => Promise<void>;
    /** Rename this device and persist the name. */
    renameDevice: (alias: string) => Promise<void>;
    /** Run the legacy subnet scan. */
    scanNow: () => Promise<{
        found: number;
    }>;
    /** Show a received file — or the inbox itself — in the file manager. */
    revealFile: (path: string) => Promise<void>;
    /** Ask the host what it knows about some paths. */
    inspectPaths: (paths: readonly string[]) => Promise<readonly PathCandidate[]>;
    /**
     * Ask for a received file to be referenced in the composer.
     *
     * Handled outside this component because the insert has to happen in the
     * conversation's own slot tree, which the main column cannot reach.
     */
    addToConversation: (path: string) => void;
    /** Whether a conversation is open for a reference to land in. */
    hasSession: () => boolean;
}
/** Full component props assembled by the main slot renderer. */
export type LocalSendPanelProps = PropsRuntime<'main'> & PropsLocale<'localSend'> & InjectFace<LocalSendPanelInjected>;
/**
 * The panel.
 * @param props - slot props, locale seat, and the injected face.
 */
export declare function LocalSendPanel(props: LocalSendPanelProps): ReactNode;
