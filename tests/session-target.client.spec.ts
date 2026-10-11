/**
 * The picker's model: what a send can reach, in what order, and what it says.
 *
 * Every rule asserted here is one whose wrong answer is invisible in use. A
 * subagent's session left in the list is a file sent into a conversation no
 * person reads; a project that survived its last session is a heading the
 * keyboard can land on and act nowhere; a current project buried under newer
 * ones makes the most common send the slowest one. None of those is a crash,
 * which is why they are pinned rather than left to the component that draws
 * them.
 *
 * The module is pure over plain objects, so the whole of it is tested that way:
 * no DOM, no store, no host. The one injected dependency — the mention grammar —
 * is passed in as `mention.ts`'s own function, so the message tests exercise the
 * real grammar rather than a stub that agrees with a second copy of it.
 *
 * @module dsh-local-send/tests/session-target
 */

import { describe, expect, it } from 'vitest'
import { formatMention } from '../src/client/mention.ts'
import {
  filterTree,
  firstChoice,
  orderedChoices,
  targetMessage,
  targetTree,
} from '../src/client/session-target.ts'
import type {
  ProjectRow,
  SessionChoice,
  SessionRow,
  TargetInput,
} from '../src/client/session-target.ts'

/** One session row with the boring fields filled in. */
function session(overrides: Partial<SessionRow> & Pick<SessionRow, 'id'>): SessionRow {
  return {
    id: overrides.id,
    displayTitle: overrides.displayTitle ?? overrides.id,
    running: overrides.running ?? false,
    blank: overrides.blank ?? false,
    updatedAt: overrides.updatedAt ?? 0,
    // Spread rather than assigned: `exactOptionalPropertyTypes` is on, and an
    // explicit `undefined` is not the same thing as an absent key.
    ...overrides.title === undefined ? {} : { title: overrides.title },
    ...overrides.origin === undefined ? {} : { origin: overrides.origin },
  }
}

/** One project row with the boring fields filled in. */
function project(overrides: Partial<ProjectRow> & Pick<ProjectRow, 'workspaceId'>): ProjectRow {
  return {
    workspaceId: overrides.workspaceId,
    path: overrides.path ?? `/work/${overrides.workspaceId}`,
    title: overrides.title ?? overrides.workspaceId,
    sessionIds: overrides.sessionIds ?? [],
    updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
  }
}

/** A snapshot over the given projects and sessions. */
function snapshot(
  overrides: Partial<TargetInput> & Pick<TargetInput, 'projects' | 'sessions'>,
): TargetInput {
  return {
    currentSessionId: undefined,
    ...overrides,
  }
}

/** Session metadata keyed by id, as the host hands it over. */
function table(...rows: readonly SessionRow[]): Record<string, SessionRow> {
  const indexed: Record<string, SessionRow> = {}
  for (const row of rows) indexed[row.id] = row
  return indexed
}

/** The ids of a choice list, for assertions about order. */
function ids(choices: readonly SessionChoice[]): readonly string[] {
  return choices.map(choice => choice.id)
}

