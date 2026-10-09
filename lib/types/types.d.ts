/**
 * The contract between this plugin's two halves.
 *
 * Everything the browser half knows arrives through these shapes over the
 * plugin's own Fetch routes, so this module is the single place the two halves
 * agree. It is deliberately free of Node imports — the browser bundle includes
 * it — which is also why the transfer rows are defined here rather than beside
 * the registry that fills them in.
 *
 * Two conventions run through the whole contract:
 *
 * - **Timestamps are epoch milliseconds, sizes are bytes, and nothing is
 *   pre-formatted.** The host never decides how a figure reads: a byte count
 *   becomes "1.4 GB" against the reader's own locale, and a duration becomes
 *   "12s ago" at render time. That is what lets a locale switch cost one
 *   re-render instead of a round trip.
 * - **Progress is bytes done over bytes total, both present.** A panel that has
 *   to derive a denominator from a file list cannot show a whole-transfer
 *   percentage while the offer is still being screened, and the host already
 *   knows the number.
 *
 * @module dsh-local-send/types
 */
import type { DeviceType, TransferProtocol } from './protocol.ts';
export type { DeviceType, TransferProtocol };
/** Which way a transfer's bytes are going. */
export type TransferDirection = 'incoming' | 'outgoing';
/** Where one file is in its life. */
export type FileStatus = 'offered' | 'transferring' | 'done' | 'failed' | 'declined';
/**
 * Where a whole transfer is.
 *
 * `awaiting` means a decision rather than a pause: an incoming transfer in this
 * state is holding a peer's HTTP request open until the user answers.
 */
export type TransferStatus = 'awaiting' | 'transferring' | 'done' | 'partial' | 'failed' | 'declined' | 'canceled';
/** One file within a transfer, as the panel draws it. */
export interface TransferFileRow {
    /** Sender-assigned identifier, unique within the transfer. */
    readonly id: string;
    /** Name the file was sent under. */
    readonly fileName: string;
    /** Expected byte count. */
    readonly size: number;
    /** MIME type as offered. */
    readonly fileType: string;
    /** Where this file is in its life. */
    readonly status: FileStatus;
    /** Bytes moved so far. */
    readonly bytesDone: number;
    /**
     * Absolute path of the saved file, once it is on disk.
     *
     * Present only for received files, and this is what the panel turns into an
     * `@` reference when the user adds the file to the conversation.
     */
    readonly savedPath?: string;
    /** Why this file failed or was refused, when it was. */
    readonly error?: string;
}
/** One transfer, as the panel draws it. */
export interface TransferRow {
    /** Registry-assigned identifier. */
    readonly id: string;
    /** Which way the bytes are going. */
    readonly direction: TransferDirection;
    /** Display name of the other device. */
    readonly peerAlias: string;
    /** Stable key of the other device. */
    readonly peerFingerprint: string;
    /** Address the exchange is happening over. */
    readonly peerAddress: string;
    /** Device class of the other device, for the row's icon. */
    readonly peerType: DeviceType | null;
    /** Where the transfer as a whole is. */
    readonly status: TransferStatus;
    /** The files, in the order the sender listed them. */
    readonly files: readonly TransferFileRow[];
    /** Sum of every file's expected size. */
    readonly bytesTotal: number;
    /** Sum of every file's progress. */
    readonly bytesDone: number;
    /** Epoch milliseconds of the first offer. */
    readonly createdAt: number;
    /** Epoch milliseconds of the most recent change. */
    readonly updatedAt: number;
    /** Why the transfer failed, when it did. */
    readonly error?: string;
}
/** One device seen on the LAN, as the panel draws it. */
export interface PeerRow {
    /** Stable key the peer is remembered by. */
    readonly fingerprint: string;
    /** Display name the peer announces. */
    readonly alias: string;
    /** Device class, for the row's icon. */
    readonly deviceType: DeviceType | null;
    /** Model string, when the peer reports one. */
    readonly deviceModel: string | null;
    /** Address the peer was seen at. */
    readonly address: string;
    /** Port the peer's API is on. */
    readonly port: number;
    /** Transport the peer's API is served over. */
    readonly protocol: TransferProtocol;
    /** Protocol version the peer announces. */
    readonly version: string;
    /** Epoch milliseconds of the most recent sighting. */
    readonly lastSeen: number;
    /**
     * Whether the peer answered a callback.
     *
     * A peer that announced itself but did not answer is listed but not offered as
     * a send target, because a send to it can only fail.
     */
    readonly reachable: boolean;
}
/** This device's own identity, as the panel shows it. */
export interface DeviceRow {
    /** Name announced to peers. */
    readonly alias: string;
    /** Stable key peers identify this device by. */
    readonly fingerprint: string;
    /** Port the transfer API listens on. */
    readonly port: number;
    /** Transport advertised to peers. */
    readonly protocol: TransferProtocol;
    /** Device class advertised to peers. */
    readonly deviceType: DeviceType;
    /** Addresses this device can be reached at, for the panel to display. */
    readonly addresses: readonly string[];
    /** Whether the transfer API is actually bound. */
    readonly serving: boolean;
}
/**
 * A condition worth telling the user about.
 *
 * Structured rather than a sentence, for the same reason no figure is
 * pre-formatted: the host knows *what* went wrong and the panel knows how to say
 * it in the reader's language. A host that shipped prose would also be shipping
 * a locale it has no way to know, and an underlying error's own text — which is
 * genuinely useful and has to survive — rides along as data.
 */
