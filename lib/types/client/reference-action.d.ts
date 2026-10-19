/**
 * What to do about a pending "add to conversation" request.
 *
 * The decision is separated from the component that carries it out because it is
 * the part with rules in it, and because getting it wrong is invisible: an
 * insert that happens twice appends the reference twice, and one that happens
 * when no conversation is open puts a path into a draft the user never sees. A
 * pure function is testable; a `useEffect` body is not.
 *
 * The text itself is built by `session-target.ts`'s `targetMessage`, the same
 * function the "send to a conversation" picker uses: one press references every
 * file in the batch, and both entry points have to spell that list the same way.
 *
 * @module dsh-local-send/client/reference-action
 */
/** What one look at the pending request concluded. */
export type ReferenceAction = 
/**
 * Nothing to do yet, and the request must survive.
 *
 * Both cases mean "try again on the next render": there is no request, or
 * there is one but the composer is not bound to a conversation yet — a
 * request is made from the transfer panel, and the composer only exists once
 * the centre column has switched back to the conversation.
 */
{
    readonly kind: 'wait';
}
/**
 * Take the request and forget it.
 *
 * None of the paths can be written as a mention — each carries a quote or a
 * control character — so inserting them would produce tokens that parse as two
 * and hand the agent half a path. Dropping it leaves the panel showing the
 * files and their location, which is the honest fallback.
 */
 | {
    readonly kind: 'drop';
}
/** Take the request and put this text at the caret. */
 | {
    readonly kind: 'insert';
    readonly text: string;
};
/**
 * Decide what to do about one pending request.
 *
 * @param pending - the paths waiting to be referenced, if any.
 * @param hasSession - whether a conversation is currently bound to the composer.
 * @returns the action to take.
 */
export declare function referenceAction(pending: readonly string[] | undefined, hasSession: boolean): ReferenceAction;
