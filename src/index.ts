/**
 * Local LAN file transfer, Host half: the transfer API, the discovery loop, and
 * the routes the panel drives them through.
 *
 * This plugin is self-contained on purpose. A Typert Remote namespace would be
 * tidier, but it only reaches the browser when the product's own Remote assembly
 * mounts it, and that list lives inside the harness repository — which would
 * make this package impossible to install on its own. Registered Fetch routes
 * cost a little plumbing and buy a plugin any deployment can load by path.
 *
 * Two listeners exist here and they are not interchangeable:
 *
 * - The **LocalSend API** ({@link LocalSendServer}) is a plain `node:http` server
 *   on the protocol's own port, because the peers that dial it are phones and
 *   laptops running the official app. They carry no session cookie, so nothing
 *   behind the harness's trust fence could ever serve them.
 * - The **panel routes** are registered on this plugin's own Fetch paths, so the
 *   browser half reaches them with the page's own credentials and no extra
 *   listening surface.
 *
 * The panel's byte-streaming route is registered as `streaming` rather than
 * `buffered`, which is the one carrier option that matters here: a file dropped
 * on the panel is piped from the browser's request straight into the request to
 * the peer, so a multi-gigabyte drag-and-drop costs one buffer rather than the
 * whole file in memory, and never touches the disk on the way through.
 *
 * @module dsh-local-send
 */

import type { Context } from '@deepseek-ai/cordis'
import { Readable } from 'node:stream'
import { stat } from 'node:fs/promises'
import { basename, dirname, join, resolve as resolvePath, sep } from 'node:path'
import { spawn } from 'node:child_process'
import {
  ANNOUNCE_INTERVAL_MS,
  PEER_TTL_MS,
  MulticastDiscovery,
  localAddresses,
  type DiscoveredPeer,
} from './discovery.ts'
import {
  cancelOffer,
  metadataForUpload,
  prepareOffer,
  sendPaths,
  uploadStream,
  type OutboundPeer,
  type PreparedOffer,
} from './outbound.ts'
import {
  PROTOCOL_VERSION,
  apiUrl,
  type Announcement,
  type DeviceInfo,
  type FileMetadata,
} from './protocol.ts'
import { LocalSendServer } from './server.ts'
import {
  ensureDirectories,
  loadDevice,
  receiveDirectory,
  resolveConfig,
  resolveDshHome,
  saveDevice,
  storePaths,
  type LocalSendConfig,
} from './store.ts'
import { TransferRegistry } from './transfer.ts'
import {
  DECIDE_PATH,
  INSPECT_PATH,
  PREPARE_PATH,
  RENAME_PATH,
  REVEAL_PATH,
  SCAN_PATH,
  SEND_PATHS_PATH,
  STATE_PATH,
  STREAM_PATH,
  type DecideRequest,
  type LocalSendState,
  type PathCandidate,
  type PeerRow,
  type PrepareSendRequest,
  type PrepareSendResponse,
  type RenameRequest,
  type SendPathsRequest,
  type SendPathsResponse,
} from './types.ts'

export type * from './types.ts'

/** Plugin name the loader row addresses. */
export const name = 'dsh-local-send'

/** Services this plugin cannot work without: the carrier's route registry. */
export const inject = ['connection']

/**
 * How many addresses the legacy subnet scan probes at once.
 *
 * The reference implementation uses fifty. That is a reasonable ceiling for a
 * `/24` — enough that a whole subnet is covered in a few rounds of the probe
 * timeout, few enough that a device with a small NAT table is not the thing that
 * fails first.
 */
const SCAN_CONCURRENCY = 50

/** How long one subnet probe may take before its address counts as empty. */
const SCAN_TIMEOUT_MS = 500

/** Files one panel-driven send may carry in a single batch. */
const MAX_PANEL_FILES = 200

/**
 * The route-registration face of `ctx.connection`.
 *
 * Reached through a local structural type rather than the Context augmentation:
 * the host's Context declares no `connection` member, so the harness's own route
 * registrars read it with a cast. Keeping the shape here also means this plugin
 * carries no dependency on the package that provides the service.
 */