describe('the target tree', () => {
  it('drops a subagent session, and a project left holding none', () => {
    const tree = targetTree(snapshot({
      projects: [
        project({ workspaceId: 'mixed', sessionIds: ['chat', 'spawned'] }),
        project({ workspaceId: 'machine-only', sessionIds: ['spawned'] }),
      ],
      sessions: table(
        session({ id: 'chat' }),
        session({ id: 'spawned', origin: 'subagent' }),
      ),
    }))
    // A subagent's conversation is a machine talking to itself: sending into it
    // looks successful and is read by nobody.
    expect(tree.projects.map(choice => choice.id)).toEqual(['mixed'])
    expect(ids(tree.projects[0]?.sessions ?? [])).toEqual(['chat'])
    // The empty heading is gone, not drawn empty: the keyboard must not be able
    // to land on a project with nothing to act on.
    expect(tree.projects.some(choice => choice.id === 'machine-only')).toBe(false)
  })

  it('resolves ids through the metadata table, survives an unknown one and orders the rest newest first', () => {
    const input = snapshot({
      projects: [project({ workspaceId: 'w', sessionIds: ['ghost', 'older', 'newer', 'middle'] })],
      sessions: table(
        session({ id: 'newer', updatedAt: 300 }),
        session({ id: 'middle', updatedAt: 200 }),
        session({ id: 'older', updatedAt: 100 }),
      ),
    })
    // A row the host no longer knows is dropped rather than rendered as a
    // placeholder that would fail at send time. It must not throw on the way,
    // and the sessions that are left are newest first regardless of the order
    // the project listed them in.
    expect(() => targetTree(input)).not.toThrow()
    expect(ids(targetTree(input).projects[0]?.sessions ?? []))
      .toEqual(['newer', 'middle', 'older'])
  })

  it('lists the current session’s project first even when it is the oldest', () => {
    const tree = targetTree(snapshot({
      currentSessionId: 'here',
      projects: [
        project({ workspaceId: 'newest', updatedAt: '2024-06-01T00:00:00.000Z', sessionIds: ['a'] }),
        project({ workspaceId: 'oldest', updatedAt: '2020-01-01T00:00:00.000Z', sessionIds: ['here'] }),
        project({ workspaceId: 'middle', updatedAt: '2024-03-01T00:00:00.000Z', sessionIds: ['b'] }),
      ],
      sessions: table(
        session({ id: 'here' }),
        session({ id: 'a' }),
        session({ id: 'b' }),
      ),
    }))
    // The most common send is to the conversation already on screen, so recency
    // is deliberately not what decides the first row.
    expect(tree.projects.map(choice => choice.id)).toEqual(['oldest', 'newest', 'middle'])
    expect(tree.projects[0]?.isCurrent).toBe(true)
    expect(tree.projects[1]?.isCurrent).toBe(false)
  })

  it('sorts the remaining projects newest first, with an undateable one last', () => {
    const tree = targetTree(snapshot({
      projects: [
        project({ workspaceId: 'broken', updatedAt: 'not a date', sessionIds: ['a'] }),
        project({ workspaceId: 'older', updatedAt: '2024-01-01T00:00:00.000Z', sessionIds: ['b'] }),
        project({ workspaceId: 'newer', updatedAt: '2024-09-01T00:00:00.000Z', sessionIds: ['c'] }),
      ],
      sessions: table(
        session({ id: 'a' }),
        session({ id: 'b' }),
        session({ id: 'c' }),
      ),
    }))
    // An unreadable timestamp is oldest, not a thrown error and not the top of
    // the list: a picker must not collapse because one clock was unreadable.
    expect(tree.projects.map(choice => choice.id)).toEqual(['newer', 'older', 'broken'])
  })

  it('labels a session by its title when it has one and describes its row otherwise', () => {
    const tree = targetTree(snapshot({
      currentSessionId: 'current',
      projects: [project({ workspaceId: 'w', sessionIds: ['named', 'untitled', 'current'] })],
      sessions: table(
        session({
          id: 'named',
          title: 'Fix the login redirect',
          displayTitle: 'Generated name',
          updatedAt: 300,
        }),
        session({ id: 'untitled', title: '', displayTitle: 'Session 4', updatedAt: 200 }),
        session({
          id: 'current',
          displayTitle: 'Session 5',
          running: true,
          blank: true,
          updatedAt: 7,
        }),
      ),
    }))
    const [named, untitled, current] = tree.projects[0]?.sessions ?? []
    expect(named?.label).toBe('Fix the login redirect')
    // An empty title is not a name; the generated one is what the user saw in
    // the sidebar, so it is what they will look for here.
    expect(untitled?.label).toBe('Session 4')
    expect(current?.label).toBe('Session 5')
    expect(current?.isCurrent).toBe(true)
    expect(current?.running).toBe(true)
    // Blank is what `stale` reports — a session nothing has ever been said in.
    expect(current?.stale).toBe(true)
    expect(named?.stale).toBe(false)
    expect(named?.updatedAt).toBe(300)
  })

  it('flattens the tree for keyboard traversal, current session first in its project', () => {
    const tree = targetTree(snapshot({
      currentSessionId: 'mine',
      projects: [
        project({ workspaceId: 'home', sessionIds: ['fresh', 'mine'], updatedAt: '2024-01-01T00:00:00.000Z' }),
        project({ workspaceId: 'other', sessionIds: ['theirs'], updatedAt: '2024-09-01T00:00:00.000Z' }),
      ],
      sessions: table(
        session({ id: 'fresh', updatedAt: 900 }),
        session({ id: 'mine', updatedAt: 100 }),
        session({ id: 'theirs', updatedAt: 500 }),
      ),
    }))
    // Projects in order, sessions in order, and the current session lifted to
    // the front of its own project: one list is what an arrow key indexes.
    expect(ids(orderedChoices(tree))).toEqual(['mine', 'fresh', 'theirs'])
  })

  it('highlights the current session, and the newest one when there is none', () => {
    const withCurrent = targetTree(snapshot({
      currentSessionId: 'mine',
      projects: [project({ workspaceId: 'w', sessionIds: ['mine', 'other'] })],
      sessions: table(
        session({ id: 'mine', updatedAt: 10 }),
        session({ id: 'other', updatedAt: 900 }),
      ),
    }))
    expect(firstChoice(withCurrent)?.id).toBe('mine')

    // No current session at all — the picker can be opened from a place with no
    // conversation behind it — falls back to the first session of the first
    // project, which is the newest thing on offer.
    const withoutCurrent = targetTree(snapshot({
      projects: [project({ workspaceId: 'w', sessionIds: ['other'] })],
      sessions: table(session({ id: 'other', updatedAt: 900 })),
    }))
    expect(firstChoice(withoutCurrent)?.id).toBe('other')

    // And nothing to highlight is `undefined`, not a crash and not a fabricated
    // first row.
    expect(firstChoice(targetTree(snapshot({ projects: [], sessions: table() })))).toBeUndefined()
  })
})

