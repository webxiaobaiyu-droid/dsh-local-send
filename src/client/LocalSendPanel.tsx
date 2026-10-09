/**
 * The Nearby transfer panel: who is around, what is moving, and what arrived.
 *
 * The panel owns presentation and nothing else. Every read and every action goes
 * through its injected face, so the component can be rendered against a fixture
 * and the wiring can be tested without one.
 *
 * Two behaviours are worth stating because they are not obvious from the markup:
 *
 * - **It owns no polling.** The state arrives from a shared store that the
 *   receive notification also reads, and the panel merely retains it while
 *   mounted. See `state.ts` for why the cadence follows the host's own work.
 * - **A drop lands on a device, not on the panel.** The tiles are the drop
 *   targets, and the panel only dims what cannot receive while a drag is in
 *   flight. Dragging is reported with a counter rather than a boolean because
 *   `dragleave` fires when the pointer crosses into a child element, so a
 *   boolean would flicker the whole panel on every internal boundary.
 *
 * @module dsh-local-send/client/LocalSendPanel
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  type LocalSendState,
  type PathCandidate,
  type PeerRow,
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
   * Shared rather than owned, because the receive notification reads the same
   * document from a different mount point; one loop serves both.
   */
  store: TransferStore
  /** Offer browser-held files to a peer and stream them. */
  sendFiles: (peer: string, files: readonly File[]) => Promise<void>
  /** Offer paths that already exist on this machine. */
  sendLocalPaths: (peer: string, paths: readonly string[]) => Promise<void>
  /** Answer an incoming offer. */
  answer: (transferId: string, accept: boolean) => Promise<void>
  /** Rename this device and persist the name. */
  renameDevice: (alias: string) => Promise<void>
  /** Run the legacy subnet scan. */
  scanNow: () => Promise<{ found: number }>
  /** Show a received file in the platform's file manager. */
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
}

/** Full component props assembled by the main slot renderer. */
export type LocalSendPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'localSend'>
  & InjectFace<LocalSendPanelInjected>

/** Format a count of files against the locale's plural rules. */
function fileCountLabel(t: (key: LocalSendLocaleKey, params?: Record<string, string | number>) => string, count: number): string {
  return count === 1 ? t('filesCountOne') : t('filesCount', { count })
}

/**
 * The panel.
 * @param props - slot props, locale seat, and the injected face.
 */
export function LocalSendPanel(props: LocalSendPanelProps): ReactNode {
  const { t, store, sendFiles, sendLocalPaths, answer, renameDevice, scanNow, revealFile, inspectPaths, addToConversation } = props
  const read = useTransferState(store)
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busyAction, setBusyAction] = useState<string | undefined>(undefined)
  const [renaming, setRenaming] = useState(false)
  const [showPaths, setShowPaths] = useState(false)
  /** Nested drag depth; see the module note on why this is a counter. */
  const dragDepth = useRef(0)

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
      setNotice(describe(error))
    } finally {
      setBusyAction(undefined)
    }
  }, [])

  /** Re-read immediately, so an action's effect is on screen without waiting a tick. */
  const refresh = useCallback(async (): Promise<void> => {
    await store.refresh()
  }, [store])

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

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    setDropTarget(undefined)
  }, [])

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
                      setNotice(result.found > 0 ? t('scanFound', { count: result.found }) : t('scanEmpty'))
                    })
                  }}
                >
                  <SearchIcon size={13} />
                  {busyAction === 'scan' ? t('scanning') : t('rescan')}
                </button>
              </div>
            )
            : null}
        </header>

        {read.status === 'loading' ? <p className="dls-note">{t('scanning')}</p> : null}

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

        {notice !== undefined ? <p className="dls-note">{notice}</p> : null}

        {incoming.map(transfer => (
          <IncomingOffer
            key={transfer.id}
            transfer={transfer}
            busy={busyAction === `answer:${transfer.id}`}
            t={t}
            onAnswer={(accept) => {
              void run(`answer:${transfer.id}`, async () => {
                await answer(transfer.id, accept)
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
              onAddToConversation={addToConversation}
              onReveal={(path) => {
                void run(`reveal:${path}`, async () => { await revealFile(path) })
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

/** An offer waiting on the reader. */
function IncomingOffer(
  { transfer, busy, t, onAnswer }: {
    readonly transfer: TransferRow
    readonly busy: boolean
    readonly t: Translate
    readonly onAnswer: (accept: boolean) => void
  },
): ReactNode {
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
            disabled={busy}
            onClick={() => { onAnswer(true) }}
          >
            {t('accept')}
          </button>
          <button type="button" className="dls-action" disabled={busy} onClick={() => { onAnswer(false) }}>
            {t('decline')}
          </button>
        </span>
      </div>
      <ul className="dls-incomingFiles">
        {transfer.files.map(file => (
          <li key={file.id} className="dls-incomingFile">
            <span className="dls-incomingName">{shortenFileName(file.fileName, 64)}</span>
            <span className="dls-incomingSize">{formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>
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
  { transfers, busyAction, t, now, onAddToConversation, onReveal }: {
    readonly transfers: readonly TransferRow[]
    readonly busyAction: string | undefined
    readonly t: Translate
    readonly now: number
    readonly onAddToConversation: (path: string) => void
    readonly onReveal: (path: string) => void
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
  { transfer, busyAction, t, now, onAddToConversation, onReveal }: {
    readonly transfer: TransferRow
    readonly busyAction: string | undefined
    readonly t: Translate
    readonly now: number
    readonly onAddToConversation: (path: string) => void
    readonly onReveal: (path: string) => void
  },
): ReactNode {
  const incoming = transfer.direction === 'incoming'
  const [open, setOpen] = useState(false)
  const settled = transfer.status !== 'transferring' && transfer.status !== 'awaiting'
  const percent = percentOf(transfer.bytesDone, transfer.bytesTotal)
  const single = transfer.files.length === 1 ? transfer.files[0] : undefined
  const done = transfer.status === 'done' || transfer.status === 'partial'
  /** Received files that are on disk, which are the ones worth referencing. */
  const saved = transfer.files.filter(file => file.status === 'done' && file.savedPath !== undefined)

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
              disabled={busyAction !== undefined}
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
              disabled={busyAction !== undefined}
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
