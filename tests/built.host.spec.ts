/**
 * The artifact the Loader actually imports.
 *
 * Every other host test imports `src/`. The Loader does not: it imports the
 * built entry named by `main`, which is a different file produced by a bundler,
 * and a build that mangled an export, dropped a dynamic import, or inlined a
 * package that had to stay external would pass every other test in this
 * repository and still fail to load.
 *
 * That failure is the expensive kind — it costs a Harness restart to discover —
 * so the built artifact is imported here and activated for real, from the same
 * path the profile resolves.
 *
 * @module dsh-local-send/tests/built
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/** This repository's root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The built host entry, as the Loader resolves it from `main`. */
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { main: string }
const ENTRY = join(ROOT, MANIFEST.main)

/** What a module the Loader can mount has to export. */
interface HostModule {
  readonly name?: unknown
  readonly inject?: unknown
  readonly apply?: unknown
  readonly default?: unknown
}

/** Everything an activated plugin left behind, so it can be torn down. */
const disposers: (() => void | Promise<void>)[] = []

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()?.()
})

/**
 * Import the built entry the way the Loader does.
 * @returns the module's exports.
 */
async function importBuilt(): Promise<HostModule> {
  // Through a `file://` URL, which is what the boot loader hands Node for a row
  // whose name resolved to a path.
  return await import(pathToFileURL(ENTRY).href) as HostModule
}

/** A host context carrying only what the module declares it needs. */
function stubContext(): Context {
  return {
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
}

describe('the built host entry', () => {
  it('exists where the manifest says it does', () => {
    // A missing artifact means the build has not run, and every assertion below
    // would fail with a module-not-found rather than saying so.
    expect(existsSync(ENTRY)).toBe(true)
  })

  it('exports the three things the Loader reads', async () => {
    const built = await importBuilt()
    expect(built.name).toBe('dsh-local-send')
    expect(Array.isArray(built.inject)).toBe(true)
    expect(built.inject).toContain('connection')
    expect(typeof built.apply).toBe('function')
  })

  it('exports no default, which would shadow the named plugin', async () => {
    // The Loader takes a module's default export when it has one, and a default
    // that is the bare `apply` function is a plugin *without* this module's
    // `name` and `inject` — the fiber then activates with an empty inject list
    // and the first service read throws.
    const built = await importBuilt()
    expect(built.default).toBeUndefined()
  })

  it('activates from the built file', async () => {
    const built = await importBuilt()
    const apply = built.apply as (ctx: Context, config?: unknown) => void
    // A port away from the protocol's own, so this never competes with a real
    // LocalSend device or another run of the suite.
    apply(stubContext(), { port: 53_994 })
    // Reaching here without a throw is most of the assertion: activation opens a
    // socket and joins a multicast group, and either can fail.
    expect(disposers.length).toBeGreaterThan(0)
  })

  it('imports nothing but Node builtins at runtime', () => {
    // The host half reaches the harness only through the Cordis context it is
    // handed, and every `@deepseek-ai/*` import behind that is type-only — which
    // the compiler erases. So the built file has no runtime coupling to harness
    // internals at all, and that is what lets this package survive a harness
    // version bump: an inlined or imported harness module would pin it to
    // whatever that version's internals happened to be.
    const source = readFileSync(ENTRY, 'utf8')
    const specifiers = [...source.matchAll(/^import[^;]*from "([^"]*)"/gmu)]
      .map(match => match[1] ?? '')
    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter(specifier => !specifier.startsWith('node:'))).toEqual([])
  })
})
