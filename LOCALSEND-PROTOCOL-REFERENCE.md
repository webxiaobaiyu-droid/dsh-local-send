# LocalSend Protocol — Implementation Reference for a TypeScript Client/Server

Research date: current `main` of both repos. Sources, in order of authority:

| Ref | Repo / file | Commit |
|---|---|---|
| **[PROTO]** | `https://github.com/localsend/protocol` — `README.md` (v2.2), `v1.md`, `CHANGELOG.md`, `v3/*.mermaid` | `62bd340` |
| **[CORE]** | `https://github.com/localsend/localsend` → `packages/core/src/**` (Rust protocol core) | `c1ce322` |
| **[APP]** | same repo → `app/lib/**` (Flutter UI layer) | `c1ce322` |
| **[ISO]** | same repo → `packages/localsend_isolates/**` (Dart bridge) | `c1ce322` |
| **[WEB]** | `https://github.com/localsend/web` (WebRTC browser client) | `main` |

### Read this first — three corrections to the task brief

1. **There is no `/finish` endpoint.** It does not exist in `[PROTO]` `README.md`, `v1.md`, `CHANGELOG.md`, the v3 diagrams, or anywhere in the Rust HTTP router (`[CORE] http/server/mod.rs:628-692`). The only `_finish` in the codebase is a private Dart UI method (`[APP] provider/network/send_provider.dart:505`). See §2.7 for what actually terminates a session.
2. **`/cancel` is bidirectional** — the receiver calls it back on the *sender* to abort a transfer the receiver no longer wants. This is the real "call back on the peer" mechanism (not `/finish`). See §2.6.
3. **The current LocalSend app has no Dart HTTP stack.** All protocol I/O moved into a Rust core (`packages/core`). `[PROTO]` is authoritative for the wire format but is *behind* the code in several places. Where they disagree, this document follows the code and says so. Also note `localsend/web` is now a **WebRTC client** (`protocolVersion = "2.3"`, `[WEB] app/services/webrtc.ts:18`) — it no longer speaks the v2 HTTP API; the browser HTTP client is now the page embedded at `[CORE] assets/web/upload.html` and `download.html`.

### Protocol version ↔ app version (from `[ISO] lib/constants.dart:3-10`)

| Protocol | Official app versions |
|---|---|
| 1.0 | 1.0.0 – 1.8.0 |
| 1.0, 2.0 | 1.9.0 – 1.14.0 |
| 1.0, 2.1 | 1.15.0 – 1.17.0 |
| 2.2 | 1.18.0+ |

Current wire value: **`"2.2"`** (`[CORE] model/discovery.rs:4` `PROTOCOL_VERSION_V2`). `[WEB]` claims `"2.3"` but speaks WebRTC, not HTTP.

---

## 1. Discovery

### 1.1 Constants and defaults

| Thing | Value | Source |
|---|---|---|
| Multicast group (IPv4) | `224.0.0.167` | `[CORE] multicast/mod.rs:28` `DEFAULT_MULTICAST_GROUP`; `[APP] constants.dart:24` |
| Multicast group (IPv6, **undocumented extension**) | `ff12::fd3a:e420` | `[CORE] multicast/mod.rs:35-36` `DEFAULT_MULTICAST_GROUP_V6` |
| Multicast/UDP port | `53317` | `[CORE] multicast/mod.rs:39` `DEFAULT_PORT`; `[PROTO] README.md:42` |
| HTTP/TCP port | `53317` default, user-configurable | `[PROTO] README.md:47`; `[APP] persistence_provider.dart:341-343` |
| Discovery register timeout | `500 ms` | `[CORE] discovery/mod.rs:26` `DEFAULT_DISCOVERY_TIMEOUT` |
| Announce burst | 3 sends at +100 ms, +500 ms, +2000 ms | `[CORE] multicast/mod.rs:45-49` |
| Multicast TTL / hops | `1` (both families) | `[CORE] multicast/socket.rs:118, 150` |
| Multicast loopback | **enabled** (own datagrams come back) | `[CORE] multicast/socket.rs:115, 147` |
| Default HTTPS | **`true`** | `[APP] persistence_provider.dart:494-496` |
| Default `verifyChecksums` | `true` | `[APP] persistence_provider.dart:405-407` |

`[PROTO] README.md:38` says "The default multicast group is `224.0.0.0/24` because some Android devices reject any other multicast group." That is a *range justification*, not the group. Every implementation joins/sends to `224.0.0.167`. Do **not** send to `224.0.0.255` or `224.0.0.168`.

`[PROTO] README.md:34` explicitly permits non-default ports/addresses: "LocalSend does not require a specific port or multicast address but instead provides a default configuration."

### 1.2 The announce (multicast) payload

`announce` is **sent only, never answered over UDP** (`[CORE] multicast/mod.rs:3-6`: "Announcements are only ever sent, never answered over UDP: the answer is an HTTP register request"). `[PROTO] README.md:100-114` documents a UDP fallback reply, but the shipping implementation has no code path that sends it — **do not implement the UDP reply as your primary path, and treat an inbound UDP `announce: false` as a legacy v1-era artefact.**

Wire struct: `AnnouncedMessage { #[serde(flatten)] message: MulticastMessageV2, announce: bool }` (`[CORE] multicast/mod.rs:174-180`), with `multicast_loop_v6` etc. as above. Field names are camelCase (`rename_all = "camelCase"`).

```jsonc
{
  "alias": "Nice Orange",          // string,                  REQUIRED
  "version": "2.2",                // string "major.minor",    REQUIRED
  "deviceModel": "Samsung",        // string|null,             OPTIONAL (omitted if null)
  "deviceType": "mobile",          // see §5,                  OPTIONAL (omitted if null)
  "fingerprint": "…",              // string,                  REQUIRED
  "port": 53317,                   // u16,                     REQUIRED
  "protocol": "https",             // "http" | "https",        REQUIRED
  "download": true,                // bool, default false,     OPTIONAL (always emitted)
  "announce": true                 // bool,                    REQUIRED (see note)
}
```

Notes, all verified against `[CORE] model/discovery.rs:105-141` and `multicast/mod.rs:174-196`:

- **`announce` (v2) vs `announcement` (v1).** `[PROTO] v1.md:43` uses `"announcement": true`; `[PROTO] README.md:75` and the code use `"announce"`. `[CORE]` only ever emits `announce` (`multicast/mod.rs:419` asserts `"announce":true`). One implementer-vs-doc trap.
- The Rust *parser* (`MulticastMessageV2`, which has no `announce` field) ignores unknown keys, so an inbound message with either spelling parses. A **sender**, however, must send `announce` to be answered by modern peers, because `[PROTO] README.md:118` — "A response is only triggered when `announce` is `true`" — is honoured by the app layer.
- `announce: false` is a *response* marker only (never sent by modern code). Receiving it must not trigger an answer.
- `deviceModel` / `deviceType` are omitted entirely when null (`skip_serializing_if = "Option::is_none"`). `download` is always present (no skip).
- `protocol` deserialization is **strict** for v2: anything other than `"http"`/`"https"` is a parse error (`[CORE] model/discovery.rs:47-59`).
- `deviceType` deserialization is **lenient**: unknown value → `desktop` (`[CORE] model/discovery.rs:86-98`, and test `dto_v2.rs:197-210` with `"fridge"`). It lowercases before matching, so `"MOBILE"` → `mobile`.

### 1.3 How to respond to an announce (the critical asymmetry)

On receiving an announce with `announce == true`, reply with a **unicast HTTP POST to the announcing device**, not a UDP message:

```
POST {protocol}://{source-ip}:{message.port}/api/localsend/v2/register
Content-Type: application/json

{ your own device info in RegisterDtoV2 shape }
```

- The **source IP comes from the UDP datagram** (`recv_from`), the **port comes from the `port` field of the payload** — *not* from the UDP source port. See `[CORE] discovery/mod.rs:539-541`: `client.register(message.protocol, &host, message.port, state.register_dto())`. The `send_to` socket is bound to 53317 but its source port is irrelevant to the HTTP reply.
- If the source is IPv6 link-local, keep the scope: `host = "{ip}%{scope_id}"` (`[CORE] discovery/mod.rs:512-515`); see §6.6 for the URL encoding trick.
- Replies are **spawned concurrently per announce** so a slow peer never stalls the rest (`[CORE] discovery/mod.rs:486-488`).
- For HTTPS peers, the client is built **pinned to `message.fingerprint`** before the request goes out (`[CORE] discovery/mod.rs:519-537`), so a device that cannot prove that certificate never receives the request.
- The peer only enters your device store **after the register round-trip succeeds** (`[CORE] discovery/mod.rs:543-555`), so everything advertised as discovered is actually reachable.
- Body you must send = the full `RegisterDtoV2` (§2.1 request body) — `alias`, `version`, `deviceModel?`, `deviceType?`, `fingerprint`, `port`, `protocol`, `download`.
- Response body you should parse = `RegisterResponseDtoV2` (§2.1 response).