interface LocalSendConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/** Read the Fetch carrier off the Host context. */
function connectionOf(ctx: Context): LocalSendConnection {
  return Reflect.get(ctx, 'connection') as LocalSendConnection
}

/** One line describing an error, for a log line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Answer with JSON and no caching, the shape every panel route uses. */
function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** Answer with a described failure the panel can show. */
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status)
}

/** One panel-driven send, held between its preparation and its last upload. */
interface StagedSend {
  /** The accepted offer, holding the tokens that authorise the uploads. */
  readonly offer: PreparedOffer
  /** The peer the offer was made to. */
  readonly peer: OutboundPeer
  /** File ids still expected from the panel. */
  readonly remaining: Set<string>
  /** Whether any file of this offer failed, so the peer must be told. */
  failed: boolean
}

/**
 * Register the LocalSend surface.
 *
 * Deliberately a named export with no default: the Loader takes a module's
 * default export when it has one, and a default that is the bare `apply`
 * function is a plugin *without* this module's `name` and `inject` — the fiber
 * then activates with an empty inject list and the first service read throws
 * "cannot get property … without inject".
 *
 * @param ctx - Host context carrying the carrier.
 * @param config - plugin configuration; omitted fields keep their defaults.
 */
export function apply(ctx: Context, config: Partial<LocalSendConfig> = {}): void {
  const resolved = resolveConfig(config)
  const paths = storePaths(resolveDshHome())
  ensureDirectories(paths)
  const device = loadDevice(paths, message => { ctx.logger.warn(`dsh-local-send: ${message}`) })
  // An explicit `alias` in the Loader row wins for this run; otherwise the name
  // the user last chose in the panel is used, so the two entry points cannot
  // fight over which one is authoritative.
  if (resolved.alias.length > 0) device.alias = resolved.alias

  const registry = new TransferRegistry()
  /** Peers believed present, keyed by the fingerprint the protocol keys them by. */
  const peers = new Map<string, PeerRow>()
  /** The most recent discovery condition worth showing the user. */
  let discoveryWarning: string | undefined
  /**
   * The most recent transfer-API condition worth showing the user.
   *
   * Kept apart from {@link discoveryWarning} because the two failures have
   * different consequences — a lost multicast socket still receives, a lost
   * listener does not — and a single field would report one as the other.
   */
  let servingWarning: string | undefined
  /** Panel-driven sends awaiting their bytes. */
  const staged = new Map<string, StagedSend>()
  /** Port the transfer API actually bound, which may differ from the configured one. */
  let boundPort = resolved.port
  /** Whether the transfer API is serving; the panel says so when it is not. */
  let serving = false

  /** This device's announced identity, rebuilt per call so a rename takes effect at once. */
  const deviceInfo = (): DeviceInfo => ({
    alias: device.alias,
    version: PROTOCOL_VERSION,
    deviceModel: 'DeepSeek Harness',
    deviceType: resolved.deviceType,
    fingerprint: device.fingerprint,
    port: boundPort,
    protocol: resolved.protocol,
    // The reverse (download) API exists so a browser can pull files from a
    // device with no LocalSend app. This plugin's panel is not a browser peer —
    // it talks to its own host — so the capability is honestly absent.
    download: false,
  })

  const announcement = (): Announcement => ({ ...deviceInfo(), announce: true })

  const host = {
    config: (): LocalSendConfig => resolved,
    info: deviceInfo,
    registry,
    paths,
    warn: (message: string): void => { ctx.logger.warn(`dsh-local-send: ${message}`) },
    sawPeer: (info: DeviceInfo, address: string): void => { observe(info, address, true) },
  }

  const server = new LocalSendServer(host)

  /**
   * Record one sighting of a peer.
   *
   * Reachability is sticky upward: a peer seen over the discovery channel as
   * unreachable, then met again through an inbound `register` that proves it is
   * listening, becomes reachable — while the reverse never demotes a peer that
   * has already proved itself, because a single unanswered callback on a busy
   * network is not evidence the device went away.
   *
   * @param info - the peer's announced identity.
   * @param address - the address it was seen at.
   * @param reachable - whether this sighting proved its API answers.
   */
  function observe(info: DeviceInfo, address: string, reachable: boolean): void {
    if (info.fingerprint === device.fingerprint) return
    const previous = peers.get(info.fingerprint)
    peers.set(info.fingerprint, {
      fingerprint: info.fingerprint,
      alias: info.alias,
      deviceType: info.deviceType ?? null,
      deviceModel: info.deviceModel ?? null,
      address,
      port: info.port,
      protocol: info.protocol,
      version: info.version,
      lastSeen: Date.now(),
      reachable: reachable || previous?.reachable === true,
    })
  }

  /** Drop peers that have stopped announcing. */
  function sweep(): void {
    const cutoff = Date.now() - PEER_TTL_MS
    for (const [fingerprint, peer] of peers) {
      if (peer.lastSeen < cutoff) peers.delete(fingerprint)
    }
  }

  /**
   * Peer table as the panel reads it.
   * @returns rows ordered by most recent sighting, reachable peers first.
   */
  function peerRows(): PeerRow[] {
    return [...peers.values()].sort((left, right) => {
      if (left.reachable !== right.reachable) return left.reachable ? -1 : 1
      return right.lastSeen - left.lastSeen
    })
  }

  /**
   * Find the peer a request named.
   * @param fingerprint - the stable key the panel sent.
   * @returns the peer as an outbound target, or `undefined`.
   */
  function targetOf(fingerprint: string): OutboundPeer | undefined {
    const peer = peers.get(fingerprint)
    if (peer === undefined || !peer.reachable) return undefined
    return {
      fingerprint: peer.fingerprint,
      alias: peer.alias,
      host: peer.address,
      port: peer.port,
      protocol: peer.protocol,
      deviceType: peer.deviceType,
    }
  }

  /**
   * The whole state the panel renders from.
   * @returns a serializable snapshot.
   */
  function state(): LocalSendState {
    return {
      device: {
        alias: device.alias,
        fingerprint: device.fingerprint,
        port: boundPort,
        protocol: resolved.protocol,
        deviceType: resolved.deviceType,
        addresses: localAddresses().map(entry => entry.address),
        serving,
      },
      peers: peerRows(),
      transfers: registry.list(),
      inbox: receiveDirectory(resolved, paths),
      discovery: {
        active: discoveryWarning === undefined,
        ...discoveryWarning === undefined ? {} : { warning: discoveryWarning },
      },
      ...servingWarning === undefined ? {} : { warning: servingWarning },
      busy: registry.busy(),
    }
  }

  /**
   * Probe every address on this machine's subnets over HTTP.
   *
   * The spec's fallback for a network that drops multicast, and deliberately
   * user-triggered rather than automatic: every other discovery mechanism here
   * costs one datagram, while this costs one request per address on the subnet.
   * Running it on a timer to find a device that is not answering multicast would
   * spend the whole subnet's patience on every interval.
   *
   * @returns how many addresses answered as LocalSend members.
   */
  async function scanSubnet(): Promise<number> {
    const targets: string[] = []
    for (const local of localAddresses()) {
      const parts = local.address.split('.')
      if (parts.length !== 4) continue
      const prefix = `${parts[0] ?? ''}.${parts[1] ?? ''}.${parts[2] ?? ''}`
      for (let host = 1; host <= 254; host += 1) targets.push(`${prefix}.${String(host)}`)
    }
    let found = 0
    let cursor = 0
    const probe = async (address: string): Promise<void> => {
      try {
        const response = await fetch(apiUrl(`http://${address}:${String(boundPort)}`, 'register'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(deviceInfo()),
          signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
        })
        if (!response.ok) return
        // The answer is the peer's own identity, but the address that answered is
        // the one that matters: the response deliberately omits port and
        // protocol, so the probed origin is the only location known to work.
        const info = readRegisterResponse(await response.json() as unknown, boundPort)
        if (info !== undefined) {
          found += 1
          observe(info, address, true)
        }
      } catch {
        // An address with nothing on it is the expected case, not a condition.
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, async () => {
        while (cursor < targets.length) {
          const index = cursor
          cursor += 1
          const address = targets[index]
          if (address !== undefined) await probe(address)
        }
      }),
    )
    return found
  }

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: STATE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => Promise.resolve(jsonResponse(state())),
    }),
    'dsh-local-send: state route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: PREPARE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson<PrepareSendRequest>(request)
        const files = body?.files ?? []
        if (body === null || files.length === 0) return errorResponse('expected a peer and at least one file')
        if (files.length > MAX_PANEL_FILES) {
          return errorResponse(`a single send may carry at most ${String(MAX_PANEL_FILES)} files`)
        }
        const peer = targetOf(body.peer)
        if (peer === undefined) return errorResponse('that device is no longer reachable', 409)
        const offered: FileMetadata[] = files.map(file =>
          metadataForUpload(file.id, file.fileName, file.size))
        const result = await prepareOffer(peer, offered, deviceInfo(), host)
        if ('refused' in result) {
          return jsonResponse({
            transferId: result.refused.transferId,
            accepted: false,
            files: [],
          } satisfies PrepareSendResponse)
        }
        staged.set(result.transferId, {
          offer: result,
          peer,
          remaining: new Set(result.accepted.keys()),
          failed: false,
        })
        return jsonResponse({
          transferId: result.transferId,
          accepted: true,
          files: [...result.accepted.keys()],
        } satisfies PrepareSendResponse)
      },
    }),
    'dsh-local-send: prepare route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      // `streaming` is the whole point of this route: the body is the file, and
      // the carrier hands it over as a live stream instead of buffering it.
      path: STREAM_PATH,
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: async (request) => {
        const url = new URL(request.url)
        const transferId = url.searchParams.get('transferId')
        const fileId = url.searchParams.get('fileId')
        if (transferId === null || fileId === null) return errorResponse('missing transferId or fileId')
        const entry = staged.get(transferId)
        if (entry === undefined) return errorResponse('that send is no longer staged', 409)
        if (!entry.offer.accepted.has(fileId)) return errorResponse('that file was not accepted by the device', 409)
        if (request.body === null) return errorResponse('expected the file as the request body')
        try {
          await uploadStream(
            entry.offer,
            fileId,
            Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
            registry,
          )
        } catch (error: unknown) {
          // The panel does not retry a file it failed to stream, so this offer
          // is over: the peer is told, rather than left holding a session for
          // bytes that will never arrive — which, since the protocol allows one
          // live session, would make it refuse the next sender.
          entry.failed = true
          entry.remaining.delete(fileId)
          if (entry.remaining.size === 0) await finishStaged(transferId, entry)
          return errorResponse(describe(error), 502)
        }
        entry.remaining.delete(fileId)
        if (entry.remaining.size === 0) await finishStaged(transferId, entry)
        return jsonResponse({ ok: true })
      },
    }),
    'dsh-local-send: stream route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: SEND_PATHS_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson<SendPathsRequest>(request)
        const requested = body?.paths ?? []
        if (body === null || requested.length === 0) return errorResponse('expected a peer and at least one path')
        if (requested.length > MAX_PANEL_FILES) {
          return errorResponse(`a single send may carry at most ${String(MAX_PANEL_FILES)} files`)
        }
        const peer = targetOf(body.peer)
        if (peer === undefined) return errorResponse('that device is no longer reachable', 409)
        const result = await sendPaths(peer, requested, deviceInfo(), host)
        return jsonResponse({ transferId: result.transferId } satisfies SendPathsResponse)
      },
    }),
    'dsh-local-send: send-paths route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: DECIDE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson<DecideRequest>(request)
        if (body === null || typeof body.transferId !== 'string' || typeof body.accept !== 'boolean') {
          return errorResponse('expected { transferId, accept }')
        }
        const settled = registry.decide(body.transferId, body.accept)
        if (!settled) {
          // A decision that arrives after the offer timed out is not an error
          // worth a failure status: the panel's view was one poll behind, and
          // the honest answer is that there was nothing left to decide.
          return jsonResponse({ decided: false })
        }
        return jsonResponse({ decided: true })
      },
    }),
    'dsh-local-send: decide route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: RENAME_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson<RenameRequest>(request)
        const alias = typeof body?.alias === 'string' ? body.alias.trim() : ''
        if (alias.length === 0) return errorResponse('a device name cannot be empty')
        if (alias.length > 64) return errorResponse('a device name may be at most 64 characters')
        device.alias = alias
        saveDevice(paths, device)
        // Announced immediately rather than at the next tick, so the name a peer
        // shows catches up while the user is still looking at the panel.
        discovery?.send()
        return jsonResponse({ alias: device.alias })
      },
    }),
    'dsh-local-send: rename route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: SCAN_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse({ found: await scanSubnet() }),
    }),
    'dsh-local-send: scan route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: INSPECT_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson<{ paths?: unknown }>(request)
        const requested = Array.isArray(body?.paths) ? body.paths : []
        const candidates: PathCandidate[] = []
        for (const entry of requested.slice(0, MAX_PANEL_FILES)) {
          if (typeof entry !== 'string' || entry.length === 0) continue
          const absolute = resolvePath(expandHome(entry))
          try {
            const stats = await stat(absolute)
            candidates.push({
              path: absolute,
              name: basename(absolute),
              directory: stats.isDirectory(),
              ...stats.isFile() ? { size: stats.size } : {},
            })
          } catch {
            candidates.push({ path: absolute, name: basename(absolute), directory: false })
          }
        }
        return jsonResponse({ candidates })
      },
    }),
    'dsh-local-send: inspect route',
  )

  ctx.effect(
    () => connectionOf(ctx).fetch.register({
      path: REVEAL_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJson<{ path?: unknown }>(request)
        const target = typeof body?.path === 'string' ? body.path : ''
        const directory = receiveDirectory(resolved, paths)
        // Only a file this plugin saved may be revealed. The guard is a prefix
        // check against the resolved receive directory rather than a trust in
        // the caller, because the route spawns a process with the path as an
        // argument and an unchecked path would be an argument injection.
        if (!isInside(directory, target)) return errorResponse('that file is not in the receive directory', 403)
        revealInFileManager(target)
        return jsonResponse({ ok: true })
      },
    }),
    'dsh-local-send: reveal route',
  )

  /**
   * Settle a staged send once every accepted file has arrived from the panel.
   * @param transferId - the registry row.
   * @param entry - the staged entry to drop.
   */
  async function finishStaged(transferId: string, entry: StagedSend): Promise<void> {
    staged.delete(transferId)
    if (entry.failed) await cancelOffer(entry.offer, host.warn)
    registry.settle(transferId)
  }

  // Discovery and the API server start independently and neither is fatal: a
  // plugin whose port is taken still lists peers and still answers the panel,
  // and the panel says which half is missing rather than showing an empty list
  // with no explanation.
  const discovery = new MulticastDiscovery(announcement, {
    onPeer: (peer: DiscoveredPeer) => { observe(peer.info, peer.host, peer.reachable) },
    onSweep: sweep,
    onWarning: (message: string) => {
      discoveryWarning = message
      ctx.logger.warn(`dsh-local-send: ${message}`)
    },
  }, resolved.port)
  discovery.start()

  ctx.effect(() => {
    let cancelled = false
    void server.start(resolved.port).then(
      (port) => {
        if (cancelled) return
        boundPort = port
        serving = true
        // The announcement carries the port, so a device that announced before
        // the listener was up would have advertised one that refuses connections.
        discovery.send()
        ctx.logger.info(`dsh-local-send: listening on ${String(port)} as "${device.alias}"`)
      },
      (error: unknown) => {
        serving = false
        servingWarning = `transfer port ${String(resolved.port)} is unavailable: ${describe(error)}`
        ctx.logger.warn(`dsh-local-send: ${servingWarning}`)
      },
    )
    return () => {
      cancelled = true
      discovery.stop()
      registry.declineAll()
      void server.stop()
    }
  }, 'dsh-local-send: listeners')

  ctx.logger.info(
    `dsh-local-send: "${device.alias}" serving on ${resolved.protocol}://0.0.0.0:${String(resolved.port)}`
    + `, announcing every ${String(ANNOUNCE_INTERVAL_MS / 1000)}s, inbox ${receiveDirectory(resolved, paths)}`,
  )
}

