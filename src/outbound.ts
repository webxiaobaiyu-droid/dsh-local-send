/**
 * The sending half: this device offering files to a peer.
 *
 * The wire sequence is the spec's two-step handshake — offer metadata, wait to
 * be accepted, then send each accepted file's bytes — and it is split here
 * exactly where the protocol splits it, because the gap between the two steps is
 * the point: nothing is uploaded until the person on the other device has agreed
 * to receive it. {@link prepareOffer} and {@link uploadStream} are that split,
 * exposed separately because this plugin has two ways to be handed a file and
 * they resolve at different moments:
 *
 * - A file already on this machine is knowable up front, so {@link sendPaths}
 *   runs the whole handshake in one call.
 * - A file dropped on the panel arrives as a browser upload, and its bytes only
 *   exist while that request is open. The panel therefore prepares first
 *   ({@link prepareOffer}), then streams each file's body straight through
 *   ({@link uploadStream}) — which is what keeps a drag-and-drop send to a single
 *   pass over the bytes, with no staging copy on disk.
 *
 * Two other decisions are worth naming:
 *
 * - **Uploads are bounded, not serialized.** The spec allows `upload` in
 *   parallel and the reference implementation runs two at a time. Two is kept
 *   here: one stream cannot saturate a link whose bottleneck is the sender's
 *   disk, and more than a few would interleave seeks on that disk and finish
 *   every file later than they started. Files are picked up as slots free, so a
 *   slow file never holds up a queue.
 * - **A rejection is data, not an error.** The peer's status is translated into a
 *   per-file outcome, so a transfer where one file was refused still sends the
 *   rest and the panel can show which one was turned down.
 *
 * @module dsh-local-send/outbound
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import {
  MESSAGE,
  STATUS,
  apiUrl,
  peerOrigin,
  uniqueFileName,
  type DeviceInfo,
  type FileMetadata,
  type PrepareUploadResponse,
  type TransferProtocol,
} from './protocol.ts'
import type { TransferRegistry } from './transfer.ts'

/**
 * Files at or below this size get a SHA-256 in their offer.
 *
 * The digest must be known before the offer is made, so offering one costs a
 * full extra read of the file. That is nothing for a document and minutes for a
 * video, and integrity across one LAN segment is already carried by the
 * transport — so the cost is paid where it is invisible and skipped where it is
 * not. The receiver is told either way: a file with no `sha256` is one nobody
 * claimed a digest for, which is a different statement from one that failed.
 */
export const HASH_LIMIT_BYTES = 256 * 1024 * 1024

/**
 * Concurrent `upload` calls, matching the reference implementation.
 *
 * Public because the staging routes must apply the same ceiling when several
 * files are streamed from the panel at once.
 */
export const UPLOAD_CONCURRENCY = 2

/** How long a preparation may take before the peer is treated as unresponsive. */
const PREPARE_TIMEOUT_MS = 30_000

/** The peer a transfer is addressed to. */
export interface OutboundPeer {
  /** Stable key of the peer, for the registry row. */
  readonly fingerprint: string
  /** Display name of the peer. */
  readonly alias: string
  /** Address the peer is reachable at. */
  readonly host: string
  /** Port the peer's API is on. */
  readonly port: number
  /** Transport the peer's API is served over. */
  readonly protocol: TransferProtocol
  /** Device class, for the row's icon. */
  readonly deviceType: DeviceInfo['deviceType'] | null
}

/** Callbacks the sender reports through. */
export interface OutboundHandlers {
  /** The shared table every outcome is written to. */
  readonly registry: TransferRegistry
  /** Log sink for conditions worth recording but not failing on. */
  readonly warn: (message: string) => void
}

/**
 * One accepted offer, ready for its bytes.
 *
 * Kept by whoever is driving the transfer, because the tokens in it are the
 * only thing that authorises an upload and they are minted once.
 */
export interface PreparedOffer {
  /** Registry row every outcome reports against. */
  readonly transferId: string
  /** Session id the peer expects on each upload. */
  readonly sessionId: string
  /** The peer's API origin. */
  readonly origin: string
  /** Per-file access tokens, keyed by file id. */
  readonly tokens: Readonly<Record<string, string>>
  /** Files the peer accepted, keyed by file id. */
  readonly accepted: ReadonlyMap<string, FileMetadata>
  /** Files the peer left out of its token map, with the reason to show. */
  readonly declined: readonly { readonly id: string; readonly reason: string }[]
}