### 1.4 Self-discovery avoidance

Two distinct checks, both needed:

1. **Multicast side:** drop the datagram if `message.fingerprint === ownFingerprint` (`[CORE] multicast/mod.rs:375-378`). Loopback is deliberately on, so a device *does* receive its own announce.
2. **Register side (inbound):** a `POST /register` whose `info.fingerprint` equals our own is ignored — literally logged as `"I talked to myself lol"` (`[APP] provider/network/server/controller/receive_controller.dart:56-59`).
3. **Register side (outbound probe):** the fingerprint compared is `cert_fingerprint` from the TLS handshake in HTTPS mode, and `response.body.fingerprint` only in HTTP mode (`[CORE] discovery/mod.rs:168-179`). In HTTPS mode the body's `fingerprint` is never trusted.
4. On TLS, `[CORE] http/server/v2.rs:161-191` additionally **rejects** a register whose claimed `info.fingerprint` does not match the client certificate fingerprint (uppercase hex), dropping the event with a warning.

The `[PROTO] README.md:116` claim "The `fingerprint` is only used to avoid self-discovering" is a simplification: it is also the device identity used for HTTPS pinning and for favourites.

### 1.5 Fallback discovery — HTTP sweep

Two mechanisms, plus a staged escalation.

**A. Direct probe (favourites / known addresses)** — `[CORE] discovery/mod.rs:256-264`:

```
POST {protocol}://{host}:{port}/api/localsend/v2/register
Content-Type: application/json
<body = your RegisterDtoV2>
```
with an unpinned TLS client (accepts any valid cert) and the 500 ms timeout.

**B. `/24` subnet scan** — `[CORE] discovery/mod.rs:342-379`:
- Scope: for each local IPv4 interface address `a.b.c.d`, probe **every** `a.b.c.0` … `a.b.c.255` *except* the interface's own IP. Assumes `/24`; there is no netmask handling. No IPv6 scanning.
- Concurrency: **50 in flight** (`SCAN_CONCURRENCY`, `discovery/mod.rs:33`). 255 probes × 500 ms / 50 ≈ **~2.5 s worst case per interface**, all interfaces in parallel.
- At most one scan per interface address at a time; a duplicate call returns `[]` immediately (`discovery/mod.rs:348-354`, guard released on drop at `421-434`).
- Same request shape as (A).

**C. Staged escalation** — `[CORE] discovery/mod.rs:308-334` `discover_staged`:
1. Announce on multicast and probe `known_channels` (favourites) **simultaneously**;
2. sleep `grace`;
3. only if the confirmation counter is unchanged (`confirmations` atomic before vs after), run the `/24` scan for every local interface.

**Legacy note.** `[PROTO] v1.md:86` defines HTTP discovery as `GET /api/localsend/v1/info?fingerprint=abc`, and `[PROTO] README.md:126` defines v2 fallback as `POST /api/localsend/v2/register`. The shipped server keeps `/api/localsend/v1/info` alive as an alias for `GET /api/localsend/v2/info`, with the comment "Old clients (v1.17 and earlier) probe unknown peers on the v1 route" (`[CORE] http/server/mod.rs:646-653`). Implement the alias for free compatibility.

**Ports probed:** the scan always uses the configured HTTP port (default 53317). There is no ephemeral-port sweep, and no scan of the legacy UDP-only port separate from HTTP — **v1 and v2 both use 53317 for both UDP and HTTP** (`[PROTO] v1.md:22-27`, `README.md:40-47`), so the "v2 uses an ephemeral HTTP port" premise is **incorrect** for the shipping app.

### 1.6 Multicast socket mechanics (what to replicate exactly)

Per usable interface (`[CORE] multicast/socket.rs:90-155`):

