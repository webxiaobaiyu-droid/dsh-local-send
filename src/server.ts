/**
 * The LocalSend transfer API this device serves.
 *
 * This is the half that other devices dial: a plain HTTP server on the port the
 * spec reserves, answering the five routes of the v2 upload API. It is
 * deliberately separate from the harness's own Fetch carrier — a Fetch-carrier
 * route is reachable by the browser half but is fenced to the app's own client,
 * and a phone on the LAN carries no such credentials. So the two surfaces exist
 * for two different callers and neither can serve the other.
 *
 * Three rules are enforced here rather than trusted to the sender:
 *
 * - **A token is bound to the address that received it.** The spec's `403` for
 *   "invalid token or IP address" is one condition, not two: an accepted offer
 *   yields a token that is only valid from the address that made the offer. This
 *   is what stops a device that observed a token on the network from using it.
 * - **Nothing is written outside the receive directory.** A sender supplies the
 *   file name, so the name is checked as a single path segment
 *   ({@link isSafeFileName}) before it is joined to anything, and the write goes
 *   to a random name in a staging directory first. A traversal attempt therefore
 *   has nowhere to land rather than being filtered after the fact.
 * - **Every ceiling is applied before a byte is read.** Sizes and counts are
 *   validated at preparation, so an oversized offer is refused while it is still
 *   only metadata, and the streaming path re-checks the byte count against what
 *   was agreed as it goes.
 *
 * @module dsh-local-send/server
 */

import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, readdirSync, renameSync, rmSync, utimesSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import {
  API_PREFIX,
  MESSAGE,
  STATUS,
  isSafeFileName,
  readDeviceInfo,
  readPrepareUpload,
  registerResponse,
  uniqueFileName,
  type DeviceInfo,
  type FileMetadata,
} from './protocol.ts'
import type { OfferDecision, TransferRegistry } from './transfer.ts'
import { ensureDirectories, receiveDirectory, type LocalSendConfig, type StorePaths } from './store.ts'

/** How long a sender waits for the user to decide before the offer is refused. */
export const APPROVAL_TIMEOUT_MS = 90_000

/**
 * Uploads this receiver will write at once.
 *
 * The spec allows a sender to call `upload` in parallel, and a sender that
 * does will open one connection per file. Bounding the number this server is
 * willing to be *writing* at once keeps a large batch from turning into a large
 * batch of open file handles and interleaved disk seeks, without telling the
 * sender no: a connection over the bound waits its turn rather than failing.
 */
const MAX_PARALLEL_WRITES = 4

/**
 * Failed PIN attempts one address is allowed before it is refused outright.
 *
 * Three, matching the reference implementation. There is no recovery short of
 * restarting the plugin, which is deliberate: a four-digit PIN has ten thousand
 * values, and an attacker who may keep guessing will reach all of them.
 */
const MAX_PIN_ATTEMPTS = 3

/** Services the server needs from its owner. */
export interface ServerHost {
  /** Configuration in effect; read fresh so a reconfigured row takes effect. */
  readonly config: () => LocalSendConfig
  /** This device's announced identity. */
  readonly info: () => DeviceInfo
  /** The shared transfer table. */
  readonly registry: TransferRegistry
  /** The paths this plugin owns. */
  readonly paths: StorePaths
  /** Log sink for conditions worth recording but not failing on. */
  readonly warn: (message: string) => void
  /** Report a peer that called this device, so it appears in the peer list. */
  readonly sawPeer: (info: DeviceInfo, host: string) => void
}

/** One accepted transfer, as the server tracks it between preparation and upload. */
interface ServerSession {
  /** Session id handed to the sender; also the registry row's id. */
  readonly id: string
  /** Address that prepared the transfer; the only one its tokens are valid from. */
  readonly remoteAddress: string
  /** Per-file access tokens, keyed by file id. */
  readonly tokens: Map<string, string>
  /** Offered metadata, keyed by file id. */
  readonly files: Map<string, FileMetadata>
  /** Names already claimed on disk by this session, so a batch cannot collide with itself. */
  readonly claimed: Set<string>
  /** Bytes accepted, for the running total check. */
  acceptedBytes: number
  /**
   * Set once the user has stopped this transfer.
   *
   * The upload loop reads it per chunk, because stopping a transfer has to take
   * effect during a multi-gigabyte write rather than after it: a cancel that
   * only repainted the row would leave the bytes arriving under a label that
   * said they had stopped.
   */
  cancelled: boolean
  /** Staging files this session is writing, so a cancel can remove them. */
  readonly staging: Set<string>
  /**
   * Requests currently writing into this session.
   *
   * Held so a cancel can destroy them. Reading the byte count per chunk is not
   * enough on its own: a sender that has gone quiet — the very sender a user is
   * most likely to be cancelling — would leave the read loop blocked on a chunk
   * that never comes, and the transfer would outlive the cancel that was
   * supposed to stop it.
   */
  readonly active: Set<ActiveUpload>
}

