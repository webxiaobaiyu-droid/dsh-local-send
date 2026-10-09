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
import { Readable } from 'node:stream';
import { type DeviceInfo, type FileMetadata, type TransferProtocol } from './protocol.ts';
import type { TransferRegistry } from './transfer.ts';
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
export declare const HASH_LIMIT_BYTES: number;
/**
 * Concurrent `upload` calls, matching the reference implementation.
 *
 * Public because the staging routes must apply the same ceiling when several
 * files are streamed from the panel at once.
 */
export declare const UPLOAD_CONCURRENCY = 2;
/** The peer a transfer is addressed to. */
export interface OutboundPeer {
    /** Stable key of the peer, for the registry row. */
    readonly fingerprint: string;
    /** Display name of the peer. */
    readonly alias: string;
    /** Address the peer is reachable at. */
    readonly host: string;
    /** Port the peer's API is on. */
    readonly port: number;
    /** Transport the peer's API is served over. */
    readonly protocol: TransferProtocol;
    /** Device class, for the row's icon. */
    readonly deviceType: DeviceInfo['deviceType'] | null;
}
/** Callbacks the sender reports through. */
export interface OutboundHandlers {
    /** The shared table every outcome is written to. */
    readonly registry: TransferRegistry;
    /** Log sink for conditions worth recording but not failing on. */
    readonly warn: (message: string) => void;
}
/**
 * One accepted offer, ready for its bytes.
 *
 * Kept by whoever is driving the transfer, because the tokens in it are the
 * only thing that authorises an upload and they are minted once.
 */
export interface PreparedOffer {
    /** Registry row every outcome reports against. */
    readonly transferId: string;
    /** Session id the peer expects on each upload. */
    readonly sessionId: string;
    /** The peer's API origin. */
    readonly origin: string;
    /** Per-file access tokens, keyed by file id. */
    readonly tokens: Readonly<Record<string, string>>;
    /** Files the peer accepted, keyed by file id. */
    readonly accepted: ReadonlyMap<string, FileMetadata>;
    /** Files the peer left out of its token map, with the reason to show. */
    readonly declined: readonly {
        readonly id: string;
        readonly reason: string;
    }[];
}
/** What one whole sending attempt produced. */
export interface OutboundOutcome {
    /** Registry row id. */
    readonly transferId: string;
    /** Whether the peer accepted the offer at all. */
    readonly accepted: boolean;
    /** Files that reached the peer, by file id. */
    readonly sent: readonly string[];
    /** Files refused or failed, by file id, with the reason. */
    readonly failed: readonly {
        readonly id: string;
        readonly reason: string;
    }[];
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
export declare function mimeTypeOf(name: string): string;
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
export declare function openRow(peer: OutboundPeer, roster: readonly FileMetadata[], registry: TransferRegistry): string;
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
export declare function offerToPeer(peer: OutboundPeer, transferId: string, files: readonly FileMetadata[], self: DeviceInfo, registry: TransferRegistry): Promise<PreparedOffer | {
    readonly refused: string;
}>;
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
export declare function prepareOffer(peer: OutboundPeer, files: readonly FileMetadata[], self: DeviceInfo, handlers: OutboundHandlers): Promise<PreparedOffer | {
    readonly refused: OutboundOutcome;
}>;
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
export declare function uploadStream(offer: PreparedOffer, fileId: string, source: Readable, registry: TransferRegistry): Promise<void>;
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
export declare function cancelOffer(offer: PreparedOffer, warn: (message: string) => void): Promise<void>;
/**
 * Record one file's failure against its row.
 * @param registry - the shared table.
 * @param transferId - the transfer the file belongs to.
 * @param fileId - the file's id.
 * @param reason - message to show the user.
 */
export declare function markFileFailed(registry: TransferRegistry, transferId: string, fileId: string, reason: string): void;
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
export declare function sendPaths(peer: OutboundPeer, paths: readonly string[], self: DeviceInfo, handlers: OutboundHandlers): Promise<OutboundOutcome>;
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
export declare function offerIdsFor(paths: readonly string[]): {
    id: string;
    fileName: string;
}[];
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
export declare function metadataForUpload(id: string, fileName: string, size: number): FileMetadata;
