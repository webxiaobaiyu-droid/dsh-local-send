/**
 * The Nearby transfer panel: who is around, what is moving, and what arrived.
 *
 * The panel owns presentation and nothing else. Every read and every action goes
 * through its injected face, so the component can be rendered against a fixture
 * and the wiring can be tested without one.
 *
 * Behaviours worth stating because they are not obvious from the markup:
 *
 * - **It owns no polling.** The state arrives from a shared store that the
 *   notification and the companion also read, and the panel merely retains it
 *   while mounted. See `state.ts` for why the cadence follows the host's own work.
 * - **A drop lands on a device, and anywhere else on the panel.** The tiles are
 *   the precise targets, but dropping onto empty space used to do nothing at all,
 *   which is indistinguishable from the panel being broken — so a drop anywhere
 *   is staged, and sent straight away when there is exactly one device it could
 *   possibly mean. The counter that tracks dragging exists because `dragleave`
 *   fires when the pointer crosses into a child element, so a boolean would
 *   flicker the whole panel on every internal boundary.
 * - **A received file is offered to the conversation, not committed to it.** The
 *   "add" action leaves a reference for the composer to insert; whether to send
 *   is still the user's.
 *
 * @module dsh-local-send/client/LocalSendPanel
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  type LocalSendState,
  type PathCandidate,
  type PeerRow,
  type SendPathsResponse,
  type StateWarning,
  type TransferFileRow,
  type TransferRow,
} from '../types.ts'
import { formatAge, formatBytes, percentOf, shortenFileName } from './format.ts'
import { useTransferState, type TransferStore } from './state.ts'
import { DeviceIcon, FolderIcon, ReceiveIcon, SearchIcon, SendIcon } from './icons.tsx'
import type { LocalSendLocaleKey } from './locales.ts'

/** Registration-side face the panel reads and acts through. */
export interface LocalSendPanelInjected {
  /** Key this panel occupies in the main column, matching the sidebar entry. */
  panelId: MainPanelId
  /** Active locale id, read at call time so a locale switch re-renders figures. */
  locale: () => string
  /**
   * The shared state store.
   *
   * Shared rather than owned, because the notification reads the same document
   * from a different mount point; one loop serves both.
   */
  store: TransferStore
  /** Offer browser-held files to a peer and stream them. */
  sendFiles: (peer: string, files: readonly File[]) => Promise<void>
  /**
   * Offer paths that already exist on this machine.
   *
   * The outcome comes back with the answer rather than through the next poll,
   * because the host runs a path send to completion before it responds: by then
   * the transfer is over, and the panel puts the figures on screen at once
   * instead of one poll behind.
   */
  sendLocalPaths: (peer: string, paths: readonly string[]) => Promise<SendPathsResponse>
  /** Answer an incoming offer, optionally taking only some of its files. */
  answer: (transferId: string, accept: boolean, fileIds?: readonly string[]) => Promise<void>
  /** Stop a transfer this device is part of, in either direction. */
  cancel: (transferId: string) => Promise<void>
  /** Send a settled outgoing transfer again, from its files on this machine. */
  retry: (transferId: string) => Promise<void>
  /** Rename this device and persist the name. */
  renameDevice: (alias: string) => Promise<void>
  /** Run the legacy subnet scan. */
  scanNow: () => Promise<{ found: number }>
  /** Show a received file — or the inbox itself — in the file manager. */
  revealFile: (path: string) => Promise<void>
  /** Ask the host what it knows about some paths. */
  inspectPaths: (paths: readonly string[]) => Promise<readonly PathCandidate[]>
  /**
   * Ask for a received file to be referenced in the composer.
   *
   * Handled outside this component because the insert has to happen in the
   * conversation's own slot tree, which the main column cannot reach.
   */
  addToConversation: (path: string) => void
  /** Whether a conversation is open for a reference to land in. */
  hasSession: () => boolean
}

/** Full component props assembled by the main slot renderer. */
export type LocalSendPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'localSend'>
  & InjectFace<LocalSendPanelInjected>

/** One thing the panel has to tell the reader, above the lists. */
interface Notice {
  /** The sentence, already resolved against the active locale. */
  readonly text: string
  /** How it should read: a result, a caution, or a failure. */
  readonly tone: 'info' | 'warn' | 'error'
}

/** Format a count of files against the locale's plural rules. */
function fileCountLabel(
  t: (key: LocalSendLocaleKey, params?: Record<string, string | number>) => string,
  count: number,
): string {
  return count === 1 ? t('filesCountOne') : t('filesCount', { count })
}

/**
 * The panel.
 * @param props - slot props, locale seat, and the injected face.
 */
