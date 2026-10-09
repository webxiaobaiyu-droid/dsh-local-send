#!/usr/bin/env node
/**
 * A fake LocalSend device, for testing this plugin on one machine.
 *
 * A second device is the one thing this plugin's test suite cannot be: the
 * tests prove both halves of the protocol against each other, but the *panel*
 — discovery tiles, the receive banner, the notification, the fish — only
 * renders against a peer that exists on the network. On a single machine the
 * protocol still works, because discovery runs with multicast loopback enabled:
 * two processes on one host hear each other's announcements, and HTTP to
 * 127.0.0.1 is indistinguishable from HTTP across the room.
 *
 * So this script is that second device. It announces itself every three
 * seconds until it appears in the panel's device list, answers whatever the
 * plugin sends it, and — with `--send` — offers files the way a phone would,
 * which is the only way to make the receive UI appear without a phone.
 *
 * Everything it does is spoken aloud on stdout, so a transfer that misbehaves
 * can be traced from both ends at once.
 *
 * Usage:
 *   node scripts/fake-peer.mjs                     # appear in the panel, receive anything
 *   node scripts/fake-peer.mjs --send a.pdf b.jpg  # offer files to the running plugin
 *   node scripts/fake-peer.mjs --accept 报告        # receive, but skip files not matching the substring
 *   node scripts/fake-peer.mjs --decline           # receive, but refuse every offer
 *
 * @module dsh-local-send/scripts/fake-peer
 */

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { networkInterfaces } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

/** The multicast group and port the LocalSend protocol reserves. */
const GROUP = '224.0.0.167'
const GROUP_PORT = 53317
const API = '/api/localsend/v2'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** @type {Record<string, string | string[] | boolean>} */
const options = { send: [], accept: [] }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : undefined
  switch (arg) {
    case '--name': options.name = value ?? 'Fake phone'; break
    case '--type': options.type = value ?? 'mobile'; break
    case '--port': options.port = value; break // HTTP port; default: ephemeral
    case '--to': options.to = value ?? '127.0.0.1:53317'; break // where --send offers go
    case '--pin': options.pin = value ?? ''; break // required of senders, supplied when sending
    case '--save': options.save = value ?? 'fake-peer-inbox'; break
    // `--send` and `--accept` take every following argument until the next
    // flag, so a batch of paths does not need one flag each.
    case '--send':
    case '--accept': {
      const bucket = arg === '--send' ? options.send : options.accept
      if (value !== undefined) bucket.push(value)
      while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) bucket.push(argv[++i])
      break
    }
    case '--decline': options.decline = true; break
    case '--stay': options.stay = true; break // keep serving after --send completes
    default:
      console.error(`unknown option ${arg}`)
      process.exit(2)
  }
}

const ALIAS = /** @type {string} */ (options.name ?? 'Fake phone')
const DEVICE_TYPE = /** @type {string} */ (options.type ?? 'mobile')
const PIN = /** @type {string} */ (options.pin ?? '')
const SAVE_DIR = resolve(/** @type {string} */ (options.save ?? 'fake-peer-inbox'))
const FINGERPRINT = `fake-${randomUUID()}`
const HTTP_PORT = options.port !== undefined ? Number(options.port) : 0

/** Identity advertised in every announcement, register answer, and offer. */
const self = () => ({
  alias: ALIAS,
  version: '2.2',
  deviceModel: 'FakePeer',
  deviceType: DEVICE_TYPE,
  fingerprint: FINGERPRINT,
  port: httpPort,
  protocol: 'http',
  download: false,
})

const log = (...parts) => console.log(`${new Date().toLocaleTimeString()}  ${parts.join(' ')}`)

// ---------------------------------------------------------------------------
// HTTP API — the half that receives, when the panel sends to this device
// ---------------------------------------------------------------------------

