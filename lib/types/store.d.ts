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
import type { DeviceType, TransferProtocol } from './protocol.ts';
/** Absolute path of the harness home, honouring an explicit override. */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv, home?: string): string;
/** Every path this plugin owns, derived from one harness home. */
export interface StorePaths {
    /** The plugin's own directory. */
    readonly root: string;
    /** Durable device identity. */
    readonly device: string;
    /** Where received files are saved. */
    readonly inbox: string;
    /** Where an upload is written while it is still arriving. */
    readonly partial: string;
}
/**
 * Derive every path from one harness home.
 * @param dshHome - absolute harness home.
 * @returns the path set, whether or not the directories exist yet.
 */
export declare function storePaths(dshHome: string): StorePaths;
/**
 * Create the directories the plugin writes into.
 *
 * Deliberately called before the first write rather than at module load: a
 * plugin that is installed but never used should not leave an empty tree in the
 * user's home.
 *
 * @param paths - the path set to materialize.
 */
export declare function ensureDirectories(paths: StorePaths): void;
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
    fingerprint: string;
    /** Name shown to other devices; the user may rename this device at any time. */
    alias: string;
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
export declare function defaultAlias(): string;
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
export declare function loadDevice(paths: StorePaths, log: (message: string) => void): StoredDevice;
/**
 * Write the identity atomically.
 * @param paths - the path set owning `device.json`.
 * @param device - the identity to persist.
 */
export declare function saveDevice(paths: StorePaths, device: StoredDevice): void;
/** Configuration a deployment may override through the plugin's Loader row. */
export interface LocalSendConfig {
    /** Name announced to peers; empty means "use the stored or default name". */
    alias: string;
    /** TCP and UDP port for the transfer API and discovery. */
    port: number;
    /** Transport advertised to peers. */
    protocol: TransferProtocol;
    /** Device class advertised to peers. */
    deviceType: DeviceType;
    /** Whether received files are accepted without asking. */
    autoAccept: boolean;
    /**
     * Required PIN for incoming transfers, or the empty string for none.
     *
     * Enforced the way the spec expects: a preparation without the matching
     * `pin` query parameter is answered `401`, and the sender retries with one.
     */
    pin: string;
    /** Largest single file this device will accept, in bytes. */
    maxFileBytes: number;
    /** Largest whole transfer this device will accept, in bytes. */
    maxTransferBytes: number;
    /** How many files one transfer may contain. */
    maxFiles: number;
    /** Override for the receive directory; empty means the default under the harness home. */
    receiveDir: string;
}
/** Shipped defaults: the spec's port, an open receive policy, and generous size ceilings. */
export declare const DEFAULT_CONFIG: LocalSendConfig;
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
export declare function resolveConfig(config: Partial<LocalSendConfig> | undefined): LocalSendConfig;
/**
 * The receive directory in effect.
 * @param config - resolved configuration.
 * @param paths - the default path set.
 * @returns the absolute receive directory, which may be outside the harness home.
 */
export declare function receiveDirectory(config: LocalSendConfig, paths: StorePaths): string;
