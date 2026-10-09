/**
 * The transfer registry: every exchange this device is part of, in both
 * directions, as one live table.
 *
 * Both directions live in one structure on purpose. A send and a receive differ
 * in who dials whom and nothing else that the user can see: both have a peer, a
 * list of files, a byte count that climbs, and an outcome. Splitting them would
 * duplicate the progress accounting and give the panel two shapes to render for
 * what is one row.
 *
 * Two properties are worth stating because the rest of the plugin leans on them:
 *
 * - **Progress is bytes, and it is monotonic per file.** A file's counter only
 *   ever moves forward, because a retry restarts the file rather than rewinding
 *   the number the user is watching. The registry is the only writer, so the
 *   panel can render whatever it reads without defending against a value going
 *   backwards.
 * - **An incoming transfer waits for a decision.** {@link TransferRegistry.await}
 *   is how the HTTP handler blocks on the user; the registry holds the resolver,
 *   so a decision made in the panel, a timeout, or the plugin unloading all
 *   settle the same promise exactly once.
 *
 * @module dsh-local-send/transfer
 */
import type { DeviceType } from './protocol.ts';
import type { FileStatus, TransferDirection, TransferFileRow, TransferRow, TransferStatus } from './types.ts';
export type { FileStatus, TransferDirection, TransferRow, TransferStatus };
/**
 * A wire row with its readonly modifiers removed.
 *
 * The registry mutates its rows in place, because progress arrives as a stream
 * of small updates and rebuilding a whole transfer object per chunk would make
 * the bookkeeping the expensive part of a transfer. The wire types keep their
 * members readonly, because a consumer has no business writing to a snapshot.
 * One definition therefore supplies two views, and a field added to either
 * cannot go missing from the other.
 */
type Live<T> = {
    -readonly [K in keyof T]: T[K] extends readonly (infer Element)[] ? Live<Element>[] : T[K];
};
/** One file within a transfer, as the registry holds it. */
export type TransferFile = Live<TransferFileRow>;
/** One transfer, as the registry holds it. */
export type Transfer = Live<TransferRow>;
/** A listener notified when the table changes. */
export type TransferListener = () => void;
/** One file as a caller describes it when opening a transfer. */
export interface OpenFile {
    /** Sender-assigned identifier, unique within the transfer. */
    readonly id: string;
    /** Name the file is sent and saved under. */
    readonly fileName: string;
    /** Expected byte count. */
    readonly size: number;
    /** MIME type as offered. */
    readonly fileType: string;
}
/** The peer and files one transfer is opened with. */
export interface OpenOptions {
    /** Display name of the other device. */
    readonly peerAlias: string;
    /** Stable key of the other device. */
    readonly peerFingerprint: string;
    /** Address the exchange is happening over. */
    readonly peerAddress: string;
    /** Device class of the other device, for the row's icon. */
    readonly peerType: DeviceType | null;
    /** Every file the user asked to move, including ones already known to have failed. */
    readonly files: readonly OpenFile[];
}
/**
 * The live table of transfers.
 *
 * Notified listeners are called without any payload: the panel re-reads the
 * snapshot it needs, which keeps the number of shapes this module has to keep
 * consistent down to one.
 */
