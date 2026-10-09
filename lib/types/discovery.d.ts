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
import { type Announcement, type DeviceInfo } from './protocol.ts';
/**
 * How often this device announces itself.
 *
 * The spec only requires an announcement at startup, but a device that joined
 * the network after this one did would never learn about it. Three seconds is
 * the interval the reference implementation uses: fast enough that opening the
 * panel on a phone finds the desktop before the user has finished reading the
 * screen, slow enough that the traffic is a rounding error on any network.
 */
export declare const ANNOUNCE_INTERVAL_MS = 3000;
/**
 * How long a peer survives without an announcement.
 *
 * Six intervals, so a device has to miss five announcements in a row before it
 * disappears — a single dropped datagram on a congested network must not make a
 * device blink.
 */
export declare const PEER_TTL_MS = 18000;
/** One device discovered on the LAN, as a live fact. */
export interface DiscoveredPeer {
    /** The peer's announced identity. */
    readonly info: DeviceInfo;
    /**
     * Address the peer was seen at.
     *
     * Taken from the datagram rather than from the payload, which carries no
     * address at all: this is the only value observed to work, and on a
     * multi-homed host it is also the interface the peer can actually reach.
     */
    readonly host: string;
    /** Epoch milliseconds of the most recent announcement from this peer. */
    readonly seenAt: number;
    /**
     * Whether the peer answered a callback.
     *
     * `false` means the device announced itself but did not answer over HTTP, so
     * it is listed as unreachable rather than quietly offered as a send target.
     */
    readonly reachable: boolean;
}
/** Callbacks the discovery loop reports through. */
export interface DiscoveryHandlers {
    /** A peer was seen, or an already-known peer was seen again. */
    onPeer: (peer: DiscoveredPeer) => void;
    /**
     * The loop is asking the owner to drop peers it has not seen for
     * {@link PEER_TTL_MS}. The peer table lives with the owner, so expiry is a
     * request rather than something this module mutates behind its back.
     */
    onSweep: () => void;
    /** A non-fatal condition worth a log line. */
    onWarning: (message: string) => void;
}
/** One IPv4 address this machine holds on a multicast-capable interface. */
interface LocalAddress {
    /** Interface name, as the OS reports it. */
    readonly name: string;
    /** Dotted-quad address. */
    readonly address: string;
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
export declare function localAddresses(): LocalAddress[];
/**
 * The multicast channel: one socket, announcing and listening.
 *
 * The class owns no policy about peers — it reports what it sees through
 * {@link DiscoveryHandlers} and lets the caller decide what a peer is worth.
 * That split is what keeps the peer registry testable without a network.
 */
export declare class MulticastDiscovery {
    private readonly announce;
    private readonly handlers;
    private readonly port;
    private socket;
    private announceTimer;
    private sweepTimer;
    private stopped;
    /** Whether the socket completed its bind; before that, an error is fatal. */
    private bound;
    /**
     * Resolves when the current socket is listening.
     *
     * A send requested before the bind has to wait for it rather than be dropped.
     * A dgram socket refuses `setMulticastInterface` outright while unbound, so a
     * send that raced the bind would silently announce nothing — and the callers
     * that send eagerly (a rename, or the moment the transfer API finishes
     * binding) are exactly the ones whose whole point is that the peer hears about
     * it now rather than at the next tick.
     */
    private listening;
    /** Addresses the current socket has joined, so a re-join can be diffed. */
    private readonly joined;
    /** Serializes announces, so per-interface sends cannot interleave. */
    private sending;
    /**
     * @param announce - this device's own identity, sent in every announcement.
     * @param handlers - callbacks the loop reports through.
     * @param port - UDP port to bind; the spec's default unless reconfigured.
     */
    constructor(announce: () => Announcement, handlers: DiscoveryHandlers, port: number);
    /**
     * Bind the socket, join the group on every interface, and start announcing.
     *
     * A socket that cannot be bound is reported and then ignored: port 53317 is a
     * well-known port, so the realistic failure is that the official LocalSend app
     * (or a second copy of this plugin) already owns it. Discovery then degrades to
     * nothing while the transfer API keeps working, which is the right way round —
     * a peer that knows this device's address can still send to it.
     */
    start(): void;
    /** Close the socket and stop both timers. Idempotent. */
    stop(): void;
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
    send(): void;
    /** Send the announcement once per local address, sequencing the interface switch. */
    private sendOnEachInterface;
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
    private receive;
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
    private reply;
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
    private sendReply;
    /**
     * Join the group on every current interface that is not already joined.
     *
     * Tracked by address so a network change adds a membership rather than
     * repeating every existing one; `addMembership` on an already-joined pair is
     * harmless on some platforms and an error on others.
     */
    private joinInterfaces;
    /** Drop the socket and forget which memberships it held. */
    private closeSocket;
}
export {};