export type StateWarning = {
    /** The transfer API could not bind its port. */
    readonly code: 'portUnavailable';
    /** The port that was attempted. */
    readonly port: number;
    /** The operating system's own words, passed through verbatim. */
    readonly detail: string;
} | {
    /** The multicast socket is not usable, so peers will not be discovered. */
    readonly code: 'discoveryUnavailable';
    /** The operating system's own words, passed through verbatim. */
    readonly detail: string;
};
/** What the discovery loop is doing, so the panel can explain an empty list. */
export interface DiscoveryRow {
    /** Whether the multicast socket is bound and announcing. */
    readonly active: boolean;
    /** The most recent condition worth telling the user about, if any. */
    readonly warning?: StateWarning;
}
/** The whole state the panel renders from. */
export interface LocalSendState {
    /** This device. */
    readonly device: DeviceRow;
    /** Every peer currently believed to be present, most recently seen first. */
    readonly peers: readonly PeerRow[];
    /** Every transfer this session has seen, newest first. */
    readonly transfers: readonly TransferRow[];
    /** Where received files are saved; the base for an `@` reference. */
    readonly inbox: string;
    /** What discovery is doing. */
    readonly discovery: DiscoveryRow;
    /**
     * The most recent condition worth explaining to the user, if any.
     *
     * Separate from {@link DiscoveryRow.warning} because it covers the transfer
     * API as well: a device whose listener could not bind still discovers peers
     * and still shows them, and a panel that only reported discovery would look
     * healthy while being unable to receive anything.
     */
    readonly warning?: StateWarning;
    /**
     * Whether anything is in motion.
     *
     * The panel polls faster while this is true and slower when it is not, so an
     * idle device costs one cheap request every few seconds instead of several a
     * second.
     */
    readonly busy: boolean;
}
/** One file the panel wants to send, described before its bytes are offered. */
export interface OutgoingFileRequest {
    /** Panel-assigned identifier, echoed back when the bytes are streamed. */
    readonly id: string;
    /** Name to send. */
    readonly fileName: string;
    /** Byte count, known from the browser's own `File` object. */
    readonly size: number;
}
/** Body of the route that opens a send from browser-held files. */
export interface PrepareSendRequest {
    /** Stable key of the peer to send to. */
    readonly peer: string;
    /** Files about to be streamed, in order. */
    readonly files: readonly OutgoingFileRequest[];
}
/** Answer to a preparation: the transfer now waiting for its bytes. */
export interface PrepareSendResponse {
    /** Registry row the upcoming uploads will report against. */
    readonly transferId: string;
    /**
     * Whether the peer accepted the offer.
     *
     * Returned rather than left for the panel to infer from the next poll: the
     * panel has the file bodies in hand and must decide in this same turn whether
     * to stream them or to discard them, and a poll would leave them waiting on a
     * round trip for an answer the host already has.
     */
    readonly accepted: boolean;
    /** File ids the peer accepted, which are the only ones worth streaming. */
    readonly files: readonly string[];
}
/** Body of the route that opens a send from paths on this machine. */
export interface SendPathsRequest {
    /** Stable key of the peer to send to. */
    readonly peer: string;
    /** Absolute paths to offer. */
    readonly paths: readonly string[];
}
/** Answer to a path send, which runs to completion before it returns. */
export interface SendPathsResponse {
    /** Registry row the transfer was recorded as. */
    readonly transferId: string;
}
/** Body of the route that answers an incoming offer. */
export interface DecideRequest {
    /** The offer's registry row. */
    readonly transferId: string;
    /** Whether to accept it. */
    readonly accept: boolean;
}
/** Body of the route that renames this device. */
export interface RenameRequest {
    /** The name to announce from now on. */
    readonly alias: string;
}
/** One absolute host path that can be offered for sending. */
export interface PathCandidate {
    /** Absolute path. */
    readonly path: string;
    /** Base name, for display. */
    readonly name: string;
    /** Byte count, or `undefined` when it could not be read. */
    readonly size?: number;
    /** Whether this entry is a directory, which this plugin does not send. */
    readonly directory: boolean;
}
/**
 * Exact route the panel reads the whole state from.
 *
 * One route rather than several: the panel draws peers and transfers together
 * and they change together, so splitting them would mean two round trips and a
 * frame where one half is newer than the other.
 */
export declare const STATE_PATH = "/api/dsh-local-send/state";
/** Exact route that opens a send from browser-held files. */
export declare const PREPARE_PATH = "/api/dsh-local-send/prepare";
/** Exact route that accepts one file's bytes from the browser and forwards them. */
export declare const STREAM_PATH = "/api/dsh-local-send/stream";
/** Exact route that sends files that already exist on this machine. */
export declare const SEND_PATHS_PATH = "/api/dsh-local-send/send-paths";
/** Exact route that accepts or declines an incoming offer. */
export declare const DECIDE_PATH = "/api/dsh-local-send/decide";
/** Exact route that renames this device. */
export declare const RENAME_PATH = "/api/dsh-local-send/rename";
/** Exact route that runs the legacy subnet scan on demand. */
export declare const SCAN_PATH = "/api/dsh-local-send/scan";
/** Exact route that reveals a received file in the OS file browser. */
export declare const REVEAL_PATH = "/api/dsh-local-send/reveal";
/** Exact route that answers whether a host path exists, for the path sender. */
export declare const INSPECT_PATH = "/api/dsh-local-send/inspect";
