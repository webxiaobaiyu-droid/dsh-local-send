/**
 * Nearby transfer, browser half: where the plugin draws, and the actions every
 * one of those places asks for.
 *
 * Five seats, each doing one job:
 *
 * - the **sidebar entry** and the **panel** it opens — who is around, what is
 *   moving, and what arrived;
 * - the **notification** in the frame-wide overlay — an offer has to reach
 *   somebody who is not looking at the panel;
 * - the **floating companion** in the same overlay — the transfer's presence and
 *   its progress, wherever in the window the user happens to be. Two surfaces that
 *   used to carry this are gone deliberately: the banner above the composer sat in
 *   the typing path, which is the one strip of the window the product keeps quiet,
 *   and the mark in the conversation header could only be seen in the conversation
 *   it belonged to;
 * - the **context menu** in the same overlay — right-click a file anywhere DSH
 *   shows one and send it, without visiting the panel at all;
 * - the **composer hook**, which is the only thing that can put a reference into
 *   the draft.
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

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `main` keyed slot's MainPanelId brand.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebar's SlotMap merge (the 'sidebar.panellist' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  cancelTransfer,
  decide,
  inspect,
  prepareSend,
  rename,
  retryTransfer,
  reveal,
  scan,
  sendPaths,
  streamFile,
} from './api.ts'
import { ComposerEntry, type ComposerEntryInjected } from './ComposerEntry.tsx'
import { ContextSendMenu, type ContextSendMenuInjected } from './ContextSendMenu.tsx'
import { FloatingBuddy, type FloatingBuddyInjected } from './FloatingBuddy.tsx'
import { flash } from './flash.ts'
import { LocalSendPanel, type LocalSendPanelInjected } from './LocalSendPanel.tsx'
import { en, zh, type LocalSendLocaleKey } from './locales.ts'
import { HandoffIcon } from './icons.tsx'
import { requestReference } from './pending.ts'
import { NoticeToast, type NoticeToastInjected } from './NoticeToast.tsx'
import {
  targetTree,
  type ProjectRow,
  type SessionRow,
  type TargetTree,
} from './session-target.ts'
import { createTransferStore } from './state.ts'
import { STYLE_ID, styles } from './styles.ts'
import { fetchState } from './api.ts'
import type { SendPathsResponse } from '../types.ts'

export type { LocalSendPanelInjected, LocalSendPanelProps } from './LocalSendPanel.tsx'
export type { LocalSendLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Nearby transfer panel copy. */
    'localSend': LocalSendLocaleKey
  }
}

/** Dictionary namespace owned by this panel. */
export const NS = 'localSend'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'local-send' as MainPanelId

/** Uploads the panel runs at once, matching what the host does toward a peer. */
const UPLOAD_CONCURRENCY = 2

/**
 * Services required by the slot registrations.
 *
 * `sessions` is deliberately absent: the composer hook only *reads* it, to check
 * whether a conversation is open, and a hard injection would keep this whole
 * plugin from activating in a deployment that mounted no session controller.
 * Every use below goes through {@link sessionsOf}, which tolerates its absence.
 */
export const inject = ['slots', 'locale', 'layout']

/**
 * One session as this plugin reads it from the session list.
 *
 * Every field beyond `retainedBy` is optional here even though the service
 * declares most of them required: this is an untrusted structural view of another
 * package's snapshot, taken by `ctx.get` rather than by an import, so a field this
 * plugin did not verify must not be able to produce `undefined` deep inside a
 * render.
 */
interface SessionSnapshotRow {
  readonly retainedBy: Readonly<Record<string, number>>
  readonly displayTitle?: string | undefined
  readonly title?: string | undefined
  readonly running?: boolean | undefined
  readonly blank?: boolean | undefined
  readonly updatedAt?: number | undefined
  readonly origin?: string | undefined
}

/** The session list service, when this deployment has one. */
interface SessionList {
  readonly list: {
    getSnapshot(): { readonly byId: Readonly<Record<string, SessionSnapshotRow>> }
  }
}

