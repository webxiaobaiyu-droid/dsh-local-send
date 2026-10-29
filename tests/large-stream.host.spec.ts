/**
 * A large upload must start arriving before its source is exhausted.
 *
 * This is the regression the "few GB" sends were failing: the sender used to hand
 * a streamed body to `fetch`, and undici buffered the whole thing — a 1 GiB file
 * took the process from 52 MB to 1.1 GB of RSS, and a multi-gigabyte one killed
 * it outright. A correctness test cannot see that, because the bytes do
 * eventually arrive; what distinguishes streaming from buffering is *when* they
 * arrive.
 *
 * So the assertion is about ordering, not memory: the sink has to observe early
 * bytes while the source is still open. Under buffering nothing arrives until the
 * body ends, and the test times out instead of passing.
 *
 * @module dsh-local-send/tests/large-stream
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { uploadStream, type PreparedOffer } from '../src/outbound.ts'
import { TransferRegistry } from '../src/transfer.ts'

/** One accept-and-drain server, plus what it saw. */
interface Sink {
  readonly origin: string
  /** Bytes received so far. */
  readonly seen: () => number
  /** The `content-length` the sender declared, if any. */
  readonly declaredLength: () => string | undefined
  /** Resolves once at least `target` bytes have arrived. */
  waitFor(target: number): Promise<void>
  /** Stop reading, so the sender's socket — and through it the source — stalls. */
  pause(): void
  /** Start reading again, so the transfer can be finished and cleaned up. */
  resume(): void
  close(): Promise<void>
}

/**
 * Start a sink that counts bytes and answers 200 when the body ends.
 * @returns the sink.
 */
async function startSink(): Promise<Sink> {
  let received = 0
  let declared: string | undefined
  let notify: (() => void) | undefined
  let inbound: import('node:http').IncomingMessage | undefined
  const server = createServer((request, response) => {
    inbound = request
    declared = typeof request.headers['content-length'] === 'string'
      ? request.headers['content-length']
      : undefined
    request.on('data', (chunk: Buffer) => {
      received += chunk.length
      notify?.()
    })
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const port = (server.address() as AddressInfo).port
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    seen: () => received,
    declaredLength: () => declared,
    waitFor: (target) => new Promise<void>((resolve) => {
      if (received >= target) { resolve(); return }
      notify = () => {
        if (received < target) return
        notify = undefined
        resolve()
      }
    }),
    pause: () => { inbound?.pause() },
    resume: () => { inbound?.resume() },
    close: async () => {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

/** A registry with one accepted file already open. */
function registryFor(size: number): { registry: TransferRegistry; offer: PreparedOffer } {
  const registry = new TransferRegistry()
  const transferId = registry.openOutgoing({
    peerAlias: 'sink',
    peerFingerprint: 'sink',
    peerAddress: '127.0.0.1',
    peerType: 'desktop',
    files: [{ id: 'f1', fileName: 'large.bin', size, fileType: 'application/octet-stream' }],
  })
  return {
    registry,
    offer: {
      transferId,
      origin: '',
      sessionId: 'session',
      tokens: { f1: 'token' },
      accepted: new Map([['f1', { id: 'f1', fileName: 'large.bin', size, fileType: 'application/octet-stream' }]]),
      declined: [],
    },
  }
}

/** A source that yields `size` bytes in 64 KiB chunks. */
async function* bytes(size: number): AsyncGenerator<Buffer> {
  for (let sent = 0; sent < size; sent += 64 * 1024) {
    yield Buffer.alloc(Math.min(64 * 1024, size - sent), 7)
  }
}

const open: (() => Promise<void>)[] = []

afterEach(async () => {
  while (open.length > 0) await open.pop()?.()
})

describe('a large upload', () => {
  it('declares its exact length', async () => {
    const sink = await startSink()
    open.push(sink.close)
    const total = 8 * 1024 * 1024
    const { registry, offer } = registryFor(total)
    await uploadStream({ ...offer, origin: sink.origin }, 'f1', bytes(total) as never, registry)
    expect(sink.declaredLength()).toBe(String(total))
    expect(sink.seen()).toBe(total)
  })

  it('does not carry the body through fetch', async () => {
    // The actual regression, pinned by construction. undici's `fetch` holds a
    // streamed request body in memory — measured, a 1 GiB upload took this
    // process from 52 MB to 1.1 GB of RSS — and no amount of backpressure in the
    // caller changes that. The sender therefore has to use `node:http`, and this
    // test fails the moment someone puts a `fetch` back in the path.
    const sink = await startSink()
    open.push(sink.close)
    const total = 1024 * 1024
    const { registry, offer } = registryFor(total)
    const original = globalThis.fetch
    let used = false
    globalThis.fetch = (async () => {
      used = true
      throw new Error('the upload body must not go through fetch')
    }) as typeof fetch
    try {
      await uploadStream({ ...offer, origin: sink.origin }, 'f1', bytes(total) as never, registry)
    } finally {
      globalThis.fetch = original
    }
    expect(used).toBe(false)
    expect(sink.seen()).toBe(total)
  })

  it('stops pulling from the source when the peer stops reading', async () => {
    // This is the memory bug, stated as backpressure: the sender must not read
    // ahead of a peer that has stopped reading. `fetch` does — it drains the body
    // into memory while the socket idles, which is how a 1 GiB file took the
    // process to 1.1 GB. `pipeline` does not: with the sink paused, the source
    // stays parked within a socket buffer of what has been acknowledged.
    const sink = await startSink()
    open.push(sink.close)
    const total = 64 * 1024 * 1024
    const { registry, offer } = registryFor(total)

    let yielded = 0
    const source = (async function* chunks(): AsyncGenerator<Buffer> {
      while (yielded < total) {
        yielded += 64 * 1024
        yield Buffer.alloc(64 * 1024, 3)
      }
    })()

    const sending = uploadStream({ ...offer, origin: sink.origin }, 'f1', source as never, registry)
    await sink.waitFor(1024 * 1024)
    sink.pause()
    // Give a buffering sender every chance to drain the source while the peer is
    // not reading. 500 ms is thousands of times longer than a read ahead would
    // need if it were not bounded.
    await new Promise((wait) => setTimeout(wait, 500))
    const readAhead = yielded - sink.seen()
    expect(readAhead).toBeLessThan(16 * 1024 * 1024)
    sink.resume()
    await sending
    expect(sink.seen()).toBe(total)
  }, 20_000)
})
