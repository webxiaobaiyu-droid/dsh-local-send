/**
 * The handoff between the panel and the composer.
 *
 * "Add to conversation" is one gesture that has to happen in a component the
 * panel does not own. Inserting text into the composer needs that composer's own
 * input actions, which only exist inside the conversation's slot tree, while the
 * button the user presses lives in the main column. The two are in one bundle
 * but not one tree, so the request has to travel between them.
 *
 * A module-level store does that, and it is the right size for the job: the
 * request is one string with a lifetime of a single keystroke-equivalent, it
 * never outlives the page, and routing it through the host would mean a round
 * trip to move a string between two components of the same bundle.
 *
 * The shape is the one React's `useSyncExternalStore` expects — a snapshot read
 * plus a subscription — so the composer can re-render on a request without the
 * panel needing to know anything about it.
 *
 * @module dsh-local-send/client/pending
 */

/**
 * How long a request stays valid.
 *
 * A request crosses a panel switch — the composer that performs the insert is
 * not mounted while the user is looking at this panel — so it cannot be consumed
 * synchronously. It must not be consumable indefinitely either: a request left
 * over from a session the user has since left would insert a reference into an
 * unrelated conversation minutes later, which is worse than doing nothing.
 */
const REQUEST_TTL_MS = 15_000

/** The request waiting to be inserted, or `undefined` when there is none. */
let pending: { readonly path: string; readonly at: number } | undefined

/** Everything waiting to hear that {@link pending} changed. */
const listeners = new Set<() => void>()

/**
 * Ask for one file to be referenced in the composer.
 *
 * A later request replaces an earlier one rather than queueing behind it: the
 * user pressed a button, and two files added by two impatient clicks should not
 * both appear — the gesture means "this file", and the second click is the one
 * that counts.
 *
 * @param path - absolute path of the received file.
 */
export function requestReference(path: string): void {
  pending = { path, at: Date.now() }
  for (const listener of listeners) listener()
}

/**
 * Subscribe to changes.
 * @param listener - called after every request.
 * @returns the unsubscribe function.
 */
export function subscribeReference(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Read the pending request without consuming it.
 *
 * Read without consuming because `useSyncExternalStore` may call this more than
 * once per render, and a snapshot that disappeared on first read would make the
 * composer render an empty state on its second pass.
 * @returns the pending path, or `undefined`.
 */
export function readReference(): string | undefined {
  if (pending === undefined) return undefined
  // Expiry is applied on read rather than by a timer: nothing is scheduled while
  // no request is outstanding, and a stale request costs one comparison.
  if (Date.now() - pending.at > REQUEST_TTL_MS) {
    pending = undefined
    return undefined
  }
  return pending.path
}

/**
 * Take the pending request.
 * @returns the path that was waiting, or `undefined` when there was none.
 */
export function consumeReference(): string | undefined {
  const taken = readReference()
  pending = undefined
  return taken
}
