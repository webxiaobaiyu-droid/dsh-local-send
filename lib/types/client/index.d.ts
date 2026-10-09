/**
 * Nearby transfer, browser half: the sidebar entry, the panel it opens, the
 * receive notification, and the composer hook that references a received file.
 *
 * A global panel rather than a settings page: this is a place you go to move a
 * file, and a transfer in progress is not a preference.
 *
 * Nothing here talks to another device directly. The browser cannot listen on a
 * socket, and a page cannot join a multicast group, so discovery and the
 * transfer protocol both live in the host half and this half reaches them over
 * the plugin's own Fetch routes. What the browser does own is the one thing the
 * host cannot do for it: handing a file the user dropped on the panel to the
 * host as a live stream.
 *
 * @module dsh-local-send/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { type LocalSendLocaleKey } from './locales.ts';
import { type HostError } from './api.ts';
export type { LocalSendPanelInjected, LocalSendPanelProps } from './LocalSendPanel.tsx';
export type { LocalSendLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Nearby transfer panel copy. */
        'localSend': LocalSendLocaleKey;
    }
}
/** Dictionary namespace owned by this panel. */
export declare const NS = "localSend";
/** The id shared by the sidebar entry and the main panel it opens. */
export declare const PANEL_ID: MainPanelId;
/**
 * Services required by the slot registrations.
 *
 * `sessions` is deliberately absent: the composer hook only *reads* it, to check
 * whether a conversation is open, and a hard injection would keep this whole
 * plugin from activating in a deployment that mounted no session controller.
 * Every use below goes through {@link sessionsOf}, which tolerates its absence.
 */
export declare const inject: string[];
/**
 * Contribute the Nearby transfer panel, its notification, and its composer hook.
 * @param ctx - Client plugin context.
 */
export declare function apply(ctx: ClientContext): void;
export type { HostError };
