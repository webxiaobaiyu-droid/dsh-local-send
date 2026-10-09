/**
 * The LocalSend wire protocol, as data and pure functions.
 *
 * Everything here is the v2.2 REST contract from `localsend/protocol`, kept in
 * one module with no I/O so both halves of an exchange — the server that answers
 * another device and the client that calls one — validate against the same
 * definitions instead of drifting apart.
 *
 * Two properties of this module are deliberate:
 *
 * 1. **Every field that arrives from the network is optional until proven
 *    otherwise.** A peer on the LAN is untrusted input. The `read*` functions
 *    below narrow `unknown` into the shapes the rest of the plugin uses, and
 *    they never throw: a malformed announcement costs one peer row, never the
 *    discovery loop. Where the spec marks a field nullable, the reader keeps
 *    `null` and `undefined` distinct so a re-serialized payload round-trips.
 *
 * 2. **No certificate.** The spec's `protocol` field exists precisely so a
 *    device that cannot present a trusted certificate can still take part, and
 *    the reference implementations honour it in both directions. Advertising
 *    `http` therefore buys full interoperability with the official apps at the
 *    cost of an unencrypted hop — a trade this plugin makes explicitly, and the
 *    one the protocol's own fingerprint rule already anticipates ("When
 *    encryption is off (HTTP), then the fingerprint is a random generated
 *    string"). {@link PROTOCOL_VERSION} is announced as what this plugin
 *    actually implements rather than as a claim of newer features.
 *
 * @module dsh-local-send/protocol
 */

/**
 * Multicast group every LocalSend member joins.
 *
 * The spec notes the default is this single address rather than the wider
 * `224.0.0.0/24` block, because some Android devices reject any other group.
 */
export const MULTICAST_GROUP = '224.0.0.167'

/** UDP and TCP port the spec reserves for discovery and the transfer API. */
export const DEFAULT_PORT = 53317

/** Path prefix of every route in the v2 API. */
export const API_PREFIX = '/api/localsend/v2'

/**
 * Protocol version announced to peers, as `major.minor`.
 *
 * This is a compatibility statement, not a vanity string: a peer that reads a
 * version it does not know may change which optional fields it sends. `2.2` is
 * the newest revision whose contract this module implements in full.
 */
export const PROTOCOL_VERSION = '2.2'

/** Device classes the spec defines; used for the icon a peer row draws. */
export const DEVICE_TYPES = ['mobile', 'desktop', 'web', 'headless', 'server'] as const

/** One of the spec's device classes. */
export type DeviceType = (typeof DEVICE_TYPES)[number]

/** Transport a peer's API is served over. */
export type TransferProtocol = 'http' | 'https'

/**
 * One device's identity, as it appears in an announcement, a `register` call,
 * and the `info` object of a upload preparation.
 *
 * The spec marks `deviceModel` and `deviceType` nullable and leaves `download`
 * optional, so the optional members mirror that exactly rather than being
 * widened to `string`: a payload this plugin re-serializes for another peer
 * keeps the distinction the sender made.
 */
export interface DeviceInfo {
  /** Human-readable device name, chosen by the device's owner. */
  alias: string
  /** Protocol version, `major.minor`. */
  version: string
  /** Model string, when the device reports one. */
  deviceModel?: string | null | undefined
  /** Device class, when the device reports one. */
  deviceType?: DeviceType | null | undefined
  /**
   * Identity of the device.
   *
   * The spec overloads this field by transport: under HTTPS it is the SHA-256
   * of the peer's certificate, and under HTTP it is a random string the peer
   * generated and persisted. Either way it is the only stable key a device has
   * — the address changes with DHCP — so it is what self-discovery suppression
   * and the peer list are keyed on.
   */
  fingerprint: string
  /** TCP port the peer's API listens on. */
  port: number
  /** Transport the peer's API is served over. */
  protocol: TransferProtocol
  /** Whether the peer also serves the reverse (download) API. */
  download?: boolean | undefined
}

/**
 * A discovery datagram.
 *
 * `announce: true` is a member looking for the room, and `announce: false` is a
 * reply from a member that could not answer over HTTP. The flag is required in
 * both directions: the spec makes a reply conditional on it, which is what stops
 * two devices from answering each other forever.
 */
export interface Announcement extends DeviceInfo {
  /** Whether this datagram is an announcement rather than a reply. */
  announce: boolean
}

/**
 * One file offered in a preparation request.
 *
 * `id` is the sender's key for the file and is what the later `upload` call and
 * the returned token map are addressed by; it is not a path or a hash.
 */
