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
import { type DeviceInfo } from './protocol.ts';
import type { TransferRegistry } from './transfer.ts';
import { type LocalSendConfig, type StorePaths } from './store.ts';
/** How long a sender waits for the user to decide before the offer is refused. */
export declare const APPROVAL_TIMEOUT_MS = 90000;
/** Services the server needs from its owner. */
export interface ServerHost {
    /** Configuration in effect; read fresh so a reconfigured row takes effect. */
    readonly config: () => LocalSendConfig;
    /** This device's announced identity. */
    readonly info: () => DeviceInfo;
    /** The shared transfer table. */
    readonly registry: TransferRegistry;
    /** The paths this plugin owns. */
    readonly paths: StorePaths;
    /** Log sink for conditions worth recording but not failing on. */
    readonly warn: (message: string) => void;
    /** Report a peer that called this device, so it appears in the peer list. */
    readonly sawPeer: (info: DeviceInfo, host: string) => void;
}
/**
 * The LocalSend API server: one HTTP listener and the sessions it is holding.
 *
 * Lifecycle is explicit ({@link start} / {@link stop}) rather than done in the
 * constructor, because a failed bind is an expected condition — the official
 * LocalSend app may already own the port — and the caller needs to hear about it
 * without losing the rest of the plugin.
 */
export declare class LocalSendServer {
    private readonly host;
    private server;
    private readonly sessions;
    private readonly writes;
    /** Set once the listener is closed, so late handlers answer instead of throwing. */
    private closed;
    /**
     * Failed PIN attempts per source address.
     *
     * The reference implementation refuses an address outright after three
     * failures, with no recovery, and that is the right shape for a four-digit
     * secret on a LAN: an attacker who can retry forever will find it, and the
     * legitimate user's remedy — restart the plugin or clear the PIN — costs far
     * less than leaving a guessable door open.
     */
    private readonly pinFailures;
    /**
     * Addresses with a preparation still waiting on the user, by registry id.
     *
     * Tracked separately from {@link sessions} because a session only exists once
     * it has been accepted, and the senders that most need cancelling are exactly
     * the ones that never got that far: a v2 sender does not learn the session id
     * until the preparation response arrives, so a sender that gives up while the
     * user is deciding has nothing to quote back and must cancel by address alone.
     */
    private readonly pendingSenders;
    /** Preparations withdrawn by their sender, so the handler can say so. */
    private readonly senderCancelled;
    /** @param host - the services this server borrows from the plugin. */
    constructor(host: ServerHost);
    /** Whether the listener is bound. */
    get listening(): boolean;
    /**
     * Bind the API server.
     *
     * @param port - TCP port to listen on.
     * @returns the port actually bound, which differs from the request when the
     *   configured port was taken and the caller allowed a fallback.
     */
    start(port: number): Promise<number>;
    /**
     * Close the listener and refuse every session it was holding.
     *
     * In-flight uploads are torn down rather than drained: the plugin is going
     * away, and a partially written file is already in the staging directory where
     * the next start will not mistake it for a complete one.
     */
    stop(): Promise<void>;
    /**
     * Dispatch one request to its route.
     *
     * @param request - incoming request.
     * @param response - response to answer on.
     */
    private route;
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
    private handleRegister;
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
    private handlePrepare;
    /**
     * Wait for the user's answer on one offer.
     *
     * The timeout is the point: a sender holding an open connection deserves an
     * answer even if nobody is looking at the panel, and "nobody answered" has to
     * resolve to refusal rather than to a request that never ends.
     *
     * @param id - registry row id.
     * @returns whether the transfer was accepted.
     */
    private awaitDecision;
    /**
     * Apply the configured ceilings to a prepared batch.
     *
     * @param entries - offered files.
     * @param config - configuration in effect.
     * @returns a reason per refused file id; absent means accepted.
     */
    private screen;
    /**
     * Whether another transfer currently owns this device.
     * @returns whether any transfer is awaiting a decision or moving bytes.
     */
    private busy;
    /**
     * Whether an address has exhausted its PIN attempts.
     * @param address - source address of the request.
     * @returns whether further attempts are refused outright.
     */
    private pinBlocked;
    /**
     * Record one failed PIN attempt.
     * @param address - source address of the request.
     */
    private recordPinFailure;
    /** The directory received files are written to, created if needed. */
    private receiveDirectory;
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
    private claimedOnDisk;
    /**
     * Receive one file's bytes.
     *
     * @param request - the sender's request, whose body is the file.
     * @param response - response to answer on.
     * @param url - parsed request URL, carrying session, file, and token.
     */
    private handleUpload;
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
    private receiveFile;
    /**
     * Mark one file failed and record why.
     * @param transferId - registry row id.
     * @param fileId - the file's id.
     * @param reason - message to show the user.
     */
    private failFile;
    /**
     * Close a session whose accepted bytes have all arrived.
     *
     * The remaining `acceptedBytes` is the completion signal rather than a count
     * of finished files, because a file that failed has no bytes to give and
     * waiting for it would leave the session open forever.
     *
     * @param session - the session to settle.
     */
    private finishSession;
    /**
     * Cancel a session on the sender's request.
     *
     * @param response - response to answer on.
     * @param url - parsed request URL carrying the session id.
     */
    private handleCancel;
}