export function LocalSendPanel(props: LocalSendPanelProps): ReactNode {
  const {
    t, store, sendFiles, sendLocalPaths, answer, cancel, retry,
    renameDevice, scanNow, revealFile, inspectPaths, addToConversation, hasSession,
  } = props
  const read = useTransferState(store)
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [busyAction, setBusyAction] = useState<string | undefined>(undefined)
  const [renaming, setRenaming] = useState(false)
  const [showPaths, setShowPaths] = useState(false)
  /**
   * Files waiting for the user to say which device they are for.
   *
   * Held rather than sent because the panel cannot guess: a drop onto empty
   * space, or a file chosen from the picker, names no device at all. When there
   * is exactly one device it could possibly mean, `stageFiles` does not stage —
   * a chooser with a single option is a step that exists only to be dismissed.
   */
  const [staged, setStaged] = useState<readonly File[] | undefined>(undefined)
  /** Nested drag depth; see the module note on why this is a counter. */
  const dragDepth = useRef(0)
  /** The hidden picker the "choose files" button drives. */
  const picker = useRef<HTMLInputElement>(null)

  // The store polls only while somebody is watching, so an open panel is what
  // keeps it alive.
  useEffect(() => store.retain(), [store])

  /** Run one action, surfacing its failure and clearing its busy mark. */
  const run = useCallback(async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusyAction(key)
    setNotice(undefined)
    try {
      await action()
    } catch (error: unknown) {
      // Wrapped rather than shown raw: the host's message is the detail, and a
      // bare "HTTP 409" in a panel that otherwise speaks sentences reads as a
      // bug rather than as an answer.
      setNotice({ text: t('errorGeneric', { message: describe(error) }), tone: 'error' })
    } finally {
      setBusyAction(undefined)
    }
  }, [t])

  /** Re-read immediately, so an action's effect is on screen without waiting a tick. */
  const refresh = useCallback(async (): Promise<void> => {
    await store.refresh()
  }, [store])

  const peers = read.status === 'ready' ? read.state.peers : []
  const reachable = useMemo(() => peers.filter(peer => peer.reachable), [peers])

  /**
   * Take files the user did not aim at a particular device.
   *
   * @param files - the files, from a drop on empty space or from the picker.
   */
  const stageFiles = useCallback((files: readonly File[]): void => {
    if (files.length === 0) return
    const only = reachable.length === 1 ? reachable[0] : undefined
    if (only !== undefined) {
      void run(`send:${only.fingerprint}`, async () => {
        await sendFiles(only.fingerprint, files)
        await refresh()
      })
      return
    }
    setStaged(files)
  }, [reachable, run, sendFiles, refresh])

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event)) return
    dragDepth.current += 1
    setDragging(true)
  }, [])

  const onDragLeave = useCallback((): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setDragging(false)
      setDropTarget(undefined)
    }
  }, [])

  /** Keep the browser from navigating to the dropped file. */
  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  /**
   * A drop that did not land on a device.
   *
   * Staged rather than ignored, because a drop that does nothing looks exactly
   * like a panel that is not working. See the module note.
   *
   * @param event - the drop event.
   */
  const onDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    setDropTarget(undefined)
    stageFiles([...event.dataTransfer.files])
  }, [stageFiles])

  const dropOn = useCallback((peer: PeerRow, event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    setDropTarget(undefined)
    const files = [...event.dataTransfer.files]
    if (files.length === 0) return
    void run(`send:${peer.fingerprint}`, async () => {
      await sendFiles(peer.fingerprint, files)
      await refresh()
    })
  }, [run, sendFiles, refresh])

  const incoming = useMemo(
    () => read.status === 'ready'
      ? read.state.transfers.filter(transfer => transfer.direction === 'incoming' && transfer.status === 'awaiting')
      : [],
    [read],
  )

  return (
    <div
      className="dls-panel"
      data-dragging={dragging ? 'true' : 'false'}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="dls-stack">
        <header className="dls-header">
          <div>
            <h1 className="dls-heading">{t('heading')}</h1>
            <p className="dls-subtitle">{t('subtitle')}</p>
          </div>
          {read.status === 'ready'
            ? (
              <div className="dls-rowActions">
                <button
                  type="button"
                  className="dls-action"
                  data-tone="primary"
                  disabled={busyAction !== undefined}
                  onClick={() => { picker.current?.click() }}
                >
                  {t('sendFiles')}
                </button>
                <button
                  type="button"
                  className="dls-action"
                  data-tone="quiet"
                  disabled={busyAction !== undefined}
                  onClick={() => { setShowPaths(value => !value) }}
                >
                  {t('sendPaths')}
                </button>
                <button
                  type="button"
                  className="dls-action"
                  disabled={busyAction === 'scan'}
                  onClick={() => {
                    void run('scan', async () => {
                      const result = await scanNow()
                      setNotice({
                        text: result.found > 0 ? t('scanFound', { count: result.found }) : t('scanEmpty'),
                        tone: 'info',
                      })
                    })
                  }}
                >
                  <SearchIcon size={13} />
                  {busyAction === 'scan' ? t('scanning') : t('rescan')}
                </button>
                <button
                  type="button"
                  className="dls-action"
                  data-tone="quiet"
                  title={t('openInbox')}
                  aria-label={t('openInbox')}
                  disabled={busyAction !== undefined}
                  onClick={() => {
                    void run('inbox', async () => {
                      if (read.status !== 'ready') return
                      await revealFile(read.state.inbox)
                    })
                  }}
                >
                  <FolderIcon size={13} />
                </button>
              </div>
            )
            : null}
        </header>

        {/* The picker is never shown: the button above drives it, because a bare
            file input cannot be styled to match anything. It stays in the tree so
            that clicking it is a real user gesture, which is what opens the
            platform's dialog. */}
        <input
          ref={picker}
          type="file"
          multiple
          className="dls-picker"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            stageFiles([...event.target.files ?? []])
            // Cleared so choosing the same file twice in a row still reports a
            // change; an input that kept its value would fire nothing the second
            // time.
            event.target.value = ''
          }}
        />

        {read.status === 'loading' ? <p className="dls-note">{t('loading')}</p> : null}

        {read.status === 'error'
          ? (
            <div className="dls-empty">
              <div className="dls-emptyTitle">{t('errorOffline')}</div>
              <p className="dls-emptyHint">{read.message}</p>
              <div className="dls-toastActions" style={{ justifyContent: 'center' }}>
                <button type="button" className="dls-action" onClick={() => { void refresh() }}>{t('retry')}</button>
              </div>
            </div>
          )
          : null}

        {read.status === 'ready' ? (
          <ThisDevice
            state={read.state}
            renaming={renaming}
            busy={busyAction === 'rename'}
            t={t}
            onStartRename={() => { setRenaming(true) }}
            onCancelRename={() => { setRenaming(false) }}
            onRename={(alias) => {
              void run('rename', async () => {
                await renameDevice(alias)
                setRenaming(false)
                await refresh()
              })
            }}
          />
        ) : null}

        {read.status === 'ready' && read.state.warning !== undefined
          ? <p className="dls-note" data-tone="warn">{warningText(t, read.state.warning)}</p>
          : null}

        {notice !== undefined
          ? (
            <p className="dls-note" data-tone={notice.tone}>
              <span>{notice.text}</span>
              <button
                type="button"
                className="dls-action"
                data-tone="quiet"
                onClick={() => { setNotice(undefined) }}
              >
                {t('dismiss')}
              </button>
            </p>
          )
          : null}

        {staged !== undefined
          ? (
            <StagedFiles
              files={staged}
              peers={reachable}
              busy={busyAction !== undefined}
              t={t}
              onCancel={() => { setStaged(undefined) }}
              onSend={(peer) => {
                const files = staged
                setStaged(undefined)
                void run(`send:${peer}`, async () => {
                  await sendFiles(peer, files)
                  await refresh()
                })
              }}
            />
          )
          : null}

        {incoming.map(transfer => (
          <IncomingOffer
            key={transfer.id}
            transfer={transfer}
            busy={busyAction === `answer:${transfer.id}`}
            t={t}
            onAnswer={(accept, fileIds) => {
              void run(`answer:${transfer.id}`, async () => {
                await answer(transfer.id, accept, fileIds)
                await refresh()
              })
            }}
          />
        ))}

        {showPaths && read.status === 'ready'
          ? (
            <PathsSender
              peers={read.state.peers}
              busy={busyAction}
              t={t}
              inspectPaths={inspectPaths}
              onSend={(peer, paths) => {
                void run(`send:${peer}`, async () => {
                  await sendLocalPaths(peer, paths)
                  await refresh()
                })
              }}
            />
          )
          : null}

        {read.status === 'ready'
          ? (
            <Nearby
              peers={read.state.peers}
              dragging={dragging}
              dropTarget={dropTarget}
              busyAction={busyAction}
              t={t}
              onDragOverTile={setDropTarget}
              onDropOnTile={dropOn}
            />
          )
          : null}

        {read.status === 'ready'
          ? (
            <Transfers
              transfers={read.state.transfers.filter(
                // An offer still waiting is drawn by its own card above, with
                // Accept and Decline on it. Listing it again as a transfer would
                // show the same pending thing twice, under two sets of verbs.
                transfer => !(transfer.direction === 'incoming' && transfer.status === 'awaiting'),
              )}
              busyAction={busyAction}
              t={t}
              now={Date.now()}
              onAddToConversation={(path) => {
                // Warned here rather than after the switch, because the switch is
                // the problem: the centre column would go to a blank-session
                // screen and the reference would sit parked with nothing on
                // screen to explain it.
                if (!hasSession()) {
                  setNotice({ text: t('noSession'), tone: 'warn' })
                  return
                }
                addToConversation(path)
              }}
              onReveal={(path) => {
                void run(`reveal:${path}`, async () => { await revealFile(path) })
              }}
              onStop={(transferId) => {
                void run(`stop:${transferId}`, async () => {
                  await cancel(transferId)
                  await refresh()
                })
              }}
              onRetry={(transferId) => {
                void run(`retry:${transferId}`, async () => {
                  await retry(transferId)
                  await refresh()
                })
              }}
            />
          )
          : null}
      </div>
    </div>
  )
}

