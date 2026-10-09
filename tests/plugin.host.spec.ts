/**
 * The host half's activation contract.
 *
 * The Loader imports this module and calls `apply` with a context and a config;
 * everything this plugin later does depends on that call surviving. A failure
 * here is not a bug in a transfer — it is a plugin that does not load at all,
 * and the symptom the user sees is an entry that never appears with no
 * explanation anywhere.
 *
 * So this exercises the module the way the Loader does: read its exports, build
 * the context it injects against, and activate it for real — a bound socket and
 * a joined multicast group included. What it cannot check is the panel, which
 * needs a browser.
 *
 * @module dsh-local-send/tests/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'
import { STATE_PATH } from '../src/types.ts'

/**
 * A port well away from the protocol's own.
 *
 * Activation binds a real socket, and the tests must not fight the official
 * LocalSend app — or another run of this suite — for port 53317.
 */
const TEST_PORT = 53_990

/** One registered route, as the module registered it. */
interface RegisteredRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

/** Everything an activated plugin left behind, so it can be torn down. */
interface Activation {
  readonly routes: Map<string, RegisteredRoute>
  readonly disposers: (() => void | Promise<void>)[]
  readonly logs: string[]
  dispose(): Promise<void>
}

const activations: Activation[] = []

afterEach(async () => {
  while (activations.length > 0) await activations.pop()?.dispose()
})

/**
 * Activate the plugin against a stand-in host context.
 *
 * The context carries only what the module declares it needs: `connection` for
 * the routes, and the Cordis members it uses for cleanup and logging. A service
 * this module forgot to declare would be missing here exactly as it would be in
 * a deployment that mounted nothing else, which is the point.
 *
 * @param config - configuration to activate with.
 * @returns the activation, with its routes and disposers.
 */
function activate(config: Record<string, unknown> = {}): Activation {
  const routes = new Map<string, RegisteredRoute>()
  const disposers: (() => void | Promise<void>)[] = []
  const logs: string[] = []
  const ctx = {
    logger: {
      info: (message: string) => { logs.push(message) },
      warn: (message: string) => { logs.push(message) },
      error: (message: string) => { logs.push(message) },
    },
    // The real effect runs its callback immediately and keeps the returned
    // disposer, which is what this mirrors.
    effect: (callback: () => void | (() => void | Promise<void>)) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on: () => {},
    get: () => undefined,
    connection: {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
          return () => {
            routes.delete(route.path)
            return Promise.resolve()
          }
        },
      },
    },
  } as unknown as Context

  apply(ctx, config)
  const activation: Activation = {
    routes,
    disposers,
    logs,
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
  activations.push(activation)
  return activation
}

describe('host half activation', () => {
  it('exports the name and the injection list the Loader reads', () => {
    expect(name).toBe('dsh-local-send')
    // The routes cannot be registered without the carrier, so it is a hard
    // dependency rather than one read reflectively.
    expect(inject).toContain('connection')
  })

  it('activates and registers every route the panel calls', () => {
    const activation = activate({ port: TEST_PORT })
    expect([...activation.routes.keys()]).toContain(STATE_PATH)
  })

  it('marks the byte-streaming route as streaming, not buffered', async () => {
    const activation = activate({ port: TEST_PORT })
    const streaming = [...activation.routes.values()].filter(route => route.requestBody === 'streaming')
    // The buffered mode caps a body at 300 MiB and holds it in memory, which is
    // the difference between streaming a large file and failing on one.
    expect(streaming.length).toBeGreaterThan(0)
    expect(streaming.every(route => route.methods.includes('POST'))).toBe(true)
  })

  it('answers the state route with a device, a peer list, and an inbox', async () => {
    const activation = activate({ port: TEST_PORT })
    const route = activation.routes.get(STATE_PATH)
    expect(route).toBeDefined()
    const response = await route?.fetch(new Request(`http://127.0.0.1${STATE_PATH}`))
    expect(response?.status).toBe(200)
    const body = await response?.json() as Record<string, unknown>
    expect(body['device']).toBeDefined()
    expect(body['peers']).toEqual([])
    expect(body['transfers']).toEqual([])
    expect(typeof body['inbox']).toBe('string')
    expect(body['busy']).toBe(false)
  })

  it('activates with no configuration at all', () => {
    // Every field has a default, which is what lets a deployment mount the row
    // bare.
    const activation = activate()
    expect(activation.routes.size).toBeGreaterThan(0)
  })

  it('tolerates a nonsensical configuration rather than refusing to load', () => {
    // A typo in a Loader row should cost the deployment a default, not the
    // plugin: a port out of range falls back rather than binding nothing.
    const activation = activate({ port: -1, maxFiles: 'lots', protocol: 'gopher', deviceType: 'toaster' })
    expect(activation.routes.size).toBeGreaterThan(0)
  })

  it('tears its listener down when the plugin unloads', async () => {
    const activation = activate({ port: TEST_PORT })
    await activation.dispose()
    activations.pop()
    // The port must be free again, or a reload would fail to bind and the plugin
    // would come back deaf.
    const { createServer } = await import('node:http')
    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(TEST_PORT, '0.0.0.0', () => { resolve() })
    })
    await new Promise<void>((resolve) => { probe.close(() => { resolve() }) })
  })
})
