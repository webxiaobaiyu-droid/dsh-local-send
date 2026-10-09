/**
 * Peer discovery over the LocalSend multicast channel.
 *
 * One UDP socket carries both directions of the conversation. A member
 * announces itself to `224.0.0.167:53317`; every other member that sees the
 * datagram answers — normally by calling back over HTTP, because that answer is
 * also the proof that the announcer is reachable, and by multicast only when
 * that call fails. Binding the same socket that announces therefore means one
 * port, one lifecycle, and no separate listener to keep in step.
 *
 * Three decisions here are about not being a bad neighbour on someone's LAN:
 *
 * - **The reply is what registers a peer, never the announcement alone.** A
 *   device whose HTTP API is unreachable is a device that cannot receive a file,
 *   so listing it would offer the user an action guaranteed to fail. The
 *   multicast fallback exists only so a peer that cannot be called back is still
 *   *visible* as a device that chose not to answer, which is a more honest row
 *   than silence.
 * - **The legacy subnet scan is not automatic.** Every other discovery mechanism
 *   here costs one datagram; the spec's HTTP fallback costs one request per
 *   address on the subnet. Running that on a timer to find a device that is not
 *   answering multicast would spend the whole subnet's patience on every scan
 *   interval, so it is a deliberate, user-triggered action instead.
 * - **Presence expires.** A peer is a live fact, not a record: a device that
 *   stops announcing is removed rather than left as a stale row the user can
 *   click. {@link PEER_TTL_MS} spans several announcement intervals, so one
 *   dropped datagram does not make a device flicker out of the list.
 *
 * @module dsh-local-send/discovery
 */

import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import {
  MULTICAST_GROUP,
  apiUrl,
  peerOrigin,
  readAnnouncement,
  type Announcement,
  type DeviceInfo,
} from './protocol.ts'

/**
 * How often this device announces itself.
 *
 * The spec only requires an announcement at startup, but a device that joined
 * the network after this one did would never learn about it. Three seconds is
 * the interval the reference implementation uses: fast enough that opening the
 * panel on a phone finds the desktop before the user has finished reading the
 * screen, slow enough that the traffic is a rounding error on any network.
 */
export const ANNOUNCE_INTERVAL_MS = 3_000

/**
 * How long a peer survives without an announcement.
 *
 * Six intervals, so a device has to miss five announcements in a row before it
 * disappears — a single dropped datagram on a congested network must not make a
 * device blink.
 */
export const PEER_TTL_MS = 18_000

/** How long a callback to an announcing peer may take before it counts as unreachable. */
const CALLBACK_TIMEOUT_MS = 3_000

/** One device discovered on the LAN, as a live fact. */
export interface DiscoveredPeer {
  /** The peer's announced identity. */
  readonly info: DeviceInfo
  /**
   * Address the peer was seen at.
   *
   * Taken from the datagram rather than from the payload, which carries no
   * address at all: this is the only value observed to work, and on a
   * multi-homed host it is also the interface the peer can actually reach.
   */
  readonly host: string
  /** Epoch milliseconds of the most recent announcement from this peer. */
  readonly seenAt: number
  /**
   * Whether the peer answered a callback.
   *
   * `false` means the device announced itself but did not answer over HTTP, so
   * it is listed as unreachable rather than quietly offered as a send target.
   */
  readonly reachable: boolean
}

/** Callbacks the discovery loop reports through. */
export interface DiscoveryHandlers {
  /** A peer was seen, or an already-known peer was seen again. */
  onPeer: (peer: DiscoveredPeer) => void
  /**
   * The loop is asking the owner to drop peers it has not seen for
   * {@link PEER_TTL_MS}. The peer table lives with the owner, so expiry is a
   * request rather than something this module mutates behind its back.
   */
  onSweep: () => void
  /** A non-fatal condition worth a log line. */
  onWarning: (message: string) => void
}

/** One IPv4 address this machine holds on a multicast-capable interface. */
interface LocalAddress {
  /** Interface name, as the OS reports it. */
  readonly name: string
  /** Dotted-quad address. */
  readonly address: string
}

/**
 * Every non-internal IPv4 address this machine holds.
 *
 * The interface list is read fresh for each join and each announce rather than
 * captured once: a laptop that joins a Wi-Fi network or opens a VPN tunnel after
 * the plugin started has an address the loop has never heard of, and a socket
 * that joined the group only on the old interface would be invisible on the new
 * one until the process restarted.
 *
 * @returns one entry per usable address, possibly empty on a disconnected host.
 */
export function localAddresses(): LocalAddress[] {
  const found: LocalAddress[] = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      // `family` is a string on modern Node and a number on ancient versions;
      // both spellings are checked because this also runs under Electron's Node.
      const isIPv4 = address.family === 'IPv4' || (address.family as unknown as number) === 4
      if (isIPv4 && !address.internal) found.push({ name, address: address.address })
    }
  }
  return found
}