/** One project, as the workspace list publishes it. */
interface WorkspaceSnapshot {
  readonly items: readonly {
    readonly workspaceId: string
    readonly path: string
    readonly title: string
    readonly sessionIds: readonly string[]
    readonly updatedAt?: string | undefined
  }[]
}

/** The workspace (project) list service, when this deployment has one. */
interface WorkspaceList {
  readonly list: {
    getSnapshot(): WorkspaceSnapshot
  }
}

/** Read the session service without declaring a dependency on it. */
function sessionsOf(ctx: ClientContext): SessionList | undefined {
  const candidate = ctx.get('sessions') as SessionList | undefined
  return candidate !== undefined && typeof candidate.list?.getSnapshot === 'function'
    ? candidate
    : undefined
}

/**
 * The session currently open in the centre column.
 *
 * The product's own derivation: the main column retains exactly one session, and
 * that is the one a composer would be bound to. There is no selected-session
 * field to read — the selection store is private to the workspace plugin — so
 * the retention count is the contract every first-party caller uses too.
 *
 * @param ctx - client context.
 * @returns the open session's id, or `undefined` when none is bound.
 */
function currentSessionId(ctx: ClientContext): string | undefined {
  const sessions = sessionsOf(ctx)
  if (sessions === undefined) return undefined
  return Object.entries(sessions.list.getSnapshot().byId)
    .find(([, row]) => (row.retainedBy['mainView'] ?? 0) > 0)?.[0]
}

/**
 * Every known session, in the shape the picker's model wants.
 *
 * Defaults are filled in here rather than trusted from the snapshot: a session row
 * missing `displayTitle` should read as a nameless session, not crash the dialog.
 *
 * @param ctx - client context.
 * @returns session rows keyed by id, empty when the service is absent.
 */
function sessionRowsOf(ctx: ClientContext): Readonly<Record<string, SessionRow>> {
  const sessions = sessionsOf(ctx)
  if (sessions === undefined) return {}
  const rows: Record<string, SessionRow> = {}
  for (const [id, row] of Object.entries(sessions.list.getSnapshot().byId)) {
    rows[id] = {
      id,
      displayTitle: typeof row.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : id,
      ...typeof row.title === 'string' ? { title: row.title } : {},
      running: row.running === true,
      blank: row.blank === true,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
      ...row.origin === 'subagent' ? { origin: 'subagent' as const } : {},
    }
  }
  return rows
}

/**
 * Every project, in the shape the picker's model wants.
 *
 * @param ctx - client context.
 * @returns project rows, empty when the service is absent.
 */
function projectsOf(ctx: ClientContext): readonly ProjectRow[] {
  const workspaces = ctx.get('workspaces') as WorkspaceList | undefined
  const items = workspaces?.list.getSnapshot().items
  if (!Array.isArray(items)) return []
  return items.map(item => ({
    workspaceId: item.workspaceId,
    path: item.path,
    title: item.title,
    sessionIds: item.sessionIds,
    // An absent timestamp reads as the empty string, which the ordering rule
    // treats as oldest — the same answer as "we do not know when this was".
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
  }))
}

/**
 * Whether a conversation is currently open in the centre column.
 *
 * @param ctx - client context.
 * @returns whether a session is bound to the main column.
 */
function hasOpenSession(ctx: ClientContext): boolean {
  return currentSessionId(ctx) !== undefined
}

/**
 * Open one conversation and leave the files' references in its composer.
 *
 * Two steps, in this order: switch the centre column to that conversation, then
 * park the request. Parking first would let whichever composer is mounted
 * *right now* take it — the one belonging to the conversation the user is
 * leaving — which is the one bug this ordering exists to prevent. The insert
 * itself is performed by `ComposerEntry`, which only exists inside a
 * conversation's slot tree.
 *
 * Nothing is sent: the user asked for the reference to land in the draft so they
 * can say what they want said about it.
 *
 * @param ctx - client context.
 * @param sessionId - the conversation to open.
 * @param paths - absolute paths of the received files.
 */