export interface FileMetadata {
  /** Sender-chosen identifier, unique within the transfer. */
  id: string
  /** Base name the receiver should save under. */
  fileName: string
  /** Exact byte count the sender will send. */
  size: number
  /** MIME type, or `application/octet-stream` when the sender has none. */
  fileType: string
  /** Hex SHA-256 the receiver should verify the bytes against, when offered. */
  sha256?: string | null | undefined
  /** Thumbnail data URI; accepted and ignored — this plugin draws no previews. */
  preview?: string | null | undefined
  /** Source timestamps, preserved onto the saved file when present. */
  metadata?: FileTimes | null | undefined
}

/** Source timestamps a sender may attach to a file. */
export interface FileTimes {
  /** ISO-8601 last-modified time. */
  modified?: string | null | undefined
  /** ISO-8601 last-accessed time. */
  accessed?: string | null | undefined
}

/** Body of `POST /prepare-upload`. */
export interface PrepareUploadRequest {
  /** The sending device's own identity. */
  info: DeviceInfo
  /** Offered files, keyed by their own `id`. */
  files: Record<string, FileMetadata>
}

/** Body a receiver answers `POST /prepare-upload` with. */
export interface PrepareUploadResponse {
  /** Identifier the sender echoes on every `upload` call in this transfer. */
  sessionId: string
  /** Per-file access tokens, keyed by file id. A file absent here was refused. */
  files: Record<string, string>
}

/**
 * What `register` and `info` answer with.
 *
 * Deliberately not a {@link DeviceInfo}: both the spec's example bodies and the
 * reference implementation omit `port` and `protocol` here, because the caller
 * is already talking to this device and learned both from the connection it
 * made. `fingerprint` and `download` stay — the first is the responder's
 * identity, and the second announces a capability the caller cannot observe.
 */
export interface RegisterResponse {
  /** Human-readable device name. */
  alias: string
  /** Protocol version, `major.minor`. */
  version: string
  /** Model string, when the device reports one. */
  deviceModel?: string | null | undefined
  /** Device class, when the device reports one. */
  deviceType?: DeviceType | null | undefined
  /** The responder's identity token. */
  fingerprint: string
  /** Whether the responder serves the reverse (download) API. */
  download?: boolean | undefined
}

/**
 * Project a device's identity onto the shape `register` and `info` answer with.
 * @param info - the device's full identity.
 * @returns the reduced response body.
 */
export function registerResponse(info: DeviceInfo): RegisterResponse {
  return {
    alias: info.alias,
    version: info.version,
    fingerprint: info.fingerprint,
    ...info.deviceModel === undefined ? {} : { deviceModel: info.deviceModel },
    ...info.deviceType === undefined ? {} : { deviceType: info.deviceType },
    ...info.download === undefined ? {} : { download: info.download },
  }
}

/** Body of `POST /prepare-download`. */
export interface PrepareDownloadResponse {
  /** The serving device's identity. */
  info: DeviceInfo
  /** Identifier the downloader echoes on every `download` call. */
  sessionId: string
  /** Files on offer, keyed by their own `id`. */
  files: Record<string, FileMetadata>
}

/**
 * The exact message strings the reference implementation answers failures with.
 *
 * Every non-2xx body in this API is `{"message": "..."}` — a bare status is not
 * the contract. The strings are copied rather than paraphrased because a client
 * written against the official app may match on them, and because a peer's
 * `429`/"Too many requests" is useless to a user if this plugin renamed it.
 */
export const MESSAGE = {
  /** A body that is not JSON, or one missing a required field. */
  invalidJson: 'Invalid JSON body',
  /** A preparation or download with no files in it. */
  noFiles: 'No files provided',
  /** An upload or cancel missing one of its query parameters. */
  missingParameters: 'Missing parameters',
  /** A transfer that needs a PIN and was offered without one. */
  pinRequired: 'PIN required',
  /** A transfer that offered the wrong PIN. */
  invalidPin: 'Invalid PIN',
  /** Declined by the person at the receiving device. */
  rejected: 'Rejected',
  /** Withdrawn by the sender while the receiver was still deciding. */
  cancelledBySender: 'Cancelled by sender',
  /** An unknown session, a token that does not match, or a different source address. */
  invalidToken: 'Invalid token or IP address',
  /** Another transfer already owns this device. */
  blocked: 'Blocked by another session',
  /** Bytes did not match the offered SHA-256. */
  checksumMismatch: 'Checksum mismatch',
  /** Too many failed PIN attempts from one address. */
  tooManyRequests: 'Too many requests',
  /** Anything this device could not classify. */
  internal: 'Internal server error',
} as const

