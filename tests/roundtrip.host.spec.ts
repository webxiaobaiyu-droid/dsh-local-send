/**
 * The sending half against the receiving half, over a real socket.
 *
 * A loopback round trip is the only test that exercises both sides of the
 * handshake at once: the offer, the token map, the per-file upload, and the
 * progress the sender reports while the bytes move. Each half can pass its own
 * tests while disagreeing about, say, the query parameter names — and this is
 * the test that would notice.
 *
 * @module dsh-local-send/tests/roundtrip
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { offerIdsFor, sendPaths, type OutboundPeer } from '../src/outbound.ts'
import { LocalSendServer } from '../src/server.ts'
import { DEFAULT_CONFIG, ensureDirectories, storePaths, type LocalSendConfig } from '../src/store.ts'
import { TransferRegistry } from '../src/transfer.ts'
import type { DeviceInfo } from '../src/protocol.ts'

/** The receiving device's identity. */
const RECEIVER: DeviceInfo = {
  alias: 'Receiver',
  version: '2.2',
  deviceType: 'desktop',
  fingerprint: 'receiver-fingerprint',
  port: 53317,
  protocol: 'http',
}

/** The sending device's identity. */
const SENDER: DeviceInfo = {
  alias: 'Sender',
  version: '2.2',
  deviceType: 'desktop',
  fingerprint: 'sender-fingerprint',
  port: 53317,
  protocol: 'http',
}

/** One running receiver, plus where it writes. */
interface Receiver {
  readonly server: LocalSendServer
  readonly registry: TransferRegistry
  readonly inbox: string
  readonly home: string
  readonly peer: OutboundPeer
  stop(): Promise<void>
}

const stopped: (() => Promise<void>)[] = []

afterEach(async () => {
  while (stopped.length > 0) await stopped.pop()?.()
})

/**
 * Start a receiver on an OS-chosen port.
 * @param overrides - configuration to replace the defaults with.
 * @returns the running receiver.
 */
async function startReceiver(overrides: Partial<LocalSendConfig> = {}): Promise<Receiver> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-local-send-rt-'))
  const paths = storePaths(home)
  ensureDirectories(paths)
  const registry = new TransferRegistry()
  const config: LocalSendConfig = { ...DEFAULT_CONFIG, port: 0, autoAccept: true, ...overrides }
  const server = new LocalSendServer({
    config: () => config,
    info: () => RECEIVER,
    registry,
    paths,
    warn: () => {},
    sawPeer: () => {},
  })
  const port = await server.start(0)
  const stop = async (): Promise<void> => {
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  }
  stopped.push(stop)
  return {
    server,
    registry,
    inbox: paths.inbox,
    home,
    peer: {
      fingerprint: RECEIVER.fingerprint,
      alias: RECEIVER.alias,
      host: '127.0.0.1',
      port,
      protocol: 'http',
      deviceType: 'desktop',
    },
    stop,
  }
}

/** A scratch directory holding files to send. */
function scratch(files: Record<string, string>): { readonly root: string; path(name: string): string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-local-send-src-'))
  stopped.push(async () => { rmSync(root, { recursive: true, force: true }) })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return { root, path: (name: string) => join(root, name) }
}

