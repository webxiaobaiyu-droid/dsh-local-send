/**
 * The pure helpers: the parsers that face the network and the formatters that
 * face the reader.
 *
 * These are worth testing apart from any socket because they are where untrusted
 * input stops being untrusted. A parser that accepts a malformed announcement
 * puts a device in the peer list that can never be sent to; a formatter that can
 * return `NaN` puts that on screen in the middle of a transfer.
 *
 * @module dsh-local-send/tests/pure
 */

import { describe, expect, it } from 'vitest'
import {
  DEVICE_TYPES,
  isSafeFileName,
  peerOrigin,
  readAnnouncement,
  readDeviceInfo,
  readFileMap,
  readPrepareUpload,
  registerResponse,
  uniqueFileName,
  type DeviceInfo,
} from '../src/protocol.ts'
import { formatAge, formatBytes, formatEta, formatRate, percentOf, shortenFileName } from '../src/client/format.ts'
import { formatMention } from '../src/client/mention.ts'

/** One well-formed device identity, for tests to spoil. */
function validInfo(): Record<string, unknown> {
  return {
    alias: 'Nice Orange',
    version: '2.2',
    deviceModel: 'Samsung',
    deviceType: 'mobile',
    fingerprint: 'abc123',
    port: 53317,
    protocol: 'https',
    download: true,
  }
}

describe('device identity parsing', () => {
  it('accepts a well-formed identity', () => {
    const info = readDeviceInfo(validInfo())
    expect(info?.alias).toBe('Nice Orange')
    expect(info?.deviceType).toBe('mobile')
    expect(info?.port).toBe(53317)
    expect(info?.protocol).toBe('https')
    expect(info?.download).toBe(true)
  })

  it.each(['alias', 'version', 'fingerprint', 'port', 'protocol'])('rejects an identity with no %s', (field) => {
    const raw = validInfo()
    delete raw[field]
    expect(readDeviceInfo(raw)).toBeUndefined()
  })

  it('rejects a port that is not a usable one', () => {
    for (const port of [0, -1, 70_000, 1.5, 'abc', null]) {
      expect(readDeviceInfo({ ...validInfo(), port })).toBeUndefined()
    }
  })

  it('rejects a transport the protocol does not define', () => {
    expect(readDeviceInfo({ ...validInfo(), protocol: 'ftp' })).toBeUndefined()
  })

  it('keeps an unrecognized device type out rather than failing the payload', () => {
    // The reference implementations fall back to a default icon for a device
    // class they do not know, so an unknown one is a display concern and must
    // not cost the whole device.
    const info = readDeviceInfo({ ...validInfo(), deviceType: 'toaster' })
    expect(info).toBeDefined()
    expect(info?.deviceType).toBeUndefined()
  })

  it('keeps an explicit null distinct from an absent field', () => {
    // A device that sent `null` said "I have no model name"; one that omitted
    // the key said nothing. Collapsing them would make this plugin's
    // re-serialization differ from what the peer actually said.
    expect(readDeviceInfo({ ...validInfo(), deviceModel: null })?.deviceModel).toBeNull()
    const raw = validInfo()
    delete raw['deviceModel']
    expect(readDeviceInfo(raw)).not.toHaveProperty('deviceModel')
  })

  it('rejects values that are not objects at all', () => {
    for (const value of [null, undefined, 42, 'text', []]) {
      expect(readDeviceInfo(value)).toBeUndefined()
    }
  })

  it.each([...DEVICE_TYPES])('accepts the %s class', (deviceType) => {
    expect(readDeviceInfo({ ...validInfo(), deviceType })?.deviceType).toBe(deviceType)
  })
})

describe('announcement parsing', () => {
  it('requires the announce flag', () => {
    expect(readAnnouncement({ ...validInfo(), announce: true })?.announce).toBe(true)
    expect(readAnnouncement(validInfo())).toBeUndefined()
  })

  it('rejects an announcement that is not a valid identity', () => {
    expect(readAnnouncement({ announce: true })).toBeUndefined()
  })
})

describe('preparation parsing', () => {
  it('reads a well-formed offer', () => {
    const parsed = readPrepareUpload({
      info: validInfo(),
      files: {
        a: { id: 'a', fileName: 'photo.jpg', size: 1024, fileType: 'image/jpeg', sha256: 'ff' },
      },
    })
    expect(parsed?.files['a']?.fileName).toBe('photo.jpg')
    expect(parsed?.files['a']?.size).toBe(1024)
  })

  it('drops one unreadable file rather than failing the batch', () => {
    const files = readFileMap({
      good: { id: 'good', fileName: 'a.txt', size: 1, fileType: 'text/plain' },
      // A negative size is the case that matters: it is what the receiver sizes
      // its write against, so accepting it would corrupt an accounting.
      negative: { id: 'negative', fileName: 'b.txt', size: -5, fileType: 'text/plain' },
      // No name at all, which no icon or save can be built from.
      nameless: { id: 'nameless', size: 3, fileType: 'text/plain' },
      fractional: { id: 'fractional', fileName: 'd.txt', size: 1.5, fileType: 'text/plain' },
    })
    expect(Object.keys(files ?? {})).toEqual(['good'])
  })

  it('uses the map key when an entry omits its own id', () => {
    // The spec keys the map by the file's id, so a sender that relies on the key
    // alone is still readable.
    const files = readFileMap({ key1: { fileName: 'a.txt', size: 1, fileType: 'text/plain' } })
    expect(files?.['key1']?.id).toBe('key1')
  })

  it('defaults a missing MIME type rather than refusing the file', () => {
    const files = readFileMap({ a: { id: 'a', fileName: 'a.bin', size: 1 } })
    expect(files?.['a']?.fileType).toBe('application/octet-stream')
  })

  it('rejects a body that is not an offer', () => {
    expect(readPrepareUpload({ info: validInfo() })).toBeUndefined()
    expect(readPrepareUpload({ files: {} })).toBeUndefined()
    expect(readPrepareUpload(null)).toBeUndefined()
  })

  it('reports only the fields register and info may carry', () => {
    const info = readDeviceInfo(validInfo()) as DeviceInfo
    const response = registerResponse(info)
    expect(response).not.toHaveProperty('port')
    expect(response).not.toHaveProperty('protocol')
    expect(response.fingerprint).toBe(info.fingerprint)
  })
})

