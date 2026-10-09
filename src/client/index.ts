/**
 * Nearby transfer, browser half: the sidebar entry, the panel it opens, the
 * receive notification, and the composer hook that references a received file.
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
  decide,
  inspect,
  prepareSend,
  rename,
  reveal,
  scan,
  sendPaths,
  streamFile,
} from './api.ts'
import { ComposerEntry, type ComposerEntryInjected } from './ComposerEntry.tsx'
import { LocalSendPanel, type LocalSendPanelInjected } from './LocalSendPanel.tsx'
import { en, zh, type LocalSendLocaleKey } from './locales.ts'
import { HandoffIcon } from './icons.tsx'
import { requestReference } from './pending.ts'
import { ReceiveToast, type ReceiveToastInjected } from './ReceiveToast.tsx'
import { createTransferStore } from './state.ts'
import { STYLE_ID, styles } from './styles.ts'
import { fetchState, type HostError } from './api.ts'

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

  const panelFace = (): LocalSendPanelInjected => ({
    panelId: PANEL_ID,
    // Read through the service on every call rather than captured once: the
    // panel formats figures during render, and the renderer re-renders this
    // entry whenever the locale revision moves, so the id it reads is always
    // the one the dictionary around it was resolved from.
    locale: () => ctx.locale.getLocale().active,
    store,
    sendFiles: sendBrowserFiles,
    sendLocalPaths: async (peer, paths) => { await sendPaths({ peer, paths }) },
    answer: async (transferId, accept) => { await decide({ transferId, accept }) },
    renameDevice: async (alias) => { await rename(alias) },
    scanNow: async () => await scan(),
    revealFile: async (path) => { await reveal(path) },
    inspectPaths: async (paths) => (await inspect(paths)).candidates,
    // The insert itself happens in the composer, which is the only component
    // holding that editor's input actions; this leaves the request and brings
    // the conversation back so the composer exists to carry it out.
    addToConversation: (path) => {
      requestReference(path)
      ctx.layout.selectPanel(null)
    },
  })

  const toastFace = (): ReceiveToastInjected => ({
    store,
    answer: async (transferId, accept) => { await decide({ transferId, accept }) },
  })

  const composerFace = (): ComposerEntryInjected => ({
    hasSession: () => hasOpenSession(ctx),
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
    id: 'local-send.receive-toast',
    order: 20,
    locale: NS,
    inject: toastFace,
  }, ReceiveToast))

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

export type { HostError }