/**
 * The multicast channel: one socket, announcing and listening.
 *
 * The class owns no policy about peers — it reports what it sees through
 * {@link DiscoveryHandlers} and lets the caller decide what a peer is worth.
 * That split is what keeps the peer registry testable without a network.
 */
export class MulticastDiscovery {
  private socket: Socket | undefined
  private announceTimer: NodeJS.Timeout | undefined
  private sweepTimer: NodeJS.Timeout | undefined
  private stopped = false
  /** Whether the socket completed its bind; before that, an error is fatal. */
  private bound = false
  /** Addresses the current socket has joined, so a re-join can be diffed. */
  private readonly joined = new Set<string>()
  /** Serializes announces, so per-interface sends cannot interleave. */
  private sending: Promise<void> = Promise.resolve()

  /**
   * @param announce - this device's own identity, sent in every announcement.
   * @param handlers - callbacks the loop reports through.
   * @param port - UDP port to bind; the spec's default unless reconfigured.
   */
  constructor(
    private readonly announce: () => Announcement,
    private readonly handlers: DiscoveryHandlers,
    private readonly port: number,
  ) {}

  /**
   * Bind the socket, join the group on every interface, and start announcing.
   *
   * A socket that cannot be bound is reported and then ignored: port 53317 is a
   * well-known port, so the realistic failure is that the official LocalSend app
   * (or a second copy of this plugin) already owns it. Discovery then degrades to
   * nothing while the transfer API keeps working, which is the right way round —
   * a peer that knows this device's address can still send to it.
   */
  start(): void {
    if (this.socket !== undefined || this.stopped) return
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('error', (error: Error) => {
      this.handlers.onWarning(`discovery socket: ${error.message}`)
      // An error before the bind completed is fatal for this socket. After that,
      // a send error on an interface that just went away is survivable, and
      // tearing discovery down over it would lose the interfaces still working.
      if (!this.bound) this.closeSocket()
    })
    socket.on('message', (buffer, remote) => {
      this.receive(buffer, remote.address)
    })
    socket.on('listening', () => {
      this.bound = true
      try {
        socket.setMulticastTTL(1)
        // Loopback stays on: two members on one machine — a second DSH profile,
        // or the official app — are exactly the case a LAN transfer should still
        // serve, and multicast loopback is how they hear each other.
        socket.setMulticastLoopback(true)
      } catch (error: unknown) {
        this.handlers.onWarning(`discovery socket options: ${describe(error)}`)
      }
      this.joinInterfaces()
      this.send()
    })
    try {
      socket.bind({ port: this.port, exclusive: false })
    } catch (error: unknown) {
      this.handlers.onWarning(`discovery bind: ${describe(error)}`)
      this.closeSocket()
      return
    }
    this.announceTimer = setInterval(() => {
      // Re-joining costs one syscall set per interface and covers the laptop
      // that changed networks since the last tick; see `localAddresses`.
      this.joinInterfaces()
      this.send()
    }, ANNOUNCE_INTERVAL_MS)
    this.announceTimer.unref()
    this.sweepTimer = setInterval(() => {
      // Expiry is driven by the owner, which holds the peer table; this timer
      // only says when to ask. Kept separate from announcing so a reconfigured
      // announce interval cannot change how long a dead peer lingers.
      this.handlers.onSweep()
    }, ANNOUNCE_INTERVAL_MS)
    this.sweepTimer.unref()
  }