/**
 * One upload writing into a session right now.
 *
 * The response is held beside the request because a cancel has to answer before
 * it disconnects: destroying the request first takes the socket with it, and the
 * sender would see a dropped connection instead of the reason it was dropped.
 */
interface ActiveUpload {
  /** The request whose body is being read. */
  readonly request: IncomingMessage
  /** The response that request will be answered on. */
  readonly response: ServerResponse
}

/**
 * A tiny counting semaphore.
 *
 * Used to bound concurrent writes without refusing work: {@link acquire} waits
 * rather than failing, which is the behaviour an upload connection needs — a
 * sender that opened ten connections should have them all succeed, just not all
 * at once.
 */
class Semaphore {
  private available: number
  private readonly waiting: (() => void)[] = []

  /** @param permits - how many holders may be active at once. */
  constructor(permits: number) {
    this.available = permits
  }

  /** Take one permit, waiting if none is free. */
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1
      return
    }
    await new Promise<void>((resolve) => { this.waiting.push(resolve) })
  }

  /** Return one permit, waking the longest-waiting holder. */
  release(): void {
    const next = this.waiting.shift()
    if (next === undefined) {
      this.available += 1
      return
    }
    next()
  }
}

/** One line describing an error, for a log line or a peer-visible message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Answer with a bare status and no body, the shape every success-no-body route uses. */
function empty(response: ServerResponse, status: number): void {
  response.writeHead(status).end()
}

/**
 * Answer with a failure.
 *
 * Every non-2xx body in this API is `{"message": "..."}` rather than a bare
 * status line: a peer's user is shown the receiving device's own words, and the
 * difference between "Rejected" and "Checksum mismatch" is the difference
 * between a person saying no and a network corrupting bytes.
 *
 * @param response - response to answer on.
 * @param status - HTTP status.
 * @param message - one of {@link MESSAGE}, or a specific explanation.
 */
function fail(response: ServerResponse, status: number, message: string): void {
  json(response, status, { message })
}

/** Answer with JSON. */
function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  }).end(payload)
}

/**
 * Read a request body with a hard ceiling.
 *
 * The ceiling matters more than the parse: this is an unauthenticated socket, so
 * "read whatever arrives" is a memory exhaustion primitive. Preparation bodies
 * are metadata only, so a generous few megabytes is far above anything a real
 * client sends and far below anything that would hurt.
 *
 * @param request - the incoming request.
 * @param limit - maximum bytes to buffer.
 * @returns the parsed JSON, or `undefined` when the body is too large or not JSON.
 */
