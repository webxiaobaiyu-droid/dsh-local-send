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

import { randomUUID } from 'node:crypto'
import type { DeviceType } from './protocol.ts'
import type {
  FileStatus,
  TransferDirection,
  TransferFileRow,
  TransferRow,
  TransferStatus,
} from './types.ts'

export type { FileStatus, TransferDirection, TransferRow, TransferStatus }

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
  -readonly [K in keyof T]: T[K] extends readonly (infer Element)[] ? Live<Element>[] : T[K]
}

/** One file within a transfer, as the registry holds it. */
export type TransferFile = Live<TransferFileRow>

/** One transfer, as the registry holds it. */
export type Transfer = Live<TransferRow>

/** A listener notified when the table changes. */
export type TransferListener = () => void

/** One file as a caller describes it when opening a transfer. */
export interface OpenFile {
  /** Sender-assigned identifier, unique within the transfer. */
  readonly id: string
  /** Name the file is sent and saved under. */
  readonly fileName: string
  /** Expected byte count. */
  readonly size: number
  /** MIME type as offered. */
  readonly fileType: string
}

/** The peer and files one transfer is opened with. */
export interface OpenOptions {
  /** Display name of the other device. */
  readonly peerAlias: string
  /** Stable key of the other device. */
  readonly peerFingerprint: string
  /** Address the exchange is happening over. */
  readonly peerAddress: string
  /** Device class of the other device, for the row's icon. */
  readonly peerType: DeviceType | null
  /** Every file the user asked to move, including ones already known to have failed. */
  readonly files: readonly OpenFile[]
}

/**
 * The live table of transfers.
 *
 * Notified listeners are called without any payload: the panel re-reads the
 * snapshot it needs, which keeps the number of shapes this module has to keep
 * consistent down to one.
 */
export class TransferRegistry {
  private readonly transfers = new Map<string, Transfer>()
  private readonly listeners = new Set<TransferListener>()
  /** One pending decision per incoming transfer awaiting the user. */
  private readonly decisions = new Map<string, (accepted: boolean) => void>()

  /**
   * @param keep - how many finished transfers to retain before the oldest is dropped.
   *   History is for the session the user is in, not an archive; the inbox on
   *   disk is the durable record.
   */
  constructor(private readonly keep = 50) {}