/** Whether a drag payload carries files rather than text or a URL. */
function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/** One line describing an error, for a note. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The translate seat's shape, named once so the subcomponents can take it. */
type Translate = LocalSendPanelProps['t']

/** This device's identity, with its room to be renamed. */
function ThisDevice(
  { state, renaming, busy, t, onStartRename, onCancelRename, onRename }: {
    readonly state: LocalSendState
    readonly renaming: boolean
    readonly busy: boolean
    readonly t: Translate
    readonly onStartRename: () => void
    readonly onCancelRename: () => void
    readonly onRename: (alias: string) => void
  },
): ReactNode {
  const [draft, setDraft] = useState(state.device.alias)
  useEffect(() => { setDraft(state.device.alias) }, [state.device.alias])
  const address = state.device.addresses[0]

  return (
    <section className="dls-section">
      <div className="dls-sectionHead">
        <span className="dls-sectionTitle">{t('thisDevice')}</span>
        {renaming
          ? null
          : (
            <button type="button" className="dls-action" data-tone="quiet" onClick={onStartRename}>
              {t('rename')}
            </button>
          )}
      </div>

      {renaming
        ? (
          <div className="dls-pathsRow" style={{ justifyContent: 'flex-start' }}>
            <input
              className="dls-input"
              value={draft}
              autoFocus
              maxLength={64}
              placeholder={t('renamePlaceholder')}
              onChange={(event) => { setDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && draft.trim().length > 0) onRename(draft.trim())
                if (event.key === 'Escape') onCancelRename()
              }}
            />
            <button
              type="button"
              className="dls-action"
              data-tone="primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() => { onRename(draft.trim()) }}
            >
              {t('save')}
            </button>
            <button type="button" className="dls-action" onClick={onCancelRename}>{t('cancel')}</button>
          </div>
        )
        : (
          <div className="dls-identity">
            <span className="dls-state" data-ok={state.device.serving ? 'true' : 'false'}>
              {state.device.alias} · {state.device.serving ? t('serving') : t('notServing')}
            </span>
            <span className="dls-fact">
              <span className="dls-factKey">{t('addressLabel')}</span>
              <span className="dls-factValue">
                {address === undefined ? t('noAddress') : `${address}:${String(state.device.port)}`}
              </span>
            </span>
            {/* Where received files go, said once and in full. It is a real
                directory the agent can be pointed at, and a user who has just
                been told a file arrived needs to know where. */}
            <span className="dls-fact">
              <span className="dls-factKey">{t('inboxLabel')}</span>
              <span className="dls-factValue" title={state.inbox}>{state.inbox}</span>
            </span>
          </div>
        )}
    </section>
  )
}