/** What one whole sending attempt produced. */
export interface OutboundOutcome {
  /** Registry row id. */
  readonly transferId: string
  /** Whether the peer accepted the offer at all. */
  readonly accepted: boolean
  /** Files that reached the peer, by file id. */
  readonly sent: readonly string[]
  /** Files refused or failed, by file id, with the reason. */
  readonly failed: readonly { readonly id: string; readonly reason: string }[]
}

/** One file's resolved metadata plus where to read it. */
interface ResolvedFile {
  readonly metadata: FileMetadata
  readonly source: { readonly kind: 'path'; readonly path: string }
}

/** One line describing an error, for a log line or a row's message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Guess a MIME type from a file name.
 *
 * A deliberate short list rather than a dependency: the field exists so the
 * receiving device can pick an icon and decide what opens the file, and the
 * common cases on a developer's machine are covered by a table this size. An
 * unknown extension becomes `application/octet-stream`, which is what the spec's
 * own senders fall back to.
 *
 * @param name - the file's base name.
 * @returns the guessed MIME type.
 */
export function mimeTypeOf(name: string): string {
  const extension = extname(name).toLowerCase()
  const table: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.heic': 'image/heic',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return table[extension] ?? 'application/octet-stream'
}

/**
 * Hash a file in one pass.
 * @param path - absolute path to read.
 * @returns the lowercase hex SHA-256.
 */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Resolve one file on disk into the metadata the handshake needs.
 *
 * The size is read here rather than during upload because it has to be in the
 * offer: the receiver screens it against its own limits before deciding, and a
 * size discovered mid-stream would be discovered too late to decline.
 *
 * @param id - identifier to offer the file under.
 * @param path - absolute path to read.
 * @returns the resolved file, or a reason it cannot be sent.
 */
async function resolvePath(
  id: string,
  path: string,
): Promise<ResolvedFile | { readonly error: string }> {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return { error: `${basename(path)} is not a regular file` }
    return {
      metadata: {
        id,
        fileName: basename(path),
        size: stats.size,
        fileType: mimeTypeOf(path),
        sha256: stats.size <= HASH_LIMIT_BYTES ? await hashFile(path) : null,
        metadata: { modified: stats.mtime.toISOString() },
      },
      source: { kind: 'path', path },
    }
  } catch (error: unknown) {
    return { error: describe(error) }
  }
}

/**
 * Narrow a preparation response.
 *
 * Validated rather than trusted for the same reason every other peer-supplied
 * shape is: this device answers to whatever is on the network, and a token map
 * that is not a map of strings would poison the upload loop rather than fail it.
 *
 * @param value - parsed response body.
 * @returns the session id and tokens, or `undefined`.
 */
function readPrepareResponse(value: unknown): PrepareUploadResponse | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const sessionId = raw['sessionId']
  const files = raw['files']
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  if (typeof files !== 'object' || files === null) return undefined
  const tokens: Record<string, string> = {}
  for (const [key, entry] of Object.entries(files as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.length > 0) tokens[key] = entry
  }
  return { sessionId, files: tokens }
}

/**
 * Read a preparation refusal into something a person can read.
 *
 * The body is `{"message": "..."}` by contract, and the reference client falls
 * back to the raw text when it is not — worth copying, because those messages
 * are the only place a receiving device explains itself.
 *
 * @param response - the failed response.
 * @returns a message for the transfer row.
 */
async function readFailure(response: Response): Promise<string> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message
      if (typeof message === 'string') detail = message
    }
  } catch {
    detail = ''
  }
  if (detail.length === 0) {
    detail = response.status === STATUS.unauthorized
      ? MESSAGE.pinRequired
      : `HTTP ${String(response.status)}`
  }
  return detail
}

/**
 * Open a transfer row for files about to be offered.
 *
 * Separate from the handshake on purpose. A caller may know before it offers
 * anything that some files are unusable — a path that does not exist, a name it
 * cannot read — and the row must still account for every file the user asked to
 * move. Opening the row over the full roster is what makes that possible: a
 * transfer that quietly shows fewer files than were requested is worse than one
 * that shows a failure.
 *
 * @param peer - the device the transfer is addressed to.
 * @param roster - every file the user asked to move, in order.
 * @param registry - the shared table.
 * @returns the new row's id.
 */
