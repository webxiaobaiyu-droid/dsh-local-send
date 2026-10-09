/**
 * Is this package installable as a Harness plugin?
 *
 * Every other test in this repository tests code. This one tests the *package*:
 * the manifest the client module system scans, the bundle patch the boot loader
 * applies, and the entry points both of them have to resolve. Those are the
 * things that decide whether the plugin appears at all, and they fail in the one
 * way nothing else here would catch — the loader skips an unreadable bundle layer
 * and carries on, so a malformed manifest produces no error anywhere. The plugin
 * simply never arrives.
 *
 * The manifest half runs against the product's own parser rather than a copy of
 * its rules, so a rule this plugin has wrong is a failure here rather than a
 * surprise at install time.
 *
 * @module dsh-local-send/tests/manifest
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type WebBootEntry } from '@deepseek-ai/dsh-client-modules/src/client/manifest.ts'
// The graph ordering lives on the package root rather than beside the manifest
// shapes; both are read from source so this test does not depend on the harness
// checkout having been built.
import { orderByModuleGraph } from '@deepseek-ai/dsh-client-modules/src/index.ts'
import { parseDshClient } from '@deepseek-ai/dsh-client-modules/src/client/manifest.ts'
import { parse as parseYaml } from 'yaml'

/** This package's root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The package manifest, read as the loader reads it. */
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>

/** The bundle patch, as text. */
const PATCH_TEXT = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

/** Read a nested field, or `undefined`. */
function field(source: Record<string, unknown>, ...path: readonly string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Resolve `exports["./client"]` the way the client module system does.
 *
 * Mirrors `clientExportOf` in `packages/client/modules/src/index.ts:195`, which
 * is not exported: the string form and the one-level conditional form are the
 * two it accepts, and a copy of that six-line rule is the only way to assert the
 * resolved path here without reaching into the product's internals.
 *
 * @param exports - the manifest's `exports` field.
 * @returns the package-relative path, or `undefined` when the export is absent.
 * @throws when the export exists in a shape the product refuses.
 */
function clientExportOf(exports: unknown): string | undefined {
  if (typeof exports !== 'object' || exports === null) return undefined
  const client = (exports as Record<string, unknown>)['./client']
  if (client === undefined) return undefined
  if (typeof client === 'string') return client
  if (typeof client === 'object' && client !== null) {
    const fallback = (client as Record<string, unknown>)['default']
    if (typeof fallback === 'string') return fallback
  }
  throw new Error('exports["./client"] must be a string or an object with a string default')
}

describe('package manifest', () => {
  it('declares a browser half the client module system accepts', () => {
    // The product's own parser: it throws on a malformed declaration rather than
    // returning undefined, which is the behaviour that makes this test worth
    // running instead of eyeballing the JSON.
    const decl = parseDshClient(String(MANIFEST['name']), field(MANIFEST, 'dsh', 'client'))
    expect(decl).toBeDefined()
    expect(decl?.platform).toBe('web')
  })

  it('names the client bundle in a shape the scanner can resolve', () => {
    const relative = clientExportOf(MANIFEST['exports'])
    expect(relative).toBe('./lib/client.js')
    expect(existsSync(join(ROOT, relative as string))).toBe(true)
  })

  it('points its host half at a file, not a directory', () => {
    // Node's ESM loader refuses a directory import outright, so a `main` that
    // names the package root would fail to load with ERR_UNSUPPORTED_DIR_IMPORT.
    const main = MANIFEST['main']
    expect(typeof main).toBe('string')
    const path = join(ROOT, main as string)
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).isFile()).toBe(true)
  })

  it('declares the bundle patch the boot loader applies', () => {
    const patch = field(MANIFEST, 'dsh', 'bundle', 'patch')
    expect(patch).toBe('./cordis.patch.yml')
    expect(field(MANIFEST, 'files')).toContain('cordis.patch.yml')
  })

  it('ships both built halves in the published file list', () => {
    // A package that omits its own build from `files` installs to a directory
    // with no entry point, which the loader reports as a resolution failure
    // rather than as a missing file.
    const files = field(MANIFEST, 'files') as unknown[]
    expect(files).toContain('lib')
  })

  it('requests only packages as its browser dependencies, never services', () => {
    // `dsh.client.inject` is a package-name graph edge list. Cordis service
    // injection is the module's own `inject` export, and a service name in this
    // list would be an edge to a package that does not exist.
    const decl = parseDshClient(String(MANIFEST['name']), field(MANIFEST, 'dsh', 'client'))
    for (const name of decl?.inject ?? []) {
      expect(name.startsWith('@deepseek-ai/') || name.startsWith('dsh-')).toBe(true)
    }
  })
})

describe('bundle patch', () => {
  it('parses as the top-level array of mappings the loader requires', () => {
    // A bundle layer that fails to parse is *skipped*, not reported: the plugin
    // would simply never load, with nothing to see anywhere.
    const parsed = parseYaml(PATCH_TEXT)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })

  it('inserts exactly one row, addressing this package by name', () => {
    const parsed = parseYaml(PATCH_TEXT) as { insert?: unknown }[]
    const inserted = parsed.flatMap(entry => Array.isArray(entry.insert) ? entry.insert : [])
    expect(inserted).toHaveLength(1)
    const row = inserted[0] as Record<string, unknown>
    expect(row['id']).toBe('local-send')
    // A bare specifier resolves through the same Loader resolution that mounts
    // the row, from the profile directory whose node_modules holds this package.
    expect(row['name']).toBe(String(MANIFEST['name']))
  })

  it('carries no config, so the row mounts with every default in place', () => {
    const parsed = parseYaml(PATCH_TEXT) as { insert?: unknown }[]
    const inserted = parsed.flatMap(entry => Array.isArray(entry.insert) ? entry.insert : [])
    const row = inserted[0] as Record<string, unknown>
    // A patch replaces a row's whole config rather than merging into it, so a
    // shipped default here would silently win over the deployment's own.
    expect(row).not.toHaveProperty('config')
    expect(row).not.toHaveProperty('disabled')
  })
})

describe('module graph', () => {
  it('orders without a cycle when this plugin is in the graph', () => {
    // The client module system sorts rows so every requested package precedes
    // its consumers, and a cycle is a hard failure that takes the whole page's
    // boot down rather than just this plugin's half.
    const decl = parseDshClient(String(MANIFEST['name']), field(MANIFEST, 'dsh', 'client'))
    const entries: WebBootEntry[] = [
      ...(decl?.inject ?? []).map(name => ({ id: name, url: `/plugins/${name}/client.js`, rev: 'r' })),
      { id: String(MANIFEST['name']), url: '/plugins/dsh-local-send/client.js', rev: 'r' },
    ]
    const ordered = orderByModuleGraph(entries)
    expect(ordered.map(entry => entry.id)).toContain('dsh-local-send')
    // Every dependency has to come before its consumer.
    const position = new Map(ordered.map((entry, index) => [entry.id, index]))
    for (const name of decl?.inject ?? []) {
      const dependency = position.get(name)
      if (dependency === undefined) continue
      expect(dependency).toBeLessThan(position.get('dsh-local-send') as number)
    }
  })
})
