import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { homedir, hostname, networkInterfaces } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
//#region src/protocol.ts
/**
* The LocalSend wire protocol, as data and pure functions.
*
* Everything here is the v2.2 REST contract from `localsend/protocol`, kept in
* one module with no I/O so both halves of an exchange — the server that answers
* another device and the client that calls one — validate against the same
* definitions instead of drifting apart.
*
* Two properties of this module are deliberate:
*
* 1. **Every field that arrives from the network is optional until proven
*    otherwise.** A peer on the LAN is untrusted input. The `read*` functions
*    below narrow `unknown` into the shapes the rest of the plugin uses, and
*    they never throw: a malformed announcement costs one peer row, never the
*    discovery loop. Where the spec marks a field nullable, the reader keeps
*    `null` and `undefined` distinct so a re-serialized payload round-trips.
*
* 2. **No certificate.** The spec's `protocol` field exists precisely so a
*    device that cannot present a trusted certificate can still take part, and
*    the reference implementations honour it in both directions. Advertising
*    `http` therefore buys full interoperability with the official apps at the
*    cost of an unencrypted hop — a trade this plugin makes explicitly, and the
*    one the protocol's own fingerprint rule already anticipates ("When
*    encryption is off (HTTP), then the fingerprint is a random generated
*    string"). {@link PROTOCOL_VERSION} is announced as what this plugin
*    actually implements rather than as a claim of newer features.
*
* @module dsh-local-send/protocol
*/
/**
* Multicast group every LocalSend member joins.
*
* The spec notes the default is this single address rather than the wider
* `224.0.0.0/24` block, because some Android devices reject any other group.
*/
const MULTICAST_GROUP = "224.0.0.167";
/** Path prefix of every route in the v2 API. */
const API_PREFIX = "/api/localsend/v2";
/** Device classes the spec defines; used for the icon a peer row draws. */
const DEVICE_TYPES = [
	"mobile",
	"desktop",
	"web",
	"headless",
	"server"
];
/**
* Project a device's identity onto the shape `register` and `info` answer with.
* @param info - the device's full identity.
* @returns the reduced response body.
*/
function registerResponse(info) {
	return {
		alias: info.alias,
		version: info.version,
		fingerprint: info.fingerprint,
		...info.deviceModel === void 0 ? {} : { deviceModel: info.deviceModel },
		...info.deviceType === void 0 ? {} : { deviceType: info.deviceType },
		...info.download === void 0 ? {} : { download: info.download }
	};
}
/**
* The exact message strings the reference implementation answers failures with.
*
* Every non-2xx body in this API is `{"message": "..."}` — a bare status is not
* the contract. The strings are copied rather than paraphrased because a client
* written against the official app may match on them, and because a peer's
* `429`/"Too many requests" is useless to a user if this plugin renamed it.
*/
const MESSAGE = {
	/** A body that is not JSON, or one missing a required field. */
	invalidJson: "Invalid JSON body",
	/** A preparation or download with no files in it. */
	noFiles: "No files provided",
	/** An upload or cancel missing one of its query parameters. */
	missingParameters: "Missing parameters",
	/** A transfer that needs a PIN and was offered without one. */
	pinRequired: "PIN required",
	/** A transfer that offered the wrong PIN. */
	invalidPin: "Invalid PIN",
	/** Declined by the person at the receiving device. */
	rejected: "Rejected",
	/** Withdrawn by the sender while the receiver was still deciding. */
	cancelledBySender: "Cancelled by sender",
	/** An unknown session, a token that does not match, or a different source address. */
	invalidToken: "Invalid token or IP address",
	/** Another transfer already owns this device. */
	blocked: "Blocked by another session",
	/** Bytes did not match the offered SHA-256. */
	checksumMismatch: "Checksum mismatch",
	/** Too many failed PIN attempts from one address. */
	tooManyRequests: "Too many requests",
	/** Anything this device could not classify. */
	internal: "Internal server error"
};
/**
* HTTP status codes the spec assigns a meaning to.
*
* Named because several of them are load-bearing rather than incidental: a
* `403` on a preparation is a person declining, `409` is a second sender
* arriving while one is live, and `422` is the only signal that bytes were
* corrupted in flight. The rest of the plugin switches on these constants
* instead of on bare numbers.
*/
const STATUS = {
	/** Preparation accepted, or work completed. */
	ok: 200,
	/** Nothing to transfer: every offered file was refused. */
	noContent: 204,
	/** Malformed body, or missing upload parameters. */
	badRequest: 400,
	/** A PIN is required, or the one supplied was wrong. */
	unauthorized: 401,
	/** Declined by the receiver, or an upload token that does not match. */
	forbidden: 403,
	/** Another session currently owns the receiver. */
	conflict: 409,
	/** Checksum mismatch. */
	unprocessable: 422,
	/** The receiver hit its own request ceiling. */
	tooManyRequests: 429,
	/** Anything the receiver could not classify. */
	serverError: 500
};
/** Read a value as a plain object, or `undefined`. */
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Read a non-empty string, or `undefined`. */
function asString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/**
* Read a nullable string, keeping `null` distinct from absent.
*
* The spec's `?` and `| null` are not interchangeable on the wire: a device that
* sent an explicit `null` chose to say "I have no model name", and a device that
* omitted the key said nothing at all. Collapsing them would make this plugin's
* re-serialization of a peer subtly different from what the peer said.
*
* @param value - raw field.
* @returns the string, `null` when explicitly null, or `undefined` when absent or malformed.
*/
function asNullableString(value) {
	if (value === null) return null;
	return asString(value);
}
/** Read a finite non-negative number, or `undefined`. */
function asCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/** Read a boolean, or `undefined`. */
function asBoolean(value) {
	return typeof value === "boolean" ? value : void 0;
}
/** Read one of the spec's device classes, or `undefined` for an unknown one. */
function asDeviceType(value) {
	if (value === null) return null;
	return DEVICE_TYPES.find((candidate) => candidate === value);
}
/** Read one of the spec's transports, or `undefined`. */
function asTransferProtocol(value) {
	return value === "http" || value === "https" ? value : void 0;
}
/**
* Narrow an untrusted value into a {@link DeviceInfo}.
*
* The spec allows unknown device types — the reference implementations fall
* back to `desktop` for presentation — so an unrecognized `deviceType` is
* dropped rather than treated as a malformed payload.
*
* @param value - raw value, typically a parsed announcement or `info` object.
* @returns the identity, or `undefined` when a required field is missing.
*/
function readDeviceInfo(value) {
	const raw = asRecord(value);
	if (raw === void 0) return void 0;
	const alias = asString(raw["alias"]);
	const version = asString(raw["version"]);
	const fingerprint = asString(raw["fingerprint"]);
	const port = asCount(raw["port"]);
	const protocol = asTransferProtocol(raw["protocol"]);
	if (alias === void 0 || version === void 0 || fingerprint === void 0) return void 0;
	if (port === void 0 || !Number.isInteger(port) || port === 0 || port > 65535) return void 0;
	if (protocol === void 0) return void 0;
	const deviceModel = asNullableString(raw["deviceModel"]);
	const deviceType = asDeviceType(raw["deviceType"]);
	const download = asBoolean(raw["download"]);
	return {
		alias,
		version,
		fingerprint,
		port,
		protocol,
		...deviceModel === void 0 ? {} : { deviceModel },
		...deviceType === void 0 ? {} : { deviceType },
		...download === void 0 ? {} : { download }
	};
}
/**
* Narrow an untrusted value into an {@link Announcement}.
* @param value - raw datagram payload.
* @returns the announcement, or `undefined` when it is not one.
*/
function readAnnouncement(value) {
	const raw = asRecord(value);
	if (raw === void 0) return void 0;
	const info = readDeviceInfo(raw);
	const announce = asBoolean(raw["announce"]);
	if (info === void 0 || announce === void 0) return void 0;
	return {
		...info,
		announce
	};
}
/** Read one {@link FileTimes}, keeping absent and null distinct. */
function readFileTimes(value) {
	if (value === null) return null;
	const raw = asRecord(value);
	if (raw === void 0) return void 0;
	const modified = asNullableString(raw["modified"]);
	const accessed = asNullableString(raw["accessed"]);
	return {
		...modified === void 0 ? {} : { modified },
		...accessed === void 0 ? {} : { accessed }
	};
}
/**
* Narrow an untrusted value into a {@link FileMetadata}.
*
* `size` must be a non-negative integer: it is what the receiver sizes its
* write against and what the sender's own progress is measured in, so a
* fractional or negative value would corrupt an accounting rather than merely
* look wrong.
*
* @param value - raw file entry.
* @param id - the key the entry arrived under, used when the entry omits `id`.
* @returns the metadata, or `undefined` when a required field is missing.
*/
function readFileMetadata(value, id) {
	const raw = asRecord(value);
	if (raw === void 0) return void 0;
	const resolvedId = asString(raw["id"]) ?? id;
	const fileName = asString(raw["fileName"]);
	const size = asCount(raw["size"]);
	const fileType = asString(raw["fileType"]);
	if (resolvedId === void 0 || fileName === void 0) return void 0;
	if (size === void 0 || !Number.isInteger(size)) return void 0;
	const sha256 = asNullableString(raw["sha256"]);
	const preview = asNullableString(raw["preview"]);
	const metadata = readFileTimes(raw["metadata"]);
	return {
		id: resolvedId,
		fileName,
		size,
		fileType: fileType ?? "application/octet-stream",
		...sha256 === void 0 ? {} : { sha256 },
		...preview === void 0 ? {} : { preview },
		...metadata === void 0 ? {} : { metadata }
	};
}
/**
* Narrow an untrusted `files` map.
*
* An entry that fails validation is dropped rather than failing the map: one
* unreadable file in a batch of twenty should cost that file, and the caller
* decides what to do about the gap.
*
* @param value - raw `files` value.
* @returns validated metadata keyed by file id, or `undefined` when the map itself is not an object.
*/
function readFileMap(value) {
	const raw = asRecord(value);
	if (raw === void 0) return void 0;
	const files = {};
	for (const [key, entry] of Object.entries(raw)) {
		const file = readFileMetadata(entry, key);
		if (file !== void 0) files[file.id] = file;
	}
	return files;
}
/**
* Narrow an untrusted `prepare-upload` body.
* @param value - raw request body.
* @returns the request, or `undefined` when it is not one.
*/
function readPrepareUpload(value) {
	const raw = asRecord(value);
	if (raw === void 0) return void 0;
	const info = readDeviceInfo(raw["info"]);
	const files = readFileMap(raw["files"]);
	if (info === void 0 || files === void 0) return void 0;
	return {
		info,
		files
	};
}
/**
* Build the absolute base URL of one peer's API.
*
* An IPv6 literal has to be bracketed before a port may follow it, and a peer
* that announces `::1` without brackets would otherwise produce a URL that
* parses the last group as a port.
*
* @param device - the peer's identity.
* @param host - the address the peer was actually reached at, which may differ
*   from anything in the announcement and is the only value that has been
*   observed to work.
* @returns the origin, without a trailing slash.
*/
function peerOrigin(device, host) {
	const literal = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `${device.protocol}://${literal}:${String(device.port)}`;
}
/**
* Build one absolute API route on a peer.
* @param origin - result of {@link peerOrigin}.
* @param route - route name under the version prefix, e.g. `upload`.
* @returns the absolute URL.
*/
function apiUrl(origin, route) {
	return `${origin}${API_PREFIX}/${route}`;
}
/**
* Decide whether a file name is safe to write into a receive directory.
*
* This is the one place a remote peer gets to influence a path on this machine,
* so the rule is a whitelist rather than a cleanup: the name must be a single
* path segment that is neither `.` nor `..`, must not be empty, and must not
* carry a separator or a NUL. Anything else is replaced with a generated name by
* the caller rather than repaired here — repairing a name is how a traversal
* gets through.
*
* @param name - the sender-supplied file name.
* @returns whether the name may be used verbatim as a path segment.
*/
function isSafeFileName(name) {
	if (name.length === 0 || name === "." || name === "..") return false;
	if (name.includes("/") || name.includes("\\")) return false;
	return !/[\u0000-\u001f\u007f]/u.test(name);
}
/**
* Pick a file name that does not collide with one already claimed.
*
* Receiving the same photo twice is normal, and overwriting the first copy
* would lose data the receiver never agreed to lose. The suffix follows the
* convention every file manager uses — `report.pdf`, `report (1).pdf` — so the
* result is recognizable rather than machine-mangled.
*
* @param name - desired file name.
* @param taken - names already used in the destination directory.
* @returns a name not present in `taken`, or `name` when it is free.
*/
function uniqueFileName(name, taken) {
	if (!taken.has(name)) return name;
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	for (let index = 1; index < 1e4; index += 1) {
		const candidate = `${stem} (${String(index)})${extension}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${stem} (${String(Date.now())})${extension}`;
}
//#endregion
//#region src/discovery.ts
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
/**
* How often this device announces itself.
*
* The spec only requires an announcement at startup, but a device that joined
* the network after this one did would never learn about it. Three seconds is
* the interval the reference implementation uses: fast enough that opening the
* panel on a phone finds the desktop before the user has finished reading the
* screen, slow enough that the traffic is a rounding error on any network.
*/
const ANNOUNCE_INTERVAL_MS = 3e3;
/**
* How long a peer survives without an announcement.
*
* Six intervals, so a device has to miss five announcements in a row before it
* disappears — a single dropped datagram on a congested network must not make a
* device blink.
*/
const PEER_TTL_MS = 18e3;
/** How long a callback to an announcing peer may take before it counts as unreachable. */
const CALLBACK_TIMEOUT_MS = 3e3;
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
function localAddresses() {
	const found = [];
	for (const [name, addresses] of Object.entries(networkInterfaces())) for (const address of addresses ?? []) if ((address.family === "IPv4" || address.family === 4) && !address.internal) found.push({
		name,
		address: address.address
	});
	return found;
}
/**
* The multicast channel: one socket, announcing and listening.
*
* The class owns no policy about peers — it reports what it sees through
* {@link DiscoveryHandlers} and lets the caller decide what a peer is worth.
* That split is what keeps the peer registry testable without a network.
*/
var MulticastDiscovery = class {
	announce;
	handlers;
	port;
	socket;
	announceTimer;
	sweepTimer;
	stopped = false;
	/** Whether the socket completed its bind; before that, an error is fatal. */
	bound = false;
	/** Addresses the current socket has joined, so a re-join can be diffed. */
	joined = /* @__PURE__ */ new Set();
	/** Serializes announces, so per-interface sends cannot interleave. */
	sending = Promise.resolve();
	/**
	* @param announce - this device's own identity, sent in every announcement.
	* @param handlers - callbacks the loop reports through.
	* @param port - UDP port to bind; the spec's default unless reconfigured.
	*/
	constructor(announce, handlers, port) {
		this.announce = announce;
		this.handlers = handlers;
		this.port = port;
	}
	/**
	* Bind the socket, join the group on every interface, and start announcing.
	*
	* A socket that cannot be bound is reported and then ignored: port 53317 is a
	* well-known port, so the realistic failure is that the official LocalSend app
	* (or a second copy of this plugin) already owns it. Discovery then degrades to
	* nothing while the transfer API keeps working, which is the right way round —
	* a peer that knows this device's address can still send to it.
	*/
	start() {
		if (this.socket !== void 0 || this.stopped) return;
		const socket = createSocket({
			type: "udp4",
			reuseAddr: true
		});
		this.socket = socket;
		socket.on("error", (error) => {
			this.handlers.onWarning(`discovery socket: ${error.message}`);
			if (!this.bound) this.closeSocket();
		});
		socket.on("message", (buffer, remote) => {
			this.receive(buffer, remote.address);
		});
		socket.on("listening", () => {
			this.bound = true;
			try {
				socket.setMulticastTTL(1);
				socket.setMulticastLoopback(true);
			} catch (error) {
				this.handlers.onWarning(`discovery socket options: ${describe$3(error)}`);
			}
			this.joinInterfaces();
			this.send();
		});
		try {
			socket.bind({
				port: this.port,
				exclusive: false
			});
		} catch (error) {
			this.handlers.onWarning(`discovery bind: ${describe$3(error)}`);
			this.closeSocket();
			return;
		}
		this.announceTimer = setInterval(() => {
			this.joinInterfaces();
			this.send();
		}, ANNOUNCE_INTERVAL_MS);
		this.announceTimer.unref();
		this.sweepTimer = setInterval(() => {
			this.handlers.onSweep();
		}, ANNOUNCE_INTERVAL_MS);
		this.sweepTimer.unref();
	}
	/** Close the socket and stop both timers. Idempotent. */
	stop() {
		this.stopped = true;
		if (this.announceTimer !== void 0) clearInterval(this.announceTimer);
		if (this.sweepTimer !== void 0) clearInterval(this.sweepTimer);
		this.announceTimer = void 0;
		this.sweepTimer = void 0;
		this.closeSocket();
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
	send() {
		this.sending = this.sending.then(() => this.sendOnEachInterface()).catch(() => {});
	}
	/** Send the announcement once per local address, sequencing the interface switch. */
	async sendOnEachInterface() {
		const payload = Buffer.from(JSON.stringify(this.announce()));
		for (const local of localAddresses()) {
			const socket = this.socket;
			if (socket === void 0) return;
			try {
				socket.setMulticastInterface(local.address);
			} catch {
				continue;
			}
			await new Promise((resolve) => {
				socket.send(payload, 0, payload.length, this.port, MULTICAST_GROUP, () => {
					resolve();
				});
			});
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
	receive(buffer, host) {
		if (buffer.length > 65536) return;
		let parsed;
		try {
			parsed = JSON.parse(buffer.toString("utf8"));
		} catch {
			return;
		}
		const announcement = readAnnouncement(parsed);
		if (announcement === void 0) return;
		if (announcement.fingerprint === this.announce().fingerprint) return;
		if (!announcement.announce) {
			this.handlers.onPeer({
				info: deviceInfoOf(announcement),
				host,
				seenAt: Date.now(),
				reachable: false
			});
			return;
		}
		this.reply(announcement, host);
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
	async reply(announcement, host) {
		const info = deviceInfoOf(this.announce());
		let reachable = false;
		try {
			const response = await fetch(apiUrl(peerOrigin(announcement, host), "register"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(info),
				signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS)
			});
			reachable = response.ok;
			await response.arrayBuffer();
		} catch {
			reachable = false;
		}
		this.handlers.onPeer({
			info: deviceInfoOf(announcement),
			host,
			seenAt: Date.now(),
			reachable
		});
		if (!reachable) this.sendReply(info);
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
	sendReply(info) {
		const socket = this.socket;
		if (socket === void 0) return;
		const payload = Buffer.from(JSON.stringify({
			...info,
			announce: false
		}));
		try {
			socket.send(payload, 0, payload.length, this.port, MULTICAST_GROUP, () => {});
		} catch {}
	}
	/**
	* Join the group on every current interface that is not already joined.
	*
	* Tracked by address so a network change adds a membership rather than
	* repeating every existing one; `addMembership` on an already-joined pair is
	* harmless on some platforms and an error on others.
	*/
	joinInterfaces() {
		const socket = this.socket;
		if (socket === void 0) return;
		for (const local of localAddresses()) {
			if (this.joined.has(local.address)) continue;
			try {
				socket.addMembership(MULTICAST_GROUP, local.address);
				this.joined.add(local.address);
			} catch {}
		}
	}
	/** Drop the socket and forget which memberships it held. */
	closeSocket() {
		const socket = this.socket;
		this.socket = void 0;
		this.bound = false;
		this.joined.clear();
		if (socket === void 0) return;
		try {
			socket.close();
		} catch {}
	}
};
/** This device's announcement with the reply flag cleared. */
function deviceInfoOf(announcement) {
	const { announce: _announce, ...info } = announcement;
	return info;
}
/** One line describing an error, for a log line. */
function describe$3(error) {
	return error instanceof Error ? error.message : String(error);
}
/** How long a preparation may take before the peer is treated as unresponsive. */
const PREPARE_TIMEOUT_MS = 3e4;
/** One line describing an error, for a log line or a row's message. */
function describe$2(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Guess a MIME type from a file name.
*
* A deliberate short list rather than a dependency: the field exists so the
* receiving device can pick an icon and decide what opens the file, and the
* common cases on a developer's machine are covered by a table this size. An
* unknown extension becomes `application/octet-stream`, which is what the spec's
* own senders fall back to.
*
* @param name - the file's base name.
* @returns the guessed MIME type.
*/
function mimeTypeOf(name) {
	return {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".svg": "image/svg+xml",
		".heic": "image/heic",
		".pdf": "application/pdf",
		".txt": "text/plain",
		".md": "text/markdown",
		".json": "application/json",
		".yaml": "application/yaml",
		".yml": "application/yaml",
		".csv": "text/csv",
		".zip": "application/zip",
		".gz": "application/gzip",
		".tar": "application/x-tar",
		".mp3": "audio/mpeg",
		".m4a": "audio/mp4",
		".wav": "audio/wav",
		".mp4": "video/mp4",
		".mov": "video/quicktime",
		".doc": "application/msword",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xls": "application/vnd.ms-excel",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".ppt": "application/vnd.ms-powerpoint",
		".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	}[extname(name).toLowerCase()] ?? "application/octet-stream";
}
/**
* Hash a file in one pass.
* @param path - absolute path to read.
* @returns the lowercase hex SHA-256.
*/
async function hashFile(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}
/**
* Resolve one file on disk into the metadata the handshake needs.
*
* The size is read here rather than during upload because it has to be in the
* offer: the receiver screens it against its own limits before deciding, and a
* size discovered mid-stream would be discovered too late to decline.
*
* @param id - identifier to offer the file under.
* @param path - absolute path to read.
* @returns the resolved file, or a reason it cannot be sent.
*/
async function resolvePath(id, path) {
	try {
		const stats = await stat(path);
		if (!stats.isFile()) return { error: `${basename(path)} is not a regular file` };
		return {
			metadata: {
				id,
				fileName: basename(path),
				size: stats.size,
				fileType: mimeTypeOf(path),
				sha256: stats.size <= 268435456 ? await hashFile(path) : null,
				metadata: { modified: stats.mtime.toISOString() }
			},
			source: {
				kind: "path",
				path
			}
		};
	} catch (error) {
		return { error: describe$2(error) };
	}
}
/**
* Narrow a preparation response.
*
* Validated rather than trusted for the same reason every other peer-supplied
* shape is: this device answers to whatever is on the network, and a token map
* that is not a map of strings would poison the upload loop rather than fail it.
*
* @param value - parsed response body.
* @returns the session id and tokens, or `undefined`.
*/
function readPrepareResponse(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	const sessionId = raw["sessionId"];
	const files = raw["files"];
	if (typeof sessionId !== "string" || sessionId.length === 0) return void 0;
	if (typeof files !== "object" || files === null) return void 0;
	const tokens = {};
	for (const [key, entry] of Object.entries(files)) if (typeof entry === "string" && entry.length > 0) tokens[key] = entry;
	return {
		sessionId,
		files: tokens
	};
}
/**
* Read a preparation refusal into something a person can read.
*
* The body is `{"message": "..."}` by contract, and the reference client falls
* back to the raw text when it is not — worth copying, because those messages
* are the only place a receiving device explains itself.
*
* @param response - the failed response.
* @returns a message for the transfer row.
*/
async function readFailure(response) {
	let detail = "";
	try {
		const body = await response.json();
		if (typeof body === "object" && body !== null) {
			const message = body.message;
			if (typeof message === "string") detail = message;
		}
	} catch {
		detail = "";
	}
	if (detail.length === 0) detail = response.status === STATUS.unauthorized ? MESSAGE.pinRequired : `HTTP ${String(response.status)}`;
	return detail;
}
/**
* Open a transfer row for files about to be offered.
*
* Separate from the handshake on purpose. A caller may know before it offers
* anything that some files are unusable — a path that does not exist, a name it
* cannot read — and the row must still account for every file the user asked to
* move. Opening the row over the full roster is what makes that possible: a
* transfer that quietly shows fewer files than were requested is worse than one
* that shows a failure.
*
* @param peer - the device the transfer is addressed to.
* @param roster - every file the user asked to move, in order.
* @param registry - the shared table.
* @returns the new row's id.
*/
function openRow(peer, roster, registry) {
	return registry.openOutgoing({
		peerAlias: peer.alias,
		peerFingerprint: peer.fingerprint,
		peerAddress: peer.host,
		peerType: peer.deviceType ?? null,
		files: roster.map((file) => ({
			id: file.id,
			fileName: file.fileName,
			size: file.size,
			fileType: file.fileType
		}))
	});
}
/**
* Offer files to a peer and read its answer.
*
* This stops at the handshake: what comes back is the authority to upload, not
* the upload. A refusal is reported rather than thrown, because "they said no",
* "they were busy" and "they wanted a PIN" are three different things to show a
* user and none of them is an exception.
*
* @param peer - the device to send to.
* @param transferId - the already-open row this offer belongs to.
* @param files - metadata to offer, already sized.
* @param self - this device's identity, sent in the preparation body.
* @param registry - the shared table.
* @returns the prepared offer, or the reason there is none.
*/
async function offerToPeer(peer, transferId, files, self, registry) {
	const origin = peerOrigin(peer, peer.host);
	const offered = {};
	for (const file of files) offered[file.id] = file;
	let prepared;
	try {
		const response = await fetch(apiUrl(origin, "prepare-upload"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				info: self,
				files: offered
			}),
			signal: AbortSignal.timeout(PREPARE_TIMEOUT_MS)
		});
		if (response.status === STATUS.noContent) {
			await response.arrayBuffer();
			return { refused: "the receiving device accepted nothing" };
		}
		if (!response.ok) return { refused: await readFailure(response) };
		const parsed = readPrepareResponse(await response.json());
		if (parsed === void 0) return { refused: "the receiving device sent an unreadable response" };
		prepared = parsed;
	} catch (error) {
		return { refused: describe$2(error) };
	}
	const accepted = /* @__PURE__ */ new Map();
	const declined = [];
	for (const file of files) {
		const token = prepared.files[file.id];
		if (token === void 0 || token.length === 0) {
			declined.push({
				id: file.id,
				reason: "declined by the receiving device"
			});
			registry.updateFile(transferId, file.id, (row) => {
				row.status = "declined";
			});
			continue;
		}
		accepted.set(file.id, file);
	}
	return {
		transferId,
		sessionId: prepared.sessionId,
		origin,
		tokens: prepared.files,
		accepted,
		declined
	};
}
/**
* Offer files and open the row for them, for a caller with nothing to pre-record.
*
* The panel's path: it holds browser files whose sizes it already knows and has
* no earlier failure to report, so one call is the whole of it.
*
* @param peer - the device to send to.
* @param files - metadata to offer.
* @param self - this device's identity.
* @param handlers - registry and log sink.
* @returns the prepared offer, or an outcome describing why there is none.
*/
async function prepareOffer(peer, files, self, handlers) {
	const registry = handlers.registry;
	const transferId = openRow(peer, files, registry);
	const result = await offerToPeer(peer, transferId, files, self, registry);
	if ("refused" in result) {
		registry.fail(transferId, result.refused);
		return { refused: {
			transferId,
			accepted: false,
			sent: [],
			failed: []
		} };
	}
	return result;
}
/**
* Send one accepted file's bytes.
*
* Progress is counted from the source stream as it passes, so the figure the
* panel shows is bytes actually handed to the socket — the one number that
* cannot be wrong about how far along the transfer is.
*
* @param offer - the prepared offer this file belongs to.
* @param fileId - which file of the offer.
* @param source - the bytes to send.
* @param registry - the shared table to report progress against.
*/
async function uploadStream(offer, fileId, source, registry) {
	const token = offer.tokens[fileId];
	const metadata = offer.accepted.get(fileId);
	if (token === void 0 || metadata === void 0) throw new Error(`file ${fileId} was not accepted by the receiving device`);
	const url = new URL(apiUrl(offer.origin, "upload"));
	url.searchParams.set("sessionId", offer.sessionId);
	url.searchParams.set("fileId", fileId);
	url.searchParams.set("token", token);
	let moved = 0;
	/**
	* The source, with each chunk counted as it passes.
	*
	* An async generator rather than a pass-through: `Readable.from` pulls one
	* chunk at a time and only when the socket is ready for it, so a
	* multi-gigabyte file occupies one buffer instead of accumulating in memory.
	*/
	async function* counted() {
		for await (const chunk of source) {
			const buffer = chunk;
			moved += buffer.length;
			registry.updateFile(offer.transferId, fileId, (row) => {
				row.bytesDone = moved;
			});
			yield buffer;
		}
	}
	const init = {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: Readable.toWeb(Readable.from(counted())),
		duplex: "half"
	};
	const response = await fetch(url, init);
	await response.arrayBuffer();
	if (!response.ok) throw new Error(`HTTP ${String(response.status)}${response.status === STATUS.unprocessable ? " (checksum mismatch)" : ""}`);
	registry.updateFile(offer.transferId, fileId, (row) => {
		row.status = "done";
		row.bytesDone = row.size;
		delete row.error;
	});
}
/**
* Tell a peer to forget an offer this device has stopped working on.
*
* The protocol's session ends when every accepted file arrives, when the sender
* cancels, or when the receiver's own state goes away. A sender that gives up
* partway — a file that failed to read, a connection that dropped — therefore
* has to say so, or the receiver keeps a session open for a transfer nobody is
* sending: it holds the staging bookkeeping, and because the protocol allows
* only one live session it would refuse the next sender with `409`.
*
* Best-effort by contract. A peer that has already gone away is exactly the case
* this is most often called in, and failing to deliver a cancellation to a
* device that is not listening changes nothing.
*
* @param offer - the offer being abandoned.
* @param warn - log sink, for a cancellation that could not be delivered.
*/
async function cancelOffer(offer, warn) {
	try {
		await (await fetch(`${apiUrl(offer.origin, "cancel")}?sessionId=${encodeURIComponent(offer.sessionId)}`, {
			method: "POST",
			signal: AbortSignal.timeout(5e3)
		})).arrayBuffer();
	} catch (error) {
		warn(`could not cancel the transfer with the receiving device: ${describe$2(error)}`);
	}
}
/**
* Record one file's failure against its row.
* @param registry - the shared table.
* @param transferId - the transfer the file belongs to.
* @param fileId - the file's id.
* @param reason - message to show the user.
*/
function markFileFailed(registry, transferId, fileId, reason) {
	registry.updateFile(transferId, fileId, (row) => {
		row.status = "failed";
		row.error = reason;
	});
}
/**
* Send files that already exist on this machine, start to finish.
*
* The one-shot path: sizes and digests are read from disk, the offer goes out,
* and the accepted files are uploaded from their own paths under a bounded pool.
*
* The row is opened over every path the user named, before anything is read, so
* a path that turns out to be missing is a failure recorded against its own file
* rather than a file that silently never existed.
*
* @param peer - the device to send to.
* @param paths - absolute paths to offer.
* @param self - this device's identity.
* @param handlers - registry and log sink.
* @returns what the attempt produced.
*/
async function sendPaths(peer, paths, self, handlers) {
	const registry = handlers.registry;
	const names = offerIdsFor(paths);
	/** One row per path, sized where it could be read so the roster total is honest. */
	const roster = [];
	const resolved = /* @__PURE__ */ new Map();
	const failed = [];
	for (const [index, path] of paths.entries()) {
		const named = names[index];
		if (named === void 0) continue;
		const result = await resolvePath(named.id, path);
		if ("error" in result) {
			failed.push({
				id: named.id,
				reason: result.error
			});
			roster.push({
				id: named.id,
				fileName: named.fileName,
				size: 0,
				fileType: mimeTypeOf(path)
			});
			continue;
		}
		resolved.set(named.id, result);
		roster.push(result.metadata);
	}
	const transferId = openRow(peer, roster, registry);
	for (const failure of failed) markFileFailed(registry, transferId, failure.id, failure.reason);
	if (resolved.size === 0) {
		registry.settle(transferId);
		return {
			transferId,
			accepted: false,
			sent: [],
			failed
		};
	}
	const prepared = await offerToPeer(peer, transferId, [...resolved.values()].map((file) => file.metadata), self, registry);
	if ("refused" in prepared) {
		registry.fail(transferId, prepared.refused);
		return {
			transferId,
			accepted: false,
			sent: [],
			failed
		};
	}
	for (const decline of prepared.declined) failed.push(decline);
	const queue = [...prepared.accepted.keys()];
	const sent = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
		while (cursor < queue.length) {
			const index = cursor;
			cursor += 1;
			const fileId = queue[index];
			if (fileId === void 0) continue;
			const file = resolved.get(fileId);
			if (file === void 0) continue;
			try {
				await uploadStream(prepared, fileId, createReadStream(file.source.path), registry);
				sent.push(fileId);
			} catch (error) {
				const reason = describe$2(error);
				failed.push({
					id: fileId,
					reason
				});
				markFileFailed(registry, transferId, fileId, reason);
			}
		}
	});
	await Promise.all(workers);
	if (failed.length > 0) await cancelOffer(prepared, handlers.warn);
	registry.settle(transferId);
	return {
		transferId,
		accepted: true,
		sent,
		failed
	};
}
/**
* Turn a list of paths into offered file identifiers and names.
*
* Shared by every entry point that sends local files, so the naming rule — a
* base name, deduplicated against the rest of the batch — is applied once. Two
* different directories can each hold `report.pdf`, and a batch carrying both
* would otherwise ask the receiver to save one over the other.
*
* @param paths - absolute paths to offer.
* @returns one entry per path, in order.
*/
function offerIdsFor(paths) {
	const claimed = /* @__PURE__ */ new Set();
	return paths.map((path, index) => {
		const raw = basename(path);
		const fileName = uniqueFileName(raw.length > 0 ? raw : `file-${String(index + 1)}`, claimed);
		claimed.add(fileName);
		return {
			id: `f${String(index + 1)}`,
			fileName
		};
	});
}
/**
* The metadata a panel-supplied file is offered under.
*
* Unlike a path, the panel already knows the size, so nothing is read here —
* this only fills in the fields the handshake requires that the browser has no
* opinion about.
*
* @param id - identifier the panel assigned.
* @param fileName - name to send.
* @param size - byte count the panel reported.
* @returns the offer metadata.
*/
function metadataForUpload(id, fileName, size) {
	return {
		id,
		fileName,
		size,
		fileType: mimeTypeOf(fileName),
		sha256: null
	};
}
//#endregion
//#region src/store.ts
/**
* This device's durable identity and the paths the plugin owns.
*
* Everything the plugin remembers between runs lives in one directory under the
* harness home, `${DSH_HOME:-~/.dsh}/local-send`:
*
* - `device.json` — the name this device announces and the fingerprint peers key
*   it by.
* - `inbox/` — files other devices sent, which is also the directory the
*   conversation references point at.
* - `inbox/.partial/` — uploads still arriving.
*
* Keeping one directory rather than scattering files under a shared config tree
* matters for two reasons: a transfer surface is something a user may want to
* back up, move, or delete wholesale, and the receive directory has to be a real
* path the agent can be pointed at, so it cannot live inside a JSON blob.
*
* @module dsh-local-send/store
*/
/** Absolute path of the harness home, honouring an explicit override. */
function resolveDshHome(env = process.env, home = homedir()) {
	const configured = env.DSH_HOME?.trim();
	return configured !== void 0 && configured.length > 0 ? configured : join(home, ".dsh");
}
/**
* Derive every path from one harness home.
* @param dshHome - absolute harness home.
* @returns the path set, whether or not the directories exist yet.
*/
function storePaths(dshHome) {
	const root = join(dshHome, "local-send");
	const inbox = join(root, "inbox");
	return {
		root,
		device: join(root, "device.json"),
		inbox,
		partial: join(inbox, ".partial")
	};
}
/**
* Create the directories the plugin writes into.
*
* Deliberately called before the first write rather than at module load: a
* plugin that is installed but never used should not leave an empty tree in the
* user's home.
*
* @param paths - the path set to materialize.
*/
function ensureDirectories(paths) {
	mkdirSync(paths.inbox, { recursive: true });
	mkdirSync(paths.partial, { recursive: true });
}
/** A generated fingerprint: 32 hex characters of OS entropy. */
function generateFingerprint() {
	return randomBytes(16).toString("hex");
}
/**
* A sensible default device name.
*
* The hostname is the right first guess — it is what the user called this
* machine, and on a LAN it is usually how they think of it — but it can be
* empty or a bare container id, so a fallback keeps the peer list readable.
*
* @returns the name to announce until the user changes it.
*/
function defaultAlias() {
	const name = hostname().trim();
	return name.length > 0 ? name : "DeepSeek Harness";
}
/**
* Read the stored device identity, creating it on first use.
*
* A corrupt file is replaced rather than repaired: the only irreplaceable field
* is the fingerprint, and a fingerprint this plugin cannot parse is one it
* cannot use either. The write is atomic (temp file plus rename) because a
* process killed mid-write would otherwise leave a truncated file that the next
* start would silently replace with a new identity.
*
* @param paths - the path set to read from and write to.
* @param log - sink for a replacement warning, so a lost identity is visible.
* @returns the identity now in effect.
*/
function loadDevice(paths, log) {
	const existing = readStoredDevice(paths.device);
	if (existing !== void 0) return existing;
	const created = {
		fingerprint: generateFingerprint(),
		alias: defaultAlias()
	};
	if (existsSync(paths.device)) log("device.json was unreadable and has been regenerated");
	saveDevice(paths, created);
	return created;
}
/**
* Read and validate a stored identity.
* @param file - absolute path of `device.json`.
* @returns the identity, or `undefined` when absent or malformed.
*/
function readStoredDevice(file) {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return void 0;
		const raw = parsed;
		const fingerprint = raw["fingerprint"];
		const alias = raw["alias"];
		if (typeof fingerprint !== "string" || fingerprint.length === 0) return void 0;
		if (typeof alias !== "string") return void 0;
		return {
			fingerprint,
			alias: alias.trim().length > 0 ? alias : defaultAlias()
		};
	} catch {
		return;
	}
}
/**
* Write the identity atomically.
* @param paths - the path set owning `device.json`.
* @param device - the identity to persist.
*/
function saveDevice(paths, device) {
	mkdirSync(paths.root, { recursive: true });
	const temporary = `${paths.device}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(device, null, 2)}\n`, "utf8");
	renameSync(temporary, paths.device);
}
/** Shipped defaults: the spec's port, an open receive policy, and generous size ceilings. */
const DEFAULT_CONFIG = {
	alias: "",
	port: 53317,
	protocol: "http",
	deviceType: "desktop",
	autoAccept: false,
	pin: "",
	maxFileBytes: 16 * 1024 ** 3,
	maxTransferBytes: 64 * 1024 ** 3,
	maxFiles: 500,
	receiveDir: ""
};
/**
* Merge a deployment's configuration over the shipped defaults.
*
* Every field is checked rather than trusted: this object is built from a Loader
* row that a human edits, and a typo in a port number should produce the default
* port rather than a server that cannot bind.
*
* @param config - the row's configuration, possibly partial or malformed.
* @returns a complete, usable configuration.
*/
function resolveConfig(config) {
	const raw = config ?? {};
	const port = raw.port;
	const maxFiles = raw.maxFiles;
	return {
		...DEFAULT_CONFIG,
		alias: typeof raw.alias === "string" ? raw.alias.trim() : DEFAULT_CONFIG.alias,
		port: typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_CONFIG.port,
		protocol: raw.protocol === "https" ? "https" : "http",
		deviceType: raw.deviceType ?? DEFAULT_CONFIG.deviceType,
		autoAccept: typeof raw.autoAccept === "boolean" ? raw.autoAccept : DEFAULT_CONFIG.autoAccept,
		pin: typeof raw.pin === "string" ? raw.pin : DEFAULT_CONFIG.pin,
		maxFileBytes: positiveOr(raw.maxFileBytes, DEFAULT_CONFIG.maxFileBytes),
		maxTransferBytes: positiveOr(raw.maxTransferBytes, DEFAULT_CONFIG.maxTransferBytes),
		maxFiles: typeof maxFiles === "number" && Number.isInteger(maxFiles) && maxFiles > 0 ? maxFiles : DEFAULT_CONFIG.maxFiles,
		receiveDir: typeof raw.receiveDir === "string" ? raw.receiveDir.trim() : DEFAULT_CONFIG.receiveDir
	};
}
/** Read a positive finite number, or a default. */
function positiveOr(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
/**
* The receive directory in effect.
* @param config - resolved configuration.
* @param paths - the default path set.
* @returns the absolute receive directory, which may be outside the harness home.
*/
function receiveDirectory(config, paths) {
	return config.receiveDir.length > 0 ? config.receiveDir : paths.inbox;
}
//#endregion
//#region src/server.ts
/**
* The LocalSend transfer API this device serves.
*
* This is the half that other devices dial: a plain HTTP server on the port the
* spec reserves, answering the five routes of the v2 upload API. It is
* deliberately separate from the harness's own Fetch carrier — a Fetch-carrier
* route is reachable by the browser half but is fenced to the app's own client,
* and a phone on the LAN carries no such credentials. So the two surfaces exist
* for two different callers and neither can serve the other.
*
* Three rules are enforced here rather than trusted to the sender:
*
* - **A token is bound to the address that received it.** The spec's `403` for
*   "invalid token or IP address" is one condition, not two: an accepted offer
*   yields a token that is only valid from the address that made the offer. This
*   is what stops a device that observed a token on the network from using it.
* - **Nothing is written outside the receive directory.** A sender supplies the
*   file name, so the name is checked as a single path segment
*   ({@link isSafeFileName}) before it is joined to anything, and the write goes
*   to a random name in a staging directory first. A traversal attempt therefore
*   has nowhere to land rather than being filtered after the fact.
* - **Every ceiling is applied before a byte is read.** Sizes and counts are
*   validated at preparation, so an oversized offer is refused while it is still
*   only metadata, and the streaming path re-checks the byte count against what
*   was agreed as it goes.
*
* @module dsh-local-send/server
*/
/** How long a sender waits for the user to decide before the offer is refused. */
const APPROVAL_TIMEOUT_MS = 9e4;
/**
* Uploads this receiver will write at once.
*
* The spec allows a sender to call `upload` in parallel, and a sender that
* does will open one connection per file. Bounding the number this server is
* willing to be *writing* at once keeps a large batch from turning into a large
* batch of open file handles and interleaved disk seeks, without telling the
* sender no: a connection over the bound waits its turn rather than failing.
*/
const MAX_PARALLEL_WRITES = 4;
/**
* Failed PIN attempts one address is allowed before it is refused outright.
*
* Three, matching the reference implementation. There is no recovery short of
* restarting the plugin, which is deliberate: a four-digit PIN has ten thousand
* values, and an attacker who may keep guessing will reach all of them.
*/
const MAX_PIN_ATTEMPTS = 3;
/**
* A tiny counting semaphore.
*
* Used to bound concurrent writes without refusing work: {@link acquire} waits
* rather than failing, which is the behaviour an upload connection needs — a
* sender that opened ten connections should have them all succeed, just not all
* at once.
*/
var Semaphore = class {
	available;
	waiting = [];
	/** @param permits - how many holders may be active at once. */
	constructor(permits) {
		this.available = permits;
	}
	/** Take one permit, waiting if none is free. */
	async acquire() {
		if (this.available > 0) {
			this.available -= 1;
			return;
		}
		await new Promise((resolve) => {
			this.waiting.push(resolve);
		});
	}
	/** Return one permit, waking the longest-waiting holder. */
	release() {
		const next = this.waiting.shift();
		if (next === void 0) {
			this.available += 1;
			return;
		}
		next();
	}
};
/** One line describing an error, for a log line or a peer-visible message. */
function describe$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Answer with a bare status and no body, the shape every success-no-body route uses. */
function empty(response, status) {
	response.writeHead(status).end();
}
/**
* Answer with a failure.
*
* Every non-2xx body in this API is `{"message": "..."}` rather than a bare
* status line: a peer's user is shown the receiving device's own words, and the
* difference between "Rejected" and "Checksum mismatch" is the difference
* between a person saying no and a network corrupting bytes.
*
* @param response - response to answer on.
* @param status - HTTP status.
* @param message - one of {@link MESSAGE}, or a specific explanation.
*/
function fail(response, status, message) {
	json(response, status, { message });
}
/** Answer with JSON. */
function json(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload)
	}).end(payload);
}
/**
* Read a request body with a hard ceiling.
*
* The ceiling matters more than the parse: this is an unauthenticated socket, so
* "read whatever arrives" is a memory exhaustion primitive. Preparation bodies
* are metadata only, so a generous few megabytes is far above anything a real
* client sends and far below anything that would hurt.
*
* @param request - the incoming request.
* @param limit - maximum bytes to buffer.
* @returns the parsed JSON, or `undefined` when the body is too large or not JSON.
*/
async function readJsonBody(request, limit) {
	const chunks = [];
	let size = 0;
	try {
		for await (const chunk of request) {
			const buffer = chunk;
			size += buffer.length;
			if (size > limit) return void 0;
			chunks.push(buffer);
		}
	} catch {
		return;
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return;
	}
}
/** The address a request came from, normalized. */
function remoteAddressOf(request) {
	const address = request.socket.remoteAddress ?? "";
	return address.startsWith("::ffff:") ? address.slice(7) : address;
}
/**
* The LocalSend API server: one HTTP listener and the sessions it is holding.
*
* Lifecycle is explicit ({@link start} / {@link stop}) rather than done in the
* constructor, because a failed bind is an expected condition — the official
* LocalSend app may already own the port — and the caller needs to hear about it
* without losing the rest of the plugin.
*/
var LocalSendServer = class {
	host;
	server;
	sessions = /* @__PURE__ */ new Map();
	writes = new Semaphore(MAX_PARALLEL_WRITES);
	/** Set once the listener is closed, so late handlers answer instead of throwing. */
	closed = false;
	/**
	* Failed PIN attempts per source address.
	*
	* The reference implementation refuses an address outright after three
	* failures, with no recovery, and that is the right shape for a four-digit
	* secret on a LAN: an attacker who can retry forever will find it, and the
	* legitimate user's remedy — restart the plugin or clear the PIN — costs far
	* less than leaving a guessable door open.
	*/
	pinFailures = /* @__PURE__ */ new Map();
	/**
	* Addresses with a preparation still waiting on the user, by registry id.
	*
	* Tracked separately from {@link sessions} because a session only exists once
	* it has been accepted, and the senders that most need cancelling are exactly
	* the ones that never got that far: a v2 sender does not learn the session id
	* until the preparation response arrives, so a sender that gives up while the
	* user is deciding has nothing to quote back and must cancel by address alone.
	*/
	pendingSenders = /* @__PURE__ */ new Map();
	/** Preparations withdrawn by their sender, so the handler can say so. */
	senderCancelled = /* @__PURE__ */ new Set();
	/** @param host - the services this server borrows from the plugin. */
	constructor(host) {
		this.host = host;
	}
	/** Whether the listener is bound. */
	get listening() {
		return this.server !== void 0;
	}
	/**
	* Bind the API server.
	*
	* @param port - TCP port to listen on.
	* @returns the port actually bound, which differs from the request when the
	*   configured port was taken and the caller allowed a fallback.
	*/
	async start(port) {
		if (this.server !== void 0) return port;
		const server = createServer((request, response) => {
			this.route(request, response).catch((error) => {
				this.host.warn(`local-send: request failed: ${describe$1(error)}`);
				if (!response.headersSent) empty(response, STATUS.serverError);
				else response.end();
			});
		});
		server.requestTimeout = 0;
		server.headersTimeout = 3e4;
		server.keepAliveTimeout = 5e3;
		this.server = server;
		await new Promise((resolve, reject) => {
			const onError = (error) => {
				reject(error);
			};
			server.once("error", onError);
			server.listen(port, "0.0.0.0", () => {
				server.off("error", onError);
				resolve();
			});
		});
		this.closed = false;
		const address = server.address();
		return typeof address === "object" && address !== null ? address.port : port;
	}
	/**
	* Close the listener and refuse every session it was holding.
	*
	* In-flight uploads are torn down rather than drained: the plugin is going
	* away, and a partially written file is already in the staging directory where
	* the next start will not mistake it for a complete one.
	*/
	async stop() {
		const server = this.server;
		this.server = void 0;
		this.closed = true;
		for (const session of this.sessions.values()) this.host.registry.cancel(session.id);
		this.sessions.clear();
		if (server === void 0) return;
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
			server.closeAllConnections?.();
		});
	}
	/**
	* Dispatch one request to its route.
	*
	* @param request - incoming request.
	* @param response - response to answer on.
	*/
	async route(request, response) {
		const url = new URL(request.url ?? "/", "http://localhost");
		const route = url.pathname.startsWith("/api/localsend/v2") ? url.pathname.slice(17) : "";
		const method = request.method ?? "GET";
		if (this.closed) {
			fail(response, STATUS.serverError, MESSAGE.internal);
			return;
		}
		if (method === "POST" && route === "/register") {
			await this.handleRegister(request, response);
			return;
		}
		if (method === "GET" && route === "/info") {
			json(response, STATUS.ok, registerResponse(this.host.info()));
			return;
		}
		if (method === "POST" && route === "/prepare-upload") {
			await this.handlePrepare(request, response, url);
			return;
		}
		if (method === "POST" && route === "/upload") {
			await this.handleUpload(request, response, url);
			return;
		}
		if (method === "POST" && route === "/cancel") {
			this.handleCancel(request, response, url);
			return;
		}
		empty(response, 404);
	}
	/**
	* Two-way discovery: a peer told us where it is, so answer with where we are.
	*
	* The body is also how this device learns about a peer that announced itself
	* while the discovery socket was down, so a successful register is reported as
	* a sighting rather than only answered.
	*
	* @param request - the peer's request.
	* @param response - response to answer on.
	*/
	async handleRegister(request, response) {
		const body = await readJsonBody(request, 262144);
		const info = readDeviceInfoShallow(body);
		if (info !== void 0) this.host.sawPeer(info, remoteAddressOf(request));
		json(response, STATUS.ok, registerResponse(this.host.info()));
	}
	/**
	* The preparation handshake: metadata in, per-file tokens out.
	*
	* The interesting part is that this handler *waits*. A person has to decide
	* whether to accept, so the HTTP request stays open while the panel shows the
	* offer, and the answer is whatever settles first: the user, the timeout, or
	* the plugin unloading. The spec's status codes carry that answer — `403` for a
	* decline, `401` for a PIN mismatch — so the sender can tell "no" from "wrong
	* PIN" from "busy".
	*
	* @param request - the sender's request.
	* @param response - response to answer on.
	* @param url - parsed request URL, carrying the optional `pin`.
	*/
	async handlePrepare(request, response, url) {
		const config = this.host.config();
		const remoteAddress = remoteAddressOf(request);
		if (config.pin.length > 0) {
			if (this.pinBlocked(remoteAddress)) {
				fail(response, STATUS.tooManyRequests, MESSAGE.tooManyRequests);
				return;
			}
			const supplied = url.searchParams.get("pin");
			if (supplied !== config.pin) {
				this.recordPinFailure(remoteAddress);
				fail(response, STATUS.unauthorized, supplied === null ? MESSAGE.pinRequired : MESSAGE.invalidPin);
				return;
			}
		}
		const prepared = readPrepareUpload(await readJsonBody(request, 4194304));
		if (prepared === void 0) {
			fail(response, STATUS.badRequest, MESSAGE.invalidJson);
			return;
		}
		const sender = prepared.info;
		this.host.sawPeer(sender, remoteAddress);
		if (this.busy()) {
			fail(response, STATUS.conflict, MESSAGE.blocked);
			return;
		}
		const entries = Object.values(prepared.files);
		if (entries.length === 0) {
			fail(response, STATUS.badRequest, MESSAGE.noFiles);
			return;
		}
		const verdicts = this.screen(entries, config);
		const accepted = entries.filter((entry) => verdicts.get(entry.id) === void 0);
		if (accepted.length === 0) {
			empty(response, STATUS.noContent);
			return;
		}
		const id = this.host.registry.openIncoming({
			peerAlias: sender.alias,
			peerFingerprint: sender.fingerprint,
			peerAddress: remoteAddress,
			peerType: sender.deviceType ?? null,
			files: entries.map((entry) => ({
				id: entry.id,
				fileName: entry.fileName,
				size: entry.size,
				fileType: entry.fileType,
				...entry.sha256 === void 0 || entry.sha256 === null ? {} : { sha256: entry.sha256 }
			}))
		});
		for (const [fileId, reason] of verdicts) this.host.registry.updateFile(id, fileId, (file) => {
			file.status = "declined";
			file.error = reason;
		});
		this.pendingSenders.set(id, remoteAddress);
		let acceptedByUser;
		try {
			acceptedByUser = config.autoAccept ? true : await this.awaitDecision(id);
		} finally {
			this.pendingSenders.delete(id);
		}
		if (!acceptedByUser) {
			this.host.registry.update(id, (transfer) => {
				transfer.status = "declined";
				for (const file of transfer.files) if (file.status === "offered") file.status = "declined";
			});
			const withdrawn = this.senderCancelled.delete(id);
			fail(response, STATUS.forbidden, withdrawn ? MESSAGE.cancelledBySender : MESSAGE.rejected);
			return;
		}
		const tokens = /* @__PURE__ */ new Map();
		for (const entry of accepted) tokens.set(entry.id, randomUUID());
		const directory = this.receiveDirectory();
		this.sessions.set(id, {
			id,
			remoteAddress,
			tokens,
			files: new Map(accepted.map((entry) => [entry.id, entry])),
			claimed: this.claimedOnDisk(directory),
			acceptedBytes: accepted.reduce((sum, entry) => sum + entry.size, 0)
		});
		this.host.registry.update(id, (transfer) => {
			transfer.status = "transferring";
			for (const file of transfer.files) if (file.status === "offered") file.status = "transferring";
		});
		const files = {};
		for (const [fileId, token] of tokens) files[fileId] = token;
		json(response, STATUS.ok, {
			sessionId: id,
			files
		});
	}
	/**
	* Wait for the user's answer on one offer.
	*
	* The timeout is the point: a sender holding an open connection deserves an
	* answer even if nobody is looking at the panel, and "nobody answered" has to
	* resolve to refusal rather than to a request that never ends.
	*
	* @param id - registry row id.
	* @returns whether the transfer was accepted.
	*/
	async awaitDecision(id) {
		const decision = this.host.registry.await(id);
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => {
				resolve(false);
			}, APPROVAL_TIMEOUT_MS);
			timer.unref();
		});
		try {
			return await Promise.race([decision, timeout]);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	}
	/**
	* Apply the configured ceilings to a prepared batch.
	*
	* @param entries - offered files.
	* @param config - configuration in effect.
	* @returns a reason per refused file id; absent means accepted.
	*/
	screen(entries, config) {
		const refused = /* @__PURE__ */ new Map();
		if (entries.length > config.maxFiles) for (const entry of entries.slice(config.maxFiles)) refused.set(entry.id, `too many files (limit ${String(config.maxFiles)})`);
		let total = 0;
		for (const entry of entries.slice(0, config.maxFiles)) {
			if (entry.size > config.maxFileBytes) {
				refused.set(entry.id, `file is larger than the ${formatBytes(config.maxFileBytes)} limit`);
				continue;
			}
			total += entry.size;
			if (total > config.maxTransferBytes) refused.set(entry.id, `transfer exceeds the ${formatBytes(config.maxTransferBytes)} limit`);
		}
		return refused;
	}
	/**
	* Whether another transfer currently owns this device.
	* @returns whether any transfer is awaiting a decision or moving bytes.
	*/
	busy() {
		return this.host.registry.busy();
	}
	/**
	* Whether an address has exhausted its PIN attempts.
	* @param address - source address of the request.
	* @returns whether further attempts are refused outright.
	*/
	pinBlocked(address) {
		return (this.pinFailures.get(address) ?? 0) >= MAX_PIN_ATTEMPTS;
	}
	/**
	* Record one failed PIN attempt.
	* @param address - source address of the request.
	*/
	recordPinFailure(address) {
		this.pinFailures.set(address, (this.pinFailures.get(address) ?? 0) + 1);
	}
	/** The directory received files are written to, created if needed. */
	receiveDirectory() {
		const config = this.host.config();
		const paths = this.host.paths;
		ensureDirectories(paths);
		const directory = receiveDirectory(config, paths);
		if (directory !== paths.inbox) ensureDirectories({
			...paths,
			inbox: directory,
			partial: join(directory, ".partial")
		});
		return directory;
	}
	/**
	* Names already present in the receive directory.
	*
	* Read once per session rather than per file, so a batch keeps its own
	* collision bookkeeping in memory and two files in one batch cannot both be
	* given the same name by racing each other.
	*
	* @param directory - the receive directory.
	* @returns the set of names in use.
	*/
	claimedOnDisk(directory) {
		const claimed = /* @__PURE__ */ new Set();
		try {
			for (const entry of readdirSync(directory)) claimed.add(entry);
		} catch {}
		return claimed;
	}
	/**
	* Receive one file's bytes.
	*
	* @param request - the sender's request, whose body is the file.
	* @param response - response to answer on.
	* @param url - parsed request URL, carrying session, file, and token.
	*/
	async handleUpload(request, response, url) {
		const sessionId = url.searchParams.get("sessionId");
		const fileId = url.searchParams.get("fileId");
		const token = url.searchParams.get("token");
		if (sessionId === null || fileId === null || token === null) {
			fail(response, STATUS.badRequest, MESSAGE.missingParameters);
			return;
		}
		const session = this.sessions.get(sessionId);
		if (session === void 0) {
			fail(response, STATUS.forbidden, MESSAGE.invalidToken);
			return;
		}
		if (remoteAddressOf(request) !== session.remoteAddress) {
			fail(response, STATUS.forbidden, MESSAGE.invalidToken);
			return;
		}
		if (session.tokens.get(fileId) !== token) {
			fail(response, STATUS.forbidden, MESSAGE.invalidToken);
			return;
		}
		const metadata = session.files.get(fileId);
		if (metadata === void 0) {
			fail(response, STATUS.forbidden, MESSAGE.invalidToken);
			return;
		}
		await this.writes.acquire();
		try {
			await this.receiveFile(request, response, session, metadata);
		} finally {
			this.writes.release();
		}
	}
	/**
	* Stream one upload to disk.
	*
	* The write goes to a random staging name and is renamed only once the bytes
	* have been verified, so a complete-looking file in the receive directory is
	* always a file that arrived whole. The checksum is computed as the bytes flow
	* past rather than in a second pass, which is what keeps a multi-gigabyte file
	* to one read of the stream.
	*
	* @param request - the sender's request.
	* @param response - response to answer on.
	* @param session - the session the token belongs to.
	* @param metadata - the file's agreed metadata.
	*/
	async receiveFile(request, response, session, metadata) {
		const config = this.host.config();
		const directory = this.receiveDirectory();
		const finalName = uniqueFileName(isSafeFileName(metadata.fileName) ? metadata.fileName : `received-${randomUUID().slice(0, 8)}`, session.claimed);
		session.claimed.add(finalName);
		const destination = join(directory, finalName);
		const staging = join(directory, ".partial", randomUUID());
		const hash = createHash("sha256");
		const stream = createWriteStream(staging);
		let received = 0;
		let aborted;
		try {
			for await (const chunk of request) {
				const buffer = chunk;
				received += buffer.length;
				if (received > metadata.size || received > config.maxFileBytes) {
					aborted = STATUS.badRequest;
					break;
				}
				hash.update(buffer);
				if (!stream.write(buffer)) await once(stream, "drain");
			}
			if (aborted === void 0) await new Promise((resolve, reject) => {
				stream.end((error) => {
					if (error !== void 0 && error !== null) reject(error);
					else resolve();
				});
			});
		} catch (error) {
			stream.destroy();
			rmSync(staging, { force: true });
			this.failFile(session.id, metadata.id, describe$1(error));
			if (!response.headersSent) fail(response, STATUS.serverError, MESSAGE.internal);
			return;
		}
		if (aborted !== void 0) {
			stream.destroy();
			rmSync(staging, { force: true });
			const reason = "the sender sent more bytes than it offered";
			this.failFile(session.id, metadata.id, reason);
			if (!response.headersSent) fail(response, aborted, reason);
			return;
		}
		const expected = metadata.sha256;
		if (expected !== void 0 && expected !== null && expected.length > 0) {
			if (hash.digest("hex").toLowerCase() !== expected.toLowerCase()) {
				rmSync(staging, { force: true });
				this.failFile(session.id, metadata.id, "checksum mismatch");
				fail(response, STATUS.unprocessable, MESSAGE.checksumMismatch);
				return;
			}
		}
		try {
			renameSync(staging, destination);
		} catch (error) {
			rmSync(staging, { force: true });
			this.failFile(session.id, metadata.id, describe$1(error));
			fail(response, STATUS.serverError, MESSAGE.internal);
			return;
		}
		try {
			const modified = metadata.metadata?.modified;
			if (modified !== void 0 && modified !== null) {
				const when = new Date(modified);
				if (!Number.isNaN(when.getTime())) utimesSync(destination, when, when);
			}
		} catch {}
		this.host.registry.updateFile(session.id, metadata.id, (file) => {
			file.status = "done";
			file.bytesDone = file.size;
			file.savedPath = destination;
			delete file.error;
		});
		session.acceptedBytes -= metadata.size;
		empty(response, STATUS.ok);
		if (session.acceptedBytes <= 0) this.finishSession(session);
	}
	/**
	* Mark one file failed and record why.
	* @param transferId - registry row id.
	* @param fileId - the file's id.
	* @param reason - message to show the user.
	*/
	failFile(transferId, fileId, reason) {
		this.host.registry.updateFile(transferId, fileId, (file) => {
			file.status = "failed";
			file.error = reason;
		});
	}
	/**
	* Close a session whose accepted bytes have all arrived.
	*
	* The remaining `acceptedBytes` is the completion signal rather than a count
	* of finished files, because a file that failed has no bytes to give and
	* waiting for it would leave the session open forever.
	*
	* @param session - the session to settle.
	*/
	finishSession(session) {
		this.sessions.delete(session.id);
		this.host.registry.settle(session.id);
	}
	/**
	* Cancel a session on the sender's request.
	*
	* @param response - response to answer on.
	* @param url - parsed request URL carrying the session id.
	*/
	handleCancel(request, response, url) {
		const sessionId = url.searchParams.get("sessionId");
		const remoteAddress = remoteAddressOf(request);
		if (sessionId === null) {
			for (const [id, pendingAddress] of this.pendingSenders) {
				if (pendingAddress !== remoteAddress) continue;
				this.senderCancelled.add(id);
				this.host.registry.decide(id, false);
			}
			empty(response, STATUS.ok);
			return;
		}
		if (this.pendingSenders.get(sessionId) === remoteAddress) {
			this.senderCancelled.add(sessionId);
			this.host.registry.decide(sessionId, false);
			empty(response, STATUS.ok);
			return;
		}
		const session = this.sessions.get(sessionId);
		if (session !== void 0 && session.remoteAddress === remoteAddress) {
			this.sessions.delete(sessionId);
			for (const metadata of session.files.values()) this.host.registry.updateFile(sessionId, metadata.id, (file) => {
				if (file.status !== "done") file.status = "declined";
			});
			this.host.registry.cancel(sessionId);
		}
		empty(response, STATUS.ok);
	}
};
/**
* A shallow identity read used by `register`.
*
* `register` is a two-way hello whose body is a {@link DeviceInfo}, and the
* protocol module already owns the only narrowing of that shape — this is a
* named alias rather than a second definition, so the server and the discovery
* loop cannot disagree about what a valid peer looks like.
*
* @param value - parsed request body.
* @returns the identity, or `undefined`.
*/
const readDeviceInfoShallow = readDeviceInfo;
/** Format a byte count for a message a person reads. */
function formatBytes(bytes) {
	const units = [
		"B",
		"KiB",
		"MiB",
		"GiB",
		"TiB"
	];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit] ?? "B"}`;
}
//#endregion
//#region src/transfer.ts
/**
* The transfer registry: every exchange this device is part of, in both
* directions, as one live table.
*
* Both directions live in one structure on purpose. A send and a receive differ
* in who dials whom and nothing else that the user can see: both have a peer, a
* list of files, a byte count that climbs, and an outcome. Splitting them would
* duplicate the progress accounting and give the panel two shapes to render for
* what is one row.
*
* Two properties are worth stating because the rest of the plugin leans on them:
*
* - **Progress is bytes, and it is monotonic per file.** A file's counter only
*   ever moves forward, because a retry restarts the file rather than rewinding
*   the number the user is watching. The registry is the only writer, so the
*   panel can render whatever it reads without defending against a value going
*   backwards.
* - **An incoming transfer waits for a decision.** {@link TransferRegistry.await}
*   is how the HTTP handler blocks on the user; the registry holds the resolver,
*   so a decision made in the panel, a timeout, or the plugin unloading all
*   settle the same promise exactly once.
*
* @module dsh-local-send/transfer
*/
/**
* The live table of transfers.
*
* Notified listeners are called without any payload: the panel re-reads the
* snapshot it needs, which keeps the number of shapes this module has to keep
* consistent down to one.
*/
var TransferRegistry = class {
	keep;
	transfers = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	/** One pending decision per incoming transfer awaiting the user. */
	decisions = /* @__PURE__ */ new Map();
	/**
	* @param keep - how many finished transfers to retain before the oldest is dropped.
	*   History is for the session the user is in, not an archive; the inbox on
	*   disk is the durable record.
	*/
	constructor(keep = 50) {
		this.keep = keep;
	}
	/** Subscribe to changes.
	* @param listener - called after every mutation.
	* @returns the unsubscribe function.
	*/
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/**
	* Every transfer, newest first.
	* @returns a snapshot safe to serialize; the rows are copies.
	*/
	list() {
		return [...this.transfers.values()].sort((left, right) => right.createdAt - left.createdAt).map((transfer) => ({
			...transfer,
			files: transfer.files.map((file) => ({ ...file }))
		}));
	}
	/**
	* One transfer by id.
	* @param id - registry identifier.
	* @returns the live row, or `undefined`.
	*/
	get(id) {
		return this.transfers.get(id);
	}
	/**
	* The transfer currently moving bytes, if any.
	*
	* Used to decide whether the panel should poll quickly: an idle device has
	* nothing to animate, so its poll can be slow.
	* @returns whether any transfer is awaiting a decision or transferring.
	*/
	busy() {
		for (const transfer of this.transfers.values()) if (transfer.status === "awaiting" || transfer.status === "transferring") return true;
		return false;
	}
	/** Announce a change to every listener. */
	notify() {
		for (const listener of this.listeners) listener();
	}
	/**
	* Drop the oldest finished rows once the table is over its limit.
	*
	* Only finished rows are eligible: a transfer still holding an HTTP request or
	* a user's decision must survive any amount of history churn behind it.
	*/
	trim() {
		if (this.transfers.size <= this.keep) return;
		const finished = [...this.transfers.values()].filter((transfer) => transfer.status !== "awaiting" && transfer.status !== "transferring").sort((left, right) => left.updatedAt - right.updatedAt);
		let excess = this.transfers.size - this.keep;
		for (const transfer of finished) {
			if (excess <= 0) break;
			this.transfers.delete(transfer.id);
			excess -= 1;
		}
	}
	/**
	* Open an outgoing transfer.
	*
	* @param options - the peer and the files about to be offered.
	* @returns the new row's id.
	*/
	openOutgoing(options) {
		const id = this.open(options, "outgoing");
		this.update(id, (transfer) => {
			transfer.status = "transferring";
			for (const file of transfer.files) file.status = "transferring";
		});
		return id;
	}
	/**
	* Open an incoming transfer, before the user has decided anything.
	*
	* @param options - the peer, its address, and the files it is offering.
	* @returns the new row's id, which becomes the LocalSend session id.
	*/
	openIncoming(options) {
		return this.open(options, "incoming");
	}
	/**
	* Open one transfer row in either direction.
	*
	* The two public openers differ only in the direction they stamp and the state
	* they leave the row in, so the row construction lives here once — which is
	* what stops the two from drifting apart in the fields a caller can see.
	*
	* @param options - the peer and the files.
	* @param direction - which way the bytes will go.
	* @returns the new row's id.
	*/
	open(options, direction) {
		const id = randomUUID();
		const files = options.files.map((file) => ({
			id: file.id,
			fileName: file.fileName,
			size: file.size,
			fileType: file.fileType,
			status: "offered",
			bytesDone: 0
		}));
		const now = Date.now();
		this.transfers.set(id, {
			id,
			direction,
			peerAlias: options.peerAlias,
			peerFingerprint: options.peerFingerprint,
			peerAddress: options.peerAddress,
			peerType: options.peerType,
			status: "awaiting",
			files,
			bytesTotal: files.reduce((sum, file) => sum + file.size, 0),
			bytesDone: 0,
			createdAt: now,
			updatedAt: now
		});
		this.trim();
		this.notify();
		return id;
	}
	/**
	* Apply a change to one transfer, then notify and trim.
	*
	* @param id - registry identifier.
	* @param change - mutation applied to the live row.
	* @returns whether the row existed.
	*/
	update(id, change) {
		const transfer = this.transfers.get(id);
		if (transfer === void 0) return false;
		change(transfer);
		transfer.updatedAt = Date.now();
		this.trim();
		this.notify();
		return true;
	}
	/**
	* Apply a change to one file of one transfer.
	*
	* Touching a file also re-derives the parent's byte totals, so a caller can
	* report progress for a single file and never think about the sum — which is
	* exactly the bug a hand-maintained total invites once uploads run in
	* parallel.
	*
	* @param id - registry identifier.
	* @param fileId - the file's sender-assigned id.
	* @param change - mutation applied to the live file row.
	* @returns whether both the transfer and the file existed.
	*/
	updateFile(id, fileId, change) {
		const transfer = this.transfers.get(id);
		if (transfer === void 0) return false;
		const file = transfer.files.find((candidate) => candidate.id === fileId);
		if (file === void 0) return false;
		change(file);
		transfer.bytesDone = transfer.files.reduce((sum, candidate) => sum + candidate.bytesDone, 0);
		transfer.updatedAt = Date.now();
		this.notify();
		return true;
	}
	/**
	* Resolve a transfer's outcome from the states of its files.
	*
	* The three interesting results are all reachable here rather than at the call
	* site: every file done is `done`, none done is `failed`/`declined` depending
	* on whether anything was transferred, and a mix is `partial` — which is a real
	* outcome worth naming, because a batch where one file was refused is neither
	* a success nor a failure and the user should be able to tell.
	*
	* @param id - registry identifier.
	* @param fallback - status to use when no file reports anything definitive.
	*/
	settle(id, fallback = "failed") {
		this.update(id, (transfer) => {
			const done = transfer.files.filter((file) => file.status === "done").length;
			const failed = transfer.files.filter((file) => file.status === "failed").length;
			const declined = transfer.files.filter((file) => file.status === "declined").length;
			if (done === transfer.files.length) {
				transfer.status = "done";
				return;
			}
			if (done > 0 && done + failed + declined === transfer.files.length) {
				transfer.status = "partial";
				return;
			}
			if (declined === transfer.files.length) {
				transfer.status = "declined";
				return;
			}
			transfer.status = failed > 0 ? "failed" : fallback;
		});
	}
	/**
	* Mark a whole transfer failed with one reason.
	* @param id - registry identifier.
	* @param error - message to show the user.
	*/
	fail(id, error) {
		this.update(id, (transfer) => {
			transfer.status = "failed";
			transfer.error = error;
		});
		this.decide(id, false);
	}
	/**
	* Mark a whole transfer canceled by either side.
	* @param id - registry identifier.
	*/
	cancel(id) {
		this.update(id, (transfer) => {
			if (transfer.status === "done" || transfer.status === "canceled") return;
			transfer.status = "canceled";
			for (const file of transfer.files) if (file.status === "offered" || file.status === "transferring") file.status = "declined";
		});
		this.decide(id, false);
	}
	/**
	* Wait for the user's decision on an incoming transfer.
	*
	* The promise settles exactly once, whichever comes first: a decision from the
	* panel, {@link decide} called by a cancel or a failure, or the caller's own
	* timeout. A second call for the same transfer returns a promise that resolves
	* immediately as declined, so a malformed sender cannot accumulate resolvers.
	*
	* @param id - registry identifier.
	* @returns whether the transfer was accepted.
	*/
	await(id) {
		if (this.decisions.has(id)) return Promise.resolve(false);
		return new Promise((resolve) => {
			this.decisions.set(id, resolve);
		});
	}
	/**
	* Settle a pending decision.
	* @param id - registry identifier.
	* @param accepted - the user's answer.
	* @returns whether a decision was actually pending.
	*/
	decide(id, accepted) {
		const resolve = this.decisions.get(id);
		if (resolve === void 0) return false;
		this.decisions.delete(id);
		resolve(accepted);
		return true;
	}
	/**
	* Settle every pending decision as declined.
	*
	* Called when the plugin unloads: a sender left holding an open connection
	* against a plugin that no longer exists would otherwise wait for its own
	* timeout, and the HTTP server is about to go away underneath it.
	*/
	declineAll() {
		for (const [id, resolve] of this.decisions) {
			this.decisions.delete(id);
			resolve(false);
		}
	}
	/** Forget every transfer and settle every decision. */
	clear() {
		this.declineAll();
		this.transfers.clear();
		this.notify();
	}
};
//#endregion
//#region src/types.ts
/**
* Exact route the panel reads the whole state from.
*
* One route rather than several: the panel draws peers and transfers together
* and they change together, so splitting them would mean two round trips and a
* frame where one half is newer than the other.
*/
const STATE_PATH = "/api/dsh-local-send/state";
/** Exact route that opens a send from browser-held files. */
const PREPARE_PATH = "/api/dsh-local-send/prepare";
/** Exact route that accepts one file's bytes from the browser and forwards them. */
const STREAM_PATH = "/api/dsh-local-send/stream";
/** Exact route that sends files that already exist on this machine. */
const SEND_PATHS_PATH = "/api/dsh-local-send/send-paths";
/** Exact route that accepts or declines an incoming offer. */
const DECIDE_PATH = "/api/dsh-local-send/decide";
/** Exact route that renames this device. */
const RENAME_PATH = "/api/dsh-local-send/rename";
/** Exact route that runs the legacy subnet scan on demand. */
const SCAN_PATH = "/api/dsh-local-send/scan";
/** Exact route that reveals a received file in the OS file browser. */
const REVEAL_PATH = "/api/dsh-local-send/reveal";
/** Exact route that answers whether a host path exists, for the path sender. */
const INSPECT_PATH = "/api/dsh-local-send/inspect";
//#endregion
//#region src/index.ts
/** Plugin name the loader row addresses. */
const name = "dsh-local-send";
/** Services this plugin cannot work without: the carrier's route registry. */
const inject = ["connection"];
/**
* How many addresses the legacy subnet scan probes at once.
*
* The reference implementation uses fifty. That is a reasonable ceiling for a
* `/24` — enough that a whole subnet is covered in a few rounds of the probe
* timeout, few enough that a device with a small NAT table is not the thing that
* fails first.
*/
const SCAN_CONCURRENCY = 50;
/** How long one subnet probe may take before its address counts as empty. */
const SCAN_TIMEOUT_MS = 500;
/** Files one panel-driven send may carry in a single batch. */
const MAX_PANEL_FILES = 200;
/** Read the Fetch carrier off the Host context. */
function connectionOf(ctx) {
	return Reflect.get(ctx, "connection");
}
/** One line describing an error, for a log line. */
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Answer with JSON and no caching, the shape every panel route uses. */
function jsonResponse(body, status = 200) {
	return Response.json(body, {
		status,
		headers: { "cache-control": "no-store" }
	});
}
/** Answer with a described failure the panel can show. */
function errorResponse(message, status = 400) {
	return jsonResponse({ error: message }, status);
}
/**
* Register the LocalSend surface.
*
* Deliberately a named export with no default: the Loader takes a module's
* default export when it has one, and a default that is the bare `apply`
* function is a plugin *without* this module's `name` and `inject` — the fiber
* then activates with an empty inject list and the first service read throws
* "cannot get property … without inject".
*
* @param ctx - Host context carrying the carrier.
* @param config - plugin configuration; omitted fields keep their defaults.
*/
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	const paths = storePaths(resolveDshHome());
	ensureDirectories(paths);
	const device = loadDevice(paths, (message) => {
		ctx.logger.warn(`dsh-local-send: ${message}`);
	});
	if (resolved.alias.length > 0) device.alias = resolved.alias;
	const registry = new TransferRegistry();
	/** Peers believed present, keyed by the fingerprint the protocol keys them by. */
	const peers = /* @__PURE__ */ new Map();
	/** The most recent discovery condition worth showing the user. */
	let discoveryWarning;
	/**
	* The most recent transfer-API condition worth showing the user.
	*
	* Kept apart from {@link discoveryWarning} because the two failures have
	* different consequences — a lost multicast socket still receives, a lost
	* listener does not — and a single field would report one as the other.
	*/
	let servingWarning;
	/** Panel-driven sends awaiting their bytes. */
	const staged = /* @__PURE__ */ new Map();
	/** Port the transfer API actually bound, which may differ from the configured one. */
	let boundPort = resolved.port;
	/** Whether the transfer API is serving; the panel says so when it is not. */
	let serving = false;
	/** This device's announced identity, rebuilt per call so a rename takes effect at once. */
	const deviceInfo = () => ({
		alias: device.alias,
		version: "2.2",
		deviceModel: "DeepSeek Harness",
		deviceType: resolved.deviceType,
		fingerprint: device.fingerprint,
		port: boundPort,
		protocol: resolved.protocol,
		download: false
	});
	const announcement = () => ({
		...deviceInfo(),
		announce: true
	});
	const host = {
		config: () => resolved,
		info: deviceInfo,
		registry,
		paths,
		warn: (message) => {
			ctx.logger.warn(`dsh-local-send: ${message}`);
		},
		sawPeer: (info, address) => {
			observe(info, address, true);
		}
	};
	const server = new LocalSendServer(host);
	/**
	* Record one sighting of a peer.
	*
	* Reachability is sticky upward: a peer seen over the discovery channel as
	* unreachable, then met again through an inbound `register` that proves it is
	* listening, becomes reachable — while the reverse never demotes a peer that
	* has already proved itself, because a single unanswered callback on a busy
	* network is not evidence the device went away.
	*
	* @param info - the peer's announced identity.
	* @param address - the address it was seen at.
	* @param reachable - whether this sighting proved its API answers.
	*/
	function observe(info, address, reachable) {
		if (info.fingerprint === device.fingerprint) return;
		const previous = peers.get(info.fingerprint);
		peers.set(info.fingerprint, {
			fingerprint: info.fingerprint,
			alias: info.alias,
			deviceType: info.deviceType ?? null,
			deviceModel: info.deviceModel ?? null,
			address,
			port: info.port,
			protocol: info.protocol,
			version: info.version,
			lastSeen: Date.now(),
			reachable: reachable || previous?.reachable === true
		});
	}
	/** Drop peers that have stopped announcing. */
	function sweep() {
		const cutoff = Date.now() - PEER_TTL_MS;
		for (const [fingerprint, peer] of peers) if (peer.lastSeen < cutoff) peers.delete(fingerprint);
	}
	/**
	* Peer table as the panel reads it.
	* @returns rows ordered by most recent sighting, reachable peers first.
	*/
	function peerRows() {
		return [...peers.values()].sort((left, right) => {
			if (left.reachable !== right.reachable) return left.reachable ? -1 : 1;
			return right.lastSeen - left.lastSeen;
		});
	}
	/**
	* Find the peer a request named.
	* @param fingerprint - the stable key the panel sent.
	* @returns the peer as an outbound target, or `undefined`.
	*/
	function targetOf(fingerprint) {
		const peer = peers.get(fingerprint);
		if (peer === void 0 || !peer.reachable) return void 0;
		return {
			fingerprint: peer.fingerprint,
			alias: peer.alias,
			host: peer.address,
			port: peer.port,
			protocol: peer.protocol,
			deviceType: peer.deviceType
		};
	}
	/**
	* The whole state the panel renders from.
	* @returns a serializable snapshot.
	*/
	function state() {
		return {
			device: {
				alias: device.alias,
				fingerprint: device.fingerprint,
				port: boundPort,
				protocol: resolved.protocol,
				deviceType: resolved.deviceType,
				addresses: localAddresses().map((entry) => entry.address),
				serving
			},
			peers: peerRows(),
			transfers: registry.list(),
			inbox: receiveDirectory(resolved, paths),
			discovery: {
				active: discoveryWarning === void 0,
				...discoveryWarning === void 0 ? {} : { warning: discoveryWarning }
			},
			...servingWarning === void 0 ? {} : { warning: servingWarning },
			busy: registry.busy()
		};
	}
	/**
	* Probe every address on this machine's subnets over HTTP.
	*
	* The spec's fallback for a network that drops multicast, and deliberately
	* user-triggered rather than automatic: every other discovery mechanism here
	* costs one datagram, while this costs one request per address on the subnet.
	* Running it on a timer to find a device that is not answering multicast would
	* spend the whole subnet's patience on every interval.
	*
	* @returns how many addresses answered as LocalSend members.
	*/
	async function scanSubnet() {
		const targets = [];
		for (const local of localAddresses()) {
			const parts = local.address.split(".");
			if (parts.length !== 4) continue;
			const prefix = `${parts[0] ?? ""}.${parts[1] ?? ""}.${parts[2] ?? ""}`;
			for (let host = 1; host <= 254; host += 1) targets.push(`${prefix}.${String(host)}`);
		}
		let found = 0;
		let cursor = 0;
		const probe = async (address) => {
			try {
				const response = await fetch(apiUrl(`http://${address}:${String(boundPort)}`, "register"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(deviceInfo()),
					signal: AbortSignal.timeout(SCAN_TIMEOUT_MS)
				});
				if (!response.ok) return;
				const info = readRegisterResponse(await response.json(), boundPort);
				if (info !== void 0) {
					found += 1;
					observe(info, address, true);
				}
			} catch {}
		};
		await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, async () => {
			while (cursor < targets.length) {
				const index = cursor;
				cursor += 1;
				const address = targets[index];
				if (address !== void 0) await probe(address);
			}
		}));
		return found;
	}
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: STATE_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: () => Promise.resolve(jsonResponse(state()))
	}), "dsh-local-send: state route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: PREPARE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			const body = await readJson(request);
			const files = body?.files ?? [];
			if (body === null || files.length === 0) return errorResponse("expected a peer and at least one file");
			if (files.length > MAX_PANEL_FILES) return errorResponse(`a single send may carry at most ${String(MAX_PANEL_FILES)} files`);
			const peer = targetOf(body.peer);
			if (peer === void 0) return errorResponse("that device is no longer reachable", 409);
			const result = await prepareOffer(peer, files.map((file) => metadataForUpload(file.id, file.fileName, file.size)), deviceInfo(), host);
			if ("refused" in result) return jsonResponse({
				transferId: result.refused.transferId,
				accepted: false,
				files: []
			});
			staged.set(result.transferId, {
				offer: result,
				peer,
				remaining: new Set(result.accepted.keys()),
				failed: false
			});
			return jsonResponse({
				transferId: result.transferId,
				accepted: true,
				files: [...result.accepted.keys()]
			});
		}
	}), "dsh-local-send: prepare route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: STREAM_PATH,
		methods: ["POST"],
		requestBody: "streaming",
		fetch: async (request) => {
			const url = new URL(request.url);
			const transferId = url.searchParams.get("transferId");
			const fileId = url.searchParams.get("fileId");
			if (transferId === null || fileId === null) return errorResponse("missing transferId or fileId");
			const entry = staged.get(transferId);
			if (entry === void 0) return errorResponse("that send is no longer staged", 409);
			if (!entry.offer.accepted.has(fileId)) return errorResponse("that file was not accepted by the device", 409);
			if (request.body === null) return errorResponse("expected the file as the request body");
			try {
				await uploadStream(entry.offer, fileId, Readable.fromWeb(request.body), registry);
			} catch (error) {
				entry.failed = true;
				entry.remaining.delete(fileId);
				if (entry.remaining.size === 0) await finishStaged(transferId, entry);
				return errorResponse(describe(error), 502);
			}
			entry.remaining.delete(fileId);
			if (entry.remaining.size === 0) await finishStaged(transferId, entry);
			return jsonResponse({ ok: true });
		}
	}), "dsh-local-send: stream route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: SEND_PATHS_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			const body = await readJson(request);
			const requested = body?.paths ?? [];
			if (body === null || requested.length === 0) return errorResponse("expected a peer and at least one path");
			if (requested.length > MAX_PANEL_FILES) return errorResponse(`a single send may carry at most ${String(MAX_PANEL_FILES)} files`);
			const peer = targetOf(body.peer);
			if (peer === void 0) return errorResponse("that device is no longer reachable", 409);
			return jsonResponse({ transferId: (await sendPaths(peer, requested, deviceInfo(), host)).transferId });
		}
	}), "dsh-local-send: send-paths route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: DECIDE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			const body = await readJson(request);
			if (body === null || typeof body.transferId !== "string" || typeof body.accept !== "boolean") return errorResponse("expected { transferId, accept }");
			if (!registry.decide(body.transferId, body.accept)) return jsonResponse({ decided: false });
			return jsonResponse({ decided: true });
		}
	}), "dsh-local-send: decide route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: RENAME_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			const body = await readJson(request);
			const alias = typeof body?.alias === "string" ? body.alias.trim() : "";
			if (alias.length === 0) return errorResponse("a device name cannot be empty");
			if (alias.length > 64) return errorResponse("a device name may be at most 64 characters");
			device.alias = alias;
			saveDevice(paths, device);
			discovery?.send();
			return jsonResponse({ alias: device.alias });
		}
	}), "dsh-local-send: rename route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: SCAN_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async () => jsonResponse({ found: await scanSubnet() })
	}), "dsh-local-send: scan route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: INSPECT_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			const body = await readJson(request);
			const requested = Array.isArray(body?.paths) ? body.paths : [];
			const candidates = [];
			for (const entry of requested.slice(0, MAX_PANEL_FILES)) {
				if (typeof entry !== "string" || entry.length === 0) continue;
				const absolute = resolve(expandHome(entry));
				try {
					const stats = await stat(absolute);
					candidates.push({
						path: absolute,
						name: basename(absolute),
						directory: stats.isDirectory(),
						...stats.isFile() ? { size: stats.size } : {}
					});
				} catch {
					candidates.push({
						path: absolute,
						name: basename(absolute),
						directory: false
					});
				}
			}
			return jsonResponse({ candidates });
		}
	}), "dsh-local-send: inspect route");
	ctx.effect(() => connectionOf(ctx).fetch.register({
		path: REVEAL_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			const body = await readJson(request);
			const target = typeof body?.path === "string" ? body.path : "";
			if (!isInside(receiveDirectory(resolved, paths), target)) return errorResponse("that file is not in the receive directory", 403);
			revealInFileManager(target);
			return jsonResponse({ ok: true });
		}
	}), "dsh-local-send: reveal route");
	/**
	* Settle a staged send once every accepted file has arrived from the panel.
	* @param transferId - the registry row.
	* @param entry - the staged entry to drop.
	*/
	async function finishStaged(transferId, entry) {
		staged.delete(transferId);
		if (entry.failed) await cancelOffer(entry.offer, host.warn);
		registry.settle(transferId);
	}
	const discovery = new MulticastDiscovery(announcement, {
		onPeer: (peer) => {
			observe(peer.info, peer.host, peer.reachable);
		},
		onSweep: sweep,
		onWarning: (message) => {
			discoveryWarning = message;
			ctx.logger.warn(`dsh-local-send: ${message}`);
		}
	}, resolved.port);
	discovery.start();
	ctx.effect(() => {
		let cancelled = false;
		server.start(resolved.port).then((port) => {
			if (cancelled) return;
			boundPort = port;
			serving = true;
			discovery.send();
			ctx.logger.info(`dsh-local-send: listening on ${String(port)} as "${device.alias}"`);
		}, (error) => {
			serving = false;
			servingWarning = `transfer port ${String(resolved.port)} is unavailable: ${describe(error)}`;
			ctx.logger.warn(`dsh-local-send: ${servingWarning}`);
		});
		return () => {
			cancelled = true;
			discovery.stop();
			registry.declineAll();
			server.stop();
		};
	}, "dsh-local-send: listeners");
	ctx.logger.info(`dsh-local-send: "${device.alias}" serving on ${resolved.protocol}://0.0.0.0:${String(resolved.port)}, announcing every ${String(ANNOUNCE_INTERVAL_MS / 1e3)}s, inbox ${receiveDirectory(resolved, paths)}`);
}
/** Read a JSON body, or `null` when it is not one. */
async function readJson(request) {
	try {
		const value = await request.json();
		return typeof value === "object" && value !== null ? value : null;
	} catch {
		return null;
	}
}
/**
* Expand a leading `~` to the user's home directory.
* @param path - a possibly tilde-prefixed path.
* @returns the path with `~` resolved.
*/
function expandHome(path) {
	if (path !== "~" && !path.startsWith(`~${sep}`)) return path;
	const home = process.env["HOME"] ?? "";
	return home.length > 0 ? join(home, path.slice(1)) : path;
}
/**
* Whether one path is inside a directory.
*
* Compared after resolution on both sides, so `..` segments and a symlinked
* parent cannot smuggle a path out of the tree the check is about. The trailing
* separator is what stops `/inbox-evil` from counting as inside `/inbox`.
*
* @param directory - the containing directory.
* @param candidate - the path to test.
* @returns whether the candidate is the directory or below it.
*/
function isInside(directory, candidate) {
	if (candidate.length === 0) return false;
	const root = resolve(directory);
	const target = resolve(candidate);
	return target === root || target.startsWith(`${root}${sep}`);
}
/**
* Show one file in the platform's file manager.
*
* Best-effort by contract: this is a convenience, and a machine with no
* file manager — a headless host, a locked-down desktop — should not have its
* request fail because a window could not open.
*
* @param path - absolute path of the file to reveal.
*/
function revealInFileManager(path) {
	const command = process.platform === "darwin" ? {
		file: "open",
		args: ["-R", path]
	} : process.platform === "win32" ? {
		file: "explorer",
		args: [`/select,${path}`]
	} : {
		file: "xdg-open",
		args: [dirname(path)]
	};
	try {
		const child = spawn(command.file, command.args, {
			detached: true,
			stdio: "ignore"
		});
		child.on("error", () => {});
		child.unref();
	} catch {}
}
/**
* Build a peer identity from a `register` response.
*
* The response omits `port` and `protocol` by contract — the caller is already
* talking to the device and learned both from the connection — so the values
* that worked are supplied by the caller rather than read out of the body.
*
* @param value - the parsed response body.
* @param port - the port that was probed, and therefore the one that works.
* @returns the peer's identity, or `undefined` when the body is not one.
*/
function readRegisterResponse(value, port) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	const alias = raw["alias"];
	const version = raw["version"];
	const fingerprint = raw["fingerprint"];
	if (typeof alias !== "string" || alias.length === 0) return void 0;
	if (typeof version !== "string" || version.length === 0) return void 0;
	if (typeof fingerprint !== "string" || fingerprint.length === 0) return void 0;
	const deviceType = raw["deviceType"];
	const deviceModel = raw["deviceModel"];
	return {
		alias,
		version,
		fingerprint,
		port,
		protocol: "http",
		...typeof deviceType === "string" ? { deviceType } : {},
		...typeof deviceModel === "string" ? { deviceModel } : {}
	};
}
//#endregion
export { apply, inject, isInside, name };