  /** Subscribe to changes.
   * @param listener - called after every mutation.
   * @returns the unsubscribe function.
   */
  subscribe(listener: TransferListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Every transfer, newest first.
   * @returns a snapshot safe to serialize; the rows are copies.
   */
  list(): Transfer[] {
    return [...this.transfers.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(transfer => ({
        ...transfer,
        files: transfer.files.map(file => ({ ...file })),
      }))
  }

  /**
   * One transfer by id.
   * @param id - registry identifier.
   * @returns the live row, or `undefined`.
   */
  get(id: string): Transfer | undefined {
    return this.transfers.get(id)
  }

  /**
   * The transfer currently moving bytes, if any.
   *
   * Used to decide whether the panel should poll quickly: an idle device has
   * nothing to animate, so its poll can be slow.
   * @returns whether any transfer is awaiting a decision or transferring.
   */
  busy(): boolean {
    for (const transfer of this.transfers.values()) {
      if (transfer.status === 'awaiting' || transfer.status === 'transferring') return true
    }
    return false
  }

  /** Announce a change to every listener. */
  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Drop the oldest finished rows once the table is over its limit.
   *
   * Only finished rows are eligible: a transfer still holding an HTTP request or
   * a user's decision must survive any amount of history churn behind it.
   */
  private trim(): void {
    if (this.transfers.size <= this.keep) return
    const finished = [...this.transfers.values()]
      .filter(transfer => transfer.status !== 'awaiting' && transfer.status !== 'transferring')
      .sort((left, right) => left.updatedAt - right.updatedAt)
    let excess = this.transfers.size - this.keep
    for (const transfer of finished) {
      if (excess <= 0) break
      this.transfers.delete(transfer.id)
      excess -= 1
    }
  }

  /**
   * Open an outgoing transfer.
   *
   * @param options - the peer and the files about to be offered.
   * @returns the new row's id.
   */
  openOutgoing(options: OpenOptions): string {
    const id = this.open(options, 'outgoing')
    // Sending is not a decision: there is nobody to ask on this side, so the row
    // starts moving rather than waiting on a prompt that will never come.
    this.update(id, (transfer) => {
      transfer.status = 'transferring'
      for (const file of transfer.files) file.status = 'transferring'
    })
    return id
  }

  /**
   * Open an incoming transfer, before the user has decided anything.
   *
   * @param options - the peer, its address, and the files it is offering.
   * @returns the new row's id, which becomes the LocalSend session id.
   */
  openIncoming(options: OpenOptions): string {
    return this.open(options, 'incoming')
  }

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
  private open(options: OpenOptions, direction: TransferDirection): string {
    const id = randomUUID()
    const files: TransferFile[] = options.files.map(file => ({
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      fileType: file.fileType,
      status: 'offered',
      bytesDone: 0,
    }))
    const now = Date.now()
    this.transfers.set(id, {
      id,
      direction,
      peerAlias: options.peerAlias,
      peerFingerprint: options.peerFingerprint,
      peerAddress: options.peerAddress,
      peerType: options.peerType,
      status: 'awaiting',
      files,
      bytesTotal: files.reduce((sum, file) => sum + file.size, 0),
      bytesDone: 0,
      createdAt: now,
      updatedAt: now,
    })
    this.trim()
    this.notify()
    return id
  }

  /**
   * Apply a change to one transfer, then notify and trim.
   *
   * @param id - registry identifier.
   * @param change - mutation applied to the live row.
   * @returns whether the row existed.
   */
  update(id: string, change: (transfer: Transfer) => void): boolean {
    const transfer = this.transfers.get(id)
    if (transfer === undefined) return false
    change(transfer)
    transfer.updatedAt = Date.now()
    this.trim()
    this.notify()
    return true
  }

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
  updateFile(id: string, fileId: string, change: (file: TransferFile) => void): boolean {
    const transfer = this.transfers.get(id)
    if (transfer === undefined) return false
    const file = transfer.files.find(candidate => candidate.id === fileId)
    if (file === undefined) return false
    change(file)
    transfer.bytesDone = transfer.files.reduce((sum, candidate) => sum + candidate.bytesDone, 0)
    transfer.updatedAt = Date.now()
    this.notify()
    return true
  }

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
  settle(id: string, fallback: TransferStatus = 'failed'): void {
    this.update(id, (transfer) => {
      const done = transfer.files.filter(file => file.status === 'done').length
      const failed = transfer.files.filter(file => file.status === 'failed').length
      const declined = transfer.files.filter(file => file.status === 'declined').length
      if (done === transfer.files.length) {
        transfer.status = 'done'
        return
      }
      if (done > 0 && done + failed + declined === transfer.files.length) {
        transfer.status = 'partial'
        return
      }
      if (declined === transfer.files.length) {
        transfer.status = 'declined'
        return
      }
      transfer.status = failed > 0 ? 'failed' : fallback
    })
  }

  /**
   * Mark a whole transfer failed with one reason.
   * @param id - registry identifier.
   * @param error - message to show the user.
   */
  fail(id: string, error: string): void {
    this.update(id, (transfer) => {
      transfer.status = 'failed'
      transfer.error = error
    })
    this.decide(id, false)
  }

  /**
   * Mark a whole transfer canceled by either side.
   * @param id - registry identifier.
   */
  cancel(id: string): void {
    this.update(id, (transfer) => {
      if (transfer.status === 'done' || transfer.status === 'canceled') return
      transfer.status = 'canceled'
      for (const file of transfer.files) {
        if (file.status === 'offered' || file.status === 'transferring') file.status = 'declined'
      }
    })
    this.decide(id, false)
  }

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
  await(id: string): Promise<boolean> {
    if (this.decisions.has(id)) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      this.decisions.set(id, resolve)
    })
  }

  /**
   * Settle a pending decision.
   * @param id - registry identifier.
   * @param accepted - the user's answer.
   * @returns whether a decision was actually pending.
   */
  decide(id: string, accepted: boolean): boolean {
    const resolve = this.decisions.get(id)
    if (resolve === undefined) return false
    this.decisions.delete(id)
    resolve(accepted)
    return true
  }

  /**
   * Settle every pending decision as declined.
   *
   * Called when the plugin unloads: a sender left holding an open connection
   * against a plugin that no longer exists would otherwise wait for its own
   * timeout, and the HTTP server is about to go away underneath it.
   */
  declineAll(): void {
    for (const [id, resolve] of this.decisions) {
      this.decisions.delete(id)
      resolve(false)
    }
  }

  /** Forget every transfer and settle every decision. */
  clear(): void {
    this.declineAll()
    this.transfers.clear()
    this.notify()
  }
}
