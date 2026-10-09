/**
 * A fixture renderer for the panel, used to look at the interface without
 * loading the plugin into a running Harness.
 *
 * This mounts the real component with the real stylesheet against a fixed state,
 * so what it shows is what the product would draw — the only thing simulated is
 * the host. That matters because the panel's job is mostly presentational: if
 * the fixture renders, the layout, the type scale, the progress rails and the
 * empty states are all being exercised for real.
 *
 * Scenarios are chosen by `?scene=` and the palette by `?theme=`, so one page
 * covers the states a reader needs to see: peers present and absent, a transfer
 * moving, a batch finished, an offer waiting, a failure.
 *
 * @module dsh-local-send/preview/entry
 */

import { createRoot } from 'react-dom/client'
import { LocalSendPanel } from '../src/client/LocalSendPanel.tsx'
import { ReceiveToast } from '../src/client/ReceiveToast.tsx'
import type { ReceiveToastProps } from '../src/client/ReceiveToast.tsx'
import type { LocalSendPanelInjected, LocalSendPanelProps } from '../src/client/LocalSendPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { LocalSendLocaleKey } from '../src/client/locales.ts'
import { styles } from '../src/client/styles.ts'
import type { TransferStore, ClientState } from '../src/client/state.ts'
import type { LocalSendState, PeerRow, TransferRow } from '../src/types.ts'

/** One transfer in the fixture, with the dates relative to now. */
const NOW = Date.now()

/** A peer row with sensible defaults, so a scenario states only what it varies. */
function peer(overrides: Partial<PeerRow> & Pick<PeerRow, 'fingerprint' | 'alias'>): PeerRow {
  return {
    deviceType: 'mobile',
    deviceModel: null,
    address: '192.168.1.24',
    port: 53317,
    protocol: 'http',
    version: '2.2',
    lastSeen: NOW - 1_000,
    reachable: true,
    ...overrides,
  }
}

/** This device, as the panel draws it in its header. */
const DEVICE: LocalSendState['device'] = {
  alias: 'Admin 的 MacBook Pro',
  fingerprint: 'a1b2c3d4e5f6',
  port: 53317,
  protocol: 'http',
  deviceType: 'desktop',
  addresses: ['192.168.1.7'],
  serving: true,
}

/** The three peers a busy network would show, including one that went quiet. */
const PEERS: PeerRow[] = [
  peer({ fingerprint: 'p1', alias: 'Pixel 8', deviceType: 'mobile', address: '192.168.1.24' }),
  peer({ fingerprint: 'p2', alias: 'MacBook Air', deviceType: 'desktop', address: '192.168.1.31' }),
  peer({
    fingerprint: 'p3',
    alias: 'iPad Pro',
    deviceType: 'mobile',
    address: '192.168.1.42',
    reachable: false,
    lastSeen: NOW - 5_000,
  }),
]

/** One transfer row, with the file list defaulted from the byte total. */
function transfer(overrides: Partial<TransferRow> & Pick<TransferRow, 'id' | 'peerAlias' | 'status'>): TransferRow {
  const bytesTotal = overrides.bytesTotal ?? 4_400_000
  return {
    direction: 'incoming',
    peerFingerprint: 'p1',
    peerAddress: '192.168.1.24',
    peerType: 'mobile',
    files: [
      {
        id: 'f1',
        fileName: 'screenshot.png',
        size: bytesTotal,
        fileType: 'image/png',
        status: 'done',
        bytesDone: bytesTotal,
        savedPath: '/Users/Admin/.dsh/local-send/inbox/screenshot.png',
      },
    ],
    bytesTotal,
    bytesDone: bytesTotal,
    createdAt: NOW - 40_000,
    updatedAt: NOW - 4_000,
    ...overrides,
  }
}

