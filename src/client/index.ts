/**
 * Nearby transfer, browser half: where the plugin draws, and the actions every
 * one of those places asks for.
 *
 * Six seats, each doing one job:
 *
 * - the **sidebar entry** and the **panel** it opens — who is around, what is
 *   moving, and what arrived;
 * - the **notification** in the frame-wide overlay — an offer has to reach
 *   somebody who is not looking at the panel;
 * - the **context menu** in the same overlay — right-click a file anywhere DSH
 *   shows one and send it, without visiting the panel at all;
 * - the **companion** in the conversation header and the **banner** above its
 *   composer — the transfer's presence while the user is working, which is where
 *   they are when a file arrives;
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
import { FishCompanion, type FishCompanionInjected } from './FishCompanion.tsx'
import { flash } from './flash.ts'
import { LocalSendPanel, type LocalSendPanelInjected } from './LocalSendPanel.tsx'
import { en, zh, type LocalSendLocaleKey } from './locales.ts'
import { HandoffIcon } from './icons.tsx'
import { requestReference } from './pending.ts'
import { NoticeToast, type NoticeToastInjected } from './NoticeToast.tsx'
import { createTransferStore } from './state.ts'
import { STYLE_ID, styles } from './styles.ts'
import { TransferBanner, type TransferBannerInjected } from './TransferBanner.tsx'
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

/** The session list service, when this deployment has one. */
interface SessionList {
  readonly list: {
    getSnapshot(): {
      readonly byId: Readonly<Record<string, { readonly retainedBy: Readonly<Record<string, number>> }>>
    }
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
 * Whether a conversation is currently open in the centre column.
 *
 * The product's own derivation: the main column retains exactly one session, and
 * that is the one a composer would be bound to. There is no selected-session
 * field to read — the selection store is private to the workspace plugin — so
 * the retention count is the contract every first-party caller uses too.
 *
 * @param ctx - client context.
 * @returns whether a session is bound to the main column.
 */
function hasOpenSession(ctx: ClientContext): boolean {
  const sessions = sessionsOf(ctx)
  if (sessions === undefined) return false
  return Object.values(sessions.list.getSnapshot().byId)
    .some(row => (row.retainedBy['mainView'] ?? 0) > 0)
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
    requestReference(path)
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
    /** Bring the transfer panel forward, for a surface that is only a summary. */
    openPanel: (): void => { ctx.layout.selectPanel(PANEL_ID) },
  }

  const panelFace = (): LocalSendPanelInjected => ({
    ...facade,
    panelId: PANEL_ID,
  })
  const noticeFace = (): NoticeToastInjected => ({ store, answer: answerOffer })

  const composerFace = (): ComposerEntryInjected => ({ hasSession: facade.hasSession })

  const buddyFace = (): FishCompanionInjected => ({
    store,
    answer: answerOffer,
    cancel: facade.cancel,
    revealFile: facade.revealFile,
    addToConversation,
    openPanel: facade.openPanel,
  })

  const bannerFace = (): TransferBannerInjected => ({
    store,
    answer: answerOffer,
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

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'local-send.companion',
    // Positive, so the companion sits to the right of the shipped utilities,
    // which register at -10 and -5 beside the overflow menu at 0.
    order: 10,
    locale: NS,
    inject: buddyFace,
  }, FishCompanion))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'local-send.banner',
    // The shipped docks run todo (0), goal (10), queue (20) top to bottom. An
    // offer is the one thing that has to be read before typing, so it goes last
    // and therefore nearest the composer.
    order: 30,
    locale: NS,
    inject: bannerFace,
  }, TransferBanner))

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
