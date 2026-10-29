/**
 * The shell's path bridge: when a dropped file can be named, the host reads it
 * from disk instead of receiving its bytes through the browser.
 *
 * The interesting cases are the refusals. A bridge that answers `''` (pasted
 * bytes), a relative path (resolved against the host's cwd, not the user's
 * folder), or a non-string must all read as "no path here" — the caller then
 * streams the file, which always works. A bridge that throws is the same answer,
 * not an error the gesture should inherit.
 *
 * @module dsh-local-send/tests/local-path
 */

import { describe, expect, it } from 'vitest'
import { localPathOf, localPathsOf, type HostPathsBridge } from '../src/client/local-path.ts'

/** A stand-in for a File; the bridge decides what it answers, not the object. */
const FILE = { name: 'x.iso', size: 4_365_586_432 } as unknown as File

/** A bridge that always answers `answer`. */
function bridge(answer: unknown): HostPathsBridge {
  return { pathFor: () => answer as string }
}

describe('one file', () => {
  it('is skipped when the deployment has no shell bridge', () => {
    expect(localPathOf(FILE, undefined)).toBeUndefined()
    expect(localPathOf(FILE, {})).toBeUndefined()
  })

  it('takes an absolute path', () => {
    const path = '/Users/Admin/Downloads/openEuler-20.03-LTS-SP3-x86_64-dvd.iso'
    expect(localPathOf(FILE, bridge(path))).toBe(path)
  })

  it('refuses the empty answer a pasted file gives', () => {
    // The shell answers '' for bytes without a path; treating that as a path
    // would send the host to the filesystem root's cwd.
    expect(localPathOf(FILE, bridge(''))).toBeUndefined()
  })

  it('refuses a relative answer', () => {
    expect(localPathOf(FILE, bridge('Downloads/x.iso'))).toBeUndefined()
    expect(localPathOf(FILE, bridge('./x.iso'))).toBeUndefined()
  })

  it('refuses a non-string answer', () => {
    expect(localPathOf(FILE, bridge(undefined))).toBeUndefined()
    expect(localPathOf(FILE, bridge(null))).toBeUndefined()
  })

  it('treats a throwing bridge as a missing capability', () => {
    const throwing: HostPathsBridge = { pathFor: () => { throw new Error('no path') } }
    expect(localPathOf(FILE, throwing)).toBeUndefined()
  })
})

describe('a batch', () => {
  it('is sent by path only when every file has one', () => {
    const paths = localPathsOf([FILE, FILE], bridge('/tmp/a.iso'))
    expect(paths).toEqual(['/tmp/a.iso', '/tmp/a.iso'])
  })

  it('falls back to streaming as a whole when one file has no path', () => {
    // A mixed batch would otherwise arrive as two offers, two sessions and two
    // rows for one gesture.
    let call = 0
    const mixed: HostPathsBridge = {
      pathFor: () => {
        call += 1
        return call === 1 ? '/tmp/a.iso' : ''
      },
    }
    expect(localPathsOf([FILE, FILE], mixed)).toBeUndefined()
  })

  it('has nothing to send for an empty batch', () => {
    expect(localPathsOf([], bridge('/tmp/a.iso'))).toBeUndefined()
  })
})
