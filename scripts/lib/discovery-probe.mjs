/**
 * A stand-in LocalSend peer, used to prove a running device answers discovery.
 *
 * This is the only probe that exercises the whole receive path against a live
 * process: the protocol answers an announcement with an HTTP POST back to the
 * announcing device, so a callback proves four things at once — the device bound
 * its UDP socket, joined the group, parsed an announcement from something it has
 * never seen, and reached this machine over HTTP.
 *
 * It lives apart from the script that uses it because it is itself worth
 * calibrating: a probe with a bug reports a healthy plugin as broken, and the
 * test suite runs it against this repository's own discovery loop to prove it
 * fires when it should.
 *
 * @module dsh-local-send/scripts/lib/discovery-probe
 */

import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { randomUUID } from 'node:crypto'

/** The multicast group and port the protocol reserves. */
const GROUP = '224.0.0.167'

/**
 * Announce a stand-in device on the multicast group and wait to be called back.
 *
 * This is the one check that exercises the whole receive path against the
 * running process. The LocalSend protocol answers an announcement with an HTTP
 * POST to the announcing device, so a callback proves four things at once: the
 * plugin bound its UDP socket, joined the group, parsed an announcement from a
 * device it has never seen, and reached this machine over HTTP.
 *
 * The stand-in advertises its own ephemeral port rather than the protocol's, so
 * it never competes with the plugin for port 53317.
 *
 * @param groupPort - the UDP port the device under test is listening on.
 * @returns whether a callback arrived, and what it said.
 */
export async function discoveryRoundTrip(groupPort) {
  const received = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      // The protocol's own reply shape: 200 with the answering device's identity.
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ alias: 'verify', version: '2.2', fingerprint: 'verify', download: false }))
      try {
        received.push({ path: request.url, peer: JSON.parse(body) })
      } catch {
        received.push({ path: request.url, peer: undefined })
      }
    })
  })

  // An ephemeral port for the callback, so the stand-in never competes with the
  // device under test for the protocol's own.
  const callbackPort = await new Promise((resolvePort) => {
    server.listen(0, '0.0.0.0', () => {
      const address = server.address()
      resolvePort(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })

  const announcement = {
    alias: 'dsh-local-send verify',
    version: '2.2',
    deviceType: 'headless',
    fingerprint: `verify-${randomUUID()}`,
    port: callbackPort,
    protocol: 'http',
    download: false,
    announce: true,
  }
  const payload = Buffer.from(JSON.stringify(announcement))
  const socket = createSocket({ type: 'udp4', reuseAddr: true })

  // The socket has to be bound before any of its options can be set: an
  // unbound dgram socket answers `setMulticastInterface` with EBADF, and a probe
  // that swallowed that would send nothing and report a healthy device as
  // broken. Binding to an ephemeral port is enough and keeps the stand-in off
  // the protocol's own.
  await new Promise((bound) => {
    socket.bind(0, () => { bound() })
  })

  try {
    for (const address of localAddresses()) {
      try {
        socket.setMulticastInterface(address)
      } catch {
        continue
      }
      await new Promise((done) => {
        socket.send(payload, 0, payload.length, groupPort, GROUP, () => { done() })
      })
    }

    const deadline = Date.now() + 6_000
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((wait) => setTimeout(wait, 100))
    }
  } finally {
    socket.close()
    server.close()
  }

  const first = received[0]
  if (first === undefined) {
    return {
      calledBack: false,
      detail: `no callback within 6s (announced to ${String(groupPort)} from ${String(callbackPort)})`,
    }
  }
  return {
    calledBack: first.path === '/api/localsend/v2/register',
    peer: first.peer,
    detail: `${String(first.path)} from "${String(first.peer?.alias)}"`,
  }
}


/**
 * Wait for the device under test to announce itself.
 *
 * The other half of the discovery contract, and the half a reply cannot cover:
 * a device that answers but never announces is invisible to everyone that has
 * not already found it, so it appears in nobody's peer list until they go
 * looking. This joins the group the way a peer would and listens.
 *
 * The device announces on a timer, so a wait of a few seconds is expected rather
 * than a sign of trouble.
 *
 * @param groupPort - the UDP port the device under test announces to.
 * @param timeoutMs - how long to listen before giving up.
 * @returns whether an announcement arrived, and what it said.
 */
export async function discoveryAnnouncement(groupPort, timeoutMs = 8_000) {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  const heard = []

  await new Promise((bound) => { socket.bind({ port: groupPort, exclusive: false }, () => { bound() }) })
  try {
    socket.setMulticastLoopback(true)
  } catch {
    // Not every platform needs it; the announcements may still arrive.
  }
  for (const address of localAddresses()) {
    try {
      socket.addMembership(GROUP, address)
    } catch {
      // An interface that will not take the membership is one this device cannot
      // be discovered on; the others still count.
    }
  }

  socket.on('message', (buffer) => {
    try {
      const parsed = JSON.parse(buffer.toString('utf8'))
      if (parsed?.announce === true) heard.push(parsed)
    } catch {
      // Junk on a well-known group is expected; it is not this device's answer.
    }
  })

  const deadline = Date.now() + timeoutMs
  while (heard.length === 0 && Date.now() < deadline) {
    await new Promise((wait) => setTimeout(wait, 100))
  }
  socket.close()

  const first = heard[0]
  if (first === undefined) {
    return { announced: false, detail: `nothing announced on ${String(groupPort)} within ${String(timeoutMs)}ms` }
  }
  return {
    announced: true,
    peer: first,
    detail: `"${String(first.alias)}" announced itself on port ${String(first.port)}`,
  }
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
