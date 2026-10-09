/**
 * This device's durable identity and the paths the plugin owns.
 *
 * Everything the plugin remembers between runs lives in one directory under the
 * harness home, `${DSH_HOME:-~/.dsh}/local-send`:
 *
 * - `device.json` — the name this device announces and the fingerprint peers key
 *   it by.
 * - `inbox/` — files other devices sent, which is also the directory the
 *   conversation references point at.
 * - `inbox/.partial/` — uploads still arriving.
 *
 * Keeping one directory rather than scattering files under a shared config tree
 * matters for two reasons: a transfer surface is something a user may want to
 * back up, move, or delete wholesale, and the receive directory has to be a real
 * path the agent can be pointed at, so it cannot live inside a JSON blob.
 *
 * @module dsh-local-send/store
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import type { DeviceType, TransferProtocol } from './protocol.ts'

/** Absolute path of the harness home, honouring an explicit override. */
export function resolveDshHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configured = env.DSH_HOME?.trim()
  return configured !== undefined && configured.length > 0 ? configured : join(home, '.dsh')
}

/** Every path this plugin owns, derived from one harness home. */
export interface StorePaths {
  /** The plugin's own directory. */
  readonly root: string
  /** Durable device identity. */
  readonly device: string
  /** Where received files are saved. */
  readonly inbox: string
  /** Where an upload is written while it is still arriving. */
  readonly partial: string
}

/**
 * Derive every path from one harness home.
 * @param dshHome - absolute harness home.
 * @returns the path set, whether or not the directories exist yet.
 */
export function storePaths(dshHome: string): StorePaths {
  const root = join(dshHome, 'local-send')
  const inbox = join(root, 'inbox')
  return {
    root,
    device: join(root, 'device.json'),
    inbox,
    partial: join(inbox, '.partial'),
  }
}

/**
 * Create the directories the plugin writes into.
 *
 * Deliberately called before the first write rather than at module load: a
 * plugin that is installed but never used should not leave an empty tree in the
 * user's home.
 *
 * @param paths - the path set to materialize.
 */
export function ensureDirectories(paths: StorePaths): void {
  mkdirSync(paths.inbox, { recursive: true })
  mkdirSync(paths.partial, { recursive: true })
}

/** This device's durable identity, as stored on disk. */
export interface StoredDevice {
  /**
   * Stable key peers identify this device by.
   *
   * Under HTTP the spec defines this as "a random generated string", which is
   * what makes it the only value that has to survive a restart: peers remember
   * devices by it, and a regenerated fingerprint would make this device a
   * stranger to every peer that had seen it before.
   */
  fingerprint: string
  /** Name shown to other devices; the user may rename this device at any time. */
  alias: string
}

/** A generated fingerprint: 32 hex characters of OS entropy. */
function generateFingerprint(): string {
  return randomBytes(16).toString('hex')
}

/**
 * A sensible default device name.
 *
 * The hostname is the right first guess — it is what the user called this
 * machine, and on a LAN it is usually how they think of it — but it can be
 * empty or a bare container id, so a fallback keeps the peer list readable.
 *
 * @returns the name to announce until the user changes it.
 */
export function defaultAlias(): string {
  const name = hostname().trim()
  return name.length > 0 ? name : 'DeepSeek Harness'
}

/**
 * Read the stored device identity, creating it on first use.
 *
 * A corrupt file is replaced rather than repaired: the only irreplaceable field
 * is the fingerprint, and a fingerprint this plugin cannot parse is one it
 * cannot use either. The write is atomic (temp file plus rename) because a
 * process killed mid-write would otherwise leave a truncated file that the next
 * start would silently replace with a new identity.
 *
 * @param paths - the path set to read from and write to.
 * @param log - sink for a replacement warning, so a lost identity is visible.
 * @returns the identity now in effect.
 */
export function loadDevice(paths: StorePaths, log: (message: string) => void): StoredDevice {
  const existing = readStoredDevice(paths.device)
  if (existing !== undefined) return existing
  const created: StoredDevice = { fingerprint: generateFingerprint(), alias: defaultAlias() }
  if (existsSync(paths.device)) log('device.json was unreadable and has been regenerated')
  saveDevice(paths, created)
  return created
}

/**
 * Read and validate a stored identity.
 * @param file - absolute path of `device.json`.
 * @returns the identity, or `undefined` when absent or malformed.
 */