/** Sessions between this device's `prepare-upload` answer and its uploads. @type {Map<string, any>} */
const sessions = new Map()

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const route = url.pathname.startsWith(API) ? url.pathname.slice(API.length) : url.pathname
  /** The remote address the way the plugin normalizes it. */
  const remote = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  try {
    if (request.method === 'POST' && route === '/register') {
      await drain(request)
      answerJson(response, 200, registerBody())
      log(`register from ${remote} — the plugin can see this device`)
      return
    }
    if (request.method === 'GET' && route === '/info') {
      answerJson(response, 200, registerBody())
      return
    }
    if (request.method === 'POST' && route === '/prepare-upload') {
      await handlePrepare(request, response, url, remote)
      return
    }
    if (request.method === 'POST' && route === '/upload') {
      await handleUpload(request, response, url, remote)
      return
    }
    if (request.method === 'POST' && route === '/cancel') {
      await drain(request)
      const id = url.searchParams.get('sessionId')
      if (id !== null) sessions.delete(id)
      // Also covers the v2.0–2.2 withdrawal with no session id at all.
      answerEmpty(response, 200)
      log(`cancel${id === null ? '' : ` session ${id.slice(0, 8)}…`} from ${remote}`)
      return
    }
    answerJson(response, 404, { message: 'not found' })
  } catch (error) {
    log('request failed:', describe(error))
    if (!response.headersSent) answerJson(response, 500, { message: describe(error) })
    else response.end()
  }
})

/** The register/info body: this device's identity, as the spec's answer shape. */
function registerBody() {
  const { alias, version, deviceModel, deviceType, fingerprint, download } = self()
  return { alias, version, deviceModel, deviceType, fingerprint, download }
}

/**
 * Answer an offer from the panel: metadata in, per-file tokens out.
 *
 * The policy flags decide here, which is what makes each test reachable:
 * `--decline` answers 403 the way a person pressing 拒绝 would, `--accept`
 * answers with a token map that is missing some files — the protocol's own way
 * of accepting one and skipping the rest — and the default takes everything.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {URL} url
 * @param {string} remote
 */
async function handlePrepare(request, response, url, remote) {
  // One read, exactly once: draining first and then reading again would wait
  // forever on a stream that already ended.
  const body = JSON.parse(await readBody(request))
  const sender = body?.info
  const offered = Object.values(body?.files ?? {})
  if (!sender || offered.length === 0) {
    answerJson(response, 400, { message: 'Invalid request' })
    return
  }
  if (PIN.length > 0 && url.searchParams.get('pin') !== PIN) {
    answerJson(response, 401, { message: PIN ? 'Invalid PIN' : 'PIN required' })
    log(`prepare from ${remote} refused: wrong or missing PIN`)
    return
  }
  if ([...sessions.values()].some((session) => !session.finished)) {
    answerJson(response, 409, { message: 'Blocked by existing session' })
    return
  }

  const wanted = offered.filter((file) =>
    options.accept.length === 0 || options.accept.some((part) => String(file.fileName).includes(part)))
  log(`offer from "${sender.alias}" (${remote}): ${offered.map((file) => `${file.fileName} (${file.size} B)`).join(', ')}`)
  if (options.decline) {
    answerJson(response, 403, { message: 'Rejected' })
    log('→ declined (--decline); the panel row should read 被拒绝')
    return
  }
  if (wanted.length === 0) {
    // The spec's answer for "nothing here I will take": success, no session.
    answerEmpty(response, 204)
    log(`→ nothing matched ${JSON.stringify(options.accept)}; answered 204, no session`)
    return
  }

  const sessionId = randomUUID()
  const tokens = new Map(wanted.map((file) => [file.id, randomUUID()]))
  sessions.set(sessionId, { remote, tokens, files: new Map(wanted.map((file) => [file.id, file])), finished: false })
  answerJson(response, 200, {
    sessionId,
    files: Object.fromEntries(tokens),
  })
  const skipped = offered.length - wanted.length
  log(`→ accepted ${wanted.length}${skipped > 0 ? `, skipped ${skipped} (--accept)` : ''}; waiting for bytes`)
}

/**
 * Receive one file's bytes, verifying the token, the sender's address, and —
 * when the offer carried one — the checksum, exactly as the real receiver does.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {URL} url
 * @param {string} remote
 */
