/**
 * Panel settings: what the reader changed, and how it loses to nothing.
 *
 * The receive directory is the first preference the panel owns, and it has three
 * possible sources — the panel, the deployment's config, the inbox — so the
 * order between them is the whole contract. It is also the only one that is
 * written at runtime, which is why the store is a separate small document
 * rather than another field in the identity.
 *
 * @module dsh-local-send/tests/settings
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  loadSettings,
  receiveDirectory,
  saveSettings,
  storePaths,
} from '../src/store.ts'

const homes: string[] = []

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

/** A temporary harness home. */
function home(): string {
  const created = mkdtempSync(join(tmpdir(), 'dsh-local-send-settings-'))
  homes.push(created)
  return created
}

describe('the settings document', () => {
  it('starts empty when nothing was ever written', () => {
    const paths = storePaths(home())
    expect(loadSettings(paths)).toEqual({ receiveDir: '' })
  })

  it('round-trips a chosen directory', () => {
    const paths = storePaths(home())
    saveSettings(paths, { receiveDir: '/Users/Admin/Downloads/inbox' })
    expect(loadSettings(paths)).toEqual({ receiveDir: '/Users/Admin/Downloads/inbox' })
  })

  it('reads a corrupt document as no preference rather than failing', () => {
    const paths = storePaths(home())
    saveSettings(paths, { receiveDir: '/tmp/x' })
    writeFileSync(paths.settings, '{ not json', 'utf8')
    expect(loadSettings(paths)).toEqual({ receiveDir: '' })
  })
})

describe('which directory wins', () => {
  it('prefers the panel choice over the deployment default', () => {
    const paths = storePaths(home())
    const config = { ...DEFAULT_CONFIG, receiveDir: '/deploy/inbox' }
    expect(receiveDirectory(config, paths, '/panel/inbox')).toBe('/panel/inbox')
  })

  it('falls back to the deployment default when the panel has not chosen', () => {
    const paths = storePaths(home())
    const config = { ...DEFAULT_CONFIG, receiveDir: '/deploy/inbox' }
    expect(receiveDirectory(config, paths, '')).toBe('/deploy/inbox')
  })

  it('falls back to the plugin inbox when neither is set', () => {
    const paths = storePaths(home())
    expect(receiveDirectory({ ...DEFAULT_CONFIG, receiveDir: '' }, paths, '')).toBe(paths.inbox)
  })
})
