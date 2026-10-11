/**
 * The picker that sends a received file into a specific conversation.
 *
 * "Add to the conversation I have open" only ever addressed one session, and only
 * the one on screen. A file that lands while the user is working in one project
 * is very often wanted in another — the one it belongs to — so the plugin needs a
 * way to name a target rather than assume it. That is this dialog: projects on the
 * left of the reading order, their sessions under them, one press to send.
 *
 * Four decisions worth stating:
 *
 * - **It is the product's `Modal`, not a bespoke overlay.** Escape, the mask, the
 *   focus trap, and returning focus to the button that opened it are all already
 *   handled there, and a plugin dialog that behaved differently from every other
 *   dialog in the window would read as a bug.
 * - **Projects and sessions are one list, not two steps.** The brief was "pick a
 *   project, then pick a session", and grouping is a superset of that: the project
 *   is a heading over its own sessions, so the second step is visible without a
 *   second screen. Searching narrows both levels at once (`filterTree`).
 * - **Subagent sessions and empty projects never appear**, and neither does a
 *   session that has never had a message in it — the rule lives in
 *   `session-target.ts`, where it is tested, rather than here.
 * - **The keyboard is the same walk as the mouse.** Arrow keys move a highlight
 *   over exactly the rows on screen (the flat list `orderedChoices` produces),
 *   Enter sends to the highlighted one, and nothing here reorders anything.
 *
 * @module dsh-local-send/client/SessionPicker
 */
import { type ReactNode } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { type TargetTree } from './session-target.ts';
/** The locale function a sub-component is handed; the panel already owns one. */
type Translate = PropsLocale<'localSend'>['t'];
/** Props assembled by the panel, which owns the transfer being sent. */
export interface SessionPickerProps {
    /** Whether the dialog is showing. */
    readonly open: boolean;
    /** Close without sending. */
    readonly onClose: () => void;
    /** Send the waiting file(s) into this session. */
    readonly onPick: (sessionId: string, label: string) => void;
    /** Every project and session that can be addressed. */
    readonly tree: TargetTree;
    /** Whether a send is in flight, which disables the rows. */
    readonly busy: boolean;
    /** Locale function from the panel's own slot seat. */
    readonly t: Translate;
}
/**
 * Offer every conversation this file could be sent to.
 *
 * @param props - the dialog's props, assembled by the panel.
 */
export declare function SessionPicker(props: SessionPickerProps): ReactNode;
export {};