async function handleUpload(request, response, url, remote) {
  const sessionId = url.searchParams.get('sessionId')
  const fileId = url.searchParams.get('fileId')
  const token = url.searchParams.get('token')
  const session = sessionId !== null ? sessions.get(sessionId) : undefined
  const metadata = session?.files.get(fileId ?? '')
  if (session === undefined || metadata === undefined || token === null || session.tokens.get(fileId) !== token
    || session.remote !== remote) {
    answerJson(response, 403, { message: 'Invalid token' })
    return
  }
  mkdirSync(SAVE_DIR, { recursive: true })
  const destination = join(SAVE_DIR, sanitize(String(metadata.fileName)))
  const hash = createHash('sha256')
  const out = createWriteStream(destination)
  await new Promise((done, fail) => {
    request.on('data', (chunk) => { hash.update(chunk); out.write(chunk) })
    request.on('end', () => { out.end(() => done()) })
    request.on('error', fail)
    out.on('error', fail)
  })
  const expected = metadata.sha256
  /** Computed once; `digest` throws if it is ever called twice. */
  const actual = typeof expected === 'string' && expected.length > 0 ? hash.digest('hex') : undefined
  if (actual !== undefined && actual.toLowerCase() !== expected.toLowerCase()) {
    answerJson(response, 422, { message: 'Checksum mismatch' })
    log(`→ ${metadata.fileName}: checksum mismatch, kept the broken file for inspection`)
    return
  }
  session.finished = [...session.files.keys()].every((id) => id === fileId) || true
  answerEmpty(response, 200)
  log(`→ saved ${metadata.fileName} → ${destination} (${actual !== undefined ? `${actual.slice(0, 12)}… matching` : 'no checksum offered'})`)
}

// ---------------------------------------------------------------------------
// Sending — the half that makes the plugin's receive UI appear
// ---------------------------------------------------------------------------

/**
 * Offer local files to the running plugin, the way a phone would.
 *
 * The prepare request stays open while the panel, the banner, and the
 * notification wait for a person to answer, so this call is where the human
 * in the loop shows up: it hangs until 接收 or 拒绝 is pressed, or until the
 * plugin's ninety-second approval timeout answers on the person's behalf.
 * @param {string} target - `host:port` of the plugin's transfer API.
 * @param {string[]} paths - files to offer.
 */
async function sendTo(target, paths) {
  const at = target.lastIndexOf(':')
  const host = target.slice(0, at)
  const port = Number(target.slice(at + 1))
  const origin = `http://${host}:${port}`

  const files = {}
  for (const path of paths) {
    const absolute = resolve(path)
    const stats = statSync(absolute)
    if (!stats.isFile()) throw new Error(`${absolute} is not a regular file`)
    const id = randomUUID()
    files[id] = {
      id,
      fileName: basename(absolute),
      size: stats.size,
      fileType: mimeTypeOf(absolute),
      // Small files carry a checksum so a correct receive is provable; the
      // 256 MiB cutoff mirrors the plugin's own sender.
      sha256: stats.size <= 256 * 1024 * 1024
        ? createHash('sha256').update(await readAll(absolute)).digest('hex')
        : null,
      metadata: { modified: new Date(stats.mtimeMs).toISOString() },
    }
  }

  log(`offering ${Object.keys(files).length} file(s) to ${origin} — waiting for 接收 / 拒绝 in the GUI…`)
  const prepared = await fetch(`${origin}${API}/prepare-upload${PIN ? `?pin=${encodeURIComponent(PIN)}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ info: self(), files }),
  })
  if (prepared.status === 204) { log('→ 204: the receiver wants none of these files'); return }
  if (!prepared.ok) { log(`→ prepare refused: HTTP ${prepared.status} ${await prepared.text()}`); return }
  const answer = await prepared.json()
  const tokens = answer?.files ?? {}
  const sessionId = answer?.sessionId
  log(`→ accepted as session ${String(sessionId).slice(0, 8)}…; ${Object.keys(tokens).length} token(s), ${Object.keys(files).length - Object.keys(tokens).length} skipped`)

  let index = 0
  for (const [fileId, file] of Object.entries(files)) {
    const token = tokens[fileId]
    if (typeof token !== 'string' || token.length === 0) {
      log(`   ${file.fileName}: skipped by the receiver (no token)`)
      continue
    }
    index += 1
    const url = `${origin}${API}/upload?sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(token)}`
    const started = Date.now()
    const uploaded = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      // Node's fetch speaks web streams, not fs.ReadStream; the conversion is
      // the same one the plugin's own sender performs.
      body: Readable.toWeb(createReadStream(findOriginal(file.fileName, paths))),
      duplex: 'half',
    })
    if (uploaded.ok) {
      log(`   (${String(index)}/${Object.keys(tokens).length}) ${file.fileName}: ${file.size} B in ${String(Date.now() - started)}ms`)
    } else {
      log(`   ${file.fileName}: HTTP ${uploaded.status} — ${await uploaded.text()}`)
    }
  }
  log('done. The received copies are in the plugin\'s inbox (~/.dsh/local-send/inbox).')
}

