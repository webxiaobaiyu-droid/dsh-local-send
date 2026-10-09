#!/usr/bin/env node
/**
 * The reverse direction of the fake-peer self-test: the plugin's *sender*
 * (the code the panel's 按路径发送 drives) offering to a running fake peer,
 * which receives, verifies the checksum, and saves the file.
 *
 * @module dsh-local-send/scripts/fake-peer-selftest-reverse
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fake-peer-reverse-'))
const work = join(home, 'work')
const { mkdirSync } = await import('node:fs')
mkdirSync(work, { recursive: true })

const payloadPath = join(work, 'outbound.bin')
const payload = Buffer.from(`reverse self-test ${Date.now()}\n`.repeat(500))
writeFileSync(payloadPath, payload)
const expectedHash = createHash('sha256').update(payload).digest('hex')
const peerInbox = join(home, 'peer-inbox')

import { register } from 'node:module'
// TypeScript sources load through the repo's own transformer; see the loader.
register(new URL('./ts-source-loader.mjs', import.meta.url))

const { TransferRegistry } = await import('../src/transfer.ts')
const { sendPaths } = await import('../src/outbound.ts')
const { PROTOCOL_VERSION } = await import('../src/protocol.ts')

// A free TCP port for the fake peer's API.
const PORT = await new Promise((resolvePort) => {
  const probe = createServer()
  probe.once('listening', () => {
    const address = probe.address()
    probe.close(() => resolvePort(typeof address === 'object' && address !== null ? address.port : 0))
  })
  probe.listen(0, '127.0.0.1')
})

// The fake peer as a pure receiver, saving into the test's own directory.
const peer = spawn(process.execPath, [
  'scripts/fake-peer.mjs',
  '--name', 'Reverse selftest peer',
  '--port', String(PORT),
  '--save', peerInbox,
  '--stay',
], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] })
let peerOutput = ''
peer.stdout.on('data', (chunk) => { peerOutput += chunk })
peer.stderr.on('data', (chunk) => { peerOutput += chunk })

// Wait until its API answers, so the send below never races the bind.
const origin = `http://127.0.0.1:${PORT}`
let up = false
let lastError = ''
for (let i = 0; i < 50 && !up; i++) {
  up = await fetch(`${origin}/api/localsend/v2/info`).then((r) => { lastError = `HTTP ${r.status}`; return r.ok }, (e) => { lastError = e.message; return false })
  if (!up) await new Promise((wait) => setTimeout(wait, 100))
}
if (!up) console.log('fake peer API probe failed:', lastError)

const registry = new TransferRegistry()
const self = {
  alias: 'Reverse selftest sender',
  version: PROTOCOL_VERSION,
  fingerprint: 'reverse-sender',
  port: PORT,
  protocol: 'http',
  download: false,
}
const outcome = await sendPaths(
  {
    alias: 'Reverse selftest peer',
    fingerprint: 'reverse-peer',
    host: '127.0.0.1',
    port: PORT,
    origin,
    protocol: 'http',
    deviceType: 'mobile',
  },
  [payloadPath],
  self,
  {
    registry,
    warn: (message) => console.log('sender warn:', message),
  },
)
if (!outcome.accepted) console.log('sender outcome:', JSON.stringify(outcome, null, 2))

peer.kill('SIGTERM')
await new Promise((done) => peer.on('exit', done))

const problems = []
if (!up) problems.push('the fake peer API never answered')
if (!outcome.accepted) problems.push('the fake peer did not accept the offer')
if (outcome.sent.length !== 1) problems.push(`sent ${outcome.sent.length} file(s), expected 1`)
const saved = join(peerInbox, 'outbound.bin')
let received
try { received = readFileSync(saved) } catch { problems.push(`nothing was saved at ${saved}`) }
if (received !== undefined && createHash('sha256').update(received).digest('hex') !== expectedHash) {
  problems.push('checksum of the saved file does not match')
}

console.log('--- fake peer output ---')
console.log(peerOutput.trim())
console.log('--- result ---')
if (problems.length > 0) {
  console.error('FAILED:', problems.join('; '))
  rmSync(home, { recursive: true, force: true })
  process.exit(1)
}
console.log('PASS: the plugin sender offered to the fake peer, which accepted, received the bytes, and verified the checksum.')
rmSync(home, { recursive: true, force: true })