async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of request) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > limit) return undefined
      chunks.push(buffer)
    }
  } catch {
    return undefined
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/** The address a request came from, normalized. */
function remoteAddressOf(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? ''
  // A dual-stack socket reports IPv4 peers as `::ffff:1.2.3.4`; the token check
  // compares this string against the one captured at preparation, so both sides
  // must normalize the same way or a legitimate upload would be refused.
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
}

/**
 * The LocalSend API server: one HTTP listener and the sessions it is holding.
 *
 * Lifecycle is explicit ({@link start} / {@link stop}) rather than done in the
 * constructor, because a failed bind is an expected condition — the official
 * LocalSend app may already own the port — and the caller needs to hear about it
 * without losing the rest of the plugin.
 */
export class LocalSendServer {
  private server: Server | undefined
  private readonly sessions = new Map<string, ServerSession>()
  private readonly writes = new Semaphore(MAX_PARALLEL_WRITES)
  /** Set once the listener is closed, so late handlers answer instead of throwing. */
  private closed = false
  /**
   * Failed PIN attempts per source address.
   *
   * The reference implementation refuses an address outright after three
   * failures, with no recovery, and that is the right shape for a four-digit
   * secret on a LAN: an attacker who can retry forever will find it, and the
   * legitimate user's remedy — restart the plugin or clear the PIN — costs far
   * less than leaving a guessable door open.
   */
  private readonly pinFailures = new Map<string, number>()
  /**
   * Addresses with a preparation still waiting on the user, by registry id.
   *
   * Tracked separately from {@link sessions} because a session only exists once
   * it has been accepted, and the senders that most need cancelling are exactly
   * the ones that never got that far: a v2 sender does not learn the session id
   * until the preparation response arrives, so a sender that gives up while the
   * user is deciding has nothing to quote back and must cancel by address alone.
   */
  private readonly pendingSenders = new Map<string, string>()
  /** Preparations withdrawn by their sender, so the handler can say so. */
  private readonly senderCancelled = new Set<string>()

  /** @param host - the services this server borrows from the plugin. */
  constructor(private readonly host: ServerHost) {}

  /** Whether the listener is bound. */
  get listening(): boolean {
    return this.server !== undefined
  }

  /**
   * Bind the API server.
   *
   * @param port - TCP port to listen on.
   * @returns the port actually bound, which differs from the request when the
   *   configured port was taken and the caller allowed a fallback.
   */
  async start(port: number): Promise<number> {
    if (this.server !== undefined) return port
    const server = createServer((request, response) => {
      this.route(request, response).catch((error: unknown) => {
        this.host.warn(`local-send: request failed: ${describe(error)}`)
        if (!response.headersSent) empty(response, STATUS.serverError)
        else response.end()
      })
    })
    // A LAN peer that stops responding mid-upload must not hold a socket for the
    // kernel's default timeout; these are cheap streams, not long-lived tunnels.
    server.requestTimeout = 0
    server.headersTimeout = 30_000
    server.keepAliveTimeout = 5_000
    this.server = server
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { reject(error) }
      server.once('error', onError)
      server.listen(port, '0.0.0.0', () => {
        server.off('error', onError)
        resolve()
      })
    })
    this.closed = false
    // The port actually bound, which is not the one requested when the caller
    // asked for 0 and let the OS choose. This value is what gets announced to
    // peers, so returning the request instead would advertise a port nothing is
    // listening on — a device that is discoverable and cannot be reached.
    const address = server.address()
    return typeof address === 'object' && address !== null ? address.port : port
  }

  /**
   * Close the listener and refuse every session it was holding.
   *
   * In-flight uploads are torn down rather than drained: the plugin is going
   * away, and a partially written file is already in the staging directory where
   * the next start will not mistake it for a complete one.
   */
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.closed = true
    // Each session is torn down through the same path a user's cancel takes, so
    // the two cannot disagree about what "no longer serving this" leaves behind:
    // the staging files go, the rows settle, and an upload already inside its
    // write loop is told to stop rather than being left to finish against a
    // server that is closing.
    for (const id of [...this.sessions.keys()]) this.cancelSession(id)
    if (server === undefined) return
    await new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      // `close` waits for open connections; a sender mid-upload would hold it
      // indefinitely, so the remaining sockets are dropped after the grace.
      server.closeAllConnections?.()
    })
  }

  /**
   * Dispatch one request to its route.
   *
   * @param request - incoming request.
   * @param response - response to answer on.
   */
  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const route = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : ''
    const method = request.method ?? 'GET'
    if (this.closed) {
      fail(response, STATUS.serverError, MESSAGE.internal)
      return
    }
    if (method === 'POST' && route === '/register') {
      await this.handleRegister(request, response)
      return
    }
    if (method === 'GET' && route === '/info') {
      json(response, STATUS.ok, registerResponse(this.host.info()))
      return
    }
    if (method === 'POST' && route === '/prepare-upload') {
      await this.handlePrepare(request, response, url)
      return
    }
    if (method === 'POST' && route === '/upload') {
      await this.handleUpload(request, response, url)
      return
    }
    if (method === 'POST' && route === '/cancel') {
      this.handleCancel(request, response, url)
      return
    }
    // The reference implementation's fallback arm answers 404 with an empty body,
    // which is the one place in this API a bare status is the contract.
    empty(response, 404)
  }

  /**
   * Two-way discovery: a peer told us where it is, so answer with where we are.
   *
   * The body is also how this device learns about a peer that announced itself
   * while the discovery socket was down, so a successful register is reported as
   * a sighting rather than only answered.
   *
   * @param request - the peer's request.
   * @param response - response to answer on.
   */
  private async handleRegister(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request, 256 * 1024)
    const info = readDeviceInfoShallow(body)
    if (info !== undefined) this.host.sawPeer(info, remoteAddressOf(request))
    json(response, STATUS.ok, registerResponse(this.host.info()))
  }

  /**
   * The preparation handshake: metadata in, per-file tokens out.
   *
   * The interesting part is that this handler *waits*. A person has to decide
   * whether to accept, so the HTTP request stays open while the panel shows the
   * offer, and the answer is whatever settles first: the user, the timeout, or
   * the plugin unloading. The spec's status codes carry that answer — `403` for a
   * decline, `401` for a PIN mismatch — so the sender can tell "no" from "wrong
   * PIN" from "busy".
   *
   * @param request - the sender's request.
   * @param response - response to answer on.
   * @param url - parsed request URL, carrying the optional `pin`.
   */
  private async handlePrepare(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const config = this.host.config()
    const remoteAddress = remoteAddressOf(request)
    if (config.pin.length > 0) {
      // The refusal order is the reference implementation's: an address already
      // over its limit hears 429 whatever it sends, so a retry loop cannot use
      // the 401 to keep guessing.
      if (this.pinBlocked(remoteAddress)) {
        fail(response, STATUS.tooManyRequests, MESSAGE.tooManyRequests)
        return
      }
      const supplied = url.searchParams.get('pin')
      if (supplied !== config.pin) {
        this.recordPinFailure(remoteAddress)
        fail(
          response,
          STATUS.unauthorized,
          supplied === null ? MESSAGE.pinRequired : MESSAGE.invalidPin,
        )
        return
      }
    }
    const body = await readJsonBody(request, 4 * 1024 * 1024)
    const prepared = readPrepareUpload(body)
    if (prepared === undefined) {
      fail(response, STATUS.badRequest, MESSAGE.invalidJson)
      return
    }
    const sender = prepared.info
    this.host.sawPeer(sender, remoteAddress)

    // "Blocked by another session" is about the receiver being busy, so it is
    // checked against the registry rather than a private counter: a session the
    // user already answered is no longer holding anything.
    if (this.busy()) {
      fail(response, STATUS.conflict, MESSAGE.blocked)
      return
    }

    const entries = Object.values(prepared.files)
    if (entries.length === 0) {
      fail(response, STATUS.badRequest, MESSAGE.noFiles)
      return
    }
    const verdicts = this.screen(entries, config)
    const accepted = entries.filter(entry => verdicts.get(entry.id) === undefined)
    if (accepted.length === 0) {
      // Every file was refused on size or count grounds, so there is nothing
      // left to send. The spec makes 204 a *success* meaning exactly that, and
      // a sender that sees it must not call `upload`.
      empty(response, STATUS.noContent)
      return
    }

    const id = this.host.registry.openIncoming({
      peerAlias: sender.alias,
      peerFingerprint: sender.fingerprint,
      peerAddress: remoteAddress,
      peerType: sender.deviceType ?? null,
      files: entries.map(entry => ({
        id: entry.id,
        fileName: entry.fileName,
        size: entry.size,
        fileType: entry.fileType,
        ...entry.sha256 === undefined || entry.sha256 === null ? {} : { sha256: entry.sha256 },
      })),
    })
    // Files refused up front are reported as declined rows rather than dropped,
    // so the panel can say which file was too large instead of quietly showing
    // a shorter list than the sender offered.
    for (const [fileId, reason] of verdicts) {
      this.host.registry.updateFile(id, fileId, (file) => {
        file.status = 'declined'
        file.error = reason
      })
    }

    this.pendingSenders.set(id, remoteAddress)
    let decision: OfferDecision
    try {
      // `autoAccept` answers `acceptAll` rather than a list, because the roster
      // is this frame's and a decision made without showing one cannot name it.
      decision = config.autoAccept ? { kind: 'acceptAll' } : await this.awaitDecision(id)
    } finally {
      this.pendingSenders.delete(id)
    }
    // Exactly the files the user picked out of the ones this device's own
    // screening left standing. A file screened out was never on offer, so it can
    // never be chosen.
    const chosen = decision.kind === 'acceptSome'
      ? accepted.filter(entry => decision.fileIds.includes(entry.id))
      : accepted
    if (decision.kind === 'decline' || chosen.length === 0) {
      this.host.registry.update(id, (transfer) => {
        transfer.status = 'declined'
        for (const file of transfer.files) {
          if (file.status === 'offered') file.status = 'declined'
        }
      })
      // A withdrawal by the sender and a refusal by the user are both 403, and
      // the message is the only thing that tells them apart on the wire.
      const withdrawn = this.senderCancelled.delete(id)
      fail(response, STATUS.forbidden, withdrawn ? MESSAGE.cancelledBySender : MESSAGE.rejected)
      return
    }

    // A file the user left unticked is `skipped` rather than `declined`, and
    // the difference is the whole reason for the second status: this device was
    // not refused anything by anybody, so a batch that arrived whole must not be
    // reported as "partly done" because the user chose to take less.
    const chosenIds = new Set(chosen.map(entry => entry.id))
    for (const entry of accepted) {
      if (chosenIds.has(entry.id)) continue
      this.host.registry.updateFile(id, entry.id, (file) => {
        file.status = 'skipped'
        delete file.error
      })
    }

    // Tokens are minted only now, so a token cannot exist for a transfer the
    // user has not accepted — there is no window in which a guessed session id
    // is worth anything.
    const tokens = new Map<string, string>()
    for (const entry of chosen) tokens.set(entry.id, randomUUID())
    // The receive directory is materialized here rather than at preparation: a
    // user who declines every offer should not have a directory created for the
    // transfer they refused.
    const directory = this.receiveDirectory()
    this.sessions.set(id, {
      id,
      remoteAddress,
      tokens,
      files: new Map(chosen.map(entry => [entry.id, entry])),
      claimed: this.claimedOnDisk(directory),
      acceptedBytes: chosen.reduce((sum, entry) => sum + entry.size, 0),
      cancelled: false,
      staging: new Set(),
      active: new Set(),
    })
    this.host.registry.update(id, (transfer) => {
      transfer.status = 'transferring'
      for (const file of transfer.files) {
        if (file.status === 'offered') file.status = 'transferring'
      }
    })
    const files: Record<string, string> = {}
    for (const [fileId, token] of tokens) files[fileId] = token
    json(response, STATUS.ok, { sessionId: id, files })
  }

  /**
   * Wait for the user's answer on one offer.
   *
   * The timeout is the point: a sender holding an open connection deserves an
   * answer even if nobody is looking at the panel, and "nobody answered" has to
   * resolve to refusal rather than to a request that never ends.
   *
   * @param id - registry row id.
   * @returns what the user decided.
   */
  private async awaitDecision(id: string): Promise<OfferDecision> {
    const decision = this.host.registry.await(id)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<OfferDecision>((resolve) => {
      timer = setTimeout(() => { resolve({ kind: 'decline' }) }, APPROVAL_TIMEOUT_MS)
      timer.unref()
    })
    try {
      return await Promise.race([decision, timeout])
    } finally {
      // The registry's own resolver is settled by whoever won, or left to the
      // plugin's unload; clearing the timer is this frame's only cleanup.
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * Apply the configured ceilings to a prepared batch.
   *
   * @param entries - offered files.
   * @param config - configuration in effect.
   * @returns a reason per refused file id; absent means accepted.
   */
  private screen(
    entries: readonly FileMetadata[],
    config: LocalSendConfig,
  ): Map<string, string> {
    const refused = new Map<string, string>()
    if (entries.length > config.maxFiles) {
      for (const entry of entries.slice(config.maxFiles)) {
        refused.set(entry.id, `too many files (limit ${String(config.maxFiles)})`)
      }
    }
    let total = 0
    for (const entry of entries.slice(0, config.maxFiles)) {
      if (entry.size > config.maxFileBytes) {
        refused.set(entry.id, `file is larger than the ${formatBytes(config.maxFileBytes)} limit`)
        continue
      }
      total += entry.size
      if (total > config.maxTransferBytes) {
        refused.set(entry.id, `transfer exceeds the ${formatBytes(config.maxTransferBytes)} limit`)
      }
    }
    return refused
  }

  /**
   * Whether another transfer currently owns this device.
   * @returns whether any transfer is awaiting a decision or moving bytes.
   */
  private busy(): boolean {
    return this.host.registry.busy()
  }

  /**
   * Whether an address has exhausted its PIN attempts.
   * @param address - source address of the request.
   * @returns whether further attempts are refused outright.
   */
  private pinBlocked(address: string): boolean {
    return (this.pinFailures.get(address) ?? 0) >= MAX_PIN_ATTEMPTS
  }

  /**
   * Record one failed PIN attempt.
   * @param address - source address of the request.
   */
  private recordPinFailure(address: string): void {
    this.pinFailures.set(address, (this.pinFailures.get(address) ?? 0) + 1)
  }

  /** The directory received files are written to, created if needed. */
  private receiveDirectory(): string {
    const config = this.host.config()
    const paths = this.host.paths
    ensureDirectories(paths)
    const directory = receiveDirectory(config, paths)
    if (directory !== paths.inbox) ensureDirectories({ ...paths, inbox: directory, partial: join(directory, '.partial') })
    return directory
  }

  /**
   * Names already present in the receive directory.
   *
   * Read once per session rather than per file, so a batch keeps its own
   * collision bookkeeping in memory and two files in one batch cannot both be
   * given the same name by racing each other.
   *
   * @param directory - the receive directory.
   * @returns the set of names in use.
   */
  private claimedOnDisk(directory: string): Set<string> {
    const claimed = new Set<string>()
    try {
      for (const entry of readdirSync(directory)) claimed.add(entry)
    } catch {
      // A directory that cannot be listed is a directory that cannot collide.
    }
    return claimed
  }

  /**
   * Receive one file's bytes.
   *
   * @param request - the sender's request, whose body is the file.
   * @param response - response to answer on.
   * @param url - parsed request URL, carrying session, file, and token.
   */
  private async handleUpload(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const sessionId = url.searchParams.get('sessionId')
    const fileId = url.searchParams.get('fileId')
    const token = url.searchParams.get('token')
    if (sessionId === null || fileId === null || token === null) {
      fail(response, STATUS.badRequest, MESSAGE.missingParameters)
      return
    }
    const session = this.sessions.get(sessionId)
    // An unknown session, a token that does not match, and a token presented
    // from the wrong address are one condition in this API: the sender's remedy
    // is identical, and distinguishing them would tell a prober which of its
    // guesses was closest.
    if (session === undefined) {
      fail(response, STATUS.forbidden, MESSAGE.invalidToken)
      return
    }
    if (remoteAddressOf(request) !== session.remoteAddress) {
      fail(response, STATUS.forbidden, MESSAGE.invalidToken)
      return
    }
    if (session.tokens.get(fileId) !== token) {
      fail(response, STATUS.forbidden, MESSAGE.invalidToken)
      return
    }
    const metadata = session.files.get(fileId)
    if (metadata === undefined) {
      fail(response, STATUS.forbidden, MESSAGE.invalidToken)
      return
    }

    await this.writes.acquire()
    try {
      await this.receiveFile(request, response, session, metadata)
    } finally {
      this.writes.release()
    }
  }

  /**
   * Stream one upload to disk.
   *
   * The write goes to a random staging name and is renamed only once the bytes
   * have been verified, so a complete-looking file in the receive directory is
   * always a file that arrived whole. The checksum is computed as the bytes flow
   * past rather than in a second pass, which is what keeps a multi-gigabyte file
   * to one read of the stream.
   *
   * @param request - the sender's request.
   * @param response - response to answer on.
   * @param session - the session the token belongs to.
   * @param metadata - the file's agreed metadata.
   */
  private async receiveFile(
    request: IncomingMessage,
    response: ServerResponse,
    session: ServerSession,
    metadata: FileMetadata,
  ): Promise<void> {
    const config = this.host.config()
    const directory = this.receiveDirectory()
    const safeName = isSafeFileName(metadata.fileName)
      ? metadata.fileName
      : `received-${randomUUID().slice(0, 8)}`
    const finalName = uniqueFileName(safeName, session.claimed)
    session.claimed.add(finalName)
    const destination = join(directory, finalName)
    const staging = join(directory, '.partial', randomUUID())
    const inFlight: ActiveUpload = { request, response }
    session.staging.add(staging)
    session.active.add(inFlight)

    const hash = createHash('sha256')
    const stream = createWriteStream(staging)
    let received = 0
    let aborted: number | undefined
    try {
      for await (const chunk of request) {
        // A session the user stopped while this file was arriving. Checked here
        // rather than once before the loop because stopping has to reach a file
        // that is still being written, and it is the only moment the answer can
        // change.
        if (session.cancelled) {
          aborted = STATUS.conflict
          break
        }
        const buffer = chunk as Buffer
        received += buffer.length
        // The agreed size is the ceiling, not the announced one: a sender that
        // lied in its metadata cannot use that lie to write past the limit it
        // was screened against.
        if (received > metadata.size || received > config.maxFileBytes) {
          aborted = STATUS.badRequest
          break
        }
        hash.update(buffer)
        if (!stream.write(buffer)) await once(stream, 'drain')
      }
      if (aborted === undefined) {
        await new Promise<void>((resolve, reject) => {
          stream.end((error?: Error | null) => {
            if (error !== undefined && error !== null) reject(error)
            else resolve()
          })
        })
      }
    } catch (error: unknown) {
      stream.destroy()
      rmSync(staging, { force: true })
      // A request destroyed by a cancel arrives here as an exception, so the two
      // causes have to be told apart: only one of them is the sender's problem,
      // and they want different answers.
      if (session.cancelled) {
        if (!response.headersSent) fail(response, STATUS.conflict, 'the transfer was stopped')
        return
      }
      this.failFile(session.id, metadata.id, describe(error))
      if (!response.headersSent) fail(response, STATUS.serverError, MESSAGE.internal)
      return
    } finally {
      session.staging.delete(staging)
      session.active.delete(inFlight)
    }

    if (aborted !== undefined) {
      stream.destroy()
      rmSync(staging, { force: true })
      // Two conditions share this exit and they are not the same thing to say: a
      // sender that overran its own metadata is at fault, while a file stopped
      // by the user is not.
      if (session.cancelled) {
        if (!response.headersSent) fail(response, aborted, 'the transfer was stopped')
        return
      }
      const reason = 'the sender sent more bytes than it offered'
      this.failFile(session.id, metadata.id, reason)
      // A descriptive message rather than one of the spec's fixed strings: this
      // condition has no assigned string, and the client falls back to whatever
      // the body says, so saying what actually happened is strictly more useful.
      if (!response.headersSent) fail(response, aborted, reason)
      return
    }

    const expected = metadata.sha256
    if (expected !== undefined && expected !== null && expected.length > 0) {
      const actual = hash.digest('hex')
      // Case-insensitive: the spec does not fix the case of a hex digest and
      // senders on different platforms disagree.
      if (actual.toLowerCase() !== expected.toLowerCase()) {
        rmSync(staging, { force: true })
        // `422` is the one code the spec reserves for exactly this, and a sender
        // that sees it knows the bytes were corrupted rather than refused.
        this.failFile(session.id, metadata.id, 'checksum mismatch')
        fail(response, STATUS.unprocessable, MESSAGE.checksumMismatch)
        return
      }
    }

    try {
      renameSync(staging, destination)
    } catch (error: unknown) {
      rmSync(staging, { force: true })
      this.failFile(session.id, metadata.id, describe(error))
      fail(response, STATUS.serverError, MESSAGE.internal)
      return
    }
    // Timestamps are advisory: failing to apply them must not fail a file that
    // is already safely on disk.
    try {
      const modified = metadata.metadata?.modified
      if (modified !== undefined && modified !== null) {
        const when = new Date(modified)
        if (!Number.isNaN(when.getTime())) utimesSync(destination, when, when)
      }
    } catch {
      // Advisory only.
    }

    this.host.registry.updateFile(session.id, metadata.id, (file) => {
      file.status = 'done'
      file.bytesDone = file.size
      file.savedPath = destination
      // A checksum retry reuses the same token and file row, so clearing the
      // message is what stops a file that eventually succeeded from still
      // showing the failure it recovered from.
      delete file.error
    })
    session.acceptedBytes -= metadata.size
    empty(response, STATUS.ok)
    if (session.acceptedBytes <= 0) this.finishSession(session)
  }

  /**
   * Mark one file failed and record why.
   * @param transferId - registry row id.
   * @param fileId - the file's id.
   * @param reason - message to show the user.
   */
  private failFile(transferId: string, fileId: string, reason: string): void {
    // A file stopped by the user has not failed, and the row already says so:
    // writing a failure over a cancelled transfer would present the user's own
    // decision as something that went wrong.
    if (this.host.registry.get(transferId)?.status === 'canceled') return
    this.host.registry.updateFile(transferId, fileId, (file) => {
      file.status = 'failed'
      file.error = reason
    })
  }

  /**
   * Stop serving one incoming transfer.
   *
   * The whole of "cancel a receive": the session leaves the table so no further
   * upload is authorised, the sessions already being written are told to stop,
   * their staging files are removed so a partial never sits in the receive
   * directory, and the registry row is settled as canceled.
   *
   * @param id - the session, which is also the registry row id.
   * @returns whether a session was actually being served.
   */
  cancelSession(id: string): boolean {
    const session = this.sessions.get(id)
    if (session === undefined) return false
    // Set before the delete, so an upload already inside its write loop sees it
    // on its next chunk rather than racing the table.
    session.cancelled = true
    this.sessions.delete(id)
    // Answered, then disconnected, in that order: the sender is owed a reason,
    // and a request destroyed first would take its response with it. This is
    // also what unblocks a loop waiting on a sender that has gone quiet — the
    // case a per-chunk check alone cannot reach.
    for (const inFlight of session.active) {
      if (!inFlight.response.headersSent) {
        fail(inFlight.response, STATUS.conflict, 'the transfer was stopped')
      }
      inFlight.request.destroy()
    }
    for (const metadata of session.files.values()) {
      this.host.registry.updateFile(id, metadata.id, (file) => {
        if (file.status !== 'done') file.status = 'declined'
      })
    }
    for (const staging of session.staging) rmSync(staging, { force: true })
    session.staging.clear()
    this.host.registry.cancel(id)
    return true
  }

  /**
   * Close a session whose accepted bytes have all arrived.
   *
   * The remaining `acceptedBytes` is the completion signal rather than a count
   * of finished files, because a file that failed has no bytes to give and
   * waiting for it would leave the session open forever.
   *
   * @param session - the session to settle.
   */
  private finishSession(session: ServerSession): void {
    this.sessions.delete(session.id)
    this.host.registry.settle(session.id)
  }

  /**
   * Cancel a session on the sender's request.
   *
   * @param response - response to answer on.
   * @param url - parsed request URL carrying the session id.
   */
  private handleCancel(request: IncomingMessage, response: ServerResponse, url: URL): void {
    const sessionId = url.searchParams.get('sessionId')
    const remoteAddress = remoteAddressOf(request)

    // A sender on protocol 2.0–2.2 does not learn the session id until the
    // preparation response arrives, so one that gives up while the user is still
    // deciding has nothing to quote back and cancels by address alone. Without
    // this the offer would sit in front of the user for a transfer nobody is
    // waiting on any more, and — because the slot is single — block the next one.
    if (sessionId === null) {
      for (const [id, pendingAddress] of this.pendingSenders) {
        if (pendingAddress !== remoteAddress) continue
        this.senderCancelled.add(id)
        this.host.registry.decide(id, { kind: 'decline' })
      }
      empty(response, STATUS.ok)
      return
    }

    // The same withdrawal, but by a sender that did get the id back.
    if (this.pendingSenders.get(sessionId) === remoteAddress) {
      this.senderCancelled.add(sessionId)
      this.host.registry.decide(sessionId, { kind: 'decline' })
      empty(response, STATUS.ok)
      return
    }

    // A withdrawal and the user's own cancel end a session the same way, so
    // there is one teardown. The deleted entry is what tells the two apart
    // afterwards: `senderCancelled` is only consulted while a decision is still
    // pending, and by here the sender has already been answered.
    if (this.sessions.get(sessionId)?.remoteAddress === remoteAddress) {
      this.cancelSession(sessionId)
    }
    // A cancel for a session this device does not know is still a success: the
    // reference implementation answers 200 for unknown sessions, and a sender
    // retrying a cancel it already delivered must not see an error.
    empty(response, STATUS.ok)
  }
}

/**
 * A shallow identity read used by `register`.
 *
 * `register` is a two-way hello whose body is a {@link DeviceInfo}, and the
 * protocol module already owns the only narrowing of that shape — this is a
 * named alias rather than a second definition, so the server and the discovery
 * loop cannot disagree about what a valid peer looks like.
 *
 * @param value - parsed request body.
 * @returns the identity, or `undefined`.
 */
const readDeviceInfoShallow = readDeviceInfo

/** Format a byte count for a message a person reads. */
function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit] ?? 'B'}`
}