export declare class TransferRegistry {
    private readonly keep;
    private readonly transfers;
    private readonly listeners;
    /** One pending decision per incoming transfer awaiting the user. */
    private readonly decisions;
    /**
     * @param keep - how many finished transfers to retain before the oldest is dropped.
     *   History is for the session the user is in, not an archive; the inbox on
     *   disk is the durable record.
     */
    constructor(keep?: number);
    /** Subscribe to changes.
     * @param listener - called after every mutation.
     * @returns the unsubscribe function.
     */
    subscribe(listener: TransferListener): () => void;
    /**
     * Every transfer, newest first.
     * @returns a snapshot safe to serialize; the rows are copies.
     */
    list(): Transfer[];
    /**
     * One transfer by id.
     * @param id - registry identifier.
     * @returns the live row, or `undefined`.
     */
    get(id: string): Transfer | undefined;
    /**
     * The transfer currently moving bytes, if any.
     *
     * Used to decide whether the panel should poll quickly: an idle device has
     * nothing to animate, so its poll can be slow.
     * @returns whether any transfer is awaiting a decision or transferring.
     */
    busy(): boolean;
    /** Announce a change to every listener. */
    private notify;
    /**
     * Drop the oldest finished rows once the table is over its limit.
     *
     * Only finished rows are eligible: a transfer still holding an HTTP request or
     * a user's decision must survive any amount of history churn behind it.
     */
    private trim;
    /**
     * Open an outgoing transfer.
     *
     * @param options - the peer and the files about to be offered.
     * @returns the new row's id.
     */
    openOutgoing(options: OpenOptions): string;
    /**
     * Open an incoming transfer, before the user has decided anything.
     *
     * @param options - the peer, its address, and the files it is offering.
     * @returns the new row's id, which becomes the LocalSend session id.
     */
    openIncoming(options: OpenOptions): string;
    /**
     * Open one transfer row in either direction.
     *
     * The two public openers differ only in the direction they stamp and the state
     * they leave the row in, so the row construction lives here once — which is
     * what stops the two from drifting apart in the fields a caller can see.
     *
     * @param options - the peer and the files.
     * @param direction - which way the bytes will go.
     * @returns the new row's id.
     */
    private open;
    /**
     * Apply a change to one transfer, then notify and trim.
     *
     * @param id - registry identifier.
     * @param change - mutation applied to the live row.
     * @returns whether the row existed.
     */
    update(id: string, change: (transfer: Transfer) => void): boolean;
    /**
     * Apply a change to one file of one transfer.
     *
     * Touching a file also re-derives the parent's byte totals, so a caller can
     * report progress for a single file and never think about the sum — which is
     * exactly the bug a hand-maintained total invites once uploads run in
     * parallel.
     *
     * @param id - registry identifier.
     * @param fileId - the file's sender-assigned id.
     * @param change - mutation applied to the live file row.
     * @returns whether both the transfer and the file existed.
     */
    updateFile(id: string, fileId: string, change: (file: TransferFile) => void): boolean;
    /**
     * Resolve a transfer's outcome from the states of its files.
     *
     * The three interesting results are all reachable here rather than at the call
     * site: every file done is `done`, none done is `failed`/`declined` depending
     * on whether anything was transferred, and a mix is `partial` — which is a real
     * outcome worth naming, because a batch where one file was refused is neither
     * a success nor a failure and the user should be able to tell.
     *
     * @param id - registry identifier.
     * @param fallback - status to use when no file reports anything definitive.
     */
    settle(id: string, fallback?: TransferStatus): void;
    /**
     * Mark a whole transfer failed with one reason.
     * @param id - registry identifier.
     * @param error - message to show the user.
     */
    fail(id: string, error: string): void;
    /**
     * Mark a whole transfer canceled by either side.
     * @param id - registry identifier.
     */
    cancel(id: string): void;
    /**
     * Wait for the user's decision on an incoming transfer.
     *
     * The promise settles exactly once, whichever comes first: a decision from the
     * panel, {@link decide} called by a cancel or a failure, or the caller's own
     * timeout. A second call for the same transfer returns a promise that resolves
     * immediately as declined, so a malformed sender cannot accumulate resolvers.
     *
     * @param id - registry identifier.
     * @returns whether the transfer was accepted.
     */
    await(id: string): Promise<boolean>;
    /**
     * Settle a pending decision.
     * @param id - registry identifier.
     * @param accepted - the user's answer.
     * @returns whether a decision was actually pending.
     */
    decide(id: string, accepted: boolean): boolean;
    /**
     * Settle every pending decision as declined.
     *
     * Called when the plugin unloads: a sender left holding an open connection
     * against a plugin that no longer exists would otherwise wait for its own
     * timeout, and the HTTP server is about to go away underneath it.
     */
    declineAll(): void;
    /** Forget every transfer and settle every decision. */
    clear(): void;
}