/**
 * HTTP status codes the spec assigns a meaning to.
 *
 * Named because several of them are load-bearing rather than incidental: a
 * `403` on a preparation is a person declining, `409` is a second sender
 * arriving while one is live, and `422` is the only signal that bytes were
 * corrupted in flight. The rest of the plugin switches on these constants
 * instead of on bare numbers.
 */
export const STATUS = {
  /** Preparation accepted, or work completed. */
  ok: 200,
  /** Nothing to transfer: every offered file was refused. */
  noContent: 204,
  /** Malformed body, or missing upload parameters. */
  badRequest: 400,
  /** A PIN is required, or the one supplied was wrong. */
  unauthorized: 401,
  /** Declined by the receiver, or an upload token that does not match. */
  forbidden: 403,
  /** Another session currently owns the receiver. */
  conflict: 409,
  /** Checksum mismatch. */
  unprocessable: 422,
  /** The receiver hit its own request ceiling. */
  tooManyRequests: 429,
  /** Anything the receiver could not classify. */
  serverError: 500,
} as const

/** Read a value as a plain object, or `undefined`. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a non-empty string, or `undefined`. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read a nullable string, keeping `null` distinct from absent.
 *
 * The spec's `?` and `| null` are not interchangeable on the wire: a device that
 * sent an explicit `null` chose to say "I have no model name", and a device that
 * omitted the key said nothing at all. Collapsing them would make this plugin's
 * re-serialization of a peer subtly different from what the peer said.
 *
 * @param value - raw field.
 * @returns the string, `null` when explicitly null, or `undefined` when absent or malformed.
 */
function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return asString(value)
}

/** Read a finite non-negative number, or `undefined`. */
function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Read a boolean, or `undefined`. */
function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Read one of the spec's device classes, or `undefined` for an unknown one. */
function asDeviceType(value: unknown): DeviceType | null | undefined {
  if (value === null) return null
  return DEVICE_TYPES.find(candidate => candidate === value)
}

/** Read one of the spec's transports, or `undefined`. */
function asTransferProtocol(value: unknown): TransferProtocol | undefined {
  return value === 'http' || value === 'https' ? value : undefined
}

/**
 * Narrow an untrusted value into a {@link DeviceInfo}.
 *
 * The spec allows unknown device types — the reference implementations fall
 * back to `desktop` for presentation — so an unrecognized `deviceType` is
 * dropped rather than treated as a malformed payload.
 *
 * @param value - raw value, typically a parsed announcement or `info` object.
 * @returns the identity, or `undefined` when a required field is missing.
 */
export function readDeviceInfo(value: unknown): DeviceInfo | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const alias = asString(raw['alias'])
  const version = asString(raw['version'])
  const fingerprint = asString(raw['fingerprint'])
  const port = asCount(raw['port'])
  const protocol = asTransferProtocol(raw['protocol'])
  if (alias === undefined || version === undefined || fingerprint === undefined) return undefined
  if (port === undefined || !Number.isInteger(port) || port === 0 || port > 65_535) return undefined
  if (protocol === undefined) return undefined
  const deviceModel = asNullableString(raw['deviceModel'])
  const deviceType = asDeviceType(raw['deviceType'])
  const download = asBoolean(raw['download'])
  return {
    alias,
    version,
    fingerprint,
    port,
    protocol,
    ...deviceModel === undefined ? {} : { deviceModel },
    ...deviceType === undefined ? {} : { deviceType },
    ...download === undefined ? {} : { download },
  }
}

/**
 * Narrow an untrusted value into an {@link Announcement}.
 * @param value - raw datagram payload.
 * @returns the announcement, or `undefined` when it is not one.
 */
export function readAnnouncement(value: unknown): Announcement | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const info = readDeviceInfo(raw)
  const announce = asBoolean(raw['announce'])
  if (info === undefined || announce === undefined) return undefined
  return { ...info, announce }
}

/** Read one {@link FileTimes}, keeping absent and null distinct. */
function readFileTimes(value: unknown): FileTimes | null | undefined {
  if (value === null) return null
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const modified = asNullableString(raw['modified'])
  const accessed = asNullableString(raw['accessed'])
  return {
    ...modified === undefined ? {} : { modified },
    ...accessed === undefined ? {} : { accessed },
  }
}

/**
 * Narrow an untrusted value into a {@link FileMetadata}.
 *
 * `size` must be a non-negative integer: it is what the receiver sizes its
 * write against and what the sender's own progress is measured in, so a
 * fractional or negative value would corrupt an accounting rather than merely
 * look wrong.
 *
 * @param value - raw file entry.
 * @param id - the key the entry arrived under, used when the entry omits `id`.
 * @returns the metadata, or `undefined` when a required field is missing.
 */
