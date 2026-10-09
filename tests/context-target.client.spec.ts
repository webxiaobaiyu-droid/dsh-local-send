/**
 * Which file the user right-clicked on: the three markup conventions, and what
 * happens when none of them matches.
 *
 * This is the part of the "send this file to…" menu that decides *whether the
 * menu opens at all*, and its failure modes are asymmetric in a way that makes
 * testing it worth the trouble. Resolving a target that was not there opens a
 * menu offering to send a file nobody pointed at; failing to resolve one that
 * was there makes the feature look broken. The first is worse, so most of what
 * is asserted below is refusal.
 *
 * The rules are a pure function over a plain object, so they are tested as one.
 * The DOM adapter around them is tested with a hand-rolled fake, because this
 * suite runs in Node: there is no `Element` to build one from, which is why the
 * casts in `elementOf` are load-bearing rather than decorative.
 *
 * @module dsh-local-send/tests/context-target
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextTargetAt, markerOf, resolveTarget } from '../src/client/context-target.ts'

/**
 * The one DOM global the adapter touches, stood up for a Node run.
 *
 * `contextTargetAt` gates on `instanceof Element` before it does anything, and
 * Node has no such binding at all, so the test installs this class as the global
 * and builds its fakes out of it. It answers only the two methods anything here
 * calls, and records the selectors the walk asked for so a test can assert that
 * the walk happened exactly once.
 */
class FakeElement {
  /** The selectors `closest` was asked for, in order. */
  readonly walks: string[] = []

  constructor(
    private readonly attributeMap: Record<string, string> = {},
    private readonly walkMatch: Element | 'self' | null = 'self',
  ) {}

  getAttribute(name: string): string | null {
    return this.attributeMap[name] ?? null
  }

  closest(selectors: string): Element | null {
    this.walks.push(selectors)
    // `'self'` is the ordinary case and the one `closest` is defined to answer:
    // the element itself matches the union whenever it carries any of the three
    // conventions. A fake that returned `null` by default would make every walk
    // test assert the "nothing matched" path instead of the one under test.
    return this.walkMatch === 'self' ? (this as unknown as Element) : this.walkMatch
  }
}

/**
 * One fake element, as something the module will accept.
 *
 * The cast is the whole point: there is no real `Element` in this environment,
 * so `FakeElement` is a stand-in that satisfies the adapter's `instanceof` only
 * because the test also installs it as the global. The intersection keeps the
 * `walks` bookkeeping reachable without a second cast at every assertion.
 *
 * @param attributes - the attribute values `getAttribute` should answer with.
 * @param match - what `closest` should return: `'self'` for the element itself, an
 *   ancestor to stand in for a walk that stopped further up, or `null` for a walk
 *   that matched nothing at all.
 * @returns a fake element the adapter can be handed.
 */
function elementOf(
  attributes: Record<string, string> = {},
  match: Element | 'self' | null = 'self',
): FakeElement & Element {
  return new FakeElement(attributes, match) as unknown as FakeElement & Element
}

