/**
 * Which file the user right-clicked on, worked out from DSH's own markup.
 *
 * DSH has no plugin-extensible context menu: a plugin cannot add a "send this
 * file to…" item, so this one installs its own `document`-level `contextmenu`
 * listener and has to answer the listener's first question itself — *what was
 * right-clicked?* The only thing available to answer it with is the markup the
 * host already renders, and there are exactly three conventions that put a path
 * on an element a user can right-click:
 *
 * 1. the right sidebar's file tree, whose every row carries `data-files-path`
 *    (already absolute) next to `data-files-entry`;
 * 2. the file-reference chips in a sent message, which carry `data-ref-chip`
 *    and hold the `@`-reference *source text* in `title`;
 * 3. `PathLabel` — the document preview, the deliverables list, and the file
 *    tree's root label — which marks itself with `data-path-label` and holds
 *    the bare path in `title`.
 *
 * None of that is a documented plugin API, so this module is written to answer
 * "nothing" rather than a guess. A marker that matches none of the conventions,
 * or one whose candidate is not even shaped like an absolute path, resolves to
 * `undefined`, and the plugin then does not open a menu at all. That is what
 * keeps a global right-click listener from interfering with right-click
 * *anywhere* it does not recognise, which is the property that matters: a menu
 * that appears on unrelated chrome, or that offers to send the wrong file, is
 * worse than no menu.
 *
 * The rules are separated from the listener that acts on them for the usual
 * reason — the rules are the part with judgement in them, and a pure function
 * over a plain object is testable where a listener body is not. The environment
 * these tests run in has no DOM, so the DOM reading is kept to one thin adapter
 * (`markerOf` / `contextTargetAt`) around the decision (`resolveTarget`).
 *
 * @module dsh-local-send/client/context-target
 */

/** What the user right-clicked on, when it turned out to be a file. */
export interface ContextTarget {
  /** Absolute path of the file or folder. */
  readonly path: string
  /** Whether the path names a directory rather than a file. */
  readonly kind: 'file' | 'folder'
}

/** What one element said about itself, before any of it is believed. */
export interface Marker {
  /** `data-files-path` on the element, when present. */
  readonly filesPath?: string | null | undefined
  /** `data-files-entry` on the same element. */
  readonly filesEntry?: string | null | undefined
  /** `data-ref-chip` on the element. */
  readonly refChip?: string | null | undefined
  /** `data-path-label` on the element — its presence is the signal; the value is unused. */
  readonly hasPathLabel?: boolean | undefined
  /** The element's `title` attribute. */
  readonly title?: string | null | undefined
}

/** The three conventions, as one selector, so the walk is a single `closest` call. */
const TARGET_SELECTOR = '[data-files-path], [data-ref-chip], [data-path-label]'

/**
 * Decide whether a candidate is shaped like a path this plugin will act on.
 *
 * This is deliberately a *shape* check and not a validation. The host is what
 * actually resolves a path — it decides whether the file exists, whether it is
 * inside the workspace, and what kind of entry it is — and no amount of
 * string-reading here can do that job. What this refuses is the
 * obviously-not-a-path: an empty or whitespace-only attribute, a relative path
 * that cannot name anything the host could send, and a value carrying a control
 * character, which is far likelier to be markup soup than a filename. Anything
 * that survives the check is handed on as-is; refusing more aggressively would
 * mean dropping real files whose names this plugin simply did not anticipate.
 *
 * @param candidate - the raw attribute or title text, before trimming.
 * @returns the trimmed path, or `undefined` when it is not path-shaped.
 */
function usablePath(candidate: string | null | undefined): string | undefined {
  if (candidate === null || candidate === undefined) return undefined
  const path = candidate.trim()
  if (path.length === 0) return undefined
  // eslint-disable-next-line no-control-regex -- refusing them is the point
  if (/[\u0000-\u001f\u007f]/u.test(path)) return undefined
  // `/` is what an absolute path looks like here; `~` covers a path the user
  // typed in that form, which the host's own resolution understands.
  if (!path.startsWith('/') && !path.startsWith('~')) return undefined
  return path
}

/**
 * Take the `@`-reference wrapper off a chip's `title`.
 *
 * A chip's `title` is the source text the message was written with, so it is
 * `@/absolute/path` — or `@"/a path with spaces"`, because the `@` grammar ends
 * the token at the first whitespace and so quotes a path that contains any. That
 * is the same grammar `formatMention` writes on the other side (see
 * `mention.ts`); this is its reader. Exactly one pair of quotes comes off, since
 * only one pair is ever added, and a lone `"` is left alone so the shape check
 * rejects it rather than turning it into an empty path.
 *
 * @param title - the chip's `title` attribute.
 * @returns the path text with the wrapper removed, or `undefined` when absent.
 */
function unwrapReference(title: string | null | undefined): string | undefined {
  if (title === null || title === undefined) return undefined
  const trimmed = title.trim()
  const body = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  if (body.length >= 2 && body.startsWith('"') && body.endsWith('"')) return body.slice(1, -1)
  return body
}