export function readFileMetadata(value: unknown, id?: string): FileMetadata | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const resolvedId = asString(raw['id']) ?? id
  const fileName = asString(raw['fileName'])
  const size = asCount(raw['size'])
  const fileType = asString(raw['fileType'])
  if (resolvedId === undefined || fileName === undefined) return undefined
  if (size === undefined || !Number.isInteger(size)) return undefined
  const sha256 = asNullableString(raw['sha256'])
  const preview = asNullableString(raw['preview'])
  const metadata = readFileTimes(raw['metadata'])
  return {
    id: resolvedId,
    fileName,
    size,
    // The spec calls the type mandatory but real senders omit it for unknown
    // extensions, and a file with no type is still a file.
    fileType: fileType ?? 'application/octet-stream',
    ...sha256 === undefined ? {} : { sha256 },
    ...preview === undefined ? {} : { preview },
    ...metadata === undefined ? {} : { metadata },
  }
}

/**
 * Narrow an untrusted `files` map.
 *
 * An entry that fails validation is dropped rather than failing the map: one
 * unreadable file in a batch of twenty should cost that file, and the caller
 * decides what to do about the gap.
 *
 * @param value - raw `files` value.
 * @returns validated metadata keyed by file id, or `undefined` when the map itself is not an object.
 */
export function readFileMap(value: unknown): Record<string, FileMetadata> | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const files: Record<string, FileMetadata> = {}
  for (const [key, entry] of Object.entries(raw)) {
    const file = readFileMetadata(entry, key)
    if (file !== undefined) files[file.id] = file
  }
  return files
}

/**
 * Narrow an untrusted `prepare-upload` body.
 * @param value - raw request body.
 * @returns the request, or `undefined` when it is not one.
 */
export function readPrepareUpload(value: unknown): PrepareUploadRequest | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const info = readDeviceInfo(raw['info'])
  const files = readFileMap(raw['files'])
  if (info === undefined || files === undefined) return undefined
  return { info, files }
}

/**
 * Read a positive integer query parameter.
 * @param params - request query.
 * @param key - parameter name.
 * @returns the value, or `undefined` when absent or not a positive integer.
 */
export function readPositiveInt(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Build the absolute base URL of one peer's API.
 *
 * An IPv6 literal has to be bracketed before a port may follow it, and a peer
 * that announces `::1` without brackets would otherwise produce a URL that
 * parses the last group as a port.
 *
 * @param device - the peer's identity.
 * @param host - the address the peer was actually reached at, which may differ
 *   from anything in the announcement and is the only value that has been
 *   observed to work.
 * @returns the origin, without a trailing slash.
 */
export function peerOrigin(device: { protocol: TransferProtocol; port: number }, host: string): string {
  const literal = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${device.protocol}://${literal}:${String(device.port)}`
}

/**
 * Build one absolute API route on a peer.
 * @param origin - result of {@link peerOrigin}.
 * @param route - route name under the version prefix, e.g. `upload`.
 * @returns the absolute URL.
 */
export function apiUrl(origin: string, route: string): string {
  return `${origin}${API_PREFIX}/${route}`
}

/**
 * Decide whether a file name is safe to write into a receive directory.
 *
 * This is the one place a remote peer gets to influence a path on this machine,
 * so the rule is a whitelist rather than a cleanup: the name must be a single
 * path segment that is neither `.` nor `..`, must not be empty, and must not
 * carry a separator or a NUL. Anything else is replaced with a generated name by
 * the caller rather than repaired here — repairing a name is how a traversal
 * gets through.
 *
 * @param name - the sender-supplied file name.
 * @returns whether the name may be used verbatim as a path segment.
 */
export function isSafeFileName(name: string): boolean {
  if (name.length === 0 || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\')) return false
  // Control characters would let a name forge a log line or truncate a path.
  // eslint-disable-next-line no-control-regex -- matching them is the point
  return !/[\u0000-\u001f\u007f]/u.test(name)
}

/**
 * Pick a file name that does not collide with one already claimed.
 *
 * Receiving the same photo twice is normal, and overwriting the first copy
 * would lose data the receiver never agreed to lose. The suffix follows the
 * convention every file manager uses — `report.pdf`, `report (1).pdf` — so the
 * result is recognizable rather than machine-mangled.
 *
 * @param name - desired file name.
 * @param taken - names already used in the destination directory.
 * @returns a name not present in `taken`, or `name` when it is free.
 */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  // A leading dot is part of the name, not an extension: `.gitignore` has none.
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${String(index)})${extension}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem} (${String(Date.now())})${extension}`
}