/**
 * Recover the absolute path an offered name came from.
 *
 * The offer map carries names, not paths, so the upload needs this lookup to
 * find the bytes again; a name that appears twice keeps its first occurrence,
 * which mirrors how the plugin deduplicates offered names too.
 * @param {string} fileName - the offered base name.
 * @param {string[]} paths - every path this run offered.
 */
function findOriginal(fileName, paths) {
  const hit = paths.map((path) => resolve(path)).find((path) => basename(path) === fileName)
  if (hit === undefined) throw new Error(`no offered path matches the name ${fileName}`)
  return hit
}

/** Read a whole file into one buffer, for hashing. */
async function readAll(path) {
  const chunks = []
  const source = createReadStream(path)
  for await (const chunk of source) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------------------
// Discovery — announcing this device until the panel lists it
// ---------------------------------------------------------------------------

/** The UDP socket that says "I am here" every three seconds. */
function startAnnouncing() {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('error', (error) => log('announcement socket error:', describe(error)))
  socket.on('message', (buffer, from) => {
    try {
      const peer = JSON.parse(buffer.toString('utf8'))
      if (peer?.fingerprint === FINGERPRINT || peer?.announce !== true) return
      // A peer's announcement is answered over HTTP, not UDP — but logging it
      // here is the cheapest proof both directions of discovery are alive.
      log(`heard "${peer.alias}" announce from ${from.address}:${from.port}`)
    } catch { /* junk on a well-known group is normal */ }
  })
  socket.bind(() => {
    try { socket.setMulticastLoopback(true) } catch { /* announcements may still arrive */ }
    for (const address of localAddresses()) {
      try { socket.addMembership(GROUP, address) } catch { /* another interface still carries it */ }
    }
    const announce = () => {
      const payload = Buffer.from(JSON.stringify({ ...self(), announce: true }))
      for (const address of localAddresses()) {
        try { socket.setMulticastInterface(address) } catch { continue }
        socket.send(payload, 0, payload.length, GROUP_PORT, GROUP, () => {})
      }
    }
    announce()
    setInterval(announce, 3_000)
    log(`announcing as "${ALIAS}" (${DEVICE_TYPE}, fingerprint ${FINGERPRINT.slice(0, 12)}…) — the panel should list it within seconds`)
  })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @returns {Promise<string>} the request body as text. */
function readBody(request) {
  return new Promise((done, fail) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 4 * 1024 * 1024) { fail(new Error('body too large')); request.destroy() }
    })
    request.on('end', () => done(body))
    request.on('error', fail)
  })
}

/** Consume and discard a request body. */
function drain(request) { return readBody(request).then(() => undefined, () => undefined) }

/** @param {number} status @param {unknown} body */
function answerJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** @param {number} status */
function answerEmpty(response, status) {
  response.writeHead(status)
  response.end()
}

/** The receiver's filename rule, copied: one safe segment or a generated one. */
function sanitize(name) {
  return /^[\w.\- ()\u4e00-\u9fff]+$/.test(name) && !name.startsWith('.') && !name.includes('/')
    ? name
    : `unnamed-${randomUUID().slice(0, 8)}`
}

/** A few common types; the fallback is the spec's octet-stream. */
function mimeTypeOf(path) {
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', mp4: 'video/mp4', zip: 'application/zip', json: 'application/json' }
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return types[extension] ?? 'application/octet-stream'
}

/** Every non-internal IPv4 address this machine holds. */
function localAddresses() {
  const found = []
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  return found
}

/** @param {unknown} error */
function describe(error) { return error instanceof Error ? error.message : String(error) }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** The port HTTP actually bound, which announcements carry. */
let httpPort = 0

await new Promise((started, failed) => {
  server.once('error', failed)
  server.listen(HTTP_PORT, '0.0.0.0', () => {
    const address = server.address()
    httpPort = typeof address === 'object' && address !== null ? address.port : HTTP_PORT
    started()
  })
})
log(`fake device API on port ${httpPort}; received files go to ${SAVE_DIR}`)

startAnnouncing()
process.on('SIGINT', () => { server.close(); process.exit(0) })

/** Sends happen after the device is on the air, so the panel sees both sides. */
const sendList = /** @type {string[]} */ (options.send)
if (sendList.length > 0) {
  try {
    await sendTo(/** @type {string} */ (options.to ?? '127.0.0.1:53317'), sendList)
  } catch (error) {
    log('send failed:', describe(error))
    if (!options.stay) process.exit(1)
  }
  if (!options.stay) process.exit(0)
}
log('serving — press Ctrl-C to leave the network.')