beforeEach(() => {
  // The module reads `Element` off the global scope the way any browser module
  // would; a Node run has neither it nor a DOM to get one from.
  vi.stubGlobal('Element', FakeElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the file tree convention', () => {
  it('resolves a file row', () => {
    expect(resolveTarget({ filesPath: '/w/src/index.ts', filesEntry: 'file' }))
      .toEqual({ path: '/w/src/index.ts', kind: 'file' })
  })

  it('resolves a directory row as a folder', () => {
    expect(resolveTarget({ filesPath: '/w/src', filesEntry: 'directory' }))
      .toEqual({ path: '/w/src', kind: 'folder' })
  })

  it('treats an "other" entry as a file', () => {
    // The tree uses `other` for an entry it will not open — a socket, a broken
    // symlink. It is explicitly not a directory, and the host's own path check
    // is what decides whether it can be sent, so a wrong guess here surfaces as
    // a message rather than a wrong transfer.
    expect(resolveTarget({ filesPath: '/w/sock', filesEntry: 'other' }))
      .toEqual({ path: '/w/sock', kind: 'file' })
  })

  it('does not read the row title, which on an "other" row is a label', () => {
    // The title on that row is a translated word, not a path. The tree's own
    // attribute has to win, or refusing the row would mean sending "Unsupported".
    expect(resolveTarget({ filesPath: '/w/sock', filesEntry: 'other', title: 'Unsupported' }))
      .toEqual({ path: '/w/sock', kind: 'file' })
  })

  it('trims the attribute before using it', () => {
    expect(resolveTarget({ filesPath: '  /w/src/index.ts  ', filesEntry: 'file' }))
      .toEqual({ path: '/w/src/index.ts', kind: 'file' })
  })

  it('accepts a path written with a leading tilde', () => {
    expect(resolveTarget({ filesPath: '~/notes.md' }))
      .toEqual({ path: '~/notes.md', kind: 'file' })
  })
})

describe('the reference chip convention', () => {
  it('resolves a file chip from its @ source text', () => {
    expect(resolveTarget({ refChip: 'file', title: '@/w/src/index.ts' }))
      .toEqual({ path: '/w/src/index.ts', kind: 'file' })
  })

  it('resolves a folder chip as a folder', () => {
    // The chip value decides the kind; a folder chip carries `folder`, not the
    // tree's `directory`.
    expect(resolveTarget({ refChip: 'folder', title: '@/w/src' }))
      .toEqual({ path: '/w/src', kind: 'folder' })
  })

  it('unwraps the quotes the @ grammar puts round a path with spaces', () => {
    // `@` ends a token at whitespace, so the writing side quotes such a path —
    // see `formatMention`. The chip's title is that source text verbatim, quotes
    // and all, and the quotes are not part of the path.
    expect(resolveTarget({ refChip: 'file', title: '@"/w/my photo.jpg"' }))
      .toEqual({ path: '/w/my photo.jpg', kind: 'file' })
  })

  it('unwraps only one pair of quotes', () => {
    // One pair is what the grammar adds, so one pair is what comes off. Stripping
    // greedily would silently rewrite a path that really does end in a quote.
    expect(resolveTarget({ refChip: 'file', title: '@"/w/""' }))
      .toEqual({ path: '/w/"', kind: 'file' })
  })

  it('leaves a lone quote to the shape check', () => {
    // `@"` is not a path and must not unwrap to an empty string, which the
    // emptiness check would then have to catch for a different reason.
    expect(resolveTarget({ refChip: 'file', title: '@"' })).toBeUndefined()
  })

  it('refuses a chip with no title', () => {
    expect(resolveTarget({ refChip: 'file' })).toBeUndefined()
    expect(resolveTarget({ refChip: 'file', title: null })).toBeUndefined()
  })

  it('refuses a chip whose value is not a file or a folder', () => {
    // DSH renders conversation references through the same chip, with
    // `data-ref-chip="session"` and a `#`-style title. Treating every chip as a
    // file would offer to send a conversation.
    expect(resolveTarget({ refChip: 'session', title: '@/w/src/index.ts' })).toBeUndefined()
  })

  it('refuses a chip whose title is not a path', () => {
    expect(resolveTarget({ refChip: 'file', title: 'not a path' })).toBeUndefined()
    expect(resolveTarget({ refChip: 'file', title: '@foo.txt' })).toBeUndefined()
  })
})

describe('the path label convention', () => {
  it('resolves the bare title as a file', () => {
    expect(resolveTarget({ hasPathLabel: true, title: '/w/src/index.ts' }))
      .toEqual({ path: '/w/src/index.ts', kind: 'file' })
  })

  it('takes the file tree root as a file, because nothing marks it a directory', () => {
    // The root label is a `PathLabel` that also carries an *empty*
    // `data-files-path`; the empty value is not a path, so the element falls
    // through to this rule. It is really a directory, and only the host's own
    // check can say so — the plugin reports that refusal rather than guessing.
    expect(resolveTarget({ filesPath: '', hasPathLabel: true, title: '/w' }))
      .toEqual({ path: '/w', kind: 'file' })
  })

  it('refuses a path label with no title', () => {
    expect(resolveTarget({ hasPathLabel: true })).toBeUndefined()
  })
})

describe('precedence between the conventions', () => {
  it('prefers the tree path over a reference chip on the same element', () => {
    // The tree states the path and the kind outright; the chip would have to be
    // read back through the `@` grammar. Nothing renders both today, and if
    // something does, the one that needs no interpretation is the one to trust.
    expect(resolveTarget({
      filesPath: '/w/src',
      filesEntry: 'directory',
      refChip: 'file',
      title: '@/elsewhere.ts',
    })).toEqual({ path: '/w/src', kind: 'folder' })
  })

  it('prefers the tree path over a path label on the same element', () => {
    expect(resolveTarget({ filesPath: '/w/a.ts', filesEntry: 'file', hasPathLabel: true, title: '/w/other.ts' }))
      .toEqual({ path: '/w/a.ts', kind: 'file' })
  })

  it('falls through a tree attribute that holds no path', () => {
    // An element carrying `data-files-path` with nothing usable in it is not a
    // tree row; whatever else it says still gets a hearing.
    expect(resolveTarget({ filesPath: '   ', refChip: 'file', title: '@/w/a.ts' }))
      .toEqual({ path: '/w/a.ts', kind: 'file' })
  })
})

describe('what is refused', () => {
  it('refuses an empty path', () => {
    expect(resolveTarget({ filesPath: '' })).toBeUndefined()
    expect(resolveTarget({ refChip: 'file', title: '' })).toBeUndefined()
    expect(resolveTarget({ refChip: 'file', title: '@' })).toBeUndefined()
    // Unwrapping an empty quoted pair leaves nothing behind, and nothing is not
    // a path — the pair itself must not be taken for one.
    expect(resolveTarget({ refChip: 'file', title: '@""' })).toBeUndefined()
  })

  it('refuses a whitespace-only path', () => {
    expect(resolveTarget({ filesPath: '   ' })).toBeUndefined()
    expect(resolveTarget({ hasPathLabel: true, title: '\t\n' })).toBeUndefined()
  })

  it('refuses a relative path', () => {
    // `foo.txt` cannot name anything the host could send, so acting on it would
    // mean sending a path resolved against a directory nobody chose.
    expect(resolveTarget({ filesPath: 'foo.txt' })).toBeUndefined()
    expect(resolveTarget({ refChip: 'file', title: '@foo.txt' })).toBeUndefined()
    expect(resolveTarget({ hasPathLabel: true, title: './foo.txt' })).toBeUndefined()
  })

  it('refuses a path carrying a control character', () => {
    // That is markup soup rather than a filename far more often than not, and a
    // path with a NUL in it cannot reach the host anyway.
    expect(resolveTarget({ filesPath: '/tmp/a\u0000b.txt' })).toBeUndefined()
    expect(resolveTarget({ refChip: 'file', title: '@/tmp/a\u007fb.txt' })).toBeUndefined()
    expect(resolveTarget({ hasPathLabel: true, title: '/tmp/a\u001fb.txt' })).toBeUndefined()
  })

  it('refuses a marker that says nothing', () => {
    // The ordinary case: a right-click on chrome that is not one of the three
    // conventions, which has to open no menu rather than some default one.
    expect(resolveTarget({})).toBeUndefined()
    expect(resolveTarget({
      filesPath: undefined,
      filesEntry: undefined,
      refChip: undefined,
      hasPathLabel: undefined,
      title: undefined,
    })).toBeUndefined()
  })

  it('refuses a marker whose convention is present but empty', () => {
    expect(resolveTarget({ filesEntry: 'file', refChip: 'file', hasPathLabel: false })).toBeUndefined()
  })
})

describe('the DOM adapter', () => {
  it('reads the four attributes and the title off one element', () => {
    expect(markerOf(elementOf({
      'data-files-path': '/w/a.ts',
      'data-files-entry': 'file',
      'data-ref-chip': 'file',
      'data-path-label': '',
      'title': '@/w/a.ts',
    }))).toEqual({
      filesPath: '/w/a.ts',
      filesEntry: 'file',
      refChip: 'file',
      hasPathLabel: true,
      title: '@/w/a.ts',
    })
  })

  it('reads a missing attribute as absent rather than as text', () => {
    expect(markerOf(elementOf({ 'title': '/w/a.ts' }))).toEqual({
      filesPath: null,
      filesEntry: null,
      refChip: null,
      hasPathLabel: false,
      title: '/w/a.ts',
    })
  })

  it('walks once, over the union of the three conventions', () => {
    // One `closest` over the union is the whole walk. A second pass up the tree
    // would mean falling back to an ancestor's path, which is not what the user
    // pointed at.
    const element = elementOf({ 'data-files-path': '/w/a.ts' })
    expect(contextTargetAt(element)).toEqual({ path: '/w/a.ts', kind: 'file' })
    expect(element.walks).toHaveLength(1)
    const [selectors] = element.walks
    expect(selectors).toContain('data-files-path')
    expect(selectors).toContain('data-ref-chip')
    expect(selectors).toContain('data-path-label')
  })

  it('resolves the element the walk stopped at, not the one clicked', () => {
    // Right-clicking lands on some inner node of a chip or a row; the path lives
    // on the element the walk finds.
    const chip = elementOf({ 'data-ref-chip': 'file', 'title': '@/w/a.ts' })
    const inner = elementOf({}, chip)
    expect(contextTargetAt(inner)).toEqual({ path: '/w/a.ts', kind: 'file' })
  })

  it('returns nothing for a null target', () => {
    expect(contextTargetAt(null)).toBeUndefined()
  })

  it('returns nothing for a target that is not an element', () => {
    // A shadow root reaches the listener as the event target in a retargeted
    // tree, and it has no `closest` to call.
    expect(contextTargetAt({} as unknown as EventTarget)).toBeUndefined()
    expect(contextTargetAt({ closest: () => null } as unknown as EventTarget)).toBeUndefined()
  })

  it('returns nothing, without throwing, when the walk matches nothing', () => {
    // The listener runs on every right-click in the application, so the "not
    // ours" path has to be silent as well as empty.
    const element = elementOf()
    expect(() => contextTargetAt(element)).not.toThrow()
    expect(contextTargetAt(element)).toBeUndefined()
  })

  it('returns nothing rather than throwing where there is no DOM at all', () => {
    // `Element` is a browser global. If it is missing, an unguarded `instanceof`
    // would raise from inside the listener and take right-click down with it.
    vi.stubGlobal('Element', undefined)
    expect(() => contextTargetAt(elementOf({ 'data-files-path': '/w/a.ts' }))).not.toThrow()
    expect(contextTargetAt(elementOf({ 'data-files-path': '/w/a.ts' }))).toBeUndefined()
  })
})