function openInSession(ctx: ClientContext, sessionId: string, paths: readonly string[]): void {
  const workspace = ctx.get('uiWorkspace') as { openSession?: (id: string) => void } | undefined
  workspace?.openSession?.(sessionId)
  // `openSession` already leaves the panel in the shipped wiring; this is the
  // plugin's own guarantee. A deployment whose workspace service is absent, or a
  // call that is a no-op because that session is already current, must still get
  // the user out of the transfer panel and in front of the composer.
  ctx.layout.selectPanel(null)
  requestReference(paths)
}

/**
 * Inject this plugin's stylesheet once.
 *
 * A plugin served outside the product's build has to carry and inject its own
 * sheet; the tag is keyed so a reload replaces rather than accumulates.
 *
 * @returns the disposer that removes the tag this call installed.
 */
function injectStyles(): () => void {
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-local-send'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = styles
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

/**
 * Contribute the Nearby transfer panel, its notification, and its composer hook.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-local-send: dictionaries')
  ctx.effect(() => injectStyles(), 'dsh-local-send: stylesheet')

  const t = ctx.locale.bind(NS)
  // One store for both readers. See `state.ts` for why the polling is shared.
  const store = createTransferStore(fetchState)

  /**
   * Offer browser-held files and stream each accepted one through.
   *
   * The bytes go straight from the panel's request into the host's request to
   * the peer — see the host half's streaming route — so a dropped file is copied
   * once and never staged.
   *
   * @param peer - the peer's stable key.
   * @param files - the dropped or picked files.
   */
  async function sendBrowserFiles(peer: string, files: readonly File[]): Promise<void> {
    if (files.length === 0) return
    // Ids have to be stable across the two calls: the preparation names them and
    // the streaming call addresses them.
    const offered = files.map((file, index) => ({
      id: `f${String(index + 1)}`,
      fileName: file.name,
      size: file.size,
    }))
    const prepared = await prepareSend({ peer, files: offered })
    if (!prepared.accepted) return
    const wanted = new Set(prepared.files)
    const queue = files
      .map((file, index) => ({ id: `f${String(index + 1)}`, file }))
      .filter(entry => wanted.has(entry.id))

    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
        while (cursor < queue.length) {
          const index = cursor
          cursor += 1
          const entry = queue[index]
          if (entry === undefined) continue
          try {
            await streamFile(prepared.transferId, entry.id, entry.file)
          } catch (error: unknown) {
            // One file failing does not abandon the batch: the host records the
            // failure against that file's row, and the rest still go.
            void error
          }
        }
      }),
    )
  }

  /**
   * Answer an incoming offer.
   *
   * `fileIds` is passed only by a surface that showed the file list. Left out,
   * the host reads the answer as "every file its own limits left standing" —
   * which is what the notification's single Accept button means.
   *
   * @param transferId - the offer's row.
   * @param accept - whether to take it.
   * @param fileIds - the files the user ticked, when a list was on screen.
   */
  async function answerOffer(
    transferId: string,
    accept: boolean,
    fileIds?: readonly string[],
  ): Promise<void> {
    await decide({
      transferId,
      accept,
      ...fileIds === undefined ? {} : { fileIds },
    })
  }

  /**
   * Ask for a received file to be referenced by the composer.
   *
   * The insert itself happens in the composer, which is the only component
   * holding that editor's input actions; this leaves the request and brings the
   * conversation back so the composer exists to carry it out.
   *
   * The confirmation is raised here rather than in whichever surface asked,
   * because this call is what switches that surface away — see `flash.ts`. It is
   * optimistic by one render: the composer inserts as soon as it mounts, and the
   * only case `reference-action.ts` refuses is a path that cannot be written as
   * a mention at all, which the panel has already shown the user in full.
   *
   * @param path - absolute path of a file this device received.
   */
  function addToConversation(path: string): void {
    // The insert is performed by the composer, which only exists inside a
    // conversation. Without one, switching the centre column would land the user
    // on a blank-session screen with the reference parked behind it and nothing
    // on screen to explain it — so the gesture is refused, out loud, instead.
    if (!hasOpenSession(ctx)) {
      flash('noSession', { tone: 'error' })
      return
    }
    requestReference([path])
    ctx.layout.selectPanel(null)
    flash('addedToConversation')
  }

  /**
   * Everything any surface can ask for, implemented once.
   *
   * One implementation handed out in slices rather than one literal per slot:
   * this plugin now draws in six seats — the panel, the sidebar, the
   * notification, the composer hook, the header companion, and the banner above
   * the composer — and five hand-written copies of `answer` is five places for
   * the host contract to drift.
   */
  const facade = {
    store,
    // Read through the service on every call rather than captured once: figures
    // are formatted during render, and the renderer re-renders an entry whenever
    // the locale revision moves, so the id read is always the one the dictionary
    // around it was resolved from.
    locale: (): string => ctx.locale.getLocale().active,
    sendFiles: sendBrowserFiles,
    sendLocalPaths: async (peer: string, paths: readonly string[]): Promise<SendPathsResponse> =>
      await sendPaths({ peer, paths }),
    answer: answerOffer,
    cancel: async (transferId: string): Promise<void> => { await cancelTransfer({ transferId }) },
    retry: async (transferId: string): Promise<void> => { await retryTransfer({ transferId }) },
    renameDevice: async (alias: string): Promise<void> => { await rename(alias) },
    scanNow: async (): Promise<{ found: number }> => await scan(),
    revealFile: async (path: string): Promise<void> => { await reveal(path) },
    inspectPaths: async (paths: readonly string[]) => (await inspect(paths)).candidates,
    addToConversation,
    hasSession: (): boolean => hasOpenSession(ctx),
    /** Every project and session a received file could be sent to. */
    readTargets: (): TargetTree => targetTree({
      projects: projectsOf(ctx),
      sessions: sessionRowsOf(ctx),
      currentSessionId: currentSessionId(ctx),
    }),
    openInSession: (sessionId: string, paths: readonly string[]): void => {
      openInSession(ctx, sessionId, paths)
    },
    /** Bring the transfer panel forward, for a surface that is only a summary. */
    openPanel: (): void => { ctx.layout.selectPanel(PANEL_ID) },
  }

  const panelFace = (): LocalSendPanelInjected => ({
    ...facade,
    panelId: PANEL_ID,
  })
  const noticeFace = (): NoticeToastInjected => ({ store, answer: answerOffer })

  const composerFace = (): ComposerEntryInjected => ({ hasSession: facade.hasSession })

  const buddyFace = (): FloatingBuddyInjected => ({
    store,
    answer: answerOffer,
    cancel: facade.cancel,
    openPanel: facade.openPanel,
  })

  const menuFace = (): ContextSendMenuInjected => ({
    store,
    sendLocalPaths: facade.sendLocalPaths,
    revealFile: facade.revealFile,
    addToConversation,
  })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: panelFace,
  }, LocalSendPanel))

  // Ordered after Usage so the transfer surface sits with the other working
  // panels rather than above the navigation entries that shape how work is run.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    label: () => t('nav'),
    locale: NS,
  }, HandoffEntryIcon))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'local-send.notice',
    order: 20,
    locale: NS,
    inject: noticeFace,
  }, NoticeToast))

  // A second cell in the same overlay rather than part of the notification: the
  // menu is anchored to the pointer and answers a right-click anywhere in the
  // window, which has nothing to do with what the notification is saying.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'local-send.context-menu',
    order: 30,
    locale: NS,
    inject: menuFace,
  }, ContextSendMenu))

  // The floating companion shares the overlay with the notification and the
  // context menu. It is its own cell rather than part of the notification because
  // the two answer different questions — "someone is asking you something" and
  // "here is what is moving" — and because this one is draggable, which is a
  // property of a surface the user can move out of the way.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'local-send.buddy',
    order: 25,
    locale: NS,
    inject: buddyFace,
  }, FloatingBuddy))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'local-send.reference',
    order: 40,
    locale: NS,
    inject: composerFace,
  }, ComposerEntry))
}

/** The sidebar mark, sized and tinted by the sidebar itself. */
function HandoffEntryIcon({ size }: { readonly size: number }): ReturnType<typeof HandoffIcon> {
  return HandoffIcon({ size })
}

/**
 * Re-exported as a value rather than a type: it is thrown, so a caller that
 * wants to tell a host failure from any other has to be able to catch it.
 */
export { HostError } from './api.ts'