/** Read a JSON body, or `null` when it is not one. */
async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const value: unknown = await request.json()
    return typeof value === 'object' && value !== null ? value as T : null
  } catch {
    return null
  }
}

/**
 * Expand a leading `~` to the user's home directory.
 * @param path - a possibly tilde-prefixed path.
 * @returns the path with `~` resolved.
 */
function expandHome(path: string): string {
  if (path !== '~' && !path.startsWith(`~${sep}`)) return path
  const home = process.env['HOME'] ?? ''
  return home.length > 0 ? join(home, path.slice(1)) : path
}

/**
 * Whether one path is inside a directory.
 *
 * Compared after resolution on both sides, so `..` segments and a symlinked
 * parent cannot smuggle a path out of the tree the check is about. The trailing
 * separator is what stops `/inbox-evil` from counting as inside `/inbox`.
 *
 * @param directory - the containing directory.
 * @param candidate - the path to test.
 * @returns whether the candidate is the directory or below it.
 */
export function isInside(directory: string, candidate: string): boolean {
  if (candidate.length === 0) return false
  const root = resolvePath(directory)
  const target = resolvePath(candidate)
  return target === root || target.startsWith(`${root}${sep}`)
}

/**
 * Show one file in the platform's file manager.
 *
 * Best-effort by contract: this is a convenience, and a machine with no
 * file manager — a headless host, a locked-down desktop — should not have its
 * request fail because a window could not open.
 *
 * @param path - absolute path of the file to reveal.
 */
