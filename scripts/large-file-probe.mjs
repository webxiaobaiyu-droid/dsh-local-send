#!/usr/bin/env node
/**
 * Probe one large file through the real sender into the fake peer.
 *
 * Temporary tool for reproducing the multi-gigabyte crash; prints the sender's
 * RSS every second so an allocation shows up before the failure does.
 *
 * Usage: node scripts/large-file-probe.mjs [gigabytes]
 *
 * @module dsh-local-send/scripts/large-file-probe
 */

import { spawn } from 'node:child_process'
import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

register(new URL('./ts-source-loader.mjs', import.meta.url))

const GB = Number(process.argv[2] ?? '3')
const home = mkdtempSync(join(tmpdir(), 'large-probe-'))
const payload = join(home, `payload-${String(GB)}g.bin`)
writeFileSync(payload, '')
const fd = openSync(payload, 'r+')
ftruncateSync(fd, GB * 1024 ** 3)
closeSync(fd)
console.log(`payload: ${payload} (${GB} GiB, sparse)`)

const PORT = await new Promise((resolvePort) => {
  const probe = createServer()
  probe.once('listening', () => {
    const address = probe.address()
    probe.close(() => resolvePort(typeof address === 'object' && address !== null ? address.port : 0))
  })
  probe.listen(0, '127.0.0.1')
})

const peer = spawn(process.execPath, [
  'scripts/fake-peer.mjs',
  '--name', 'Large probe peer',
  '--port', String(PORT),
  '--save', join(home, 'inbox'),
  '--stay',
], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] })
let peerOutput = ''
peer.stdout.on('data', (chunk) => { peerOutput += chunk })
peer.stderr.on('data', (chunk) => { peerOutput += chunk })

const origin = `http://127.0.0.1:${String(PORT)}`
for (let i = 0; i < 60; i++) {
  const up = await fetch(`${origin}/api/localsend/v2/info`).then(r => r.ok, () => false)
  if (up) break
  await new Promise(wait => setTimeout(wait, 100))
}

const { TransferRegistry } = await import('../src/transfer.ts')
const { sendPaths } = await import('../src/outbound.ts')
const { PROTOCOL_VERSION } = await import('../src/protocol.ts')

const registry = new TransferRegistry()
const rss = () => `${String(Math.round(process.memoryUsage().rss / 1024 ** 2))} MB`
const timer = setInterval(() => {
  const row = registry.list()[0]
  console.log(`  rss=${rss()} done=${String(row?.bytesDone ?? 0)} status=${row?.status ?? '-'}`)
}, 1000)

const started = Date.now()
const outcome = await sendPaths(
  {
    alias: 'Large probe peer',
    fingerprint: 'large-probe',
    host: '127.0.0.1',
    port: PORT,
    origin,
    protocol: 'http',
    deviceType: 'desktop',
  },
  [payload],
  {
    alias: 'Large probe sender',
    version: PROTOCOL_VERSION,
    fingerprint: 'large-probe-sender',
    port: PORT,
    protocol: 'http',
  },
  { registry, warn: message => console.log('warn:', message) },
)
clearInterval(timer)

peer.kill('SIGTERM')
await new Promise(done => peer.on('exit', done))
console.log('--- outcome ---')
console.log(JSON.stringify(outcome, null, 2))
console.log('--- peer ---')
console.log(peerOutput.trim().split('\n').slice(-6).join('\n'))
console.log(`elapsed ${String(Math.round((Date.now() - started) / 1000))}s, rss=${rss()}`)
rmSync(home, { recursive: true, force: true })