export function openRow(
  peer: OutboundPeer,
  roster: readonly FileMetadata[],
  registry: TransferRegistry,
): string {
  return registry.openOutgoing({
    peerAlias: peer.alias,
    peerFingerprint: peer.fingerprint,
    peerAddress: peer.host,
    peerType: peer.deviceType ?? null,
    files: roster.map(file => ({
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      fileType: file.fileType,
    })),
  })
}

/**
 * Offer files to a peer and read its answer.
 *
 * This stops at the handshake: what comes back is the authority to upload, not
 * the upload. A refusal is reported rather than thrown, because "they said no",
 * "they were busy" and "they wanted a PIN" are three different things to show a
 * user and none of them is an exception.
 *
 * @param peer - the device to send to.
 * @param transferId - the already-open row this offer belongs to.
 * @param files - metadata to offer, already sized.
 * @param self - this device's identity, sent in the preparation body.
 * @param registry - the shared table.
 * @returns the prepared offer, or the reason there is none.
 */
export async function offerToPeer(
  peer: OutboundPeer,
  transferId: string,
  files: readonly FileMetadata[],
  self: DeviceInfo,
  registry: TransferRegistry,
): Promise<PreparedOffer | { readonly refused: string }> {
  const origin = peerOrigin(peer, peer.host)
  const offered: Record<string, FileMetadata> = {}
  for (const file of files) offered[file.id] = file

  let prepared: PrepareUploadResponse
  try {
    const response = await fetch(apiUrl(origin, 'prepare-upload'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ info: self, files: offered }),
      signal: AbortSignal.timeout(PREPARE_TIMEOUT_MS),
    })
    // `204` is a success that means "accepted, but nothing to send" — the spec's
    // signal for a transfer with no files left once the receiver filtered them.
    // A sender that sees it must not call `upload`.
    if (response.status === STATUS.noContent) {
      await response.arrayBuffer()
      return { refused: 'the receiving device accepted nothing' }
    }
    if (!response.ok) return { refused: await readFailure(response) }
    const parsed = readPrepareResponse(await response.json() as unknown)
    if (parsed === undefined) return { refused: 'the receiving device sent an unreadable response' }
    prepared = parsed
  } catch (error: unknown) {
    return { refused: describe(error) }
  }

  // A file the receiver left out of its token map was refused, and that omission
  // is the only signal the protocol carries for a per-file rejection.
  const accepted = new Map<string, FileMetadata>()
  const declined: { id: string; reason: string }[] = []
  for (const file of files) {
    const token = prepared.files[file.id]
    if (token === undefined || token.length === 0) {
      declined.push({ id: file.id, reason: 'declined by the receiving device' })
      registry.updateFile(transferId, file.id, (row) => { row.status = 'declined' })
      continue
    }
    accepted.set(file.id, file)
  }
  return {
    transferId,
    sessionId: prepared.sessionId,
    origin,
    tokens: prepared.files,
    accepted,
    declined,
  }
}

/**
 * Offer files and open the row for them, for a caller with nothing to pre-record.
 *
 * The panel's path: it holds browser files whose sizes it already knows and has
 * no earlier failure to report, so one call is the whole of it.
 *
 * @param peer - the device to send to.
 * @param files - metadata to offer.
 * @param self - this device's identity.
 * @param handlers - registry and log sink.
 * @returns the prepared offer, or an outcome describing why there is none.
 */
export async function prepareOffer(
  peer: OutboundPeer,
  files: readonly FileMetadata[],
  self: DeviceInfo,
  handlers: OutboundHandlers,
): Promise<PreparedOffer | { readonly refused: OutboundOutcome }> {
  const registry = handlers.registry
  const transferId = openRow(peer, files, registry)
  const result = await offerToPeer(peer, transferId, files, self, registry)
  if ('refused' in result) {
    registry.fail(transferId, result.refused)
    return { refused: { transferId, accepted: false, sent: [], failed: [] } }
  }
  return result
}