/**
 * Files waiting for a device to be named.
 *
 * Shown instead of guessing whenever a drop or a pick could mean more than one
 * device. The devices are buttons rather than a select, because there is exactly
 * one decision to make here and a select would hide it behind a second press.
 */
function StagedFiles(
  { files, peers, busy, t, onCancel, onSend }: {
    readonly files: readonly File[]
    readonly peers: readonly PeerRow[]
    readonly busy: boolean
    readonly t: Translate
    readonly onCancel: () => void
    readonly onSend: (fingerprint: string) => void
  },
): ReactNode {
  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  return (
    <section className="dls-section dls-staged">
      <div className="dls-sectionHead">
        <span className="dls-sectionTitle">
          {t('sendFiles')}
          <span className="dls-count">{fileCountLabel(t, files.length)}</span>
        </span>
        <span className="dls-rowActions">
          <button type="button" className="dls-action" data-tone="quiet" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </button>
        </span>
      </div>
      <p className="dls-note">{t('incomingTotal', { size: formatBytes(bytes) })}</p>
      {peers.length === 0
        ? <p className="dls-note" data-tone="warn">{t('noPeers')}</p>
        : (
          <div className="dls-peers">
            {peers.map(peer => (
              <button
                key={peer.fingerprint}
                type="button"
                className="dls-tile"
                disabled={busy}
                onClick={() => { onSend(peer.fingerprint) }}
              >
                <span className="dls-tileMark"><DeviceIcon type={peer.deviceType} size={18} /></span>
                <span className="dls-tileBody">
                  <span className="dls-tileName">{peer.alias}</span>
                  <span className="dls-tileMeta">{deviceTypeLabel(t, peer.deviceType)} · {peer.address}</span>
                </span>
              </button>
            ))}
          </div>
        )}
    </section>
  )
}