describe('file name safety', () => {
  it('accepts an ordinary name', () => {
    expect(isSafeFileName('holiday photo.jpg')).toBe(true)
    expect(isSafeFileName('.gitignore')).toBe(true)
  })

  it.each(['..', '.', '', 'a/b.txt', 'a\\b.txt', 'null\u0000byte', 'new\nline'])(
    'refuses %j',
    (name) => {
      expect(isSafeFileName(name)).toBe(false)
    },
  )
})

describe('collision naming', () => {
  it('leaves a free name alone', () => {
    expect(uniqueFileName('report.pdf', new Set())).toBe('report.pdf')
  })

  it('suffixes the way a file manager does', () => {
    expect(uniqueFileName('report.pdf', new Set(['report.pdf']))).toBe('report (1).pdf')
    expect(uniqueFileName('report.pdf', new Set(['report.pdf', 'report (1).pdf']))).toBe('report (2).pdf')
  })

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(uniqueFileName('.env', new Set(['.env']))).toBe('.env (1)')
  })

  it('keeps a compound extension intact', () => {
    expect(uniqueFileName('archive.tar.gz', new Set(['archive.tar.gz']))).toBe('archive.tar (1).gz')
  })
})

describe('peer origins', () => {
  it('brackets an IPv6 literal so the port cannot be read as a group', () => {
    expect(peerOrigin({ protocol: 'http', port: 53317 }, 'fe80::1')).toBe('http://[fe80::1]:53317')
  })

  it('leaves an IPv4 address alone', () => {
    expect(peerOrigin({ protocol: 'https', port: 53317 }, '192.168.1.4')).toBe('https://192.168.1.4:53317')
  })

  it('does not double-bracket an address that already is', () => {
    expect(peerOrigin({ protocol: 'http', port: 80 }, '[::1]')).toBe('http://[::1]:80')
  })
})

describe('figures', () => {
  it('formats bytes at a readable precision', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB')
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB')
  })

  it('never renders a figure that is not a number', () => {
    // A formatter that could return NaN would put it on screen mid-transfer.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(formatBytes(value)).toBe('0 B')
    }
    expect(percentOf(Number.NaN, 10)).toBe(0)
    expect(percentOf(1, 0)).toBe(0)
    expect(formatRate(100, 0)).toBeUndefined()
    expect(formatEta(100, 0)).toBeUndefined()
  })

  it('clamps a percentage into range', () => {
    expect(percentOf(5, 10)).toBe(50)
    expect(percentOf(20, 10)).toBe(100)
    expect(percentOf(-5, 10)).toBe(0)
  })

  it('withholds a rate until there is enough time for one to mean anything', () => {
    expect(formatRate(1000, 100)).toBeUndefined()
    expect(formatRate(1024 * 1024, 1000)).toBe('1.00 MB/s')
  })

  it('ages coarsely and then says nothing', () => {
    const now = 1_000_000_000
    expect(formatAge(now - 1_000, now)).toBe('just now')
    expect(formatAge(now - 30_000, now)).toBe('30s ago')
    expect(formatAge(now - 120_000, now)).toBe('2m ago')
    // Past an hour the column is not worth a figure.
    expect(formatAge(now - 7_200_000, now)).toBeUndefined()
  })

  it('shortens a file name from the middle, keeping the extension', () => {
    const long = 'a-very-long-file-name-that-will-not-fit-in-the-row.pdf'
    const short = shortenFileName(long, 24)
    expect(short.length).toBeLessThanOrEqual(24)
    expect(short.endsWith('.pdf')).toBe(true)
    expect(short).toContain('…')
    expect(shortenFileName('short.txt', 24)).toBe('short.txt')
  })
})

describe('mentions', () => {
  it('writes a plain path unquoted', () => {
    expect(formatMention('/tmp/inbox/photo.jpg')).toBe('@/tmp/inbox/photo.jpg')
  })

  it('quotes a path that contains whitespace', () => {
    // Without the quotes the token would end at the first space and the agent
    // would be handed half a path.
    expect(formatMention('/tmp/my inbox/photo.jpg')).toBe('@"/tmp/my inbox/photo.jpg"')
  })

  it('refuses a path the grammar cannot represent', () => {
    expect(formatMention('/tmp/a"b.txt')).toBeUndefined()
    expect(formatMention('/tmp/a\u0000b')).toBeUndefined()
    expect(formatMention('')).toBeUndefined()
  })
})