describe('the message body', () => {
  it('joins the mentions with a single space, with no trailing one and no second copy of the grammar', () => {
    const message = targetMessage(
      ['/Users/Admin/one.txt', '/Users/Admin/two.txt'],
      formatMention,
    )
    expect(message).toBe('@/Users/Admin/one.txt @/Users/Admin/two.txt')
    expect(message?.endsWith(' ')).toBe(false)
    // A path with whitespace the grammar has to quote is still one token, and
    // the quoting is `mention.ts`'s business, not this module's.
    expect(targetMessage(['/Users/Admin/my file.txt'], formatMention))
      .toBe('@"/Users/Admin/my file.txt"')
    // The formatter is the caller's, so a stub is honoured exactly as written.
    expect(targetMessage(['/a.txt'], () => undefined)).toBeUndefined()
  })

  it('drops a path the grammar refuses instead of failing the whole message', () => {
    // One unwritable name — a quote is the case the grammar cannot spell — must
    // not cost the user the other files.
    expect(targetMessage(['/ok/one.txt', '/bad/od"d.txt'], formatMention))
      .toBe('@/ok/one.txt')
    // And a message made only of unwritable paths, or of nothing at all, is no
    // message: the caller reports it rather than sending a token that parses as
    // something else.
    expect(targetMessage(['/bad/od"d.txt'], formatMention)).toBeUndefined()
    expect(targetMessage([], formatMention)).toBeUndefined()
  })
})

describe('the picker’s search box', () => {
  /** A tree of two projects, with one session each plus a second in the first. */
  const tree = targetTree(snapshot({
    currentSessionId: 'beta',
    projects: [
      project({
        workspaceId: 'alpha',
        title: 'Local Send',
        path: '/Users/Admin/dsh-plugins/dsh-local-send',
        sessionIds: ['beta', 'gamma'],
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      project({
        workspaceId: 'delta',
        title: 'Notes',
        path: '/Users/Admin/notes',
        sessionIds: ['epsilon'],
        updatedAt: '2024-02-01T00:00:00.000Z',
      }),
    ],
    sessions: table(
      session({ id: 'beta', title: 'Wire the picker', updatedAt: 300 }),
      session({ id: 'gamma', title: 'Old thread', updatedAt: 200 }),
      session({ id: 'epsilon', title: 'Shopping list', updatedAt: 100 }),
    ),
  }))

  it('keeps every session of a project matched by its path', () => {
    const filtered = filterTree(tree, 'dsh-local-send')
    // Typing the project's directory asks for the project, not for whichever
    // session happened to contain the same letters.
    expect(filtered.projects.map(choice => choice.id)).toEqual(['alpha'])
    expect(ids(filtered.projects[0]?.sessions ?? [])).toEqual(['beta', 'gamma'])
  })

  it('sifts sessions when the project itself does not match, and drops what is left empty', () => {
    const filtered = filterTree(tree, 'SHOPPING')
    // Case is not something the user should have to get right.
    expect(filtered.projects.map(choice => choice.id)).toEqual(['delta'])
    expect(ids(filtered.projects[0]?.sessions ?? [])).toEqual(['epsilon'])

    // A query that matches a session nowhere leaves no projects at all, rather
    // than headings with nothing under them.
    expect(filterTree(tree, 'nothing here').projects).toEqual([])

    // A query that says nothing is not a filter, and hands back the very tree
    // the picker is holding: a keystroke of whitespace must not rebuild the list.
    expect(filterTree(tree, '')).toBe(tree)
    expect(filterTree(tree, '   ')).toBe(tree)
  })
})
