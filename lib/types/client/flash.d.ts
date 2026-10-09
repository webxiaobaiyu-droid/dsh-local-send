/**
 * One short confirmation, shown somewhere the user can still see it.
 *
 * Most of this plugin's feedback belongs in the panel, next to the thing it is
 * about. Two cases cannot work that way, and they are why this module exists:
 *
 * - **"Add to conversation" leaves the panel.** The reference can only be
 *   inserted by the composer, which lives in the conversation's own slot tree,
 *   so asking for it switches the centre column away from the panel. A
 *   confirmation rendered in the panel would be unmounted in the same gesture
 *   that earned it, and the user would watch the panel disappear with no sign
 *   that anything had happened.
 * - **"Copy path" and the right-click menu happen anywhere.** The menu is opened
 *   from a global listener and is gone the moment it is used; the surface that
 *   answered is not on screen to say so.
 *
 * So the message is handed to a store, and the frame-wide overlay renders it.
 * That is the same reasoning the receive notification follows, and the same
 * product `Toast` carries it — a confirmation that looked unlike every other
 * confirmation in the window would read as an interruption.
 *
 * Three decisions are worth stating:
 *
 * - **A key and its placeholders, never a finished sentence.** The active locale
 *   can change while a message is on screen — the panel re-renders on a locale
 *   switch and this surface must follow it — and the plugin's rule everywhere
 *   else is that whoever knows *what* happened does not decide how it reads.
 * - **One at a time, replacing.** These confirm actions the user has just taken.
 *   A queue would show them a backlog of stale news and make the newest, most
 *   relevant one wait behind it.
 * - **An id, not a flag.** Dismissal belongs to one message rather than to the
 *   surface, so clearing the one on screen cannot silence the next — the same
 *   trap `notice.ts` documents for offers.
 *
 * @module dsh-local-send/client/flash
 */
import type { LocalSendLocaleKey } from './locales.ts';
/** A message to show once, then forget. */
export interface Flash {
    /** Identity of this message, so a dismissal cannot silence a later one. */
    readonly id: number;
    /** Dictionary key to render at the moment it is drawn. */
    readonly key: LocalSendLocaleKey;
    /** Placeholders for that key's template, when it has any. */
    readonly params?: Readonly<Record<string, string | number>>;
    /**
     * Whether this reports something that did not work.
     *
     * Carried rather than inferred from the key, because the same store serves
     * both and the surface should not have to keep a list of which keys are bad
     * news — a list that would go stale the first time a key was added.
     */
    readonly tone: 'info' | 'error';
}
/**
 * Show one confirmation, replacing whatever was on screen.
 *
 * @param key - dictionary key describing what happened.
 * @param options - placeholders for the template, and whether this is a failure.
 */
export declare function flash(key: LocalSendLocaleKey, options?: {
    readonly params?: Readonly<Record<string, string | number>>;
    readonly tone?: 'info' | 'error';
}): void;
/**
 * The message on screen, if any.
 * @returns the current message.
 */
export declare function readFlash(): Flash | undefined;
/**
 * Forget one message, by id.
 *
 * The id is checked rather than trusted: the surface fades on a timer, and a
 * timer that fires after a newer message has replaced this one must not take the
 * newer one down with it.
 *
 * @param id - the message that finished being shown.
 */
export declare function clearFlash(id: number): void;
/**
 * Watch for messages.
 * @param listener - called whenever the message changes.
 * @returns the unsubscribe function.
 */
export declare function subscribeFlash(listener: () => void): () => void;