  /** Close the socket and stop both timers. Idempotent. */
  stop(): void {
    this.stopped = true
    if (this.announceTimer !== undefined) clearInterval(this.announceTimer)
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer)
    this.announceTimer = undefined
    this.sweepTimer = undefined
    this.closeSocket()
  }

  /**
   * Send one announcement to the group on every interface.
   *
   * Public because two moments cannot wait for the next tick: a rename, so the
   * name a peer shows catches up while the user is still looking at the panel,
   * and the moment the transfer API finishes binding, because the announcement
   * carries the port and a device that announced before the listener was up
   * would have advertised one that refuses connections.
   *
   * Sent per interface with that interface's own outgoing address, because a
   * machine with both Wi-Fi and a VPN up has two routes to the group and the
   * default route would only ever use one of them. The sends are serialized:
   * `setMulticastInterface` is socket-wide state, so two announces overlapping
   * would race for it and send both on whichever interface won.
   */
  send(): void {
    this.sending = this.sending.then(() => this.sendOnEachInterface()).catch(() => {})
  }

  /** Send the announcement once per local address, sequencing the interface switch. */
  private async sendOnEachInterface(): Promise<void> {
    const payload = Buffer.from(JSON.stringify(this.announce()))
    for (const local of localAddresses()) {
      const socket = this.socket
      if (socket === undefined) return
      try {
        socket.setMulticastInterface(local.address)
      } catch {
        // An address that vanished between enumeration and here; the next tick
        // will get a fresh list.
        continue
      }
      await new Promise<void>((resolve) => {
        socket.send(payload, 0, payload.length, this.port, MULTICAST_GROUP, () => { resolve() })
      })
    }
  }

  /**
   * Handle one incoming datagram.
   *
   * A malformed payload is dropped silently: this socket is joined to a
   * well-known multicast group, so anything on the network can send to it, and a
   * log line per junk datagram would itself be a denial of service on the log.
   *
   * @param buffer - raw datagram.
   * @param host - source address, which is the peer's real location.
   */
  private receive(buffer: Buffer, host: string): void {
    if (buffer.length > 64 * 1024) return
    let parsed: unknown
    try {
      parsed = JSON.parse(buffer.toString('utf8'))
    } catch {
      return
    }
    const announcement = readAnnouncement(parsed)
    if (announcement === undefined) return
    // Self-discovery suppression, the only thing the fingerprint is for on the
    // discovery path: our own datagram arrives back through multicast loopback.
    if (announcement.fingerprint === this.announce().fingerprint) return
    // A reply registers a peer that could not be called back. It is not itself
    // answered, which is what stops two devices from replying forever.
    if (!announcement.announce) {
      this.handlers.onPeer({
        info: deviceInfoOf(announcement),
        host,
        seenAt: Date.now(),
        reachable: false,
      })
      return
    }
    void this.reply(announcement, host)
  }

  /**
   * Answer one announcement.
   *
   * The HTTP callback is the normal path and the only one that proves the peer's
   * API is up; the multicast fallback carries the same identity back so the
   * announcer learns about this device even when it cannot be called.
   *
   * @param announcement - the peer's datagram.
   * @param host - the peer's address.
   */
  private async reply(announcement: Announcement, host: string): Promise<void> {
    const info = deviceInfoOf(this.announce())
    let reachable = false
    try {
      const response = await fetch(apiUrl(peerOrigin(announcement, host), 'register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(info),
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      })
      // A peer that answers at all has proved it is listening. A non-2xx answer
      // is its own business and does not change whether this device can be sent
      // to, so the row is still reported, with reachability left false.
      reachable = response.ok
      // Drain the body: an unconsumed response holds the connection open.
      await response.arrayBuffer()
    } catch {
      reachable = false
    }
    this.handlers.onPeer({
      info: deviceInfoOf(announcement),
      host,
      seenAt: Date.now(),
      reachable,
    })
    if (!reachable) this.sendReply(info)
  }

  /**
   * Send the multicast reply form of an answer.
   *
   * Only used when the HTTP callback failed. The datagram carries no address of
   * its own, so the peer learns this device's location from the datagram's
   * source, which is this machine's address on whichever interface the route to
   * the group uses.
   *
   * @param info - this device's identity, without the `announce` flag.
   */
  private sendReply(info: DeviceInfo): void {
    const socket = this.socket
    if (socket === undefined) return
    const payload = Buffer.from(JSON.stringify({ ...info, announce: false }))
    try {
      socket.send(payload, 0, payload.length, this.port, MULTICAST_GROUP, () => {})
    } catch {
      // The socket went away between the callback and the reply; the peer will
      // announce again and get another chance.
    }
  }

  /**
   * Join the group on every current interface that is not already joined.
   *
   * Tracked by address so a network change adds a membership rather than
   * repeating every existing one; `addMembership` on an already-joined pair is
   * harmless on some platforms and an error on others.
   */
  private joinInterfaces(): void {
    const socket = this.socket
    if (socket === undefined) return
    for (const local of localAddresses()) {
      if (this.joined.has(local.address)) continue
      try {
        socket.addMembership(MULTICAST_GROUP, local.address)
        this.joined.add(local.address)
      } catch {
        // A stale membership (the address went away between enumeration and the
        // call) is expected on a roaming laptop; it is not worth a warning.
      }
    }
  }

  /** Drop the socket and forget which memberships it held. */
  private closeSocket(): void {
    const socket = this.socket
    this.socket = undefined
    this.bound = false
    this.joined.clear()
    if (socket === undefined) return
    try {
      socket.close()
    } catch {
      // Already closed by an error path; nothing to do.
    }
  }
}

/** This device's announcement with the reply flag cleared. */
function deviceInfoOf(announcement: Announcement): DeviceInfo {
  const { announce: _announce, ...info } = announcement
  return info
}

/** One line describing an error, for a log line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
