/**
 * The "send this file to…" menu, opened where the user right-clicked.
 *
 * DSH has no plugin-extensible context menu, so this is not an item added to
 * somebody else's menu: it is a listener on the document plus a menu of this
 * plugin's own, and the whole feature rests on one property — **it must be
 * invisible everywhere it does not apply.** So the listener resolves a target
 * first (`context-target.ts`) and returns without touching the event when there
 * is none. Only a right-click that landed on a path this plugin can actually act
 * on has its default suppressed and a menu drawn over it.
 *
 * That is why this lives in the frame-wide overlay rather than beside the panel:
 * the file tree, the document preview, and a sent message are three different
 * parts of the window owned by three different packages, and the only place they
 * have in common is the document.
 *
 * Three decisions worth stating:
 *
 * - **The menu closes before the transfer starts.** The host runs a path send to
 *   completion before it answers, so a menu left open across a large file would
 *   look like a hang. The transfer then reports itself through the notification
 *   surface — first as "sending", then as the outcome — which is also what
 *   `flash.ts` exists for.
 * - **A folder is offered nothing to send.** The protocol and the host's own
 *   resolution both work in files, so the send rows are replaced by a line
 *   saying so rather than by a round trip that comes back as an error. Adding a
 *   folder to the conversation is still offered, because that one works.
 * - **"Show in folder" appears only for a file this device received.** The host
 *   route deliberately refuses anything outside the receive directory — it
 *   spawns a process with the path as an argument — so offering the row for an
 *   arbitrary workspace file would be offering a button whose only outcome is a
 *   403.
 *
 * @module dsh-local-send/client/ContextSendMenu
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Menu, writeClipboard, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { contextTargetAt, type ContextTarget } from './context-target.ts'
import { flash } from './flash.ts'
import { DeviceIcon, HandoffIcon } from './icons.tsx'
import { useTransferState, type TransferStore } from './state.ts'
import type { PeerRow, SendPathsResponse } from '../types.ts'

/** Registration-side face the menu reads and acts through. */
export interface ContextSendMenuInjected {
  /** The shared state store, for the peer list and the receive directory. */
  store: TransferStore
  /** Offer absolute paths this machine already has. */
  sendLocalPaths: (peer: string, paths: readonly string[]) => Promise<SendPathsResponse>
  /** Show a received file in the platform's file manager. */
  revealFile: (path: string) => Promise<void>
  /** Ask for the file to be referenced in the composer. */
  addToConversation: (path: string) => void
}

/** Full component props assembled by the overlay renderer. */
export type ContextSendMenuProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'localSend'>
  & InjectFace<ContextSendMenuInjected>

/** One line describing an error, for a message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a path looks like it is inside the receive directory.
 *
 * A string prefix check rather than the host's own resolution, and deliberately
 * so: this only decides whether the row is *offered*, and the host re-checks for
 * real before it runs anything. A check here that tried to be authoritative
 * would be a second implementation of a security decision, which is the one
 * thing it must not be.
 *
 * @param path - the candidate absolute path.
 * @param inbox - the receive directory, when the state has been read.
 * @returns whether the row is worth offering.
 */
function looksReceived(path: string, inbox: string | undefined): boolean {
  if (inbox === undefined || inbox.length === 0) return false
  return path.startsWith(`${inbox.replace(/\/+$/u, '')}/`)
}

