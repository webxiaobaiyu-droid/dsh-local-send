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

import {
  DECIDE_PATH,
  INSPECT_PATH,
  PREPARE_PATH,
  RENAME_PATH,
  REVEAL_PATH,
  SCAN_PATH,
  SEND_PATHS_PATH,
  STATE_PATH,
  STREAM_PATH,
  type DecideRequest,
  type LocalSendState,
  type PathCandidate,
  type PrepareSendRequest,
  type PrepareSendResponse,
  type SendPathsRequest,
  type SendPathsResponse,
} from '../types.ts'

/** A request that failed, carrying the host's own words when it had any. */
export class HostError extends Error {
  /** HTTP status, when the failure had one. */
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'HostError'
  }
}

/**
 * Read a response body, or describe the failure.
 *
 * The host's failure shape is `{ error: string }`, but a proxy, a carrier cap or
 * an unloaded plugin can all answer with something else — a 404 body of
 * "not found", or an empty 413. Falling back to the status code keeps the panel
 * able to say *something* true rather than showing an empty toast.
 *
 * @param response - the response to read.
 * @returns the parsed body.
 * @throws {HostError} when the response is not ok.
 */
async function readBody<T>(response: Response): Promise<T> {
  if (response.ok) return await response.json() as T
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const message = (body as { error?: unknown }).error
      if (typeof message === 'string') detail = message
    }
  } catch {
    detail = ''
  }
  throw new HostError(
    detail.length > 0 ? detail : `HTTP ${String(response.status)}`,
    response.status,
  )
}

/** POST a JSON body to one route and read the answer. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await readBody<T>(response)
}

/**
 * Read the whole panel state.
 * @returns the state the panel renders from.
 */
export async function fetchState(): Promise<LocalSendState> {
  const response = await fetch(new URL(STATE_PATH, window.location.origin), {
    credentials: 'include',
  })
  return await readBody<LocalSendState>(response)
}

/**
 * Offer browser-held files to a peer, before any bytes move.
 * @param request - the peer and the files about to be streamed.
 * @returns the transfer to stream against, and which files were accepted.
 */
export async function prepareSend(request: PrepareSendRequest): Promise<PrepareSendResponse> {
  return await post<PrepareSendResponse>(PREPARE_PATH, request)
}

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
export async function streamFile(
  transferId: string,
  fileId: string,
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  const url = new URL(STREAM_PATH, window.location.origin)
  url.searchParams.set('transferId', transferId)
  url.searchParams.set('fileId', fileId)
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) await readBody<never>(response)
}

/**
 * Send files that already exist on this machine.
 * @param request - the peer and the absolute paths.
 * @returns the transfer the send was recorded as.
 */
export async function sendPaths(request: SendPathsRequest): Promise<SendPathsResponse> {
  return await post<SendPathsResponse>(SEND_PATHS_PATH, request)
}

/**
 * Answer an incoming offer.
 * @param request - the offer and the answer.
 * @returns whether a decision was still pending.
 */
export async function decide(request: DecideRequest): Promise<{ decided: boolean }> {
  return await post<{ decided: boolean }>(DECIDE_PATH, request)
}

/**
 * Rename this device.
 * @param alias - the new name to announce.
 * @returns the name now in effect.
 */
export async function rename(alias: string): Promise<{ alias: string }> {
  return await post<{ alias: string }>(RENAME_PATH, { alias })
}

/**
 * Run the legacy subnet scan.
 * @returns how many devices answered.
 */
export async function scan(): Promise<{ found: number }> {
  return await post<{ found: number }>(SCAN_PATH, {})
}

/**
 * Ask the host what it knows about some paths.
 * @param paths - candidate absolute paths, as typed.
 * @returns one entry per path, in order.
 */
export async function inspect(paths: readonly string[]): Promise<{ candidates: PathCandidate[] }> {
  return await post<{ candidates: PathCandidate[] }>(INSPECT_PATH, { paths })
}

/**
 * Show a received file in the platform's file manager.
 * @param path - absolute path of a file in the receive directory.
 */
export async function reveal(path: string): Promise<void> {
  await post<{ ok: true }>(REVEAL_PATH, { path })
}
