/**
 * The receiver, exercised over a real socket by a stand-in peer.
 *
 * Everything here goes through HTTP on purpose. The value of these tests is that
 * they pin the wire contract — status codes, message bodies, the token rules —
 * against an implementation that has to satisfy a phone running the official
 * app, and a test that called the handler directly would not notice a wrong
 * status code or a missing token check.
 *
 * @module dsh-local-send/tests/receiver
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalSendServer } from '../src/server.ts'
import { DEFAULT_CONFIG, ensureDirectories, storePaths, type LocalSendConfig } from '../src/store.ts'
import { TransferRegistry } from '../src/transfer.ts'
import { MESSAGE, STATUS, type DeviceInfo } from '../src/protocol.ts'

/** A device identity for the stand-in peer. */
const PEER: DeviceInfo = {
  alias: 'Test Phone',
  version: '2.2',
  deviceType: 'mobile',
  deviceModel: 'Test',
  fingerprint: 'peer-fingerprint',
  port: 53317,
  protocol: 'http',
}

/** A running receiver plus the paths it was given. */
interface Harness {
  readonly server: LocalSendServer
  readonly registry: TransferRegistry
  readonly port: number
  readonly inbox: string
  readonly config: LocalSendConfig
  readonly warnings: string[]
  stop(): Promise<void>
}

/** Everything started by a test, torn down afterwards. */
const running: Harness[] = []

afterEach(async () => {
  while (running.length > 0) {
    const harness = running.pop()
    if (harness !== undefined) await harness.stop()
  }
})

/**
 * Start a receiver on an ephemeral port over a temporary home.
 *
 * @param overrides - configuration to replace the shipped defaults with.
 * @returns the running harness.
 */
async function startReceiver(overrides: Partial<LocalSendConfig> = {}): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-local-send-test-'))
  const paths = storePaths(home)
  ensureDirectories(paths)
  const registry = new TransferRegistry()
  const warnings: string[] = []
  const config: LocalSendConfig = {
    ...DEFAULT_CONFIG,
    // The port is chosen by the OS: these tests must run on a machine that may
    // already have the real LocalSend port in use.
    port: 0,
    ...overrides,
  }
  const server = new LocalSendServer({
    config: () => config,
    info: () => PEER,
    registry,
    paths,
    warn: (message: string) => { warnings.push(message) },
    sawPeer: () => {},
  })
  const port = await server.start(0)
  const harness: Harness = {
    server,
    registry,
    port,
    inbox: paths.inbox,
    config,
    warnings,
    stop: async () => {
      await server.stop()
      rmSync(home, { recursive: true, force: true })
    },
  }
  running.push(harness)
  return harness
}

/** The absolute URL of one route on a harness. */
function urlOf(harness: Harness, route: string): string {
  return `http://127.0.0.1:${String(harness.port)}/api/localsend/v2/${route}`
}