/**
 * Work out what one element's markup says was right-clicked.
 *
 * The three conventions are tried in order of how much they actually assert.
 * Each rule only claims the element when it yields a usable path, so an element
 * that carries one convention's attribute without carrying its payload falls
 * through to the next rather than resolving to a guess. When none of them
 * yields a path — the ordinary case for a right-click anywhere else in the
 * application — the answer is `undefined` and no menu opens.
 *
 * @param marker - what the element said about itself.
 * @returns the target, or `undefined` when nothing here names a path.
 */
export function resolveTarget(marker: Marker): ContextTarget | undefined {
  // The file tree is tried first because it is the only convention that states
  // the path *and* the kind directly, with no grammar to undo. It is also the
  // only reason `title` cannot simply be preferred: an "other" row carries a
  // human-readable label in `title`, which would read as a path if the tree's
  // attribute did not win here.
  const fromTree = usablePath(marker.filesPath)
  if (fromTree !== undefined) {
    // `data-files-entry` is `directory` for a directory and `file` for a file,
    // but it can also be `other` — a symlink, a socket, anything the tree will
    // not open. Treating `other` as `file` is the honest choice: it is
    // explicitly *not* a directory, and the host's own path check is what
    // finally decides whether the path can be sent, so a wrong guess here costs
    // an error message rather than a wrong transfer.
    return { path: fromTree, kind: marker.filesEntry === 'directory' ? 'folder' : 'file' }
  }

  // A reference chip states the kind itself, and its `title` is the source text
  // with the `@` grammar still on it. `data-ref-chip` also carries values that
  // are not files at all — `session` for a conversation reference, and slash
  // chips for other token kinds — so only the two file values are accepted and
  // everything else falls through to no target.
  if (marker.refChip === 'file' || marker.refChip === 'folder') {
    const fromChip = usablePath(unwrapReference(marker.title))
    if (fromChip !== undefined) {
      return { path: fromChip, kind: marker.refChip === 'folder' ? 'folder' : 'file' }
    }
  }

  // `PathLabel` has no kind in its markup, so the path is taken as a file. That
  // is right for the document preview and the deliverables list, and wrong for
  // its one directory use — the file tree's root label, which nothing marks as a
  // directory. Rather than guess at that from the path's shape, the plugin sends
  // it as a file and lets the host's own `isDirectory` check refuse it, and the
  // menu reports that refusal. A visible "that is a folder" is better than a
  // silent wrong kind.
  if (marker.hasPathLabel === true) {
    const fromLabel = usablePath(marker.title)
    if (fromLabel !== undefined) return { path: fromLabel, kind: 'file' }
  }

  return undefined
}

/**
 * Read one element's markup into a marker.
 *
 * Presence of `data-path-label` is read as a non-null `getAttribute` rather than
 * with `hasAttribute`, so the adapter touches exactly one DOM method and a test
 * fake only has to answer that one. The attribute is a valueless marker in the
 * host's markup, so its value is never interpreted.
 *
 * @param element - the element the walk stopped at.
 * @returns what that element said about itself.
 */
export function markerOf(element: Element): Marker {
  return {
    filesPath: element.getAttribute('data-files-path'),
    filesEntry: element.getAttribute('data-files-entry'),
    refChip: element.getAttribute('data-ref-chip'),
    hasPathLabel: element.getAttribute('data-path-label') !== null,
    title: element.getAttribute('title'),
  }
}

/**
 * Find the nearest right-clickable target at or above an event target.
 *
 * One `closest` call over the union of the three selectors is the whole walk:
 * it stops at the innermost element matching any convention, which is the one
 * the user actually pointed at. There is no second pass further up the tree,
 * because an ancestor's path is not what was clicked, and offering it would be
 * exactly the guess this module exists to avoid.
 *
 * Everything about this function is defensive, because it runs inside a global
 * `contextmenu` listener: an exception thrown here would break right-click for
 * the entire application, not just for this plugin. So a target that is not an
 * `Element` — a shadow root being the case that actually occurs, since
 * `event.target` is retargeted to the host for a closed tree — or a node
 * detached from the document, or simply nothing, all return `undefined` instead
 * of throwing, and `undefined` means the menu does not open.
 *
 * @param target - the event's `target`, whatever it turned out to be.
 * @returns the target under that element, or `undefined` when there is none.
 */
export function contextTargetAt(target: EventTarget | null): ContextTarget | undefined {
  // `Element` is a browser global. A DOM-less embedder (and this repository's
  // Node test run) has no such binding, and a bare `instanceof` would raise a
  // `ReferenceError` from inside the listener — the one failure mode this
  // function must not have. So the binding is checked before it is used.
  if (typeof Element === 'undefined') return undefined
  if (!(target instanceof Element)) return undefined
  const match = target.closest(TARGET_SELECTOR)
  return match === null ? undefined : resolveTarget(markerOf(match))
}