/** The scenes the preview can draw. */
const SCENES: Record<string, LocalSendState> = {
  /** Nothing discovered yet: the first thing a new user sees. */
  empty: {
    device: DEVICE,
    peers: [],
    transfers: [],
    inbox: '/Users/Admin/.dsh/local-send/inbox',
    discovery: { active: true },
    busy: false,
  },

  /** The ordinary working state: peers around, a transfer moving, history behind. */
  busy: {
    device: DEVICE,
    peers: PEERS,
    transfers: [
      transfer({
        id: 't1',
        peerAlias: 'Pixel 8',
        status: 'transferring',
        files: [
          {
            id: 'f1',
            fileName: 'holiday-2026-07.tar.gz',
            size: 812_000_000,
            fileType: 'application/gzip',
            status: 'transferring',
            bytesDone: 344_000_000,
          },
        ],
        bytesTotal: 812_000_000,
        bytesDone: 344_000_000,
      }),
      transfer({
        id: 't2',
        peerAlias: 'MacBook Air',
        status: 'done',
        direction: 'outgoing',
        peerFingerprint: 'p2',
        peerAddress: '192.168.1.31',
        peerType: 'desktop',
        files: [
          {
            id: 'f1',
            fileName: 'design-notes.md',
            size: 18_400,
            fileType: 'text/markdown',
            status: 'done',
            bytesDone: 18_400,
          },
        ],
        bytesTotal: 18_400,
        bytesDone: 18_400,
        updatedAt: NOW - 90_000,
      }),
    ],
    inbox: '/Users/Admin/.dsh/local-send/inbox',
    discovery: { active: true },
    busy: true,
  },

  /** An offer waiting on the reader, which is the panel's one blocking state. */
  incoming: {
    device: DEVICE,
    peers: PEERS,
    transfers: [
      transfer({
        id: 't1',
        peerAlias: 'Pixel 8',
        status: 'awaiting',
        files: [
          { id: 'f1', fileName: 'IMG_20260709_1042.jpg', size: 3_800_000, fileType: 'image/jpeg', status: 'offered', bytesDone: 0 },
          { id: 'f2', fileName: 'IMG_20260709_1043.jpg', size: 4_100_000, fileType: 'image/jpeg', status: 'offered', bytesDone: 0 },
          { id: 'f3', fileName: 'IMG_20260709_1044.jpg', size: 3_600_000, fileType: 'image/jpeg', status: 'offered', bytesDone: 0 },
        ],
        bytesTotal: 11_500_000,
        bytesDone: 0,
        peerType: 'mobile',
      }),
    ],
    inbox: '/Users/Admin/.dsh/local-send/inbox',
    discovery: { active: true },
    busy: true,
  },

  /** What a batch looks like once it landed, with the per-file action. */
  received: {
    device: DEVICE,
    peers: PEERS,
    transfers: [
      transfer({
        id: 't1',
        peerAlias: 'Pixel 8',
        status: 'partial',
        files: [
          {
            id: 'f1',
            fileName: 'IMG_20260709_1042.jpg',
            size: 3_800_000,
            fileType: 'image/jpeg',
            status: 'done',
            bytesDone: 3_800_000,
            savedPath: '/Users/Admin/.dsh/local-send/inbox/IMG_20260709_1042.jpg',
          },
          {
            id: 'f2',
            fileName: 'IMG_20260709_1043.jpg',
            size: 4_100_000,
            fileType: 'image/jpeg',
            status: 'done',
            bytesDone: 4_100_000,
            savedPath: '/Users/Admin/.dsh/local-send/inbox/IMG_20260709_1043.jpg',
          },
          {
            id: 'f3',
            fileName: 'a-very-long-screen-recording-name.mov',
            size: 96_000_000,
            fileType: 'video/quicktime',
            status: 'declined',
            bytesDone: 0,
            error: 'file is larger than the 16 MiB limit',
          },
        ],
        bytesTotal: 103_900_000,
        bytesDone: 7_900_000,
        updatedAt: NOW - 12_000,
      }),
      transfer({
        id: 't2',
        peerAlias: 'iPad Pro',
        status: 'failed',
        direction: 'outgoing',
        peerFingerprint: 'p3',
        peerType: 'mobile',
        error: 'connect ECONNREFUSED 192.168.1.42:53317',
        files: [
          {
            id: 'f1',
            fileName: 'quarterly-report.pdf',
            size: 2_400_000,
            fileType: 'application/pdf',
            status: 'failed',
            bytesDone: 0,
            error: 'connect ECONNREFUSED 192.168.1.42:53317',
          },
        ],
        bytesTotal: 2_400_000,
        bytesDone: 0,
        updatedAt: NOW - 240_000,
      }),
    ],
    inbox: '/Users/Admin/.dsh/local-send/inbox',
    discovery: { active: true },
    busy: false,
  },

  /** The degraded case: discovery is up but nothing can arrive. */
  blocked: {
    device: { ...DEVICE, serving: false },
    peers: PEERS.slice(0, 1),
    transfers: [],
    inbox: '/Users/Admin/.dsh/local-send/inbox',
    discovery: { active: false, warning: { code: 'discoveryUnavailable', detail: 'EADDRINUSE' } },
    warning: {
      code: 'portUnavailable',
      port: 53317,
      detail: 'listen EADDRINUSE: address already in use 0.0.0.0:53317',
    },
    busy: false,
  },
}

