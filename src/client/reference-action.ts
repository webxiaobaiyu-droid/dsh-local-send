/**
 * What to do about a pending "add to conversation" request.
 *
 * The decision is separated from the component that carries it out because it is
 * the part with rules in it, and because getting it wrong is invisible: an
 * insert that happens twice appends the reference twice, and one that happens
 * when no conversation is open puts a path into a draft the user never sees. A
 * pure function is testable; a `useEffect` body is not.
 *
 * @module dsh-local-send/client/reference-action
 */

import { formatMention } from './mention.ts'

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
  | { readonly kind: 'wait' }
  /**
   * Take the request and forget it.
   *
   * The path cannot be written as a mention at all — it carries a quote or a
   * control character — so inserting it would produce a token that parses as two
   * and hands the agent half a path. Dropping it leaves the panel showing the
   * file and its location, which is the honest fallback.
   */
  | { readonly kind: 'drop' }
  /** Take the request and put this text at the caret. */
  | { readonly kind: 'insert'; readonly text: string }

/**
 * Decide what to do about one pending request.
 *
 * @param pending - the path waiting to be referenced, if any.
 * @param hasSession - whether a conversation is currently bound to the composer.
 * @returns the action to take.
 */
export function referenceAction(pending: string | undefined, hasSession: boolean): ReferenceAction {
  if (pending === undefined) return { kind: 'wait' }
  // Deferred rather than dropped: the request is still wanted, the composer just
  // is not in a position to take it yet.
  if (!hasSession) return { kind: 'wait' }
  const mention = formatMention(pending)
  if (mention === undefined) return { kind: 'drop' }
  // The trailing space is part of the insert, not decoration: the `@` grammar
  // ends a token at whitespace, so without it the next character the user types
  // would extend this path.
  return { kind: 'insert', text: `${mention} ` }
}