/** Offer one file and return the raw response. */
async function prepare(
  harness: Harness,
  body: unknown,
  query = '',
): Promise<Response> {
  return await fetch(urlOf(harness, `prepare-upload${query}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** One file's metadata, sized and named. */
function fileOf(id: string, fileName: string, bytes: Buffer): Record<string, unknown> {
  return {
    id,
    fileName,
    size: bytes.length,
    fileType: 'application/octet-stream',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** A preparation body offering the given files. */
function offer(files: readonly Record<string, unknown>[]): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const file of files) map[String(file['id'])] = file
  return { info: PEER, files: map }
}

describe('LocalSend receiver', () => {
  it('answers register with its identity and no location', async () => {
    const harness = await startReceiver()
    const response = await fetch(urlOf(harness, 'register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PEER),
    })
    expect(response.status).toBe(STATUS.ok)
    const body = await response.json() as Record<string, unknown>
    expect(body['alias']).toBe(PEER.alias)
    expect(body['fingerprint']).toBe(PEER.fingerprint)
    // The reference implementation omits these: the caller is already talking to
    // this device and learned both from the connection.
    expect(body).not.toHaveProperty('port')
    expect(body).not.toHaveProperty('protocol')
  })

  it('receives a whole file and verifies its checksum', async () => {
    const harness = await startReceiver({ autoAccept: true })
    const bytes = Buffer.from('hello from the other device\n'.repeat(64))
    const response = await prepare(harness, offer([fileOf('a', 'note.txt', bytes)]))
    expect(response.status).toBe(STATUS.ok)
    const body = await response.json() as { sessionId: string; files: Record<string, string> }
    expect(body.files['a']).toBeTypeOf('string')

    const upload = await fetch(
      `${urlOf(harness, 'upload')}?sessionId=${body.sessionId}&fileId=a&token=${body.files['a'] as string}`,
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes },
    )
    expect(upload.status).toBe(STATUS.ok)
    expect(readFileSync(join(harness.inbox, 'note.txt'))).toEqual(bytes)

    const row = harness.registry.get(body.sessionId)
    expect(row?.status).toBe('done')
    expect(row?.files[0]?.status).toBe('done')
    expect(row?.files[0]?.savedPath).toBe(join(harness.inbox, 'note.txt'))
  })

  it('writes nothing when the checksum fails', async () => {
    const harness = await startReceiver({ autoAccept: true })
    const bytes = Buffer.from('the real bytes')
    const response = await prepare(harness, offer([fileOf('a', 'note.txt', bytes)]))
    const body = await response.json() as { sessionId: string; files: Record<string, string> }
    // Same length, different content: this is the corruption case the checksum
    // exists for. A longer body would trip the byte-count guard first and test
    // something else.
    const corrupted = Buffer.from('the REAL bytes')
    expect(corrupted).toHaveLength(bytes.length)
    const upload = await fetch(
      `${urlOf(harness, 'upload')}?sessionId=${body.sessionId}&fileId=a&token=${body.files['a'] as string}`,
      { method: 'POST', body: corrupted },
    )
    expect(upload.status).toBe(STATUS.unprocessable)
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(harness.inbox).filter(name => name !== '.partial')).toEqual([])
  })

  it('refuses an upload presented from a token that is not its own', async () => {
    const harness = await startReceiver({ autoAccept: true })
    const bytes = Buffer.from('guarded')
    const response = await prepare(harness, offer([fileOf('a', 'note.txt', bytes)]))
    const body = await response.json() as { sessionId: string; files: Record<string, string> }
    const upload = await fetch(
      `${urlOf(harness, 'upload')}?sessionId=${body.sessionId}&fileId=a&token=${randomUUID()}`,
      { method: 'POST', body: bytes },
    )
    expect(upload.status).toBe(STATUS.forbidden)
    expect(await upload.json()).toEqual({ message: MESSAGE.invalidToken })
  })

  it('refuses a file larger than the configured ceiling, before any bytes move', async () => {
    const harness = await startReceiver({ autoAccept: true, maxFileBytes: 8 })
    const response = await prepare(harness, offer([fileOf('a', 'big.bin', Buffer.alloc(64))]))
    // Nothing was acceptable, so there is nothing to send: the protocol's own
    // "no file transfer needed" success.
    expect(response.status).toBe(STATUS.noContent)
  })

  it('reports the files a size ceiling refused, and still sends the rest', async () => {
    const harness = await startReceiver({ autoAccept: true, maxFileBytes: 8 })
    const small = Buffer.from('ok')
    const big = Buffer.alloc(64, 1)
    const response = await prepare(harness, offer([fileOf('a', 'small.txt', small), fileOf('b', 'big.bin', big)]))
    expect(response.status).toBe(STATUS.ok)
    const body = await response.json() as { sessionId: string; files: Record<string, string> }
    expect(Object.keys(body.files)).toEqual(['a'])
    const row = harness.registry.get(body.sessionId)
    expect(row?.files.find(file => file.id === 'b')?.status).toBe('declined')
    expect(row?.files.find(file => file.id === 'b')?.error).toContain('larger than')
  })

  it('answers a wrong PIN with 401 and then refuses the address outright', async () => {
    const harness = await startReceiver({ autoAccept: true, pin: '1234' })
    const bytes = Buffer.from('x')
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await prepare(harness, offer([fileOf('a', 'note.txt', bytes)]), '?pin=9999')
      expect(response.status).toBe(STATUS.unauthorized)
      expect(await response.json()).toEqual({ message: MESSAGE.invalidPin })
    }
    // The fourth attempt is over the limit whatever it sends, so a retry loop
    // cannot use the 401 to keep guessing.
    const blocked = await prepare(harness, offer([fileOf('a', 'note.txt', bytes)]), '?pin=1234')
    expect(blocked.status).toBe(STATUS.tooManyRequests)
    expect(await blocked.json()).toEqual({ message: MESSAGE.tooManyRequests })
  })

  it('accepts the offer once the PIN is right', async () => {
    const harness = await startReceiver({ autoAccept: true, pin: '1234' })
    const bytes = Buffer.from('pin ok')
    const response = await prepare(harness, offer([fileOf('a', 'note.txt', bytes)]), '?pin=1234')
    expect(response.status).toBe(STATUS.ok)
  })

  it('declines the offer when the user says no', async () => {
    const harness = await startReceiver()
    const bytes = Buffer.from('unwanted')
    const pending = prepare(harness, offer([fileOf('a', 'note.txt', bytes)]))
    // Wait for the offer to reach the registry, which is when the user would see
    // it, then answer the way the panel's Decline button does.
    const row = await waitForTransfer(harness)
    expect(row.status).toBe('awaiting')
    harness.registry.decide(row.id, false)
    const response = await pending
    expect(response.status).toBe(STATUS.forbidden)
    expect(await response.json()).toEqual({ message: MESSAGE.rejected })
  })

  it('lets a sender withdraw an offer it is still waiting on, without the session id', async () => {
    const harness = await startReceiver()
    const pending = prepare(harness, offer([fileOf('a', 'note.txt', Buffer.from('withdrawn'))]))
    await waitForTransfer(harness)
    // A sender on protocol 2.0-2.2 does not learn the session id until the
    // preparation response arrives, so it cancels by address alone.
    const cancel = await fetch(urlOf(harness, 'cancel'), { method: 'POST' })
    expect(cancel.status).toBe(STATUS.ok)
    const response = await pending
    expect(response.status).toBe(STATUS.forbidden)
    expect(await response.json()).toEqual({ message: MESSAGE.cancelledBySender })
  })

  it('answers a cancel for a session it never had with success', async () => {
    const harness = await startReceiver()
    const cancel = await fetch(
      `${urlOf(harness, 'cancel')}?sessionId=${randomUUID()}`,
      { method: 'POST' },
    )
    // A sender retrying a cancel it already delivered must not see an error.
    expect(cancel.status).toBe(STATUS.ok)
  })

  it('reports a malformed preparation body as invalid JSON', async () => {
    const harness = await startReceiver({ autoAccept: true })
    const response = await fetch(urlOf(harness, 'prepare-upload'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })
    expect(response.status).toBe(STATUS.badRequest)
    expect(await response.json()).toEqual({ message: MESSAGE.invalidJson })
  })

  it('answers an unknown route with a bare 404', async () => {
    const harness = await startReceiver()
    const response = await fetch(urlOf(harness, 'nonsense'), { method: 'POST' })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('keeps a file name that collides with one already in the inbox', async () => {
    const harness = await startReceiver({ autoAccept: true })
    writeFileSync(join(harness.inbox, 'report.pdf'), 'first')
    const bytes = Buffer.from('second')
    const response = await prepare(harness, offer([fileOf('a', 'report.pdf', bytes)]))
    const body = await response.json() as { sessionId: string; files: Record<string, string> }
    await fetch(
      `${urlOf(harness, 'upload')}?sessionId=${body.sessionId}&fileId=a&token=${body.files['a'] as string}`,
      { method: 'POST', body: bytes },
    )
    // Receiving the same name twice is normal; overwriting the first copy would
    // lose data the receiver never agreed to lose.
    expect(readFileSync(join(harness.inbox, 'report (1).pdf'), 'utf8')).toBe('second')
    expect(readFileSync(join(harness.inbox, 'report.pdf'), 'utf8')).toBe('first')
  })

  it('never writes outside the inbox, whatever the sender calls the file', async () => {
    const harness = await startReceiver({ autoAccept: true })
    const bytes = Buffer.from('escaped?')
    const response = await prepare(harness, offer([fileOf('a', '../../escaped.txt', bytes)]))
    const body = await response.json() as { sessionId: string; files: Record<string, string> }
    await fetch(
      `${urlOf(harness, 'upload')}?sessionId=${body.sessionId}&fileId=a&token=${body.files['a'] as string}`,
      { method: 'POST', body: bytes },
    )
    const { readdirSync, existsSync } = await import('node:fs')
    const written = readdirSync(harness.inbox).filter(name => name !== '.partial')
    // The name is refused rather than repaired, so the file lands under a
    // generated one and nothing appears outside the directory.
    expect(written).toHaveLength(1)
    expect(written[0]).not.toContain('/')
    expect(existsSync(join(harness.inbox, '..', '..', 'escaped.txt'))).toBe(false)
  })

  it('refuses a second sender while an offer is still waiting', async () => {
    const harness = await startReceiver()
    const first = prepare(harness, offer([fileOf('a', 'one.txt', Buffer.from('one'))]))
    await waitForTransfer(harness)
    const second = await prepare(harness, offer([fileOf('b', 'two.txt', Buffer.from('two'))]))
    expect(second.status).toBe(STATUS.conflict)
    expect(await second.json()).toEqual({ message: MESSAGE.blocked })
    // Release the first so the harness can shut down cleanly.
    harness.registry.declineAll()
    await first
  })
})

/**
 * Wait until the receiver has an offer in its registry.
 *
 * The preparation handler deliberately blocks on the user, so a test that wants
 * to answer it has to observe the row first rather than awaiting the response.
 *
 * @param harness - the running receiver.
 * @returns the row now waiting.
 */
async function waitForTransfer(harness: Harness): Promise<{ id: string; status: string }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = harness.registry.list()[0]
    if (row !== undefined) return row
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the receiver never registered the offer')
}
