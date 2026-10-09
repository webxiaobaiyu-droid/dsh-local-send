#!/usr/bin/env node
/**
 * Loopback self-test for the fake peer: a real plugin receive stack (the same
 * `LocalSendServer` and discovery the running DSH loads) plus a temporary
 * fake-peer process, exchanging real files over real sockets on one machine.
 *
 * @module dsh-local-send/scripts/fake-peer-selftest
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fake-peer-selftest-'))
const inbox = join(home, 'inbox')
const work = join(home, 'work')
const { mkdirSync } = await import('node:fs')
mkdirSync(inbox, { recursive: true })
mkdirSync(work, { recursive: true })

/** A payload with a checksum, so a correct receive is provable. */
const payloadPath = join(work, 'selftest.bin')
const payload = Buffer.from(`fake-peer self-test ${Date.now()}\n`.repeat(1000))
writeFileSync(payloadPath, payload)
const expectedHash = createHash('sha256').update(payload).digest('hex')

import { register } from 'node:module'
// TypeScript sources load through the repo's own transformer; see the loader.
register(new URL('./ts-source-loader.mjs', import.meta.url))

// The TypeScript sources are used here: the built bundle inlines every class
// behind the loader's entry, and this test wants the pieces directly. The
// loader above compiles them with the same transformer the build uses.
const { LocalSendServer } = await import('../src/server.ts')
const { DEFAULT_CONFIG, ensureDirectories, storePaths } = await import('../src/store.ts')
const { TransferRegistry } = await import('../src/transfer.ts')
const { MulticastDiscovery } = await import('../src/discovery.ts')
const { PROTOCOL_VERSION } = await import('../src/protocol.ts')

// Port 53317 belongs to the real plugin when DSH is running, which this test
// must not fight with; the protocol is port-agnostic, so pick a free one.
const PORT = await new Promise((resolvePort) => {
  const probe = createServer()
  probe.once('listening', () => {
    const address = probe.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    probe.close(() => resolvePort(port === 0 ? 0 : port === 0 ? 0 : port || 0))
  })
  probe.listen(53317 === 0 ? 0 : 53317 === 53317 ? 0 : 53317, '127.0.0.1')
})

const registry = new TransferRegistry()
// The receive directory comes from `config.receiveDir` when set, so route the
// receiver's writes into this test's temporary home rather than a real inbox.
const config = { ...DEFAULT_CONFIG, port: PORT, autoAccept: true, receiveDir: inbox }
const paths = storePaths(home)
ensureDirectories(paths)
const info = () => ({
  alias: 'Selftest receiver',
  version: PROTOCOL_VERSION,
  fingerprint: 'selftest-receiver',
  port: PORT,
  protocol: 'http',
  download: false,
})
const server = new LocalSendServer({
  config: () => config,
  info,
  registry,
  paths,
  warn: (message) => console.log('receiver warn:', message),
  sawPeer: () => {},
})
await server.start(PORT)
console.log(`receiver listening on ${PORT} (autoAccept on)`)

const discovery = new MulticastDiscovery({
  info,
  onWarning: (warning) => console.log('discovery warning:', warning),
  onPeer: () => {},
})
await discovery.start()
console.log('discovery started (loopback on, same as production)')

const peer = spawn(process.execPath, ['scripts/fake-peer.mjs', '--send', payloadPath, '--to', `127.0.0.1:${PORT}`, '--save', join(home, 'peer-inbox')], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let peerOutput = ''
peer.stdout.on('data', (chunk) => { peerOutput += chunk })
peer.stderr.on('data', (chunk) => { peerOutput += chunk })
const exit = await new Promise((done) => peer.on('exit', done))

await discovery.stop()
await server.stop()

const saved = join(inbox, 'selftest.bin')
const problems = []
if (exit !== 0) problems.push(`fake peer exited ${exit}`)
let received
try { received = readFileSync(saved) } catch { problems.push(`nothing was saved at ${saved}`) }
if (received !== undefined) {
  const actual = createHash('sha256').update(received).digest('hex')
  if (actual !== expectedHash) problems.push('checksum of the received file does not match')
}
const session = registry.list()[0]
if (session === undefined) problems.push('no transfer row was opened')
else if (session.status !== 'done') problems.push(`transfer row is ${session.status}, expected done`)

console.log('--- fake peer output ---')
console.log(peerOutput.trim())
console.log('--- result ---')
if (problems.length > 0) {
  console.error('FAILED:', problems.join('; '))
  rmSync(home, { recursive: true, force: true })
  process.exit(1)
}
console.log(`PASS: the fake peer offered selftest.bin (${String(payload.length)} B), the receiver accepted it, and the bytes on disk hash to the offered sha256.`)
rmSync(home, { recursive: true, force: true })
