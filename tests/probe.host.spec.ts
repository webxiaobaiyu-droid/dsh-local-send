/**
 * Calibration for the discovery probe.
 *
 * `scripts/verify.mjs` decides whether a *running* Harness has loaded this
 * plugin, and its strongest check announces a stand-in device on the multicast
 * group and waits to be called back. A probe with a bug would report a healthy
 * plugin as broken — and it would do so at exactly the moment somebody is
 * relying on it, after a restart, with nothing else to compare against.
 *
 * So it is run here against this repository's own discovery loop, where the
 * answer is known. If this passes and the verify script still reports no
 * callback, the plugin really is not loaded.
 *
 * @module dsh-local-send/tests/probe
 */

import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { discoveryAnnouncement, discoveryRoundTrip } from '../scripts/lib/discovery-probe.mjs'
import { apply } from '../src/index.ts'

/** A port the protocol does not use, so this never competes with a real device. */
const TEST_PORT = 53_991

/** Everything an activated plugin left behind, so it can be torn down. */
const disposers: (() => void | Promise<void>)[] = []

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()?.()
})

/** Activate the plugin against a stand-in host context. */
function activate(): void {
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    effect: (callback: () => void | (() => void | Promise<void>)) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on: () => {},
    get: () => undefined,
    connection: { fetch: { register: () => () => Promise.resolve() } },
  } as unknown as Context
  // Both the transfer API and the discovery socket are opened from `apply`, and
  // the discovery socket is the one under test here.
  apply(ctx, { port: TEST_PORT })
}

/** Give the discovery socket time to bind and join the group. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700))
}

describe('the discovery probe', () => {
  it('is called back by this plugin’s own discovery loop', async () => {
    activate()
    await settle()
    const result = await discoveryRoundTrip(TEST_PORT)
    // The whole assertion: a device that announces itself is answered.
    expect(result.calledBack).toBe(true)
    expect(result.detail).toContain('/api/localsend/v2/register')
  }, 15_000)

  it('reads a usable identity out of the callback', async () => {
    activate()
    await settle()
    const result = await discoveryRoundTrip(TEST_PORT)
    // The answer is the receiving device's own identity, which is what the
    // protocol uses to build a peer row.
    expect(typeof result.peer?.alias).toBe('string')
    expect(typeof result.peer?.fingerprint).toBe('string')
    expect(typeof result.peer?.port).toBe('number')
  }, 15_000)

  it('is found by a peer listening on the group', async () => {
    activate()
    // The other direction: a device that replies but never announces is
    // invisible to anyone who has not already found it.
    const result = await discoveryAnnouncement(TEST_PORT)
    expect(result.announced).toBe(true)
    expect(result.peer?.protocol).toBe('http')
    // The port it advertises is what a peer will dial, so it has to be the one
    // the transfer API actually bound.
    expect(result.peer?.port).toBe(TEST_PORT)
  }, 20_000)

  it('reports no announcement when nothing is listening', async () => {
    const result = await discoveryAnnouncement(53_993, 1_500)
    expect(result.announced).toBe(false)
  }, 20_000)

  it('reports no callback when nothing is listening', async () => {
    // The negative case, which is what the verify script prints when the plugin
    // has not been loaded: a port with no discovery loop on it must not be
    // mistaken for a healthy device.
    const result = await discoveryRoundTrip(53_992)
    expect(result.calledBack).toBe(false)
    expect(result.detail).toContain('no callback')
  }, 15_000)
})