/**
 * Send one accepted file's bytes.
 *
 * Progress is counted from the source stream as it passes, so the figure the
 * panel shows is bytes actually handed to the socket — the one number that
 * cannot be wrong about how far along the transfer is.
 *
 * @param offer - the prepared offer this file belongs to.
 * @param fileId - which file of the offer.
 * @param source - the bytes to send.
 * @param registry - the shared table to report progress against.
 */
export async function uploadStream(
  offer: PreparedOffer,
  fileId: string,
  source: Readable,
  registry: TransferRegistry,
): Promise<void> {
  const token = offer.tokens[fileId]
  const metadata = offer.accepted.get(fileId)
  if (token === undefined || metadata === undefined) {
    throw new Error(`file ${fileId} was not accepted by the receiving device`)
  }
  const url = new URL(apiUrl(offer.origin, 'upload'))
  url.searchParams.set('sessionId', offer.sessionId)
  url.searchParams.set('fileId', fileId)
  url.searchParams.set('token', token)

  let moved = 0
  /**
   * The source, with each chunk counted as it passes.
   *
   * An async generator rather than a pass-through: `Readable.from` pulls one
   * chunk at a time and only when the socket is ready for it, so a
   * multi-gigabyte file occupies one buffer instead of accumulating in memory.
   */
  async function* counted(): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      const buffer = chunk as Buffer
      moved += buffer.length
      registry.updateFile(offer.transferId, fileId, (row) => {
        row.bytesDone = moved
      })
      yield buffer
    }
  }

  // `duplex: 'half'` is required for a streamed request body: without it Node
  // would also try to end the readable side, and a body that closes early
  // truncates the upload at whatever the peer had received. The init object is
  // typed rather than inlined because TypeScript's `RequestInit` predates the
  // `duplex` member Node requires, and an inline literal carrying it is rejected.
  const init: RequestInit & { readonly duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Readable.toWeb(Readable.from(counted())) as unknown as BodyInit,
    duplex: 'half',
  }
  const response = await fetch(url, init)
  await response.arrayBuffer()
  if (!response.ok) {
    throw new Error(
      `HTTP ${String(response.status)}${response.status === STATUS.unprocessable ? ' (checksum mismatch)' : ''}`,
    )
  }
  registry.updateFile(offer.transferId, fileId, (row) => {
    row.status = 'done'
    row.bytesDone = row.size
    delete row.error
  })
}

/**
 * Tell a peer to forget an offer this device has stopped working on.
 *
 * The protocol's session ends when every accepted file arrives, when the sender
 * cancels, or when the receiver's own state goes away. A sender that gives up
 * partway — a file that failed to read, a connection that dropped — therefore
 * has to say so, or the receiver keeps a session open for a transfer nobody is
 * sending: it holds the staging bookkeeping, and because the protocol allows
 * only one live session it would refuse the next sender with `409`.
 *
 * Best-effort by contract. A peer that has already gone away is exactly the case
 * this is most often called in, and failing to deliver a cancellation to a
 * device that is not listening changes nothing.
 *
 * @param offer - the offer being abandoned.
 * @param warn - log sink, for a cancellation that could not be delivered.
 */
export async function cancelOffer(
  offer: PreparedOffer,
  warn: (message: string) => void,
): Promise<void> {
  try {
    const response = await fetch(
      `${apiUrl(offer.origin, 'cancel')}?sessionId=${encodeURIComponent(offer.sessionId)}`,
      { method: 'POST', signal: AbortSignal.timeout(5_000) },
    )
    await response.arrayBuffer()
  } catch (error: unknown) {
    warn(`could not cancel the transfer with the receiving device: ${describe(error)}`)
  }
}

/**
 * Record one file's failure against its row.
 * @param registry - the shared table.
 * @param transferId - the transfer the file belongs to.
 * @param fileId - the file's id.
 * @param reason - message to show the user.
 */
export function markFileFailed(
  registry: TransferRegistry,
  transferId: string,
  fileId: string,
  reason: string,
): void {
  registry.updateFile(transferId, fileId, (row) => {
    row.status = 'failed'
    row.error = reason
  })
}

/**
 * Send files that already exist on this machine, start to finish.
 *
 * The one-shot path: sizes and digests are read from disk, the offer goes out,
 * and the accepted files are uploaded from their own paths under a bounded pool.
 *
 * The row is opened over every path the user named, before anything is read, so
 * a path that turns out to be missing is a failure recorded against its own file
 * rather than a file that silently never existed.
 *
 * @param peer - the device to send to.
 * @param paths - absolute paths to offer.
 * @param self - this device's identity.
 * @param handlers - registry and log sink.
 * @returns what the attempt produced.
 */