function readStoredDevice(file: string): StoredDevice | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const raw = parsed as Record<string, unknown>
    const fingerprint = raw['fingerprint']
    const alias = raw['alias']
    if (typeof fingerprint !== 'string' || fingerprint.length === 0) return undefined
    if (typeof alias !== 'string') return undefined
    return { fingerprint, alias: alias.trim().length > 0 ? alias : defaultAlias() }
  } catch {
    return undefined
  }
}

/**
 * Write the identity atomically.
 * @param paths - the path set owning `device.json`.
 * @param device - the identity to persist.
 */
export function saveDevice(paths: StorePaths, device: StoredDevice): void {
  mkdirSync(paths.root, { recursive: true })
  const temporary = `${paths.device}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(device, null, 2)}\n`, 'utf8')
  renameSync(temporary, paths.device)
}

/** Configuration a deployment may override through the plugin's Loader row. */
export interface LocalSendConfig {
  /** Name announced to peers; empty means "use the stored or default name". */
  alias: string
  /** TCP and UDP port for the transfer API and discovery. */
  port: number
  /** Transport advertised to peers. */
  protocol: TransferProtocol
  /** Device class advertised to peers. */
  deviceType: DeviceType
  /** Whether received files are accepted without asking. */
  autoAccept: boolean
  /**
   * Required PIN for incoming transfers, or the empty string for none.
   *
   * Enforced the way the spec expects: a preparation without the matching
   * `pin` query parameter is answered `401`, and the sender retries with one.
   */
  pin: string
  /** Largest single file this device will accept, in bytes. */
  maxFileBytes: number
  /** Largest whole transfer this device will accept, in bytes. */
  maxTransferBytes: number
  /** How many files one transfer may contain. */
  maxFiles: number
  /** Override for the receive directory; empty means the default under the harness home. */
  receiveDir: string
}

/** Shipped defaults: the spec's port, an open receive policy, and generous size ceilings. */
export const DEFAULT_CONFIG: LocalSendConfig = {
  alias: '',
  port: 53317,
  protocol: 'http',
  deviceType: 'desktop',
  autoAccept: false,
  pin: '',
  // 16 GiB per file and 64 GiB per transfer: high enough that a normal user
  // never meets them, low enough that a hostile peer cannot fill the disk in one
  // request. Both are configuration, not constants, because the right ceiling is
  // a property of the machine rather than of the protocol.
  maxFileBytes: 16 * 1024 ** 3,
  maxTransferBytes: 64 * 1024 ** 3,
  maxFiles: 500,
  receiveDir: '',
}

/**
 * Merge a deployment's configuration over the shipped defaults.
 *
 * Every field is checked rather than trusted: this object is built from a Loader
 * row that a human edits, and a typo in a port number should produce the default
 * port rather than a server that cannot bind.
 *
 * @param config - the row's configuration, possibly partial or malformed.
 * @returns a complete, usable configuration.
 */
export function resolveConfig(config: Partial<LocalSendConfig> | undefined): LocalSendConfig {
  const raw: Partial<LocalSendConfig> = config ?? {}
  const port = raw.port
  const maxFiles = raw.maxFiles
  return {
    ...DEFAULT_CONFIG,
    alias: typeof raw.alias === 'string' ? raw.alias.trim() : DEFAULT_CONFIG.alias,
    port: typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65_535
      ? port
      : DEFAULT_CONFIG.port,
    protocol: raw.protocol === 'https' ? 'https' : 'http',
    deviceType: raw.deviceType ?? DEFAULT_CONFIG.deviceType,
    autoAccept: typeof raw.autoAccept === 'boolean' ? raw.autoAccept : DEFAULT_CONFIG.autoAccept,
    pin: typeof raw.pin === 'string' ? raw.pin : DEFAULT_CONFIG.pin,
    maxFileBytes: positiveOr(raw.maxFileBytes, DEFAULT_CONFIG.maxFileBytes),
    maxTransferBytes: positiveOr(raw.maxTransferBytes, DEFAULT_CONFIG.maxTransferBytes),
    maxFiles: typeof maxFiles === 'number' && Number.isInteger(maxFiles) && maxFiles > 0
      ? maxFiles
      : DEFAULT_CONFIG.maxFiles,
    receiveDir: typeof raw.receiveDir === 'string' ? raw.receiveDir.trim() : DEFAULT_CONFIG.receiveDir,
  }
}

/** Read a positive finite number, or a default. */
function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * The receive directory in effect.
 * @param config - resolved configuration.
 * @param paths - the default path set.
 * @returns the absolute receive directory, which may be outside the harness home.
 */
export function receiveDirectory(config: LocalSendConfig, paths: StorePaths): string {
  return config.receiveDir.length > 0 ? config.receiveDir : paths.inbox
}
