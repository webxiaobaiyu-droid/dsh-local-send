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
    readonly path: string;
    /** Whether the path names a directory rather than a file. */
    readonly kind: 'file' | 'folder';
}
/** What one element said about itself, before any of it is believed. */
export interface Marker {
    /** `data-files-path` on the element, when present. */
    readonly filesPath?: string | null | undefined;
    /** `data-files-entry` on the same element. */
    readonly filesEntry?: string | null | undefined;
    /** `data-ref-chip` on the element. */
    readonly refChip?: string | null | undefined;
    /** `data-path-label` on the element — its presence is the signal; the value is unused. */
    readonly hasPathLabel?: boolean | undefined;
    /** The element's `title` attribute. */
    readonly title?: string | null | undefined;
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
export declare function resolveTarget(marker: Marker): ContextTarget | undefined;
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
export declare function markerOf(element: Element): Marker;
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
export declare function contextTargetAt(target: EventTarget | null): ContextTarget | undefined;