/**
 * Listen for a right-click on a file, and offer to send it.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function ContextSendMenu(props: ContextSendMenuProps): ReactNode {
  const { t, store, sendLocalPaths, revealFile, addToConversation } = props
  const read = useTransferState(store)
  /** Where the menu was asked for, and what was under the pointer. */
  const [at, setAt] = useState<{ x: number; y: number; target: ContextTarget } | undefined>(undefined)

  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = contextTargetAt(event.target)
      // Not ours: the event is left exactly as it was found, so a right-click
      // anywhere else in the application behaves as though this plugin were not
      // installed.
      if (target === undefined) return
      event.preventDefault()
      setAt({ x: event.clientX, y: event.clientY, target })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => { document.removeEventListener('contextmenu', onContextMenu) }
  }, [])

  const close = useCallback((): void => { setAt(undefined) }, [])

  /**
   * Send the file to one device.
   *
   * @param peer - the device to send to.
   */
  const send = useCallback((peer: PeerRow): void => {
    const path = at?.target.path
    if (path === undefined) return
    // Closed first: the host answers only once the whole transfer is over, and a
    // menu that stayed open for the length of a large file would read as a hang.
    close()
    flash('menuSending', { params: { alias: peer.alias } })
    void sendLocalPaths(peer.fingerprint, [path]).then(
      (state) => {
        void store.refresh()
        const failed = state.failed[0]
        if (failed !== undefined) {
          flash('menuSendFailed', { params: { message: failed.reason }, tone: 'error' })
          return
        }
        flash('menuSent', { params: { alias: peer.alias } })
      },
      (error: unknown) => {
        flash('menuSendFailed', { params: { message: describe(error) }, tone: 'error' })
      },
    )
  }, [at, close, sendLocalPaths, store])

  const copy = useCallback((): void => {
    const path = at?.target.path
    close()
    if (path === undefined) return
    // Reported through the notification surface because the menu is already
    // gone: the confirmation has nowhere else to be. The helper answers false
    // rather than throwing when the clipboard is unavailable — an insecure
    // context, or a denied permission — so the two outcomes are read from it
    // instead of from a rejection.
    void writeClipboard(path).then((copied) => {
      if (copied) flash('menuCopied')
      else flash('menuCopyFailed', { tone: 'error' })
    })
  }, [at, close])

  const add = useCallback((): void => {
    const path = at?.target.path
    close()
    if (path === undefined) return
    addToConversation(path)
  }, [at, close, addToConversation])

  const reveal = useCallback((): void => {
    const path = at?.target.path
    close()
    if (path === undefined) return
    void revealFile(path).then(
      () => {},
      (error: unknown) => { flash('menuSendFailed', { params: { message: describe(error) }, tone: 'error' }) },
    )
  }, [at, close, revealFile])

  const peers = read.status === 'ready' ? read.state.peers.filter(peer => peer.reachable) : []
  const inbox = read.status === 'ready' ? read.state.inbox : undefined
  const folder = at?.target.kind === 'folder'

  const items: MenuEntry[] = []
  items.push({ type: 'label', id: 'send-label', text: t('menuSendTo') })
  if (folder) {
    // A line rather than a round trip: the host resolves files, and offering a
    // row that can only come back as "not a regular file" is a worse way to say
    // the same thing.
    items.push({ id: 'send-folder', label: t('menuFoldersUnsupported'), disabled: true })
  } else if (peers.length === 0) {
    items.push({ id: 'send-none', label: t('menuNoPeers'), disabled: true })
  } else {
    for (const peer of peers) {
      items.push({
        id: `send:${peer.fingerprint}`,
        label: peer.alias,
        icon: <DeviceIcon type={peer.deviceType} size={15} />,
      })
    }
  }

  items.push({ type: 'separator', id: 'sep-actions' })
  items.push({
    id: 'add',
    label: t('addToConversation'),
    icon: <HandoffIcon size={15} />,
  })
  if (at !== undefined && looksReceived(at.target.path, inbox)) {
    items.push({ id: 'reveal', label: t('reveal') })
  }
  items.push({ type: 'separator', id: 'sep-copy' })
  items.push({ id: 'copy', label: t('menuCopyPath') })

  return (
    <Menu
      open={at !== undefined}
      // The trigger is the pointer, so the wrapper is deliberately inert: it has
      // no size and takes no pointer events, and the rect below is what the menu
      // is actually placed from.
      anchor={<span className="dls-menuAnchor" />}
      items={items}
      onSelect={(id) => {
        if (id === 'add') { add(); return }
        if (id === 'copy') { copy(); return }
        if (id === 'reveal') { reveal(); return }
        if (!id.startsWith('send:')) return
        const peer = peers.find(candidate => candidate.fingerprint === id.slice('send:'.length))
        if (peer !== undefined) send(peer)
      }}
      onClose={close}
      // Portaled, so the menu is not clipped by the overlay layer or by whatever
      // the right-clicked element sits inside.
      portal
      getAnchorRect={() => at === undefined ? null : new DOMRect(at.x, at.y, 0, 0)}
      className="dls-menu"
    />
  )
}