- IPv4: `SO_REUSEADDR` **and** `SO_REUSEPORT` (Unix, minus Solaris/illumos); bind to `0.0.0.0:53317` (wildcard, *not* the interface address — required on platforms that match the datagram's destination against the bound address); `IP_ADD_MEMBERSHIP` for `224.0.0.167` on that interface; `IP_MULTICAST_IF` pinned to the interface so each socket announces on its own link; `IP_MULTICAST_LOOP = 1`; `IP_MULTICAST_TTL = 1`.
- IPv6: `IPV6_V6ONLY = 1` (otherwise it clashes with the IPv4 sockets on the same port), same reuse flags, bind `[::]:53317`, `IPV6_JOIN_GROUP` by **interface index**, `IPV6_MULTICAST_IF`, `IPV6_MULTICAST_LOOP = 1`, `IPV6_MULTICAST_HOPS = 1`.
- **One socket per interface is mandatory**: a socket only sends on one interface (`socket.rs:24-26`).
- Interfaces that fail to bind/join are skipped with a warning, so one bad virtual adapter cannot disable discovery.
- Receive buffer 65536 B; a socket is abandoned after **10 consecutive** receive errors (`multicast/mod.rs:53-58`).
- Sending iterates all send sockets; a failing interface is skipped (`multicast/mod.rs:198-204`).

**Interface filtering** (`[CORE] util/interface.rs:11-66`): `InterfaceFilter{whitelist?, blacklist?}` matched against every address of an interface; blacklist wins. `*` matches ≥1 character and never crosses a `.` — `192.168.1.*` matches `192.168.1.42` but not `192.168.10.1`, and `192.168.*` does **not** match `192.168.1.42`. Loopback interfaces are always excluded from multicast.

**Re-announce triggers:** `announce()` is explicit/app-initiated (app start, network change, resume). There is no periodic timer; the burst itself is the only repetition.

---

## 2. HTTP API

### 2.0 Global facts

- **Router** (`[CORE] http/server/mod.rs:628-692`) — the complete, exhaustive route table:

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/` | web page | `download.html` / `upload.html` / 403 page |
| GET | `/i18n.json` | web i18n | `WebI18n` JSON |
| POST | `/api/localsend/v2/register` | `v2::register` | 404 if v2 disabled |
| GET | `/api/localsend/v1/info` **and** `/api/localsend/v2/info` | `v2::info` | both aliases |
| POST | `/api/localsend/v2/prepare-upload` | `v2::prepare_upload` | |
| POST | `/api/localsend/v2/upload` | `v2::upload` | |
| POST | `/api/localsend/v2/cancel` | `v2::cancel` | |
| POST | `/api/localsend/v2/prepare-download` | `web::prepare_download` | served regardless of `v2` flag |
| GET | `/api/localsend/v2/download` | `web::download` | ditto |
| POST | `/api/localsend/v2/show` | `internal::show` | **app-internal**, guarded by `show_token` |
| POST | `/api/localsend/v3/nonce` | `v3::nonce_exchange` | |
| POST | `/api/localsend/v3/register` | `v3::register` | marked `// TODO: not wired up yet` (`server/v3.rs:52`) |
| any | anything else | — | `404` with **empty body** (`mod.rs:687-691`) |

- **There is no `/finish`.** See §2.7.
- **HTTP/1.1 only.** `hyper::server::conn::http1` is used deliberately, with the comment "HTTP/2 multiplexes many requests over one connection, so the connection limits would no longer bound the requests of a peer" (`mod.rs:533-543`). The client likewise forces `alpn_protocols = [b"http/1.1"]` because "HTTP/2's flow-control window caps bulk upload throughput" (`[CORE] http/client/mod.rs:228-230`).
- **Error body shape.** Every error (`AppError::to_response`, `[CORE] http/server/common/error.rs:21-46`) is `Content-Type: application/json` with:
  ```json
  { "message": "<text>" }
  ```
  Exact strings: `"Invalid JSON body"` (400), `"No files provided"` (400), `"Missing parameters"` (400), `"PIN required"` (401), `"Invalid PIN"` (401), `"Rejected"` (403), `"Cancelled by sender"` (403), `"Invalid token or IP address"` (403), `"File transfer rejected."` (403, download API), `"Invalid sessionId."`/`"Invalid fileId."` (403, download API), `"Blocked by another session"` (409), `"Checksum mismatch"` (422), `"Too many requests"` (429), `"Internal server error"` (500), `"Status code: {code}"` for bare statuses. A `404` from the fallback arm has an **empty** body.
  Parse leniently: the client falls back to the raw body text when it is not `{"message": …}` (`[CORE] http/client/mod.rs:333-349`).
- **Success JSON responses** always carry `Content-Type: application/json` (`common/response.rs:32-35`).
- **Success-no-body responses** (`/upload`, `/cancel`) return `200` with a **zero-length body** and **no `Content-Type`** (`common/response.rs:17-20`, used at `server/v2.rs:446, 488, 527`).
- **Connection limits** (`[CORE] http/server/connection_limit.rs:9-14`): `MAX_CONNECTIONS = 64` total, `MAX_CONNECTIONS_PER_IP = 8`. Loopback peers count only toward the total. Over-limit connections are **dropped without an HTTP response** (the accept loop `continue`s, `server/mod.rs:450-469`) — a client sees a connection reset, not a 429/503.
- **Keep-alive / liveness:** `TCP_NODELAY` on, `TCP_KEEPALIVE` idle 60 s / interval 10 s (`server/mod.rs:341-343, 411-413`).
- **No CORS.** There is not a single `Access-Control-*` header, preflight handler, or `OPTIONS` route in the entire core. See §6.1.

### 2.1 `POST /api/localsend/v2/register`

Two-way discovery: both sides exchange full device info. Handler `[CORE] http/server/v2.rs:154-207`; client `[CORE] http/client/v2.rs:74-118`.

**Request** (`RegisterDtoV2`, `[CORE] http/dto_v2.rs:15-50`) — `Content-Type: application/json`:

| Field | Type | Required | Serde behaviour |
|---|---|---|---|
| `alias` | string | **yes** | — |
| `version` | string | **yes** | `"major.minor"`, e.g. `"2.0"`, `"2.2"` |
| `deviceModel` | string \| null | no | omitted when null |
| `deviceType` | string \| null | no | omitted when null; unknown → `desktop` |
| `fingerprint` | string | **yes** | no `default`, so a missing key is a **deserialization error → 400** |
| `port` | number (u16) | **yes** | no default |
| `protocol` | `"http"` \| `"https"` | **yes** | strict; other values → 400 |
| `download` | boolean | no | `#[serde(default)]` → `false` when absent |

**Response** `200`, `RegisterResponseDtoV2` (`[CORE] http/dto_v2.rs:55-84`):

```jsonc
{
  "alias": "…",
  "version": "2.2",             // the responder's PROTOCOL_VERSION_V2, not the requester's
  "deviceModel": "…",           // omitted if null
  "deviceType": "desktop",      // omitted if null
  "fingerprint": "…",           // == responder's own device token; default "" if absent
  "download": true              // default false if absent
}
```
Note: **no `port` and no `protocol`** in the response, unlike `[PROTO] README.md:145-154`. The client already knows those (they are in `[CORE] http/dto.rs:66-84`, "Similar to `RegisterDto`, but without `port` and `protocol` (those are already known)").
`fingerprint` on the response is the responder's identity token: `info.token`, which for the Rust server equals its certificate fingerprint (`server/v2.rs:203, 220` ← `ClientInfo.token` set from `fingerprint` at `[ISO] rust/src/api/server.rs:85`).

**Failure modes:** malformed JSON → `400 {"message":"Invalid JSON body"}`; missing required field → same `400`; v2 disabled → `404` empty body; TLS fingerprint mismatch → **still `200`**, but the register event is silently dropped (never rejected over the wire).

**Register is fire-and-forget on the server side** (`server/v2.rs:170-184`): emitted with `try_send`, so a burst of registrations can be dropped under load. Peers repeat announcements, so this is recoverable — but do not build logic that depends on every register being observed.

### 2.2 `GET /api/localsend/v2/info` (and the `/v1/info` alias)

Handler `[CORE] http/server/v2.rs:209-224`. Documentation says debugging only (`[PROTO] README.md:391-393`). No query parameters. No request body.

**Response** `200`, `InfoResponseDtoV2` (`[CORE] http/dto_v2.rs:141-166`) — the `RegisterResponseDtoV2` shape **plus nothing else**: `alias`, `version`, `deviceModel?`, `deviceType?`, `fingerprint`, `download`. Again **no `port`, no `protocol`**, contradicting `[PROTO] README.md:399-408`, which lists neither either but whose v2 section elsewhere implies them. Legacy v1 callers send `?fingerprint=abc` (`[PROTO] v1.md:86`); the server ignores the parameter entirely.

`404` empty body when v2 is disabled.

### 2.3 `POST /api/localsend/v2/prepare-upload`

Handler `[CORE] http/server/v2.rs:226-360`; client `[CORE] http/client/v2.rs:149-208`.

**Query parameters**

| Name | Type | Required | Notes |
|---|---|---|---|
| `pin` | string | only if the receiver has a PIN | URL-encoded; `form_urlencoded` parses it, so `a+b` decodes to `a b` |

**Request body** (`PrepareUploadRequestDtoV2`, `[CORE] http/dto_v2.rs:89-97`):

```jsonc
{
  "info": { /* RegisterDtoV2 — full copy, §2.1 */ },
  "files": {
    "<fileId>": {
      "id": "<fileId>",                          // string, REQUIRED — must equal the map key
      "fileName": "my image.png",                // string, REQUIRED
      "size": 324242,                            // u64 bytes, REQUIRED
      "fileType": "image/jpeg",                  // string, REQUIRED — MIME type in v2
      "sha256": "…",                             // string|null, OPTIONAL (omitted if null), lowercase or uppercase hex accepted
      "preview": "…",                            // string|null, OPTIONAL (omitted if null)
      "metadata": {                              // object|null, OPTIONAL (omitted if null)
        "modified": "2021-01-01T12:34:56Z",      // string|null, RFC 3339
        "accessed": "2021-01-01T12:34:56Z"       // string|null, RFC 3339
      }
    }
  }
}
```

`FileDto` is `[CORE] model/transfer.rs:134-147`; `FileMetadata` is `:149-155`. The two inner timestamp fields are **not** camel-cased and are emitted only when `Some`. Timestamps are RFC 3339 and the Dart side sends `DateTime.toIso8601String()` of a UTC value, so **fractional seconds are normal** — `1970-01-01T00:00:00.500Z` must parse (`transfer.rs:233-241`). Output uses nanosecond precision (`:261`).

The `id` inside the object is redundant with the map key; the server uses the **map key** for token lookup (`server/v2.rs:312-325`) and separately trusts the embedded `id` for nothing but re-serialization. Set them equal.

Empty `files` map → `400 {"message":"No files provided"}` (`server/v2.rs:247-249`).

**Response** `200` (`PrepareUploadResponseDtoV2`, `[CORE] http/dto_v2.rs:104-111`):

```jsonc
{
  "sessionId": "1b4e28ba-2fa1-11d2-883f-0016d3cca427",  // string, REQUIRED — UUID v4 text
  "files": {                                            // map fileId -> fileToken (UUID v4 text)
    "file-a": "9f1c…",                                  // ONLY files the receiver accepted
    "file-b": "3d7a…"
  }
}
```

- `sessionId` = `Uuid::new_v4().to_string()` (`server/v2.rs:251`), i.e. 36-char lowercase hyphenated UUID.
- Each accepted file's `token` is **an independent `Uuid::new_v4()`** (`server/v2.rs:319`) — not a hash, not derived from the sessionId or the fileId.
- The `files` map contains **only accepted files**; a file the receiver declined is simply absent. That is how partial acceptance is expressed (`[PROTO] README.md:168`).
- `sessionId` is pre-generated before the user decides, so the receiver's UI can track it consistently from the first event (`server/v2.rs:47-50`).

**All documented status codes** (docs `[PROTO] README.md:227-235`; implemented in `server/v2.rs` & `common/pin.rs`):

| Code | Meaning | Trigger in code |
|---|---|---|
| `200` | Accepted (all or a subset) | `server/v2.rs:352-359` |
| `204` | Finished — no file transfer needed. **Empty body**; no session is created | requested files empty after filtering: user accepted nothing / text-only message (`server/v2.rs:327-333`; `[APP] receive_controller.dart:532-538`) |
| `400` | Invalid body / no files | malformed JSON (`collect_to_json.rs:13-16`) or empty `files` |
| `401` | PIN required (`"PIN required"`) or invalid (`"Invalid PIN"`) | `common/pin.rs:31-47` |
| `403` | Rejected by the user (`"Rejected"`), **or** cancelled by the sender while pending (`"Cancelled by sender"`) | `server/v2.rs:302-308`, `:293-298` |
| `409` | Blocked by another session (`"Blocked by another session"`) | a `Pending` **or** `Active` session already occupies the single slot (`server/v2.rs:256-262`) |
| `429` | Too many requests — ≥3 failed PIN attempts from this IP | `common/pin.rs:24-29` |
| `500` | Unknown error by receiver; also when the app drops the decision channel or the event channel is closed | `server/v2.rs:283, 291, 424-431` |
| `404` | Route disabled (no response body) | `server/v2.rs:530-535` |

**On `204` the sender must not call `/upload`** and must treat the transfer as complete. The official client models this as `PrepareUploadResultV2 { status_code, response: Option<…> }` with `response: None` (`[CORE] http/dto_v2.rs:113-116`, `client/v2.rs:195-200`).

### 2.4 `POST /api/localsend/v2/upload` — see §3.

### 2.5 The session model (what `/upload` enforces)

State machine, `[CORE] http/server/common/session.rs` + `server/v2.rs`:

- **Exactly one session slot**, holding either `Pending` (prepare-upload awaiting the user's decision) or `Active` (accepted). `V2State.session: Mutex<Option<SessionStateV2>>` (`server/mod.rs:64-65`, comment: "The single upload session slot. Only one session can be active at a time.").
- A second `prepare-upload` while either state is occupied → `409` (`server/v2.rs:256-262`), **before** the PIN check? No — the PIN check runs first (`:234-240`), so a PIN-protected server answers `401` before `409`.
- A `Pending` slot is released by: the decision, the sender disconnecting, the sender sending a session-less `/cancel`, or drop of the request future (`PendingSessionGuard`, `server/v2.rs:549-600`). The app is told via `PrepareUploadAborted` (`:99-106`).
- Per-file status: `Pending → InProgress → Finished | Failed`, with `attempts: u8` (`session.rs:49-61`).
- `Active` session ends when **every** accepted file is `Finished` or `Failed` (`is_complete()`, `session.rs:40-47`) — the slot is then cleared (`server/v2.rs:673-680`). Files the sender never uploads keep the session alive indefinitely.
- **There is no session timeout or expiry.** No timer, no idle reaper anywhere in `server/`. A session that is never finished and never cancelled leaks its slot until the app closes it (`ServerHandle::cancel_v2_session`) or the server restarts. See §6.4.

### 2.6 `POST /api/localsend/v2/cancel` — bidirectional

Handler `[CORE] http/server/v2.rs:455-528`. **`200` with an empty body in essentially every case** — even for an unknown session, so the sender can always treat cancel as best-effort.

Query parameter: `sessionId` — **optional** (`?sessionId=`…). Three behaviours:

1. **Session-less cancel of a pending prepare-upload.** If a `Pending` session exists whose `sender_ip` equals the caller's IP and either no `sessionId` was given or it equals the pending one, the waiting `prepare-upload` handler is interrupted: the pending sender gets `403 {"message":"Cancelled by sender"}` and the slot is freed (`server/v2.rs:464-489`). This exists because **senders on 2.0/2.1/2.2 do not know the session ID before the prepare-upload response** (`session.rs:15-20`). A v2 sender that aborts while the user is deciding must therefore call `POST /cancel` with **no** query string from the same IP.
2. **Cancel of your own session.** If `sessionId` matches an `Active` session whose `sender_ip` equals the caller's IP, the slot is cleared and the app is notified with `SessionEndReasonV2::Cancelled` (`server/v2.rs:491-513`).
3. **Cancel of a session you are receiving.** Any other `sessionId` produces a `CancelReceived { ip, session_id }` event for the *application* to match against a transfer it is currently **sending**, verifying `ip` equals that send target (`server/v2.rs:514-524`, `[APP] receive_controller.dart:477-497`: match `remoteSessionId`, require `target.ip == event.ip`, require status `sending`). This is the **only** cross-peer session abort, and the only "the receiver calls back on the sender" flow.

Who may call it: the sender (cases 1–2, authorised by **source IP equality**, `session.rs:24-25, 33-34`), and the receiver (case 3, as a normal outbound request). No token or PIN is required for `/cancel`.

### 2.7 `/finish` — does not exist; what really ends a transfer

- No `/finish` route in `[CORE] http/server/mod.rs:628-692`.
- No `finish` mention in `[PROTO] README.md`, `v1.md`, `CHANGELOG.md`, or `v3/*.mermaid`.
- No outbound `/finish` call from any client (`[CORE] http/client/v2.rs` has `register`, `prepare_upload`, `upload`, `cancel`, `info`, `prepare_download`, `download` — nothing else).
- **What actually ends the session, receiver side:** all accepted files reaching `Finished`/`Failed` (`server/v2.rs:653-691`), an explicit `/cancel`, the user's `cancelSession()` (`ServerHandle::cancel_v2_session`, `server/mod.rs:201-213`, which silently clears the slot and emits *no* `SessionEnd`), or a server restart (sessions never survive one — `[APP] server_provider.dart:313, 420`: "Sessions do not survive a server restart").
- **What actually ends the session, sender side:** purely local. `[APP] provider/network/send_provider.dart:502-517` `_finish()` only stops a foreground-service notification and sets a UI status; no HTTP request. On success with an errors-free background session it drops the local session state.
- **The sender learns of completion** by every `/upload` returning `200` (and by `/prepare-upload` returning `401/403/409/429/204` for the failure cases). Nothing else.
- **Rejection of a *file*** is signalled at `prepare-upload` time by omission from the returned `files` map, or at `upload` time by a non-200 status. There is no per-file post-hoc rejection channel.

If you were planning to implement `/finish`, **do not** — a real LocalSend peer will 404 it and no peer will ever send it to you.

### 2.8 Reverse transfer / Download API (browser mode)

Documented at `[PROTO] README.md:286-385`; implemented at `[CORE] http/server/web.rs`. **Plain HTTP only, by design:** "It is important to note that the unencrypted HTTP protocol is used because browsers reject self-signed certificates" (`[PROTO] README.md:294`). The Rust server relaxes mTLS when a web share is active (see §4.5).

**`POST /api/localsend/v2/prepare-download`** (`web.rs:308-392`)

| Query param | Required | Meaning |
|---|---|---|
| `sessionId` | no | Re-fetch the file list for an already-accepted session (browser page reload). Without it, a new session is requested. |
| `pin` | if PIN set | |
Body: **none** (`XHR.send()` with no argument, `assets/web/download.html:194`).

Response `200`:
```jsonc
{
  "info": { /* InfoResponseDtoV2 — alias, version, deviceModel?, deviceType?, fingerprint, download. NO port/protocol */ },
  "sessionId": "192.168.1.23",   // ← see note
  "files": { "<fileId>": { /* FileDto */ } }
}
```
**Critical difference from the documented model:** the `sessionId` here is the **client's IP address as a string** (`web.rs:84`: `let session_id = client_info.ip.to_string();`, state keyed by session ID = IP at `web.rs:198`). One session per IP; a new request replaces the previous one. Downloads are only accepted from the session's own IP (`web.rs:148-159`).

Status codes: `200`; `401` (`PIN required`/`Invalid PIN`); `403` (`File transfer rejected.`); `429` (`Too many requests`); `500`; `403 {"message":"Web download not initialized."}` when no web share is active (`web.rs:470-475`).

**`GET /api/localsend/v2/download?sessionId=…&fileId=…`** (`web.rs:396-468`)
- `sessionId` missing → `400 {"message":"Missing sessionId."}`; `fileId` missing → `400 {"message":"Missing fileId."}`.
- Unknown/wrong-IP session → `403 {"message":"Invalid sessionId."}`; unknown file → `403 {"message":"Invalid fileId."}`.
- Success `200` with headers:
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="<percent-encoded>"` — `/` in the name is replaced by `-` first, then RFC-2396 component encoding (`web.rs:72-83, 452-462`)
  - `Content-Length: <file.size>`

`[PROTO] README.md:291-302` also documents the browser URL as `http://<sender-ip>:<sender-port>` — the root path serves the share page when a web share is active (`web.rs:283-298`), and the 403 page when it is not (`web.rs:491-497`).

Refresh handling: the page stores `sessionId` in `sessionStorage` and re-sends it as a **query parameter** (not a body) on reload (`assets/web/download.html:103-124`).

---

## 3. File upload mechanics

### 3.1 `POST /api/localsend/v2/upload`

Handler `[CORE] http/server/v2.rs:362-453`; client `[CORE] http/client/v2.rs:233-273`.

**Query parameters — all three REQUIRED:**

| Name | Notes |
|---|---|
| `sessionId` | from `prepare-upload` |
| `fileId` | the **map key** from the request `files` object |
| `token` | the per-file token from the `prepare-upload` response `files[fileId]` |

Missing any one → `400 {"message":"Missing parameters"}` (`server/v2.rs:370-379`).

**Body encoding: raw binary. Not multipart, not base64, no wrapper.**

- Server: `save_req_to_target` streams `req.into_body()` frames straight to the file target, hashing on the way (`[CORE] http/server/common/save.rs:164-196`).
- Native client: `reqwest::Body::wrap_stream(...)` over the file's chunk stream, **no `Content-Type` header set** (`[CORE] http/client/mod.rs:181-193`, `client/v2.rs:259-262`).
- Browser client: `xhr.send(fileObject)` — a raw `File`, no headers (`assets/web/upload.html:99-108, 123`).
- **`Content-Length` should be set to `file.size`.** The native client sets it via the streaming body's known length (`contentLength` is passed through `[ISO] src/task/upload/http_upload.dart:48`), and the receiver aborts with `500` if the received byte count does not equal the declared `size` (`save.rs:275-277`: "Fails if the total number of written bytes does not match `expected_size`"). A missing/short body is a **failed** upload, not a truncated-but-accepted one.
- Chunked transfer-encoding is tolerated by `hyper`, but the receiver still enforces the declared `size`.
- **There are no custom metadata headers.** No `X-File-Id`, no `X-File-Name`, no `X-File-Size`, no `X-Session-Id`. All metadata lives in the `prepare-upload` JSON; `/upload` carries the three query params and bytes. (`grep` for `X-File`/`headers_mut` over `[CORE] http/` returns only the JSON `Content-Type` on the two JSON POSTs, the JSON response header, and the download-page headers.)

**Response:** `200` with an **empty body** and **no `Content-Type`** (`server/v2.rs:446`, `common/response.rs:17-20`).

**All status codes** (docs `[PROTO] README.md:262-270`; code in `server/v2.rs`):

| Code | Meaning | Trigger |
|---|---|---|
| `200` | File stored | `save_req_to_target` → `SaveResult::Success` |
| `400` | Missing parameters | `server/v2.rs:375-379` |
| `403` | Invalid token or IP address | any of: no `Active` session; `sessionId` mismatch; source IP ≠ session `sender_ip`; unknown `fileId`; wrong `token`; file not `Pending` (`server/v2.rs:381-399`, `invalid_token_error()` at `:537-542`) |
| `409` | **Documented but NOT implemented for `/upload`.** The single-session invariant is enforced only at `prepare-upload`; by upload time the session is already claimed. A mismatched session ID yields `403`, not `409`. |
| `422` | Checksum mismatch | received bytes hash ≠ declared `sha256` (`server/v2.rs:448-451`, `save.rs:225-234`). **Only if** `verifyChecksums` is on (receiver setting, default `true`); when off, the stored `sha256` is ignored (`server/v2.rs:405-408`) |
| `500` | Unknown error by receiver | body read error, size mismatch, write failure, app dropped the target channel (`server/v2.rs:429-432, 447`) |

Notes for implementers:
- **IP binding is mandatory.** Uploads are rejected unless the TCP source IP equals the prepare-upload source IP (`server/v2.rs:387`). Peers behind NAT or with multiple interfaces can therefore fail; using the same client socket/connection helps but the IP check is on the address, not the connection.
- **A checksum mismatch is retryable with the same token.** `finalize_file` resets the file to `Pending` on mismatch while `attempts < MAX_UPLOAD_ATTEMPTS (= 3)` (`server/v2.rs:646, 653-680`). After the third attempt the file goes `Failed` and the token stops working: a further upload returns **`403`** (test `packages/core/tests/v2_server.rs:675-728`).
- Comparing is case-insensitive: `actual.eq_ignore_ascii_case(expected)` (`save.rs:227`), and `actual` is lowercase hex (`crypto/hash.rs:105-107`). Accept either case as a receiver; emit lowercase as a sender.
- The file is **truncated to the written size** so a pre-existing longer file cannot leave a tail (`save.rs:278-280`).
- Sender-provided `metadata.modified`/`accessed` are applied to the written file after a complete write (`save.rs:80-90, 281-283`).

### 3.2 Parallel vs sequential — what to do

Both are legal; the receiver handles both. Observed behaviour:

| Implementation | Behaviour | Source |
|---|---|---|
| Native app → native app | **2 files in parallel** per send task | `[ISO] src/isolate/child/upload_isolate.dart:16-17` `const _concurrency = 2;` with `Pool(_concurrency).forEach` at `:146` |
| Browser share page → receiver | **strictly sequential**, one file at a time, recursive `uploadNext(index)` | `[CORE] assets/web/upload.html:283-315` |
| Server capacity | 64 connections total, **8 per IP** — so 2 parallel files is comfortably inside the per-IP budget alongside keep-alive sockets | `connection_limit.rs:9-14` (comment: "a sender uploads two files in parallel and browsers open up to six connections per host") |
| Server-side receive | each `/upload` is handled independently; a `Mutex` guards only the short validation and finalisation windows, never the body transfer | `server/v2.rs:382-399, 653-680` |

**Guidance:** upload **2 at a time** to match the reference. Never exceed ~6 in flight (the per-IP connection cap is 8 and the receiver may also be serving a browser). The spec explicitly says "This route can be called in parallel" (`[PROTO] README.md:243`) with no stated limit; the only real limits are the connection caps and the fact that a second *file* of the *same* fileId will be rejected with `403` for the duration of the first (status `InProgress`).

### 3.3 Streaming, chunking, resumability

- **Streaming is expected and required.** The receiver never buffers a whole file: it forwards body frames into a bounded channel of **16 chunks** (`UPLOAD_CHANNEL_CAPACITY`, `save.rs:11`) and coalesces into **512 KiB** writes (`WRITE_BUFFER_SIZE`, `save.rs:15`). The sender reads in **512 KiB** chunks with **4 chunks (≈2 MiB)** of read-ahead (`model/transfer.rs:10, 13`).
- **No chunked/resumable protocol.** There is no `Content-Range`, no offset parameter, no partial-upload resumption, no range support on `/upload`. If a transfer dies mid-file, the receiver marks the file `Failed` (`UploadGuard::drop`, `server/v2.rs:629-641`) and the whole file must be re-sent from byte 0 — with the **same token**, which is still valid because `Failed` is a final state but the session only ends when *all* files are final. Note: a `Failed` file's token can never be reused (`file.status != Pending` → `403`), so a from-scratch re-send of that file requires a **new `prepare-upload`** session.
- **No `Expect: 100-continue` handling**, no `Range` support, no `Transfer-Encoding: chunked` special-casing.
- **Progress** is derived from bytes read/written locally, not from any protocol message (`[CORE] http/client/mod.rs:186-190`).
- The only documented retry is the `422` checksum path (§3.1), capped at 3 attempts, mirrored client-side (`[ISO] upload_isolate.dart:19-23`, `_maxUploadAttempts = 3`).

---

## 4. Cryptography / TLS

### 4.1 The certificate

Generated by `[CORE] crypto/cert.rs:32-56` (`generate_self_signed`), called from Dart via `[APP] util/security_helper.dart:5-13`.

| Property | Value | Source |
|---|---|---|
| Key algorithm | **RSA-2048** | `cert.rs:36`; comment: "RSA-2048, matching the certificates the Flutter app has historically generated in Dart" |
| Key encodings | private key PKCS#8 PEM, public key SPKI PEM, LF line endings | `cert.rs:37-40` |
| Subject | `CN=LocalSend User`, **no SANs**, empty O/OU/L/ST/C | `cert.rs:44-47` |
| Signature | self-signed | `cert.rs:48` |
| Serial number | rcgen default = derived from the public-key hash (not set explicitly) | `cert.rs:28-29` |
| Validity | **rcgen default ≈ 1975 → 4096** — "so certificates do not expire in practice and never need to be rotated for time reasons" | `cert.rs:30-31` |
| Library | `rcgen` (Rust) | `cert.rs:42-48` |

**Persistence:** the whole identity is stored as a `StoredSecurityContext { privateKey, publicKey, certificate, certificateHash }` (`[ISO] model/stored_security_context.dart:5-19`) in the app's shared preferences, **and survives restarts**. A new context is only generated by the explicit `ResetSecurityContextAction` (`[APP] provider/security_provider.dart:29-36`). So the fingerprint is stable for the lifetime of an installation — favourites/pinning depend on this. A from-scratch implementation must persist `(certPem, privateKeyPem)` to disk.

**Validating your own cert** (must pass for peers to accept you): `verify_cert_from_cert` checks (a) `cert.validity.is_valid()`, (b) if a public key is supplied, that the cert's SPKI equals it, (c) `cert.verify_signature(None)` — the self-signature (`cert.rs:75-97`). A cert that is time-invalid or whose self-signature does not verify is rejected.

### 4.2 The fingerprint — exact algorithm

```rust
// [CORE] crypto/cert.rs:99-106
pub fn fingerprint_from_cert_der(cert: &[u8]) -> String {
    crate::crypto::hash::sha256(cert)          // SHA-256 over the DER bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))     // UPPERCASE hex, no separators
        .collect()
}
```

**Exact recipe:** `fingerprint = SHA256(DER-encoded-X.509-certificate)`, hex-encoded, **uppercase**, 64 characters, no colons. Input is the **entire certificate in DER**, not the public key, not the PEM text, not the SPKI.

- Reference vector, so you can unit-test: `[CORE] crypto/cert.rs:277-284` asserts the fingerprint of the embedded test certificate is
  `4BADDE53A7F7CDEEED93189FD898E02BF6B4806CA4C05DE0ACE08319B86552FA`
  and the comment says "Must match the Dart side: uppercase hex SHA-256 of the DER bytes."
- From Node.js: `crypto.createHash('sha256').update(derBuffer).digest('hex').toUpperCase()`, where `derBuffer` is what `X509Certificate.raw` gives you (Node's `raw` is the DER).
- Case-insensitivity is defensive on the compare side: `PinnedServerCertVerifier` uppercases the expected value (`server_cert_verifier.rs:79`) and the server uppercases the claimed one (`server/v2.rs:164`), with a test `accepts_lowercase_fingerprint` (`:191-194`). Emit uppercase; accept either.

### 4.3 HTTPS vs plain HTTP

- **HTTPS is the default but NOT mandatory.** Default setting is `https = true` (`[APP] persistence_provider.dart:494-496`), user-switchable, and `[PROTO] README.md:73` lists `"http"` as a valid `protocol` value.
- The server listens on **one** protocol per run, not both: `tls_config: Option<TlsConfig>` is a single acceptor for the whole listener (`server/mod.rs:217-225, 388-395`); the app logs `"{https ? 'HTTPS' : 'HTTP'} only"` (`[APP] server_provider.dart:225`).
- The reverse-transfer/download API and the browser share pages are documented as **plain HTTP only**, because "browsers reject self-signed certificates" (`[PROTO] README.md:294`). Note that the Rust server *can* serve those pages over TLS — it becomes an HTTPS page with an untrusted cert — but the protocol's intent is HTTP.
- The `protocol` you advertise in announce/register/info/`prepare-upload.info` **must** match what you actually listen on; peers choose the URL scheme from it (`TargetUrl`, `[CORE] http/client/url.rs:21-49`).

### 4.4 Certificate validation on the client — TOFU with pinning, enforced during the handshake

`PinnedServerCertVerifier` (`[CORE] http/client/server_cert_verifier.rs:55-138`) replaces WebPKI entirely:

1. Validate the peer cert structurally: time validity, self-signature, optionally public key (`server_cert_verifier.rs:102-103` → `verify_cert_from_der`).
2. **Hostname is deliberately ignored** — "peers are addressed by IP and their certificates carry no matching SAN. The fingerprint below is what identifies the peer" (`:99-101`).
3. If a fingerprint is pinned: compute `SHA256(DER)` and require an exact match, else fail (`:105-112`).

**Where the pin comes from:**
- Discovery probing: **no pin** (`expected_fingerprint = None`) — "trust on first use and is only appropriate for discovery, where the fingerprint of the peer is not known yet and is read from the response instead" (`server_cert_verifier.rs:60-63`). The fingerprint is then read off the handshake (`cert_fingerprint_from_res`, `client/mod.rs:298-307`) and stored.
- Answering an announce: **pinned to `message.fingerprint`** (`discovery/mod.rs:519-522`).
- **All data transfer** (prepare-upload/upload/cancel): pinned to the fingerprint previously learned for that device — `httpProvider.pinnedTo(device.fingerprint)` (`[APP] provider/http_provider.dart:30-37`), whose doc says "The check happens during the TLS handshake, so a different peer never receives the request. Use this for everything that carries file data."

**Where the pin is stored:** the device store, keyed by fingerprint (`[CORE] discovery/store.rs`, `DiscoveryHandle::device_by_fingerprint`, `discovery/mod.rs:404-406`) and in app favourites (`FavoriteDevice.fingerprint`, used for quick-save-from-favourites at `[APP] receive_controller.dart:132`).

**There is no user prompt for an unknown fingerprint.** Trust-on-first-use is automatic; the only user-visible consequence of a changed fingerprint is that the device appears as new (and loses favourite/quick-save status).

**The "fingerprint is ignored in HTTPS mode" comment — precise meaning.** `[PROTO] README.md:93, 136, 151` annotate the JSON `fingerprint` field as `// ignored in HTTPS mode`. This does **not** mean the field is unused:
- In **HTTPS** mode the *authoritative* identity is the certificate fingerprint from the handshake; the JSON `fingerprint` value is only used to detect self-discovery, and on the server side it must actually **match** the client cert or the register is dropped (`server/v2.rs:161-190`). `[APP] receive_controller.dart:86-89`: "The fingerprint of the sender's mTLS certificate cannot be spoofed, unlike the self-reported fingerprint in the JSON payload which is only used as fallback when encryption is disabled."
- In **HTTP** mode the JSON `fingerprint` is the only identity there is, and is a random string (`[PROTO] README.md:55`: "When encryption is off (HTTP), then the fingerprint is a random generated string"), generated once and persisted with the rest of the security context. The browser page fakes one as `"web-" + 32 random chars` in `sessionStorage` (`assets/web/upload.html:137-141`).

### 4.5 mTLS — required, with one documented exception

- The client always presents a certificate (`with_client_auth_cert`, `[CORE] http/client/mod.rs:224-225`; comment at `discovery/mod.rs:35-37`: "sent as client certificate with every register request (client certificates are mandatory in HTTPS mode)").
- The server verifies it via `CustomClientCertVerifier` (`server/mod.rs:16, 565-568`), seeded with the server's own cert so the root store is non-empty (the verifier never delegates — `server_cert_verifier.rs:72-76`).
- **Exception:** when a browser-facing web share is active, client certificates are **optional** so browsers can connect; a certificate that *is* presented is still verified: `let mandatory_client_auth = matches!(app_state.web.share, WebShare::Disabled);` (`server/mod.rs:384-386`) → `create_tls_config(&tls_config, mandatory_client_auth)`.
- mTLS is required for **no specific endpoint** — it is a transport-level condition. A v2 peer with no client cert simply cannot complete the TLS handshake against a default server.

### 4.6 v3 crypto (brief; docs are diagrams only)

From `[CORE] crypto/` and `v3/*.mermaid`:
- `POST /api/localsend/v3/nonce` with `{"nonce": "<base64>"}` → `200 {"nonce": "<base64>"}`. Nonces are **32 random bytes** (`crypto/nonce.rs:3-7`), accepted if **16 ≤ len ≤ 128** (`:9-11`), stored per remote identity in LRU caches of 200 (`server/mod.rs:118-123`). The remote identity is the **public key extracted from the client certificate** when mTLS is present, else the peer IP string (`server/mod.rs:591-608`).
- Combined nonce = `sender_nonce || receiver_nonce`; a signed token is then exchanged via `/api/localsend/v3/register`. Token signing uses **Ed25519** (`ed25519-dalek`, `[CORE] Cargo.toml`), plus RSA for the certs.
- `RegisterDto` v3 renames the identity fields: `token` instead of `fingerprint`, `hasWebInterface` instead of `download` (`[CORE] http/dto.rs:28-49`), and `DeviceType` serializes as `SCREAMING_SNAKE_CASE` (`Mobile`, `Desktop`, …) rather than lowercase (`model/discovery.rs:6-14`).
- v3's HTTP `register` handler is explicitly **`// TODO: not wired up yet`** (`server/v3.rs:52`) and only nonce exchange is live. The full v3 feature set (pairing, 202 `PAIR_REQUESTED`, 16 KiB WebRTC chunks) exists only as diagrams.
- **Recommendation: implement v2.2.** v3 is not a stable, fully-implemented target.

---

## 5. Device metadata / types

### 5.1 `DeviceType`

`[PROTO] README.md:410-428` + `[CORE] model/discovery.rs:6-14, 66-99`.

| Value | Meaning |
|---|---|
| `mobile` | Android, iOS, FireOS |
| `desktop` | Windows, macOS, Linux (also the **fallback for unknown values**) |
| `web` | Firefox, Chrome |
| `headless` | program without GUI on a terminal |
| `server` | (self-hosted) cloud service running 24/7 |

- **v2 wire form: lowercase** — `"mobile"`, `"desktop"`, `"web"`, `"headless"`, `"server"` (`model/discovery.rs:70-84`).
- Deserialization lowercases then matches; **any unknown value → `desktop`**, never an error (`model/discovery.rs:86-98`; test with `"fridge"` → `Desktop`, `dto_v2.rs:196-210`). `[PROTO] README.md:428`: "The implementation handle unknown values. The official implementation falls back to `desktop`."
- **v3 wire form (only in the WebRTC/v3 path): SCREAMING_SNAKE_CASE** (`Mobile`, `Desktop`, …) via `rename_all = "SCREAMING_SNAKE_CASE"` (`model/discovery.rs:7`).
- `[PROTO] v1.md:41` lists only `mobile | desktop | web`.
- Types are **UI-only**: "There is no difference in the protocol between the different device types" (`README.md:418`). Nothing branches on it.

### 5.2 Full field reference — `type`/`deviceType` naming and everything else

**`type` vs `deviceType`:** the field has **always** been `deviceType` on the wire in every version. There is no `type` field in v1 or v2 (`[PROTO] v1.md:40`, `README.md:70`; `RegisterDtoV2.device_type` with `rename_all = "camelCase"` → `deviceType`, `dto_v2.rs:34`). Some third-party client libraries use a Dart/TS property named `deviceType` mapped to a Rust enum named `DeviceType` — that is the only sense in which "type" appears. Use `deviceType`.

| Field | v1 | v2.2 | Notes |
|---|---|---|---|
| `alias` | ✅ required | ✅ required | display name |
| `version` | ❌ absent | ✅ required | `"major.minor"` |
| `deviceModel` | ✅ nullable | ✅ nullable | omitted when null |
| `deviceType` | ✅ (3 values) | ✅ (5 values) | omitted when null; unknown → `desktop` |
| `fingerprint` | ✅ required | ✅ required | uppercase-hex SHA-256 of cert (HTTPS) or random string (HTTP) |
| `port` | ❌ absent | ✅ required | HTTP port, **not** the multicast port |
| `protocol` | ❌ absent | ✅ required | `"http"` \| `"https"`, strict |
| `download` | ❌ absent | ✅ optional, default `false` | see §5.3 |
| `announce` | `announcement` ✅ | ✅ on announces only (never in register/info) | see §1.2 |
| `encryption` | ❌ **does not exist** | ❌ **does not exist** | There is no `encryption` field anywhere. Encryption is expressed by `protocol: "https"`. If you saw `encryption` in a blog post or an unofficial doc, it is wrong. |
| `token` | — | — | **v3 only**, replaces `fingerprint` (`dto.rs:41`) |
| `hasWebInterface` | — | — | **v3 only**, replaces `download` (`dto.rs:47-48`) |

**Where each field appears:**

| Message | `alias` | `version` | `deviceModel` | `deviceType` | `fingerprint` | `port` | `protocol` | `download` | `announce` |
|---|---|---|---|---|---|---|---|---|---|
| UDP announce (§1.2) | ✅ | ✅ | opt | opt | ✅ | ✅ | ✅ | opt | ✅ `true` |
| `/register` **request** (§2.1) | ✅ | ✅ | opt | opt | ✅ | ✅ | ✅ | opt | ❌ |
| `/register` **response** (§2.1) | ✅ | ✅ | opt | opt | ✅ | ❌ | ❌ | opt | ❌ |
| `/info` response (§2.2) | ✅ | ✅ | opt | opt | ✅ | ❌ | ❌ | opt | ❌ |
| `/prepare-upload` `info` | ✅ | ✅ | opt | opt | ✅ | ✅ | ✅ | opt | ❌ |
| `/prepare-download` `info` | ✅ | ✅ | opt | opt | ✅ | ❌ | ❌ | opt | ❌ |

The asymmetry is real and matters: **responses carry no `port`/`protocol`** because the requester already learned them from the announce or from the probe it sent.

### 5.3 `download` flag semantics

"Whether the download API (sections 5.2, 5.3) is active" (`[PROTO] README.md:74`). Computed as `state.web.share.download().is_some()` (`[CORE] http/server/v2.rs:194, 211`), i.e. **true exactly when the reverse-transfer share page is currently being served**. In the app: `download: serverState?.webDownloadState != null` (`[APP] provider/device_info_provider.dart:47`).

- Optional everywhere with `#[serde(default)]` → **absent means `false`**; a parser must not error on its absence (`dto_v2.rs:47-49`, test `test_register_response_without_download_field`).
- The Rust serializer **always emits it** (no `skip_serializing_if`), so peers see `"download": false` explicitly.
- A sender must only offer the "open in browser" flow when the target advertises `download: true`.
- Note the v3 equivalent `hasWebInterface` **is** skipped when false (`is_default`, `dto.rs:47`) — a subtle cross-version difference.

### 5.4 `fingerprint`, `port`, `protocol`, `version`, `alias`

- **`fingerprint`** — for v2 HTTPS: `SHA256(DER cert)` uppercase hex (§4.2). For HTTP: a random persisted string. Used for self-discovery avoidance, device identity/pinning, and favourites.
- **`port`** — the port of the device's **HTTP server**, "which is not necessarily the multicast port" (`[CORE] multicast/mod.rs:81-83`). Default and current default for both is `53317`, but they are separate configuration values in the protocol; always use the announced `port`, never assume 53317.
- **`protocol`** — `"http"` | `"https"`; determines the URL scheme. Strict parse in v2.
- **`version`** — `"major.minor"`. Used **only** to select v1 vs v2 routes: `target.version == '1.0' ? v1 : v2` (`[ISO] lib/api_route_builder.dart:31, 39`). There is no minor-version negotiation; a `"2.0"` peer and a `"2.2"` peer use identical routes, and the only behavioural difference is that a 2.0/2.1/2.2 sender does not know the session ID before the response (§2.6 case 1).
- **`alias`** — free-form display name. An empty alias is replaced by a random one before the server starts (`[APP] server_provider.dart:126-129`), and the sample values are fruit-themed (`"Nice Orange"`, `"Secret Banana"`).

---

## 6. Implementation gotchas

### 6.1 CORS — there is none, and that constrains browser clients

**Fact:** `[CORE]` contains **zero** `Access-Control-Allow-*` headers, no `OPTIONS` route, and no preflight handling (verified by grep over all of `packages/core/src/`). An unknown path returns `404` with an empty body. A cross-origin `fetch`/XHR from a page on `http://localhost:3000` to `http://192.168.1.5:53317/api/localsend/v2/prepare-upload` will be blocked by the browser.

Consequences for the Node-host + browser-client design:
- The **browser client can only call the LocalSend API same-origin** — i.e. from a page served by that same LocalSend server, exactly like `assets/web/upload.html` / `download.html` do (`var BASE_URL = '/api/localsend/v2'`, relative).
- Everything else must go through your Node host (which has no CORS restriction), with the browser talking to the Node host instead.
- If you serve your own page from an Electron renderer or a local dev server and want it to talk to LocalSend directly, you need to disable web security / use a custom protocol handler — do not expect the peer to help you.
- Note also that a `file://` or Electron `app://` origin is treated as opaque and will trip CORS even for `localhost` targets.
- The **download API** is different: it is designed for browser navigation (`<a href>`), which is not subject to CORS. That is why the reverse-transfer flow works from a plain browser.

### 6.2 mDNS / Bonjour — not used at all

LocalSend does **not** use mDNS, DNS-SD, SSDP, or any service-discovery protocol. Discovery is exclusively UDP multicast to `224.0.0.167:53317` (+ `ff12::fd3a:e420` on IPv6) with the custom JSON announce, and HTTP register sweeps as fallback. Do not advertise `_localsend._tcp` — no peer will look for it, and no peer publishes it.

### 6.3 Port conflicts

- **HTTP port:** the server binds the requested port on IPv4 **and** IPv6 wildcard. If the bind fails, `start_server` returns an error and the app surfaces "Failed to start server" (`[APP] server_provider.dart:205-212`). **There is no automatic fallback to an ephemeral port.** The user must change the port in settings. `start_with_port(0, …)` is supported by the core (`ServerHandle::port()`, `server/mod.rs:147-152`: "Relevant when the server was started with port 0, where the OS picks the port") and the IPv6 listener then reuses the IPv4-assigned port (`:236-237`), but the app never calls it with `0` — it validates `port < 0 || port > 65535` and substitutes the default `53317` (`[APP] server_provider.dart:131-133`).
- **UDP port:** binding failure is **not** fatal. Discovery starts without multicast and keeps working via HTTP probes/scans (`discovery/mod.rs:244-246, 436-441`). Multiple LocalSend instances on one host coexist because every multicast socket sets `SO_REUSEADDR` + `SO_REUSEPORT` (Unix) — note the comment "the `SO_REUSEPORT` sockets do not even fail the next bind" (`[ISO] rust/src/api/discovery.rs:141-144`), which is exactly why the bridge has to explicitly stop a leftover discovery instance before restarting.
- **Port and multicast port are the same number by default but are separate settings** and are passed as one `port` value to `start_discovery`, used both for the multicast bind and as the advertised HTTP port (`[ISO] rust/src/api/discovery.rs:153-155`). If you make them configurable independently, you must also make the announce carry the HTTP port (§5.4).
- The app has an explicit liveness check because of mobile OS socket reclamation: `ensureRunning()` opens a loopback TCP probe and restarts the server if it fails (`[APP] server_provider.dart:384-405`); the core also emits `ListenerFailed` when the accept loop dies (`mod.rs:123-130, 250-291`). A from-scratch server should mirror this — a dead listener with a cheerful UI is a real failure mode.

### 6.4 Session expiry / timeouts — none, and that is the spec

- **No session TTL.** Nothing in `[CORE] http/server/` expires a session; the only transitions are "all files final" and "explicit cancel" (§2.7). A peer that calls `prepare-upload` and then walks away holds the single session slot forever, and every other peer gets `409` until the user closes the session in the UI.
- **No HTTP request timeout on the server** either: a stalled `prepare-upload` body or a stalled `/upload` body simply holds a connection permit (up to the 64/8 limits). TCP keepalive (60 s idle, 10 s interval) is the only reaper.
- **Client-side timeout is 500 ms**, and it applies to **discovery probes only** (`DEFAULT_DISCOVERY_TIMEOUT`, `discovery/mod.rs:26`, passed as the register timeout at `:145-152` and `:523-528`). Transfers use a client with **no timeout** unless one is explicitly passed (`create_reqwest_client` only sets `.timeout()` when `Some`, `client/mod.rs:244-246`).
- Practical advice for a from-scratch implementation: model the 500 ms discovery timeout exactly (it bounds your `/24` scan), keep transfers timeout-free or very generous, and be prepared for a `409` that never clears.

### 6.5 Concurrency limits, backpressure, and their failure modes

- 64 total / 8 per IP connections; over-limit connections are **silently dropped before any HTTP response** (`server/mod.rs:450-469`). A client sees ECONNRESET, not a status code. Retry with backoff; treat reset-on-connect as "receiver busy", not "receiver broken".
- Receive-side backpressure is real: 16 × ~16 KiB in-flight chunks, 512 KiB write coalescing (`save.rs:11-15`).
- The server caps a single upload at the declared `size` (`save.rs:275-277`) and truncates over-long pre-existing targets.
- The app drops bursts rather than blocking: register events use `try_send` ("Dropped a register event", `server/v2.rs:179-184`) and discovery events use `try_send` too ("Dropped a discovery event", `discovery/mod.rs:199-206`). Do not build a protocol that requires every notification to arrive.
- `[PROTO]`'s `/upload` `409` is documented but unreachable (§3.1) — a sender should still handle it defensively.

### 6.6 IPv6 / dual-stack and multiple interfaces

- **Separate listeners, `IPV6_V6ONLY` forced on.** Without it, macOS binds IPv6 wildcard dual-stack and conflicts with the IPv4 socket on the same port (`server/mod.rs:301-318`). Listen on `0.0.0.0:port` **and** `[::]:port`. If the IPv6 bind fails it is only a warning; the server continues IPv4-only (`:238-245`), and `ServerHandle::local_addresses()` reflects which families are actually bound (`:163-181`).
- **Reachable addresses** are enumerated from interfaces, not from the wildcard bind; loopback is excluded and **link-local IPv6 is skipped** because "peers can only use them together with their own scope, which this device cannot know" (`server/mod.rs:154-181`).
- **Scoped IPv6 in URLs.** A zone identifier (`fe80::1%3`) is not representable in a URL. The native client mints a synthetic host `fe80--1s3.scoped.localsend.internal` (colons → `-`, `s` + scope, suffix `.scoped.localsend.internal`) and resolves it back through a custom DNS resolver into a scoped `SocketAddrV6` (`[CORE] http/client/scoped_host.rs:16-51`, `client/mod.rs:256-272`). In Node.js you can instead pass the interface index via `lookup`/`localAddress` when opening the socket. Plain IPv6 hosts still need brackets: `https://[::1]:53317/...` (`url.rs:29-32, 97-109`).
- **Multicast is per-interface**, one socket each, because a socket sends on only one interface (`socket.rs:20-26`). A dual-stack peer is discovered over **both** families and deduplication by fingerprint is left to the application (`multicast/mod.rs:114-117`).
- **The register scan only covers IPv4 `/24`s** (§1.5). IPv6-only networks rely entirely on multicast.
- The subnet scan's ~50 concurrent sockets can transiently exhaust file descriptors, which the server explicitly tolerates by backing off instead of dying (`server/mod.rs:356-375, 416-446`).
- The IP check on `/upload` uses the canonicalized peer IP; IPv4-mapped IPv6 (`::ffff:192.168.1.2`) counts as the IPv4 peer (`connection_limit.rs:51, 127-135`). Your `/upload` IP comparison must canonicalize too, or a dual-stack peer that registered over IPv4 and uploads over an IPv4-mapped IPv6 socket will get a spurious `403`.

### 6.7 Miscellaneous traps worth pre-empting

- **`version` in `prepare-upload.info` must be your real protocol version** (`"2.2"`), not your app version.
- **`204` is a success**, not an error — it means "accepted but nothing to send" (text messages). Handle it before parsing a body.
- **`/upload` `200` has no body.** Do not call `response.json()`.
- **Empty `Content-Type` on `/upload`** is expected; do not require `application/octet-stream`.
- **`sha256` mismatch is `422`, and the sender may retry up to 3 times with the same token** before the token dies (`403`). Budget for the retry loop.
- **`/cancel` returns `200` even for a session the server does not know**, and takes an optional `sessionId`. Send it session-less when aborting a prepare-upload you have not yet received a response for.
- **The download API's `sessionId` is an IP address string** — do not assume UUID shape there.
- **`/api/localsend/v2/show` is app-internal**, guarded by a `show_token`; do not call it and do not treat its presence as part of the public API (`server/mod.rs:675-676`).
- **`/api/localsend/v1/register`, `/v1/send-request`, `/v1/send`, `/v1/cancel` are NOT implemented** by the current server — only `/v1/info` survives (`server/mod.rs:646-653`). If you need v1 as a *receiver*, implement the full v1 route set from `[PROTO] v1.md`; if you only need v1 *senders* to discover you, the `/v1/info` alias suffices.
- **The `X-File-Id`-style headers do not exist** (see §3.1). Everything is query params + raw body.

---

## 7. Minimal implementation checklist

**As a receiver (server):**
1. Generate + persist an RSA-2048 self-signed cert (`CN=LocalSend User`, no SANs, long validity); compute `fingerprint = SHA256(DER).hex().toUpperCase()`.
2. Listen `0.0.0.0:53317` and `[::]:53317` (`IPV6_V6ONLY`), HTTP/1.1, with/without TLS.
3. Bind one UDP socket per non-loopback interface, `SO_REUSEADDR`+`SO_REUSEPORT`, join `224.0.0.167:53317` (and `ff12::fd3a:e420`), TTL 1, loopback on, `IP_MULTICAST_IF` pinned.
4. Announce 3× at 100/500/2000 ms with the §1.2 payload (including `"announce": true`).
5. On an inbound announce (fingerprint ≠ mine, `announce === true`) → `POST {protocol}://{srcIp}:{payload.port}/api/localsend/v2/register` with your own `RegisterDtoV2`, pinned to `payload.fingerprint` over TLS.
6. Implement `/register`, `/info` (+`/v1/info` alias), `/prepare-upload`, `/upload`, `/cancel`. Errors as `{"message": "…"}`.
7. Enforce: one session slot, source-IP binding on upload, optional PIN with a 3-strike → 429, `422` on sha256 mismatch (retryable 3× with the same token), `204` when nothing was accepted.

**As a sender (client):**
1. Discover (multicast + announce-answering + optional `/24` scan at 500 ms/probe, 50 concurrent).
2. `POST /prepare-upload?pin=` with `info` + `files`; handle `200`/`204`/`400`/`401`/`403`/`409`/`429`/`500`.
3. `POST /upload?sessionId&fileId&token`, body = raw bytes, `Content-Length = size`, 2 files in parallel, retry `422` ≤3×.
4. `POST /cancel?sessionId=` on abort, and session-less `/cancel` if aborting while the prepare-upload is still pending.
5. Nothing else — there is no `/finish`.