/** The devices around this one, each a drop target. */
function Nearby(
  { peers, dragging, dropTarget, busyAction, t, onDragOverTile, onDropOnTile }: {
    readonly peers: readonly PeerRow[]
    readonly dragging: boolean
    readonly dropTarget: string | undefined
    readonly busyAction: string | undefined
    readonly t: Translate
    readonly onDragOverTile: (fingerprint: string | undefined) => void
    readonly onDropOnTile: (peer: PeerRow, event: DragEvent<HTMLElement>) => void
  },
): ReactNode {
  const now = Date.now()
  return (
    <section className="dls-section">
      <div className="dls-sectionHead">
        <span className="dls-sectionTitle">
          {t('nearby')}
          {peers.length > 0 ? <span className="dls-count">{peers.length}</span> : null}
        </span>
        {peers.length > 0 ? <span className="dls-note">{t('dropHint')}</span> : null}
      </div>

      {peers.length === 0
        ? (
          <div className="dls-empty">
            <div className="dls-emptyTitle">{t('noPeers')}</div>
            <p className="dls-emptyHint">{t('noPeersHint')}</p>
          </div>
        )
        : (
          <div className="dls-peers">
            {peers.map((peer) => {
              const age = formatAge(peer.lastSeen, now)
              const sending = busyAction === `send:${peer.fingerprint}`
              return (
                <button
                  key={peer.fingerprint}
                  type="button"
                  className="dls-tile"
                  data-reachable={peer.reachable ? 'true' : 'false'}
                  data-drop={dropTarget === peer.fingerprint ? 'true' : 'false'}
                  disabled={!peer.reachable || sending}
                  onDragOver={(event) => {
                    if (!peer.reachable) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                    onDragOverTile(peer.fingerprint)
                  }}
                  onDragLeave={() => { onDragOverTile(undefined) }}
                  onDrop={(event) => { onDropOnTile(peer, event) }}
                >
                  <span className="dls-tileMark">
                    <DeviceIcon type={peer.deviceType} size={18} />
                  </span>
                  <span className="dls-tileBody">
                    <span
                      className="dls-tileName"
                      data-dropLabel={t('dropToSend')}
                    >
                      {peer.alias}
                    </span>
                    <span className="dls-tileMeta">
                      {sending
                        ? t('sendingTo', { alias: peer.alias })
                        : peer.reachable
                          ? `${deviceTypeLabel(t, peer.deviceType)} · ${peer.address}`
                          : `${t('unreachable')}${age === undefined ? '' : ` · ${age}`}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

      {dragging && peers.some(peer => peer.reachable) ? (
        <p className="dls-note">{t('dropHint')}</p>
      ) : null}
    </section>
  )
}

/** The label for one device class, falling back for an unknown one. */
function deviceTypeLabel(t: Translate, type: PeerRow['deviceType']): string {
  const key = `deviceType.${type ?? 'unknown'}` as LocalSendLocaleKey
  return t(key)
}

/**
 * An offer waiting on the reader, file by file.
 *
 * The tick boxes are the reason this is a component rather than a paragraph: the
 * protocol carries a per-file decision and the panel is where it is made, so a
 * batch of twenty holiday photos does not force the user to take the one
 * document they did not want. Everything this device's own limits already
 * refused is listed without a box, because there is nothing left to decide.
 */
function IncomingOffer(
  { transfer, busy, t, onAnswer }: {
    readonly transfer: TransferRow
    readonly busy: boolean
    readonly t: Translate
    readonly onAnswer: (accept: boolean, fileIds?: readonly string[]) => void
  },
): ReactNode {
  const selectable = transfer.files.filter(file => file.status === 'offered')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(selectable.map(file => file.id)),
  )
  const all = selectable.length > 0 && chosen.size === selectable.length
  const none = chosen.size === 0

  const toggle = (id: string): void => {
    setChosen((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Hand the decision up.
   *
   * Every file ticked is sent as `undefined` rather than as the full list: the
   * host has a word for "all of them" that does not depend on the panel and the
   * host agreeing about which ids exist, and this is the case it exists for.
   */
  const submit = (): void => {
    if (none) return
    onAnswer(true, all ? undefined : [...chosen])
  }

  const count = transfer.files.length
  return (
    <section className="dls-incoming">
      <div className="dls-incomingHead">
        <span className="dls-incomingTitle">
          {count === 1
            ? t('incomingFromOne', { alias: transfer.peerAlias })
            : t('incomingFrom', { alias: transfer.peerAlias, count })}
          <span className="dls-count">{t('incomingTotal', { size: formatBytes(transfer.bytesTotal) })}</span>
        </span>
        <span className="dls-rowActions">
          <button
            type="button"
            className="dls-action"
            data-tone="primary"
            disabled={busy || none}
            onClick={submit}
          >
            {t('acceptSelected', { count: chosen.size })}
          </button>
          <button type="button" className="dls-action" disabled={busy} onClick={() => { onAnswer(false) }}>
            {t('decline')}
          </button>
        </span>
      </div>

      {selectable.length > 1
        ? (
          <div className="dls-pickBar">
            <span className="dls-note">{t('selectedOf', { count: chosen.size, total: selectable.length })}</span>
            <button
              type="button"
              className="dls-action"
              data-tone="quiet"
              disabled={busy || all}
              onClick={() => { setChosen(new Set(selectable.map(file => file.id))) }}
            >
              {t('selectAll')}
            </button>
            <button
              type="button"
              className="dls-action"
              data-tone="quiet"
              disabled={busy || none}
              onClick={() => { setChosen(new Set()) }}
            >
              {t('selectNone')}
            </button>
          </div>
        )
        : null}

      <ul className="dls-incomingFiles">
        {transfer.files.map((file) => {
          const offered = file.status === 'offered'
          return (
            <li key={file.id} className="dls-incomingFile">
              {offered
                ? (
                  <label className="dls-tick">
                    <input
                      type="checkbox"
                      checked={chosen.has(file.id)}
                      disabled={busy}
                      onChange={() => { toggle(file.id) }}
                    />
                    <span className="dls-incomingName">{shortenFileName(file.fileName, 64)}</span>
                  </label>
                )
                : (
                  <span className="dls-incomingName" data-tone="muted">
                    {shortenFileName(file.fileName, 64)}
                  </span>
                )}
              <span className="dls-incomingSize">
                {offered
                  ? formatBytes(file.size)
                  : file.error ?? t(`fileStatus.${file.status}` as LocalSendLocaleKey)}
              </span>
            </li>
          )
        })}
      </ul>

      {none && selectable.length > 0
        ? <p className="dls-note" data-tone="warn">{t('noFileSelected')}</p>
        : null}
    </section>
  )
}

/** Sending files that already exist on this machine, by path. */
function PathsSender(
  { peers, busy, t, inspectPaths, onSend }: {
    readonly peers: readonly PeerRow[]
    readonly busy: string | undefined
    readonly t: Translate
    readonly inspectPaths: (paths: readonly string[]) => Promise<readonly PathCandidate[]>
    readonly onSend: (peer: string, paths: readonly string[]) => void
  },
): ReactNode {
  const [text, setText] = useState('')
  const [peer, setPeer] = useState<string>('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const usable = peers.filter(candidate => candidate.reachable)
  const chosen = peer.length > 0 ? peer : usable[0]?.fingerprint ?? ''

  const submit = async (): Promise<void> => {
    const paths = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    if (paths.length === 0) {
      setProblem(t('pathsEmpty'))
      return
    }
    if (chosen.length === 0) {
      setProblem(t('noPeers'))
      return
    }
    // Verified before sending rather than after failing: a path that does not
    // exist is the commonest mistake here, and the host can say so in one round
    // trip instead of the user reading a failed transfer row.
    const candidates = await inspectPaths(paths)
    const bad = candidates.filter(candidate => candidate.directory)
    if (bad.length > 0) {
      setProblem(t('pathsInvalid', { list: bad.map(candidate => candidate.name).join('、') }))
      return
    }
    setProblem(undefined)
    onSend(chosen, paths)
  }

  return (
    <section className="dls-section">
      <div className="dls-sectionHead">
        <span className="dls-sectionTitle">{t('sendPaths')}</span>
      </div>
      <div className="dls-paths">
        <textarea
          className="dls-textarea"
          value={text}
          placeholder={t('pathsPlaceholder')}
          spellCheck={false}
          onChange={(event) => { setText(event.target.value) }}
        />
        {problem !== undefined ? <p className="dls-note" data-tone="error">{problem}</p> : null}
        <div className="dls-pathsRow">
          <select
            className="dls-input"
            value={chosen}
            onChange={(event) => { setPeer(event.target.value) }}
          >
            {usable.length === 0 ? <option value="">{t('noPeers')}</option> : null}
            {usable.map(candidate => (
              <option key={candidate.fingerprint} value={candidate.fingerprint}>{candidate.alias}</option>
            ))}
          </select>
          <button
            type="button"
            className="dls-action"
            data-tone="primary"
            disabled={busy !== undefined || chosen.length === 0}
            onClick={() => { void submit() }}
          >
            {t('pathsSend')}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Every transfer this session has seen. */
function Transfers(
  { transfers, busyAction, t, now, onAddToConversation, onReveal, onStop, onRetry }: {
    readonly transfers: readonly TransferRow[]
    readonly busyAction: string | undefined
    readonly t: Translate
    readonly now: number
    readonly onAddToConversation: (path: string) => void
    readonly onReveal: (path: string) => void
    readonly onStop: (transferId: string) => void
    readonly onRetry: (transferId: string) => void
  },
): ReactNode {
  return (
    <section className="dls-section">
      <div className="dls-sectionHead">
        <span className="dls-sectionTitle">
          {t('transfers')}
          {transfers.length > 0 ? <span className="dls-count">{transfers.length}</span> : null}
        </span>
      </div>

      {transfers.length === 0
        ? (
          <div className="dls-empty">
            <div className="dls-emptyTitle">{t('noTransfers')}</div>
            <p className="dls-emptyHint">{t('noTransfersHint')}</p>
          </div>
        )
        : (
          <div className="dls-rows">
            {transfers.map(transfer => (
              <TransferLine
                key={transfer.id}
                transfer={transfer}
                busyAction={busyAction}
                t={t}
                now={now}
                onAddToConversation={onAddToConversation}
                onReveal={onReveal}
                onStop={onStop}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}
    </section>
  )
}

/**
 * One transfer, with its outcome as its own left edge.
 *
 * The rail means two different things at two different times, and conflating
 * them is what makes a progress bar lie: **while a transfer moves it is the byte
 * fraction**, and **once it has settled it is the outcome**, full height and
 * coloured by how it ended. A finished batch drawn at its byte fraction shows a
 * stub of a few percent — a picture of "barely started" for something that is
 * over.
 *
 * The meta line carries what the row is actually about, in the order a reader
 * asks: which file (or how many), how it went, how much, and when.
 */
function TransferLine(
  { transfer, busyAction, t, now, onAddToConversation, onReveal, onStop, onRetry }: {
    readonly transfer: TransferRow
    readonly busyAction: string | undefined
    readonly t: Translate
    readonly now: number
    readonly onAddToConversation: (path: string) => void
    readonly onReveal: (path: string) => void
    readonly onStop: (transferId: string) => void
    readonly onRetry: (transferId: string) => void
  },
): ReactNode {
  const incoming = transfer.direction === 'incoming'
  const [open, setOpen] = useState(false)
  const live = transfer.status === 'transferring' || transfer.status === 'awaiting'
  const settled = !live
  const percent = percentOf(transfer.bytesDone, transfer.bytesTotal)
  const single = transfer.files.length === 1 ? transfer.files[0] : undefined
  const done = transfer.status === 'done' || transfer.status === 'partial'
  /** Received files that are on disk, which are the ones worth referencing. */
  const saved = transfer.files.filter(file => file.status === 'done' && file.savedPath !== undefined)
  /** A retry is only possible when the host still has the source files. */
  const retryable = settled && transfer.status !== 'done' && transfer.canRetry === true
  const busy = busyAction !== undefined

  const meta = useMemo(() => {
    const parts: string[] = []
    // What is moving, or what was moved.
    parts.push(single === undefined
      ? fileCountLabel(t, transfer.files.length)
      : shortenFileName(single.fileName, 44))

    // How it went, but only when the count alone cannot say it: a batch where
    // some files were refused is the case a reader has no way to guess. A
    // single-file row already says it in its status, so repeating it there would
    // be the same fact twice on one line.
    const failed = transfer.files.filter(file => file.status === 'failed').length
    const declined = transfer.files.filter(file => file.status === 'declined').length
    if (settled && single === undefined && (failed > 0 || declined > 0)) {
      parts.push(t('outcomeMixed', {
        arrived: transfer.files.filter(file => file.status === 'done').length,
        lost: failed + declined,
      }))
    }

    // The figure: bytes against the total while moving, the total once it is over.
    if (transfer.bytesTotal > 0) {
      parts.push(transfer.status === 'transferring'
        ? `${formatBytes(transfer.bytesDone)} / ${formatBytes(transfer.bytesTotal)} · ${String(percent)}%`
        : formatBytes(transfer.bytesTotal))
    }

    if (settled) {
      const age = formatAge(transfer.updatedAt, now)
      if (age !== undefined) parts.push(age)
    }
    return parts.join(' · ')
  }, [transfer, single, settled, percent, now, t])

  // The rail: a fraction while moving, the outcome once there is nothing left to
  // measure. See the note above on why these are not the same quantity.
  const fill = settled ? 1 : percent / 100

  return (
    <div
      className="dls-row"
      data-status={transfer.status}
      data-direction={transfer.direction}
      style={{ '--dls-fill': fill } as React.CSSProperties}
      role="group"
      aria-label={`${incoming ? t('directionIn') : t('directionOut')} ${transfer.peerAlias}`}
    >
      <span className="dls-rowMark">
        {incoming ? <ReceiveIcon size={15} /> : <SendIcon size={15} />}
      </span>

      <div className="dls-rowBody">
        <div className="dls-rowTitle">
          <span className="dls-rowPeer">
            {incoming ? t('directionIn') : t('directionOut')} {transfer.peerAlias}
          </span>
          <span className="dls-rowStatus">{statusLabel(t, transfer)}</span>
        </div>
        <div className="dls-rowMeta">{meta}</div>
        {open ? (
          <FileBreakdown
            files={transfer.files}
            t={t}
            onAddToConversation={incoming ? onAddToConversation : undefined}
          />
        ) : null}
      </div>

      <div className="dls-rowActions">
        {transfer.files.length > 1
          ? (
            <button
              type="button"
              className="dls-action"
              data-tone="quiet"
              aria-expanded={open}
              onClick={() => { setOpen(value => !value) }}
            >
              {fileCountLabel(t, transfer.files.length)}
            </button>
          )
          : null}

        {/* Stopping is offered while there is still something to stop. A row
            that is already over has nothing for this button to do, and hiding it
            is what keeps the outcome row's actions to the ones that still mean
            something. */}
        {live
          ? (
            <button
              type="button"
              className="dls-action"
              disabled={busy}
              onClick={() => { onStop(transfer.id) }}
            >
              {t('stopTransfer')}
            </button>
          )
          : null}

        {retryable
          ? (
            <button
              type="button"
              className="dls-action"
              title={t('retryTransferHint')}
              disabled={busy}
              onClick={() => { onRetry(transfer.id) }}
            >
              {t('retryTransfer')}
            </button>
          )
          : null}

        {/* The panel's whole reason for existing: a received file the
            conversation can then read. Offered directly on a single-file row,
            and through the file list on a batch, so twenty files do not put
            twenty buttons on one line. */}
        {done && incoming && saved.length > 0
          ? (
            <button
              type="button"
              className="dls-action"
              data-tone="primary"
              disabled={busy}
              title={t('addToConversationHint')}
              onClick={() => {
                if (single?.savedPath !== undefined) onAddToConversation(single.savedPath)
                else setOpen(true)
              }}
            >
              {t('addToConversation')}
            </button>
          )
          : null}

        {single?.savedPath !== undefined
          ? (
            <button
              type="button"
              className="dls-action"
              data-tone="quiet"
              title={t('reveal')}
              aria-label={t('reveal')}
              disabled={busy}
              onClick={() => { onReveal(single.savedPath as string) }}
            >
              <FolderIcon size={13} />
            </button>
          )
          : null}
      </div>
    </div>
  )
}

/**
 * The per-file lines inside an expanded transfer.
 *
 * A batch of twenty files cannot put twenty buttons on one row, so the row's
 * action opens this list and each saved file carries its own reference action.
 * `onAddToConversation` is absent for an outgoing transfer, where there is
 * nothing on this machine to reference.
 */
function FileBreakdown(
  { files, t, onAddToConversation }: {
    readonly files: readonly TransferFileRow[]
    readonly t: Translate
    readonly onAddToConversation: ((path: string) => void) | undefined
  },
): ReactNode {
  return (
    <ul className="dls-fileList">
      {files.map(file => (
        <li key={file.id} className="dls-fileRow">
          <span className="dls-fileName">{shortenFileName(file.fileName, 52)}</span>
          <span className="dls-fileActions">
            <span className="dls-fileNote" data-tone={file.error === undefined ? 'plain' : 'error'}>
              {file.error ?? (file.status === 'done' ? formatBytes(file.size) : t(`fileStatus.${file.status}` as LocalSendLocaleKey))}
            </span>
            {onAddToConversation !== undefined && file.savedPath !== undefined && file.status === 'done'
              ? (
                <button
                  type="button"
                  className="dls-action"
                  data-tone="quiet"
                  title={t('addToConversationHint')}
                  onClick={() => { onAddToConversation(file.savedPath as string) }}
                >
                  {t('addToConversation')}
                </button>
              )
              : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Say one host condition in the reader's language.
 *
 * The two halves are treated differently on purpose: the clause is ours and is
 * translated, while the detail is the operating system's own message and is
 * passed through untouched — it is the string a search for the problem will
 * match, and translating it would help nobody.
 *
 * @param t - the locale seat.
 * @param warning - the structured condition.
 * @returns the sentence to show.
 */
function warningText(t: Translate, warning: StateWarning): string {
  if (warning.code === 'portUnavailable') {
    return t('warning.portUnavailable', { port: warning.port, detail: warning.detail })
  }
  return t('warning.discoveryUnavailable', { detail: warning.detail })
}

/** The localized status of a transfer. */
function statusLabel(t: Translate, transfer: TransferRow): string {
  return t(`status.${transfer.status}` as LocalSendLocaleKey)
}