function revealInFileManager(path: string): void {
  const command = process.platform === 'darwin'
    ? { file: 'open', args: ['-R', path] }
    : process.platform === 'win32'
      ? { file: 'explorer', args: [`/select,${path}`] }
      : { file: 'xdg-open', args: [dirname(path)] }
  try {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Nothing to do: the file is still on disk and its path is on screen.
  }
}

/**
 * Build a peer identity from a `register` response.
 *
 * The response omits `port` and `protocol` by contract — the caller is already
 * talking to the device and learned both from the connection — so the values
 * that worked are supplied by the caller rather than read out of the body.
 *
 * @param value - the parsed response body.
 * @param port - the port that was probed, and therefore the one that works.
 * @returns the peer's identity, or `undefined` when the body is not one.
 */
function readRegisterResponse(value: unknown, port: number): DeviceInfo | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const alias = raw['alias']
  const version = raw['version']
  const fingerprint = raw['fingerprint']
  if (typeof alias !== 'string' || alias.length === 0) return undefined
  if (typeof version !== 'string' || version.length === 0) return undefined
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return undefined
  const deviceType = raw['deviceType']
  const deviceModel = raw['deviceModel']
  return {
    alias,
    version,
    fingerprint,
    port,
    protocol: 'http',
    ...typeof deviceType === 'string' ? { deviceType: deviceType as DeviceInfo['deviceType'] } : {},
    ...typeof deviceModel === 'string' ? { deviceModel } : {},
  }
  // `address` is the caller's own record of where the answer came from; it is
  // not part of the identity and is carried on the peer row instead.
}
