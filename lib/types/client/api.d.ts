/**
 * The panel's side of the host contract.
 *
 * One module owns every request the browser half makes, so the paths and the
 * error shape are stated once. Failures are turned into messages here rather
 * than at each call site: the host answers a described failure as
 * `{"error": "..."}`, and a panel that had to remember that at nine call sites
 * would eventually print `[object Object]` at one of them.
 *
 * @module dsh-local-send/client/api
 */
import { type CancelTransferRequest, type DecideRequest, type LocalSendState, type PathCandidate, type PrepareSendRequest, type PrepareSendResponse, type RetryTransferRequest, type RetryTransferResponse, type SendPathsRequest, type SendPathsResponse } from '../types.ts';
/** A request that failed, carrying the host's own words when it had any. */
export declare class HostError extends Error {
    readonly status?: number | undefined;
    /** HTTP status, when the failure had one. */
    constructor(message: string, status?: number | undefined);
}
/**
 * Read the whole panel state.
 * @returns the state the panel renders from.
 */
export declare function fetchState(): Promise<LocalSendState>;
/**
 * Offer browser-held files to a peer, before any bytes move.
 * @param request - the peer and the files about to be streamed.
 * @returns the transfer to stream against, and which files were accepted.
 */
export declare function prepareSend(request: PrepareSendRequest): Promise<PrepareSendResponse>;
/**
 * Stream one file's bytes through the host to the peer.
 *
 * The body is the file itself and the route is registered as a streaming route
 * on the host, so the bytes are piped from this request into the request the
 * host makes to the peer: one pass, one buffer, nothing staged on disk.
 *
 * @param transferId - the prepared transfer.
 * @param fileId - which file of it.
 * @param file - the browser's own file object.
 * @param signal - aborts the upload when the panel goes away.
 */
export declare function streamFile(transferId: string, fileId: string, file: File, signal?: AbortSignal): Promise<void>;
/**
 * Send files that already exist on this machine.
 * @param request - the peer and the absolute paths.
 * @returns the transfer the send was recorded as.
 */
export declare function sendPaths(request: SendPathsRequest): Promise<SendPathsResponse>;
/**
 * Answer an incoming offer.
 *
 * `fileIds` is left absent when the surface answering had no file list to show —
 * a notification with a single Accept button — which the host reads as "every
 * file its own limits left standing". An empty array means the user unticked
 * everything, and is a refusal rather than an empty transfer.
 *
 * @param request - the offer and the answer.
 * @returns whether a decision was still pending.
 */
export declare function decide(request: DecideRequest): Promise<{
    decided: boolean;
}>;
/**
 * Stop a transfer this device is part of.
 * @param request - the row to stop.
 */
export declare function cancelTransfer(request: CancelTransferRequest): Promise<void>;
/**
 * Send a settled outgoing transfer again, from its files on this machine.
 * @param request - the row to send again.
 * @returns the new row the attempt was recorded as.
 */
export declare function retryTransfer(request: RetryTransferRequest): Promise<RetryTransferResponse>;
/**
 * Rename this device.
 * @param alias - the new name to announce.
 * @returns the name now in effect.
 */
export declare function rename(alias: string): Promise<{
    alias: string;
}>;
/**
 * Run the legacy subnet scan.
 * @returns how many devices answered.
 */
export declare function scan(): Promise<{
    found: number;
}>;
/**
 * Ask the host what it knows about some paths.
 * @param paths - candidate absolute paths, as typed.
 * @returns one entry per path, in order.
 */
export declare function inspect(paths: readonly string[]): Promise<{
    candidates: PathCandidate[];
}>;
/**
 * Show a received file in the platform's file manager.
 * @param path - absolute path of a file in the receive directory.
 */
export declare function reveal(path: string): Promise<void>;