export async function sendPaths(
  peer: OutboundPeer,
  paths: readonly string[],
  self: DeviceInfo,
  handlers: OutboundHandlers,
): Promise<OutboundOutcome> {
  const registry = handlers.registry
  const names = offerIdsFor(paths)

  /** One row per path, sized where it could be read so the roster total is honest. */
  const roster: FileMetadata[] = []
  const resolved = new Map<string, ResolvedFile>()
  const failed: { id: string; reason: string }[] = []
  for (const [index, path] of paths.entries()) {
    const named = names[index]
    if (named === undefined) continue
    const result = await resolvePath(named.id, path)
    if ('error' in result) {
      failed.push({ id: named.id, reason: result.error })
      // Zero bytes because nothing was measured: the file could not be read, so
      // any size here would be a claim this device cannot support.
      roster.push({
        id: named.id,
        fileName: named.fileName,
        size: 0,
        fileType: mimeTypeOf(path),
      })
      continue
    }
    resolved.set(named.id, result)
    roster.push(result.metadata)
  }

  const transferId = openRow(peer, roster, registry)
  for (const failure of failed) markFileFailed(registry, transferId, failure.id, failure.reason)

  if (resolved.size === 0) {
    registry.settle(transferId)
    return { transferId, accepted: false, sent: [], failed }
  }

  const offered = [...resolved.values()].map(file => file.metadata)
  const prepared = await offerToPeer(peer, transferId, offered, self, registry)
  if ('refused' in prepared) {
    registry.fail(transferId, prepared.refused)
    return { transferId, accepted: false, sent: [], failed }
  }
  for (const decline of prepared.declined) failed.push(decline)

  const queue = [...prepared.accepted.keys()]
  const sent: string[] = []
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
    async () => {
      while (cursor < queue.length) {
        const index = cursor
        cursor += 1
        const fileId = queue[index]
        if (fileId === undefined) continue
        const file = resolved.get(fileId)
        if (file === undefined) continue
        try {
          await uploadStream(prepared, fileId, createReadStream(file.source.path), registry)
          sent.push(fileId)
        } catch (error: unknown) {
          const reason = describe(error)
          failed.push({ id: fileId, reason })
          markFileFailed(registry, transferId, fileId, reason)
        }
      }
    },
  )
  await Promise.all(workers)
  // A batch the sender has stopped working on is withdrawn, so the receiver is
  // not left holding a session for files that will never arrive.
  if (failed.length > 0) await cancelOffer(prepared, handlers.warn)
  registry.settle(transferId)
  return { transferId, accepted: true, sent, failed }
}


/**
 * Turn a list of paths into offered file identifiers and names.
 *
 * Shared by every entry point that sends local files, so the naming rule — a
 * base name, deduplicated against the rest of the batch — is applied once. Two
 * different directories can each hold `report.pdf`, and a batch carrying both
 * would otherwise ask the receiver to save one over the other.
 *
 * @param paths - absolute paths to offer.
 * @returns one entry per path, in order.
 */
export function offerIdsFor(paths: readonly string[]): { id: string; fileName: string }[] {
  const claimed = new Set<string>()
  return paths.map((path, index) => {
    const raw = basename(path)
    const fileName = uniqueFileName(raw.length > 0 ? raw : `file-${String(index + 1)}`, claimed)
    claimed.add(fileName)
    return { id: `f${String(index + 1)}`, fileName }
  })
}

/**
 * The metadata a panel-supplied file is offered under.
 *
 * Unlike a path, the panel already knows the size, so nothing is read here —
 * this only fills in the fields the handshake requires that the browser has no
 * opinion about.
 *
 * @param id - identifier the panel assigned.
 * @param fileName - name to send.
 * @param size - byte count the panel reported.
 * @returns the offer metadata.
 */
export function metadataForUpload(id: string, fileName: string, size: number): FileMetadata {
  return {
    id,
    fileName,
    size,
    fileType: mimeTypeOf(fileName),
    // No digest: the receiver would have to be told before the bytes exist, and
    // the panel's file is only read once, straight through to the peer.
    sha256: null,
  }
}
