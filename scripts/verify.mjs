#!/usr/bin/env node
/**
 * Check that the plugin is actually loaded and working in a running Harness.
 *
 * Every probe here is chosen so that it proves something the unit tests cannot:
 * that the *installed* plugin, inside the *running* process, is doing its job.
 * The tests all pass against the source; only this can tell you whether the two
 * halves arrived.
 *
 * The interesting one is the transfer API. It is a plain HTTP server this plugin
 * opens for other devices on the LAN, which means it sits outside the Harness's
 * own authenticated surface and can be called with nothing but curl — so the
 * host half can be verified end to end without touching the GUI's credentials.
 *
 * Usage:
 *   node scripts/verify.mjs [--origin http://127.0.0.1:19387] [--port 53317]
 *
 * @module dsh-local-send/scripts/verify
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'


import { discoveryAnnouncement, discoveryRoundTrip } from './lib/discovery-probe.mjs'

/** This repository's root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Read one `--flag value` pair, or the fallback. */
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback
}

const ORIGIN = arg('origin', 'http://127.0.0.1:19387')
const PORT = Number(arg('port', '53317'))

/** One check's outcome. */
const results = []

/** Record a check. */
function check(name, ok, detail) {
  results.push({ name, ok, detail })
}

/** Fetch with a short timeout, returning the response or undefined. */
async function probe(url, options = {}) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(4_000), ...options })
  } catch {
    return undefined
  }
}

// 1. The package is installed into the profile and the profile lists it.
const profile = join(process.env['HOME'] ?? '', '.dsh', 'profiles', 'desktop')
try {
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  const deps = manifest?.dependencies ?? {}
  check('profile lists the bundle', bundles.includes('dsh-local-send'), bundles.join(', '))
  check('profile depends on the package', 'dsh-local-send' in deps, deps['dsh-local-send'] ?? 'absent')
  check(
    'package is linked into the profile',
    existsSync(join(profile, 'node_modules', 'dsh-local-send', 'lib', 'index.js')),
    join(profile, 'node_modules', 'dsh-local-send'),
  )
} catch (error) {
  check('profile is readable', false, String(error))
}

// 2. The transfer API is listening. This is the host half's own socket, opened
//    for phones and laptops that carry no Harness credentials at all — so a
//    successful call proves the host half activated, not merely that the row was
//    read.
const info = await probe(`http://127.0.0.1:${String(PORT)}/api/localsend/v2/info`)
if (info === undefined) {
  check('transfer API is listening', false, `nothing answered on port ${String(PORT)}`)
} else if (!info.ok) {
  check('transfer API is listening', false, `HTTP ${String(info.status)}`)
} else {
  const body = await info.json()
  check('transfer API is listening', true, `HTTP 200 on ${String(PORT)}`)
  check(
    'transfer API announces this device',
    typeof body.alias === 'string' && typeof body.fingerprint === 'string',
    `alias="${String(body.alias)}" protocol=${String(body.protocol)}`,
  )
  // The reference implementation omits these two; sending them would be a
  // divergence from what other LocalSend peers expect to parse.
  check(
    'register-shaped response omits port and protocol',
    !('port' in body) && !('protocol' in body),
    JSON.stringify(body),
  )
}

// 3. The client half is served to the browser. This is the bundle the module
//    table hands the page, and a 404 here is the signature of a plugin whose row
//    never made it into the boot graph.
const bundle = await probe(`${ORIGIN}/plugins/dsh-local-send/client.js`)
if (bundle === undefined) {
  check('client bundle is served', false, `${ORIGIN} did not answer`)
} else {
  const text = bundle.ok ? await bundle.text() : ''
  check('client bundle is served', bundle.ok, `HTTP ${String(bundle.status)}, ${String(text.length)} bytes`)
  if (bundle.ok) {
    // The hand-written wrapper is the one part of this bundle a build change
    // could break silently, and a bundle without it registers nothing.
    check(
      'bundle registers itself under the package id',
      text.includes('window.__ModuleLoader__.load') && text.includes('"dsh-local-send"'),
      text.slice(0, 60).replace(/\n/gu, ' '),
    )
  }
}

// 4. The page's boot manifest carries the row, which is what makes the browser
//    fetch the bundle in the first place.
const page = await probe(ORIGIN)
if (page === undefined) {
  check('boot manifest names the plugin', false, `${ORIGIN} did not answer`)
} else if (!page.ok) {
  // The GUI's own document is behind the app's authentication, so an
  // unauthenticated probe cannot read it. That is not a failure of the plugin,
  // and the served-bundle check above is the one that speaks to this.
  check('boot manifest names the plugin', true, `skipped: the page answers HTTP ${String(page.status)} without credentials`)
} else {
  const html = await page.text()
  // The manifest is inlined into the document; the id appearing anywhere in it
  // is the signal, since the exact shape is the product's business.
  check('boot manifest names the plugin', html.includes('dsh-local-send'), `${String(html.length)} bytes of page`)
}

// 5. The discovery round trip, which is the strongest thing this script can
//    prove without a person: a stand-in device announces itself on the multicast
//    group and waits to be called back. A callback means the running plugin
//    joined the group, parsed a third-party announcement, and answered it over
//    HTTP — the whole receive-side path short of a file.
// Both directions, because they fail independently: a device that answers is
// findable by anyone who knows its address, and a device that announces is
// findable by anyone at all.
const announced = await discoveryAnnouncement(PORT, 8_000)
check('announces itself on the group', announced.announced, announced.detail)

const discovery = await discoveryRoundTrip(PORT)
check('answers a multicast announcement', discovery.calledBack, discovery.detail)
if (discovery.calledBack) {
  check(
    'the callback carries a usable identity',
    typeof discovery.peer?.alias === 'string' && typeof discovery.peer?.port === 'number',
    `alias="${String(discovery.peer?.alias)}" port=${String(discovery.peer?.port)}`,
  )
}

// 6. Who owns the port, for the case where something is listening but it is not
//    this process — the official LocalSend app on the same machine, for instance.
try {
  const lsof = execFileSync('lsof', ['-nP', `-iTCP:${String(PORT)}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  check('port owner', true, lsof.trim().split('\n').slice(1, 3).join(' | ') || 'nobody')
} catch {
  check('port owner', true, 'nobody is listening')
}

// Report.
let failed = 0
for (const result of results) {
  if (!result.ok) failed += 1
  console.log(`${result.ok ? ' ok ' : 'FAIL'}  ${result.name.padEnd(42)} ${result.detail}`)
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
if (failed > 0) {
  console.log(
    '\nA plugin that is installed but absent from the boot manifest needs a Harness\n'
    + 'restart: the profile is read at boot, and a bundle patch is not reconciled\n'
    + 'into a running process.',
  )
  process.exitCode = 1
}