/**
 * Translate a key out of the shipped Chinese dictionary.
 *
 * The preview deliberately renders the shipped copy rather than placeholder
 * strings: the point of looking at it is to judge the real thing, and copy is
 * part of the layout as much as the spacing is.
 *
 * @param key - dictionary key.
 * @param params - `{name}` substitutions.
 * @returns the rendered string.
 */
function translate(key: LocalSendLocaleKey, params?: Record<string, unknown>): string {
  const template = (zh as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    (name in params ? String(params[name]) : match))
}

/** A store that answers the fixture and never changes. */
function fixedStore(state: LocalSendState): TransferStore {
  // One object identity for the snapshot: `useSyncExternalStore` compares by
  // reference and would re-render forever on a fresh object per read.
  const snapshot: ClientState = { status: 'ready', state }
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    retain: () => () => {},
    refresh: async () => {},
  }
}

/** The notification's injected face, with the answer inert. */
function toastFace(state: LocalSendState) {
  return {
    store: fixedStore(state),
    answer: async () => {},
  }
}

/** The injected face, with every action inert. */
function face(state: LocalSendState): LocalSendPanelInjected {
  return {
    panelId: 'local-send' as LocalSendPanelInjected['panelId'],
    locale: () => 'zh',
    store: fixedStore(state),
    sendFiles: async () => {},
    sendLocalPaths: async () => {},
    answer: async () => {},
    renameDevice: async () => {},
    scanNow: async () => ({ found: 0 }),
    revealFile: async () => {},
    inspectPaths: async () => [],
    addToConversation: () => {},
  }
}

/** The parameters one render is driven by. */
const params = new URLSearchParams(window.location.search)
const scene = params.get('scene') ?? 'busy'
const theme = params.get('theme') ?? 'light'

/**
 * Report a failure into the document.
 *
 * A render failure unmounts the whole tree and leaves a blank page, and on a
 * screenshot that is indistinguishable from a scene that legitimately has
 * nothing in it. Everything that can go wrong here is therefore written where
 * the document can be read — by a person looking at the capture, and by the
 * render script, which refuses to call a blank scene a success.
 *
 * @param label - which stage failed.
 * @param error - what was thrown.
 */
function reportFailure(label: string, error: unknown): void {
  const box = document.createElement('pre')
  box.id = 'preview-error'
  box.style.cssText = 'font: 12px/1.5 ui-monospace, monospace; color: #b00; padding: 16px; white-space: pre-wrap'
  box.textContent = `${label}: ${String(error)}\n${error instanceof Error ? error.stack ?? '' : ''}`
  document.body.appendChild(box)
}

try {
  const state = SCENES[scene] ?? SCENES['busy'] as LocalSendState
  document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark')

  // The same injection the plugin performs on activation, from the same export.
  const tag = document.createElement('style')
  tag.textContent = styles
  document.head.appendChild(tag)

  const props = { t: translate, ...face(state) } as unknown as LocalSendPanelProps
  const toastProps = { t: translate, ...toastFace(state) } as unknown as ReceiveToastProps

  const root = document.getElementById('root')
  if (root === null) throw new Error('preview: no #root')

  /**
   * `?only=toast` mounts the notification alone.
   *
   * Kept because the two surfaces fail independently and a blank page does not
   * say which one did: with both mounted, a throw in either unmounts the tree
   * and looks identical.
   */
  const only = params.get('only')

  createRoot(root, {
    onUncaughtError: (error: unknown) => { reportFailure('uncaught', error) },
    onRecoverableError: (error: unknown) => { reportFailure('recoverable', error) },
  }).render(
    only === 'toast'
      ? <ReceiveToast {...toastProps} />
      : (
        <>
          <LocalSendPanel {...props} />
          {params.get('toast') === '1' ? <ReceiveToast {...toastProps} /> : null}
        </>
      ),
  )
} catch (error: unknown) {
  // Setup runs synchronously, so a failure here — a fixture that will not build,
  // a missing mount point — is caught rather than lost.
  reportFailure('setup', error)
}