describe('sendPaths against a live receiver', () => {
  it('delivers one file and reports the transfer as done', async () => {
    const receiver = await startReceiver()
    const source = scratch({ 'note.txt': 'the payload' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [source.path('note.txt')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.accepted).toBe(true)
    expect(outcome.failed).toEqual([])
    expect(outcome.sent).toEqual(['f1'])
    expect(readFileSync(join(receiver.inbox, 'note.txt'), 'utf8')).toBe('the payload')

    const row = registry.get(outcome.transferId)
    expect(row?.direction).toBe('outgoing')
    expect(row?.status).toBe('done')
    expect(row?.files[0]?.status).toBe('done')
    // Progress has to end at the file's own size, or the row would show a
    // transfer stuck below a hundred percent.
    expect(row?.bytesDone).toBe(row?.bytesTotal)
    expect(row?.bytesDone).toBe(Buffer.byteLength('the payload'))
  })

  it('delivers a batch and keeps the receiver’s rows in step', async () => {
    const receiver = await startReceiver()
    const source = scratch({ 'a.txt': 'first', 'b.txt': 'second', 'c.txt': 'third' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [source.path('a.txt'), source.path('b.txt'), source.path('c.txt')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.sent).toHaveLength(3)
    expect(readFileSync(join(receiver.inbox, 'a.txt'), 'utf8')).toBe('first')
    expect(readFileSync(join(receiver.inbox, 'c.txt'), 'utf8')).toBe('third')
    const received = receiver.registry.list()[0]
    expect(received?.status).toBe('done')
    expect(received?.files.every(file => file.status === 'done')).toBe(true)
  })

  it('carries a file well past one read buffer', async () => {
    const receiver = await startReceiver()
    // Comfortably over the 64 KiB high-water mark a stream reads in, so the
    // chunk loop, the backpressure wait and the byte accounting all run more
    // than once.
    const content = 'x'.repeat(300_000)
    const source = scratch({ 'large.bin': content })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [source.path('large.bin')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.sent).toEqual(['f1'])
    expect(readFileSync(join(receiver.inbox, 'large.bin'), 'utf8')).toHaveLength(content.length)
    expect(registry.get(outcome.transferId)?.bytesDone).toBe(content.length)
  })

  it('reports a refusal without sending anything', async () => {
    // The receiver refuses every file on size, so the offer is answered 204 and
    // there is nothing to upload.
    const receiver = await startReceiver({ maxFileBytes: 4 })
    const source = scratch({ 'big.bin': 'far too long to accept' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [source.path('big.bin')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.accepted).toBe(false)
    expect(outcome.sent).toEqual([])
    const row = registry.get(outcome.transferId)
    expect(row?.status).not.toBe('done')
  })

  it('reports a peer that is not listening as a failed transfer', async () => {
    const receiver = await startReceiver()
    await receiver.stop()
    const source = scratch({ 'note.txt': 'into the void' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [source.path('note.txt')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.accepted).toBe(false)
    const row = registry.get(outcome.transferId)
    expect(row?.status).toBe('failed')
    // The failure has to be legible: a row that says only "failed" leaves the
    // user with nothing to act on.
    expect(row?.error).toBeTruthy()
  })

  it('tells the peer to forget an offer the sender has given up on', async () => {
    // A receiver that accepts two files and receives one is left with an open
    // session. The sender abandoning the batch must withdraw it, or the receiver
    // keeps the staging bookkeeping for a transfer nobody is sending.
    const receiver = await startReceiver()
    const source = scratch({ 'first.txt': 'one', 'second.txt': 'two' })
    const { prepareOffer, uploadStream, cancelOffer } = await import('../src/outbound.ts')
    const { createReadStream } = await import('node:fs')
    const registry = new TransferRegistry()

    const offered = [source.path('first.txt'), source.path('second.txt')].map((path, index) => ({
      id: `f${String(index + 1)}`,
      fileName: `file${String(index + 1)}.txt`,
      size: 3,
      fileType: 'text/plain',
    }))
    const prepared = await prepareOffer(receiver.peer, offered, SENDER, { registry, warn: () => {} })
    if ('refused' in prepared) throw new Error('the receiver refused the offer')
    await uploadStream(prepared, 'f1', createReadStream(source.path('first.txt')), registry)
    // Only one of the two arrived, and the sender has decided not to send the
    // other.
    await cancelOffer(prepared, () => {})

    const row = receiver.registry.list()[0]
    expect(row?.status).toBe('canceled')
    expect(row?.files.find(file => file.id === 'f1')?.status).toBe('done')
    expect(row?.files.find(file => file.id === 'f2')?.status).toBe('declined')
    expect(receiver.registry.busy()).toBe(false)
  })

  it('can be sent to again after a batch it gave up on', async () => {
    const receiver = await startReceiver()
    const source = scratch({ 'good.txt': 'readable', 'again.txt': 'second go' })
    const registry = new TransferRegistry()
    await sendPaths(
      receiver.peer,
      [join(source.root, 'missing.txt'), source.path('good.txt')],
      SENDER,
      { registry, warn: () => {} },
    )
    // The protocol allows one live session per receiver, so a new send is what
    // proves the abandoned one did not take the slot with it.
    const second = await sendPaths(receiver.peer, [source.path('again.txt')], SENDER, { registry, warn: () => {} })
    expect(second.accepted).toBe(true)
    expect(second.sent).toEqual(['f1'])
    expect(readFileSync(join(receiver.inbox, 'again.txt'), 'utf8')).toBe('second go')
  })

  it('leaves the receiver’s session in place when everything arrived', async () => {
    const receiver = await startReceiver()
    const source = scratch({ 'ok.txt': 'delivered' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(receiver.peer, [source.path('ok.txt')], SENDER, { registry, warn: () => {} })

    // Nothing to withdraw: a completed transfer must not be cancelled, or the
    // receiver would mark files it already wrote as declined.
    expect(outcome.failed).toEqual([])
    const row = receiver.registry.list()[0]
    expect(row?.status).toBe('done')
    expect(row?.files[0]?.status).toBe('done')
  })

  it('reports files it cannot read at all, and still sends the readable ones', async () => {
    const receiver = await startReceiver()
    const source = scratch({ 'good.txt': 'readable' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [join(source.root, 'missing.txt'), source.path('good.txt')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.sent).toEqual(['f2'])
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]?.id).toBe('f1')
    expect(readFileSync(join(receiver.inbox, 'good.txt'), 'utf8')).toBe('readable')
    const row = registry.get(outcome.transferId)
    expect(row?.files.find(file => file.id === 'f1')?.status).toBe('failed')
  })

  it('deduplicates two files that share a base name', async () => {
    const receiver = await startReceiver()
    const first = scratch({ 'report.pdf': 'one' })
    const second = scratch({ 'report.pdf': 'two' })
    const registry = new TransferRegistry()
    const outcome = await sendPaths(
      receiver.peer,
      [first.path('report.pdf'), second.path('report.pdf')],
      SENDER,
      { registry, warn: () => {} },
    )

    expect(outcome.sent).toHaveLength(2)
    // Two directories can each hold `report.pdf`; a batch carrying both must not
    // ask the receiver to save one over the other.
    expect(readFileSync(join(receiver.inbox, 'report.pdf'), 'utf8')).toBe('one')
    expect(readFileSync(join(receiver.inbox, 'report (1).pdf'), 'utf8')).toBe('two')
  })
})

describe('offerIdsFor', () => {
  it('names files by base name and keeps them distinct', () => {
    const ids = offerIdsFor(['/one/report.pdf', '/two/report.pdf', '/three/notes.md'])
    expect(ids.map(entry => entry.fileName)).toEqual(['report.pdf', 'report (1).pdf', 'notes.md'])
    expect(ids.map(entry => entry.id)).toEqual(['f1', 'f2', 'f3'])
  })
})
