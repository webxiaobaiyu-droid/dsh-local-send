window.__ModuleLoader__.load({
	id: "dsh-local-send",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
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
		//#region src/client/api.ts
		/**
		* The panel's side of the host contract.
		*
		* One module owns every request the browser half makes, so the paths and the
		* error shape are stated once. Failures are turned into messages here rather
		* than at each call site: the host answers a described failure as
		* `{"error": "..."}`, and a panel that had to remember that at nine call sites
		* would eventually print `[object Object]` at one of them.
		*
		* @module dsh-local-send/client/api
		*/
		/** A request that failed, carrying the host's own words when it had any. */
		var HostError = class extends Error {
			status;
			/** HTTP status, when the failure had one. */
			constructor(message, status) {
				super(message);
				this.status = status;
				this.name = "HostError";
			}
		};
		/**
		* Read a response body, or describe the failure.
		*
		* The host's failure shape is `{ error: string }`, but a proxy, a carrier cap or
		* an unloaded plugin can all answer with something else — a 404 body of
		* "not found", or an empty 413. Falling back to the status code keeps the panel
		* able to say *something* true rather than showing an empty toast.
		*
		* @param response - the response to read.
		* @returns the parsed body.
		* @throws {HostError} when the response is not ok.
		*/
		async function readBody(response) {
			if (response.ok) return await response.json();
			let detail = "";
			try {
				const body = await response.json();
				if (typeof body === "object" && body !== null) {
					const message = body.error;
					if (typeof message === "string") detail = message;
				}
			} catch {
				detail = "";
			}
			throw new HostError(detail.length > 0 ? detail : `HTTP ${String(response.status)}`, response.status);
		}
		/** POST a JSON body to one route and read the answer. */
		async function post(path, body) {
			return await readBody(await fetch(new URL(path, window.location.origin), {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}));
		}
		/**
		* Read the whole panel state.
		* @returns the state the panel renders from.
		*/
		async function fetchState() {
			return await readBody(await fetch(new URL(STATE_PATH, window.location.origin), { credentials: "include" }));
		}
		/**
		* Offer browser-held files to a peer, before any bytes move.
		* @param request - the peer and the files about to be streamed.
		* @returns the transfer to stream against, and which files were accepted.
		*/
		async function prepareSend(request) {
			return await post(PREPARE_PATH, request);
		}
		/**
		* Stream one file's bytes through the host to the peer.
		*
		* The body is the file itself and the route is registered as a streaming route
		* on the host, so the bytes are piped from this request into the request the
		* host makes to the peer: one pass, one buffer, nothing staged on disk.
		*
		* @param transferId - the prepared transfer.
		* @param fileId - which file of it.
		* @param file - the browser's own file object.
		* @param signal - aborts the upload when the panel goes away.
		*/
		async function streamFile(transferId, fileId, file, signal) {
			const url = new URL(STREAM_PATH, window.location.origin);
			url.searchParams.set("transferId", transferId);
			url.searchParams.set("fileId", fileId);
			const response = await fetch(url, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/octet-stream" },
				body: file,
				...signal === void 0 ? {} : { signal }
			});
			if (!response.ok) await readBody(response);
		}
		/**
		* Send files that already exist on this machine.
		* @param request - the peer and the absolute paths.
		* @returns the transfer the send was recorded as.
		*/
		async function sendPaths(request) {
			return await post(SEND_PATHS_PATH, request);
		}
		/**
		* Answer an incoming offer.
		* @param request - the offer and the answer.
		* @returns whether a decision was still pending.
		*/
		async function decide(request) {
			return await post(DECIDE_PATH, request);
		}
		/**
		* Rename this device.
		* @param alias - the new name to announce.
		* @returns the name now in effect.
		*/
		async function rename(alias) {
			return await post(RENAME_PATH, { alias });
		}
		/**
		* Run the legacy subnet scan.
		* @returns how many devices answered.
		*/
		async function scan() {
			return await post(SCAN_PATH, {});
		}
		/**
		* Ask the host what it knows about some paths.
		* @param paths - candidate absolute paths, as typed.
		* @returns one entry per path, in order.
		*/
		async function inspect(paths) {
			return await post(INSPECT_PATH, { paths });
		}
		/**
		* Show a received file in the platform's file manager.
		* @param path - absolute path of a file in the receive directory.
		*/
		async function reveal(path) {
			await post(REVEAL_PATH, { path });
		}
		//#endregion
		//#region src/client/mention.ts
		/**
		* The `@file` mention, built as the editor's own grammar spells it.
		*
		* A mention is plain text: the composer's `@` completion produces one, the
		* product's own Desktop intake produces one for a dropped non-image file, and
		* the same string is what a chip expands to on copy. Reproducing the rule here
		* rather than importing it keeps this bundle free of a package the browser
		* module table does not answer — the whole grammar a mention needs is the four
		* lines below.
		*
		* @module dsh-local-send/client/mention
		*/
		/**
		* Quote a path for a mention when it needs it.
		*
		* A path with whitespace has to be quoted or the token ends at the first space,
		* and a path the grammar cannot represent safely at all — one carrying a quote
		* or a control character — returns `undefined` so the caller can say so instead
		* of inserting a token that would be parsed as two.
		*
		* @param path - absolute path of the file to reference.
		* @returns the mention text, or `undefined` when the path cannot be written as one.
		*/
		function formatMention(path) {
			if (path.length === 0) return void 0;
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return void 0;
			return /\s/u.test(path) ? `@"${path}"` : `@${path}`;
		}
		//#endregion
		//#region src/client/pending.ts
		/**
		* The handoff between the panel and the composer.
		*
		* "Add to conversation" is one gesture that has to happen in a component the
		* panel does not own. Inserting text into the composer needs that composer's own
		* input actions, which only exist inside the conversation's slot tree, while the
		* button the user presses lives in the main column. The two are in one bundle
		* but not one tree, so the request has to travel between them.
		*
		* A module-level store does that, and it is the right size for the job: the
		* request is one string with a lifetime of a single keystroke-equivalent, it
		* never outlives the page, and routing it through the host would mean a round
		* trip to move a string between two components of the same bundle.
		*
		* The shape is the one React's `useSyncExternalStore` expects — a snapshot read
		* plus a subscription — so the composer can re-render on a request without the
		* panel needing to know anything about it.
		*
		* @module dsh-local-send/client/pending
		*/
		/**
		* How long a request stays valid.
		*
		* A request crosses a panel switch — the composer that performs the insert is
		* not mounted while the user is looking at this panel — so it cannot be consumed
		* synchronously. It must not be consumable indefinitely either: a request left
		* over from a session the user has since left would insert a reference into an
		* unrelated conversation minutes later, which is worse than doing nothing.
		*/
		const REQUEST_TTL_MS = 15e3;
		/** The request waiting to be inserted, or `undefined` when there is none. */
		let pending;
		/** Everything waiting to hear that {@link pending} changed. */
		const listeners = /* @__PURE__ */ new Set();
		/**
		* Ask for one file to be referenced in the composer.
		*
		* A later request replaces an earlier one rather than queueing behind it: the
		* user pressed a button, and two files added by two impatient clicks should not
		* both appear — the gesture means "this file", and the second click is the one
		* that counts.
		*
		* @param path - absolute path of the received file.
		*/
		function requestReference(path) {
			pending = {
				path,
				at: Date.now()
			};
			for (const listener of listeners) listener();
		}
		/**
		* Subscribe to changes.
		* @param listener - called after every request.
		* @returns the unsubscribe function.
		*/
		function subscribeReference(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/**
		* Read the pending request without consuming it.
		*
		* Read without consuming because `useSyncExternalStore` may call this more than
		* once per render, and a snapshot that disappeared on first read would make the
		* composer render an empty state on its second pass.
		* @returns the pending path, or `undefined`.
		*/
		function readReference() {
			if (pending === void 0) return void 0;
			if (Date.now() - pending.at > REQUEST_TTL_MS) {
				pending = void 0;
				return;
			}
			return pending.path;
		}
		/**
		* Take the pending request.
		* @returns the path that was waiting, or `undefined` when there was none.
		*/
		function consumeReference() {
			const taken = readReference();
			pending = void 0;
			return taken;
		}
		//#endregion
		//#region src/client/ComposerEntry.tsx
		/**
		* The composer's end of "add to conversation".
		*
		* This component is why that gesture works at all. Inserting text into the
		* composer needs the composer's own input actions — a revision-guarded caret
		* span and a CAS-checked insert — and those exist only inside the conversation's
		* slot tree, which the main column cannot reach. So the panel leaves a request
		* in a module store, switches the centre column back to the conversation, and
		* this entry performs the insert once it is mounted.
		*
		* It renders nothing while idle. A button here would have nothing to act on:
		* the file list lives in the panel, and duplicating it would mean this component
		* polling the host for a list the panel already holds. Its whole job is to be
		* the thing with the caret.
		*
		* The insert goes through `captureInsertion` + `insertText` — the voice-input
		* pattern — rather than `setDraft`, because `setDraft` replaces the entire draft
		* and would silently discard anything the user had already typed, including any
		* `@` or `/` tokens the editor had resolved into chips.
		*
		* @module dsh-local-send/client/ComposerEntry
		*/
		/**
		* Watch for a pending reference and insert it.
		*
		* The insert happens in an effect rather than during render because it writes to
		* the editor, and a render-phase write would run twice under React's strict
		* double-invocation and insert the mention twice.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function ComposerEntry(props) {
			const { inputActions, sessionId, hasSession } = props;
			const pending = readReference();
			/** Drives re-render when a request arrives while this entry is mounted. */
			const [, setRevision] = (0, react.useState)(0);
			(0, react.useEffect)(() => subscribeReference(() => {
				setRevision((value) => value + 1);
			}), []);
			(0, react.useEffect)(() => {
				if (pending === void 0) return;
				if (sessionId === void 0 || !hasSession()) return;
				const mention = formatMention(pending);
				if (mention === void 0) {
					consumeReference();
					return;
				}
				consumeReference();
				const span = inputActions.captureInsertion();
				inputActions.insertText(`${mention} `, span);
			}, [
				pending,
				sessionId,
				inputActions,
				hasSession
			]);
			return null;
		}
		//#endregion
		//#region src/client/format.ts
		/**
		* Figures and durations, formatted for the reader's language.
		*
		* Kept apart from the copy because these are not translations: a byte count and
		* a duration are properties of the reader's locale, not strings with a key
		* hanging off them, and the host deliberately sends neither pre-rendered.
		*
		* Every figure a transfer displays is rendered through this module, which is why
		* it is small and total — a formatter that can return `NaN`, `Infinity` or an
		* empty string would put that on screen mid-transfer.
		*
		* @module dsh-local-send/client/format
		*/
		/**
		* A byte count in the largest unit that keeps it readable.
		*
		* Binary units, because this is what a file manager shows and a user comparing
		* the panel against Finder should not have to convert. The decimal is dropped at
		* three significant digits: "1.37 GB" is as much as anyone reads off a progress
		* row, and a longer string is what makes a live figure jitter as it changes.
		*
		* @param bytes - a byte count, expected non-negative and finite.
		* @returns a string like `2.4 MB`.
		*/
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
			const units = [
				"B",
				"KB",
				"MB",
				"GB",
				"TB"
			];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			const label = units[unit] ?? "B";
			if (unit === 0) return `${String(Math.round(value))} ${label}`;
			const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
			return `${value.toFixed(digits)} ${label}`;
		}
		/**
		* How long ago something happened.
		*
		* Coarse on purpose: a peer list ticks, and a figure that changes every second
		* draws the eye to the least important column. Past a minute the answer is a
		* count of minutes, and past an hour it is not worth showing at all.
		*
		* @param timestamp - epoch milliseconds.
		* @param now - the current time, injected so the result is testable.
		* @returns a string like `just now` or `4m ago`, or `undefined` beyond an hour.
		*/
		function formatAge(timestamp, now) {
			const elapsed = now - timestamp;
			if (elapsed < 5e3) return "just now";
			if (elapsed < 6e4) return `${String(Math.floor(elapsed / 1e3))}s ago`;
			if (elapsed < 36e5) return `${String(Math.floor(elapsed / 6e4))}m ago`;
		}
		/**
		* A whole-transfer completion percentage.
		* @param done - bytes moved.
		* @param total - bytes expected.
		* @returns an integer 0–100.
		*/
		function percentOf(done, total) {
			if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
			return Math.max(0, Math.min(100, Math.round(done / total * 100)));
		}
		/**
		* A file name shortened from the left.
		*
		* Extension-first truncation: the tail of a file name is the part that says what
		* the file is, so the middle is what gives way. The character budget is applied
		* to the whole string rather than to the stem alone so the result always fits.
		*
		* @param name - the file name.
		* @param limit - maximum characters to return.
		* @returns the name, shortened if it had to be.
		*/
		function shortenFileName(name, limit) {
			if (name.length <= limit) return name;
			const dot = name.lastIndexOf(".");
			const extension = dot > 0 ? name.slice(dot) : "";
			const stem = dot > 0 ? name.slice(0, dot) : name;
			const room = limit - extension.length - 1;
			if (room <= 1) return `${name.slice(0, Math.max(1, limit - 1))}…`;
			return `${stem.slice(0, room)}…${extension}`;
		}
		//#endregion
		//#region src/client/state.ts
		/**
		* One shared read of the host state, for everything that draws from it.
		*
		* Two surfaces need this state and they are mounted independently: the panel,
		* which is only present while its own main column is selected, and the receive
		* notification, which has to fire wherever the user happens to be. Giving each
		* its own polling loop would mean two requests per tick to read one document,
		* and two answers that could momentarily disagree about whether an offer is
		* still waiting.
		*
		* So there is one loop, and it runs only while something is watching. That is
		* what {@link TransferStore.retain} is for: the notification retains for as long
		* as it is mounted, the panel retains while it is open, and a deployment where
		* neither exists reads nothing at all.
		*
		* The cadence follows the answer, not a fixed period. A device with no peers and
		* no transfers is a still picture and is re-read on a slow tick; a transfer in
		* flight is re-read fast enough that its progress bar moves smoothly; and a
		* hidden tab is re-read slowly enough to be impolite to nobody.
		*
		* @module dsh-local-send/client/state
		*/
		/** How often to re-read while something is moving. */
		const ACTIVE_MS = 500;
		/**
		* How often to re-read while nothing is.
		*
		* Slow enough to be invisible, fast enough that a file sent from a phone appears
		* while the sender is still looking at the screen they sent it from.
		*/
		const IDLE_MS = 2500;
		/** How often to re-read while the tab is in the background. */
		const HIDDEN_MS = 8e3;
		/** One line describing an error, for the failure state. */
		function describe$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Build the store over one reader.
		*
		* @param read - performs the actual host request.
		* @returns the store.
		*/
		function createTransferStore(read) {
			const listeners = /* @__PURE__ */ new Set();
			let snapshot = { status: "loading" };
			let holders = 0;
			let timer;
			/** Whether a read is in flight, so a refresh cannot stack behind the loop. */
			let reading = false;
			/** Set while the loop is torn down mid-read, so a late answer is dropped. */
			let generation = 0;
			const publish = (next) => {
				snapshot = next;
				for (const listener of listeners) listener();
			};
			const schedule = (delay) => {
				if (timer !== void 0) window.clearTimeout(timer);
				if (holders === 0) return;
				const mine = generation;
				timer = window.setTimeout(() => {
					if (mine !== generation) return;
					tick();
				}, delay);
			};
			const tick = async () => {
				if (reading) {
					schedule(ACTIVE_MS);
					return;
				}
				reading = true;
				try {
					const state = await read();
					if (holders === 0) return;
					publish({
						status: "ready",
						state
					});
					schedule(document.hidden ? HIDDEN_MS : state.busy ? ACTIVE_MS : IDLE_MS);
				} catch (error) {
					if (holders === 0) return;
					publish({
						status: "error",
						message: describe$1(error)
					});
					schedule(IDLE_MS);
				} finally {
					reading = false;
				}
			};
			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot: () => snapshot,
				retain() {
					holders += 1;
					if (holders === 1) tick();
					let released = false;
					return () => {
						if (released) return;
						released = true;
						holders -= 1;
						if (holders === 0) {
							generation += 1;
							if (timer !== void 0) window.clearTimeout(timer);
							timer = void 0;
						}
					};
				},
				async refresh() {
					try {
						const state = await read();
						publish({
							status: "ready",
							state
						});
					} catch (error) {
						publish({
							status: "error",
							message: describe$1(error)
						});
					}
				}
			};
		}
		/**
		* Read the store as React state.
		* @param store - the shared store.
		* @returns the current snapshot, re-rendering on every change.
		*/
		function useTransferState(store) {
			return (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
		}
		//#endregion
		//#region src/client/icons.tsx
		/** Shared attributes: one weight, round joins, inherited colour. */
		const STROKE = {
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		/** Wrap one glyph's paths in the common svg element. */
		function Svg({ size = 16, className, children, viewBox = "0 0 24 24" }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox,
				className,
				"aria-hidden": "true",
				focusable: "false",
				children
			});
		}
		/**
		* The sidebar mark: two devices exchanging a file.
		*
		* Two facing brackets with an arrow passing each way between them — the glyph
		* says "transfer" without borrowing LocalSend's own logo, which belongs to that
		* project rather than to this plugin.
		*
		* @param props - size and class.
		*/
		function HandoffIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4 5.5h3.5v13H4",
						...STROKE
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M20 5.5h-3.5v13H20",
						...STROKE
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M9 9.5h4.5",
						...STROKE
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M11.6 7.6 13.5 9.5l-1.9 1.9",
						...STROKE
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M15 14.5h-4.5",
						...STROKE
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M12.4 12.6 10.5 14.5l1.9 1.9",
						...STROKE
					})
				]
			});
		}
		/** A phone: tall rounded rect with a home indicator. */
		function MobileMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
				x: "7",
				y: "2.5",
				width: "10",
				height: "19",
				rx: "2.5",
				...STROKE
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M10.5 18.5h3",
				...STROKE
			})] });
		}
		/** A computer: screen on a stand. */
		function DesktopMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "2.5",
					y: "4",
					width: "19",
					height: "12.5",
					rx: "2",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9 20h6",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 16.5V20",
					...STROKE
				})
			] });
		}
		/** A browser: window with a chrome bar. */
		function WebMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "2.5",
					y: "4",
					width: "19",
					height: "16",
					rx: "2",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.5 8.5h19",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.5 6.4h.01M8 6.4h.01",
					...STROKE
				})
			] });
		}
		/** A terminal: prompt and caret. */
		function HeadlessMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "2.5",
					y: "4",
					width: "19",
					height: "16",
					rx: "2",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.5 9.5 9 12l-2.5 2.5",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M11.5 14.5H17",
					...STROKE
				})
			] });
		}
		/** A server: stacked rack units. */
		function ServerMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "3.5",
					width: "18",
					height: "7",
					rx: "1.8",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "13.5",
					width: "18",
					height: "7",
					rx: "1.8",
					...STROKE
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.5 7h.01M6.5 17h.01",
					...STROKE
				})
			] });
		}
		/**
		* The mark for one device class.
		*
		* An unknown class falls back to the desktop mark, which is what the reference
		* implementation does and what the protocol's own guidance asks for: the field
		* exists so a peer can pick an icon, so an unrecognized value must still leave a
		* peer looking like a device rather than like an error.
		*
		* @param props - size, class, and which class of device.
		*/
		function DeviceIcon({ type, ...props }) {
			const marks = {
				mobile: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MobileMark, {}),
				desktop: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopMark, {}),
				web: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WebMark, {}),
				headless: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeadlessMark, {}),
				server: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServerMark, {})
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				...props,
				children: marks[type ?? "desktop"] ?? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopMark, {})
			});
		}
		/** An arrow leaving a device: this file is going out. */
		function SendIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 19V5",
					...STROKE
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m6.5 10.5 5.5-5.5 5.5 5.5",
					...STROKE
				})]
			});
		}
		/** An arrow arriving at a device: this file is coming in. */
		function ReceiveIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 5v14",
					...STROKE
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m6.5 13.5 5.5 5.5 5.5-5.5",
					...STROKE
				})]
			});
		}
		/** The search action. */
		function SearchIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "11",
					cy: "11",
					r: "6.5",
					...STROKE
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m16 16 4 4",
					...STROKE
				})]
			});
		}
		/** A folder, for revealing a saved file. */
		function FolderIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3 7.5A2 2 0 0 1 5 5.5h3.6l1.8 2.2H19a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
					...STROKE
				})
			});
		}
		//#endregion
		//#region src/client/LocalSendPanel.tsx
		/**
		* The Nearby transfer panel: who is around, what is moving, and what arrived.
		*
		* The panel owns presentation and nothing else. Every read and every action goes
		* through its injected face, so the component can be rendered against a fixture
		* and the wiring can be tested without one.
		*
		* Two behaviours are worth stating because they are not obvious from the markup:
		*
		* - **It owns no polling.** The state arrives from a shared store that the
		*   receive notification also reads, and the panel merely retains it while
		*   mounted. See `state.ts` for why the cadence follows the host's own work.
		* - **A drop lands on a device, not on the panel.** The tiles are the drop
		*   targets, and the panel only dims what cannot receive while a drag is in
		*   flight. Dragging is reported with a counter rather than a boolean because
		*   `dragleave` fires when the pointer crosses into a child element, so a
		*   boolean would flicker the whole panel on every internal boundary.
		*
		* @module dsh-local-send/client/LocalSendPanel
		*/
		/** Format a count of files against the locale's plural rules. */
		function fileCountLabel(t, count) {
			return count === 1 ? t("filesCountOne") : t("filesCount", { count });
		}
		/**
		* The panel.
		* @param props - slot props, locale seat, and the injected face.
		*/
		function LocalSendPanel(props) {
			const { t, store, sendFiles, sendLocalPaths, answer, renameDevice, scanNow, revealFile, inspectPaths, addToConversation } = props;
			const read = useTransferState(store);
			const [dropTarget, setDropTarget] = (0, react.useState)(void 0);
			const [dragging, setDragging] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(void 0);
			const [busyAction, setBusyAction] = (0, react.useState)(void 0);
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [showPaths, setShowPaths] = (0, react.useState)(false);
			/** Nested drag depth; see the module note on why this is a counter. */
			const dragDepth = (0, react.useRef)(0);
			(0, react.useEffect)(() => store.retain(), [store]);
			/** Run one action, surfacing its failure and clearing its busy mark. */
			const run = (0, react.useCallback)(async (key, action) => {
				setBusyAction(key);
				setNotice(void 0);
				try {
					await action();
				} catch (error) {
					setNotice(describe(error));
				} finally {
					setBusyAction(void 0);
				}
			}, []);
			/** Re-read immediately, so an action's effect is on screen without waiting a tick. */
			const refresh = (0, react.useCallback)(async () => {
				await store.refresh();
			}, [store]);
			const onDragEnter = (0, react.useCallback)((event) => {
				if (!hasFiles(event)) return;
				dragDepth.current += 1;
				setDragging(true);
			}, []);
			const onDragLeave = (0, react.useCallback)(() => {
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) {
					setDragging(false);
					setDropTarget(void 0);
				}
			}, []);
			/** Keep the browser from navigating to the dropped file. */
			const onDragOver = (0, react.useCallback)((event) => {
				if (!hasFiles(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}, []);
			const onDrop = (0, react.useCallback)((event) => {
				event.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				setDropTarget(void 0);
			}, []);
			const dropOn = (0, react.useCallback)((peer, event) => {
				event.preventDefault();
				event.stopPropagation();
				dragDepth.current = 0;
				setDragging(false);
				setDropTarget(void 0);
				const files = [...event.dataTransfer.files];
				if (files.length === 0) return;
				run(`send:${peer.fingerprint}`, async () => {
					await sendFiles(peer.fingerprint, files);
					await refresh();
				});
			}, [
				run,
				sendFiles,
				refresh
			]);
			const incoming = (0, react.useMemo)(() => read.status === "ready" ? read.state.transfers.filter((transfer) => transfer.direction === "incoming" && transfer.status === "awaiting") : [], [read]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dls-panel",
				"data-dragging": dragging ? "true" : "false",
				onDragEnter,
				onDragLeave,
				onDragOver,
				onDrop,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-stack",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "dls-header",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
								className: "dls-heading",
								children: t("heading")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dls-subtitle",
								children: t("subtitle")
							})] }), read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dls-rowActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dls-action",
									"data-tone": "quiet",
									disabled: busyAction !== void 0,
									onClick: () => {
										setShowPaths((value) => !value);
									},
									children: t("sendPaths")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dls-action",
									disabled: busyAction === "scan",
									onClick: () => {
										run("scan", async () => {
											const result = await scanNow();
											setNotice(result.found > 0 ? t("scanFound", { count: result.found }) : t("scanEmpty"));
										});
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, { size: 13 }), busyAction === "scan" ? t("scanning") : t("rescan")]
								})]
							}) : null]
						}),
						read.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-note",
							children: t("scanning")
						}) : null,
						read.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dls-empty",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dls-emptyTitle",
									children: t("errorOffline")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dls-emptyHint",
									children: read.message
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dls-toastActions",
									style: { justifyContent: "center" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dls-action",
										onClick: () => {
											refresh();
										},
										children: t("retry")
									})
								})
							]
						}) : null,
						read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThisDevice, {
							state: read.state,
							renaming,
							busy: busyAction === "rename",
							t,
							onStartRename: () => {
								setRenaming(true);
							},
							onCancelRename: () => {
								setRenaming(false);
							},
							onRename: (alias) => {
								run("rename", async () => {
									await renameDevice(alias);
									setRenaming(false);
									await refresh();
								});
							}
						}) : null,
						read.status === "ready" && read.state.warning !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-note",
							"data-tone": "warn",
							children: read.state.warning
						}) : null,
						notice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-note",
							children: notice
						}) : null,
						incoming.map((transfer) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IncomingOffer, {
							transfer,
							busy: busyAction === `answer:${transfer.id}`,
							t,
							onAnswer: (accept) => {
								run(`answer:${transfer.id}`, async () => {
									await answer(transfer.id, accept);
									await refresh();
								});
							}
						}, transfer.id)),
						showPaths && read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PathsSender, {
							peers: read.state.peers,
							busy: busyAction,
							t,
							inspectPaths,
							onSend: (peer, paths) => {
								run(`send:${peer}`, async () => {
									await sendLocalPaths(peer, paths);
									await refresh();
								});
							}
						}) : null,
						read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Nearby, {
							peers: read.state.peers,
							dragging,
							dropTarget,
							busyAction,
							t,
							onDragOverTile: setDropTarget,
							onDropOnTile: dropOn
						}) : null,
						read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Transfers, {
							transfers: read.state.transfers,
							busyAction,
							t,
							now: Date.now(),
							onAddToConversation: addToConversation,
							onReveal: (path) => {
								run(`reveal:${path}`, async () => {
									await revealFile(path);
								});
							}
						}) : null
					]
				})
			});
		}
		/** Whether a drag payload carries files rather than text or a URL. */
		function hasFiles(event) {
			return Array.from(event.dataTransfer.types).includes("Files");
		}
		/** One line describing an error, for a note. */
		function describe(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** This device's identity, with its room to be renamed. */
		function ThisDevice({ state, renaming, busy, t, onStartRename, onCancelRename, onRename }) {
			const [draft, setDraft] = (0, react.useState)(state.device.alias);
			(0, react.useEffect)(() => {
				setDraft(state.device.alias);
			}, [state.device.alias]);
			const address = state.device.addresses[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-sectionHead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dls-sectionTitle",
						children: t("thisDevice")
					}), renaming ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dls-action",
						"data-tone": "quiet",
						onClick: onStartRename,
						children: t("rename")
					})]
				}), renaming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-pathsRow",
					style: { justifyContent: "flex-start" },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dls-input",
							value: draft,
							autoFocus: true,
							maxLength: 64,
							placeholder: t("renamePlaceholder"),
							onChange: (event) => {
								setDraft(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter" && draft.trim().length > 0) onRename(draft.trim());
								if (event.key === "Escape") onCancelRename();
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-action",
							"data-tone": "primary",
							disabled: busy || draft.trim().length === 0,
							onClick: () => {
								onRename(draft.trim());
							},
							children: t("save")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-action",
							onClick: onCancelRename,
							children: t("cancel")
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-identity",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-state",
						"data-ok": state.device.serving ? "true" : "false",
						children: [
							state.device.alias,
							" · ",
							state.device.serving ? t("serving") : t("notServing")
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-fact",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-factKey",
							children: t("addressLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-factValue",
							children: address === void 0 ? t("noAddress") : `${address}:${String(state.device.port)}`
						})]
					})]
				})]
			});
		}
		/** The devices around this one, each a drop target. */
		function Nearby({ peers, dragging, dropTarget, busyAction, t, onDragOverTile, onDropOnTile }) {
			const now = Date.now();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-sectionHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dls-sectionTitle",
							children: [t("nearby"), peers.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-count",
								children: peers.length
							}) : null]
						}), peers.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-note",
							children: t("dropHint")
						}) : null]
					}),
					peers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dls-emptyTitle",
							children: t("noPeers")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-emptyHint",
							children: t("noPeersHint")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dls-peers",
						children: peers.map((peer) => {
							const age = formatAge(peer.lastSeen, now);
							const sending = busyAction === `send:${peer.fingerprint}`;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dls-tile",
								"data-reachable": peer.reachable ? "true" : "false",
								"data-drop": dropTarget === peer.fingerprint ? "true" : "false",
								disabled: !peer.reachable || sending,
								onDragOver: (event) => {
									if (!peer.reachable) return;
									event.preventDefault();
									event.dataTransfer.dropEffect = "copy";
									onDragOverTile(peer.fingerprint);
								},
								onDragLeave: () => {
									onDragOverTile(void 0);
								},
								onDrop: (event) => {
									onDropOnTile(peer, event);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-tileMark",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeviceIcon, {
										type: peer.deviceType,
										size: 18
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dls-tileBody",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dls-tileName",
										"data-dropLabel": t("dropToSend"),
										children: peer.alias
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dls-tileMeta",
										children: sending ? t("sendingTo", { alias: peer.alias }) : peer.reachable ? `${deviceTypeLabel(t, peer.deviceType)} · ${peer.address}` : `${t("unreachable")}${age === void 0 ? "" : ` · ${age}`}`
									})]
								})]
							}, peer.fingerprint);
						})
					}),
					dragging && peers.some((peer) => peer.reachable) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dls-note",
						children: t("dropHint")
					}) : null
				]
			});
		}
		/** The label for one device class, falling back for an unknown one. */
		function deviceTypeLabel(t, type) {
			return t(`deviceType.${type ?? "unknown"}`);
		}
		/** An offer waiting on the reader. */
		function IncomingOffer({ transfer, busy, t, onAnswer }) {
			const count = transfer.files.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-incoming",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-incomingHead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-incomingTitle",
						children: [count === 1 ? t("incomingFromOne", { alias: transfer.peerAlias }) : t("incomingFrom", {
							alias: transfer.peerAlias,
							count
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-count",
							children: t("incomingTotal", { size: formatBytes(transfer.bytesTotal) })
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-rowActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-action",
							"data-tone": "primary",
							disabled: busy,
							onClick: () => {
								onAnswer(true);
							},
							children: t("accept")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-action",
							disabled: busy,
							onClick: () => {
								onAnswer(false);
							},
							children: t("decline")
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "dls-incomingFiles",
					children: transfer.files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: "dls-incomingFile",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-incomingName",
							children: shortenFileName(file.fileName, 64)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-incomingSize",
							children: formatBytes(file.size)
						})]
					}, file.id))
				})]
			});
		}
		/** Sending files that already exist on this machine, by path. */
		function PathsSender({ peers, busy, t, inspectPaths, onSend }) {
			const [text, setText] = (0, react.useState)("");
			const [peer, setPeer] = (0, react.useState)("");
			const [problem, setProblem] = (0, react.useState)(void 0);
			const usable = peers.filter((candidate) => candidate.reachable);
			const chosen = peer.length > 0 ? peer : usable[0]?.fingerprint ?? "";
			const submit = async () => {
				const paths = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
				if (paths.length === 0) {
					setProblem(t("pathsEmpty"));
					return;
				}
				if (chosen.length === 0) {
					setProblem(t("noPeers"));
					return;
				}
				const bad = (await inspectPaths(paths)).filter((candidate) => candidate.directory);
				if (bad.length > 0) {
					setProblem(t("pathsInvalid", { list: bad.map((candidate) => candidate.name).join("、") }));
					return;
				}
				setProblem(void 0);
				onSend(chosen, paths);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dls-sectionHead",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dls-sectionTitle",
						children: t("sendPaths")
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-paths",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "dls-textarea",
							value: text,
							placeholder: t("pathsPlaceholder"),
							spellCheck: false,
							onChange: (event) => {
								setText(event.target.value);
							}
						}),
						problem !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-note",
							"data-tone": "error",
							children: problem
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dls-pathsRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "dls-input",
								value: chosen,
								onChange: (event) => {
									setPeer(event.target.value);
								},
								children: [usable.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("noPeers")
								}) : null, usable.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: candidate.fingerprint,
									children: candidate.alias
								}, candidate.fingerprint))]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "primary",
								disabled: busy !== void 0 || chosen.length === 0,
								onClick: () => {
									submit();
								},
								children: t("pathsSend")
							})]
						})
					]
				})]
			});
		}
		/** Every transfer this session has seen. */
		function Transfers({ transfers, busyAction, t, now, onAddToConversation, onReveal }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dls-sectionHead",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-sectionTitle",
						children: [t("transfers"), transfers.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-count",
							children: transfers.length
						}) : null]
					})
				}), transfers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-empty",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dls-emptyTitle",
						children: t("noTransfers")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dls-emptyHint",
						children: t("noTransfersHint")
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dls-rows",
					children: transfers.map((transfer) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TransferLine, {
						transfer,
						busyAction,
						t,
						now,
						onAddToConversation,
						onReveal
					}, transfer.id))
				})]
			});
		}
		/** One transfer, with its progress as its own left edge. */
		function TransferLine({ transfer, busyAction, t, now, onAddToConversation, onReveal }) {
			const percent = percentOf(transfer.bytesDone, transfer.bytesTotal);
			const incoming = transfer.direction === "incoming";
			const [open, setOpen] = (0, react.useState)(false);
			const done = transfer.status === "done" || transfer.status === "partial";
			const single = transfer.files.length === 1 ? transfer.files[0] : void 0;
			const meta = (0, react.useMemo)(() => {
				const size = transfer.bytesTotal > 0 ? formatBytes(transfer.bytesTotal) : "";
				if (transfer.status === "transferring") return `${formatBytes(transfer.bytesDone)} / ${size} · ${String(percent)}%`;
				if (transfer.status === "done") return size;
				return [size, formatAge(transfer.updatedAt, now)].filter((part) => part !== void 0 && part.length > 0).join(" · ");
			}, [
				transfer,
				percent,
				now
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dls-row",
				"data-status": transfer.status,
				"data-direction": transfer.direction,
				style: { "--dls-fill": percent / 100 },
				role: "group",
				"aria-label": `${incoming ? t("directionIn") : t("directionOut")} ${transfer.peerAlias}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dls-rowMark",
						children: incoming ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReceiveIcon, { size: 15 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SendIcon, { size: 15 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-rowBody",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dls-rowTitle",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dls-rowPeer",
									children: [
										incoming ? t("directionIn") : t("directionOut"),
										" ",
										transfer.peerAlias
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-rowStatus",
									children: statusLabel(t, transfer)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dls-rowMeta",
								children: [
									transfer.files.length > 1 ? `${fileCountLabel(t, transfer.files.length)} · ` : "",
									meta,
									transfer.error === void 0 ? "" : ` · ${transfer.error}`
								]
							}),
							open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileBreakdown, {
								files: transfer.files,
								t,
								onAddToConversation: incoming ? onAddToConversation : void 0
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-rowActions",
						children: [
							transfer.files.length > 1 || transfer.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								onClick: () => {
									setOpen((value) => !value);
								},
								children: transfer.files.length > 1 ? fileCountLabel(t, transfer.files.length) : t("fileStatus.failed")
							}) : null,
							done && incoming && single?.savedPath !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "primary",
								disabled: busyAction !== void 0,
								title: t("addToConversationHint"),
								onClick: () => {
									onAddToConversation(single.savedPath);
								},
								children: t("addToConversation")
							}) : null,
							done && incoming && transfer.files.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								onClick: () => {
									setOpen(true);
								},
								children: t("addToConversation")
							}) : null,
							single?.savedPath !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								title: t("reveal"),
								disabled: busyAction !== void 0,
								onClick: () => {
									onReveal(single.savedPath);
								},
								children: incoming && !done ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, { size: 13 })
							}) : null
						]
					})
				]
			});
		}
		/**
		* The per-file lines inside an expanded transfer.
		*
		* A batch of twenty files cannot put twenty buttons on one row, so the row's
		* action opens this list and each saved file carries its own reference action.
		* `onAddToConversation` is absent for an outgoing transfer, where there is
		* nothing on this machine to reference.
		*/
		function FileBreakdown({ files, t, onAddToConversation }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: "dls-fileList",
				children: files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: "dls-fileRow",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dls-fileName",
						children: shortenFileName(file.fileName, 52)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-fileActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-fileNote",
							"data-tone": file.error === void 0 ? "plain" : "error",
							children: file.error ?? (file.status === "done" ? formatBytes(file.size) : t(`fileStatus.${file.status}`))
						}), onAddToConversation !== void 0 && file.savedPath !== void 0 && file.status === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-action",
							"data-tone": "quiet",
							title: t("addToConversationHint"),
							onClick: () => {
								onAddToConversation(file.savedPath);
							},
							children: t("addToConversation")
						}) : null]
					})]
				}, file.id))
			});
		}
		/** The localized status of a transfer. */
		function statusLabel(t, transfer) {
			return t(`status.${transfer.status}`);
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Copy dictionaries for the Nearby transfer panel.
		*
		* Every user-visible string on the panel lives here, in both shipped locales:
		* the panel renders no literal of its own, so adding a language is a dictionary
		* registration rather than a component change. Figures are not copy, so they are
		* formatted by `format.ts` against the active locale instead — a translated
		* string wraps a number, it never renders one.
		*
		* Keys are flat and the values are strings, because that is the shape the
		* locale runtime's dictionary contract requires; the dotted keys are the
		* grouping, and the `status.` / `fileStatus.` families are looked up by
		* concatenation from a state name the panel already has.
		*
		* Placeholders are `{name}`; the runtime substitutes them by name and leaves an
		* unknown name in place, so a template's contract is its own keys.
		*
		* @module dsh-local-send/client/locales
		*/
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			nav: "隔空传文件",
			heading: "隔空传文件",
			subtitle: "在同一网络内与其他设备互传文件",
			thisDevice: "本机",
			rename: "改名",
			renamePlaceholder: "设备名称",
			save: "保存",
			cancel: "取消",
			serving: "可被接收",
			notServing: "未能监听端口，暂时收不到文件",
			addressLabel: "地址",
			noAddress: "未连接到网络",
			nearby: "附近设备",
			rescan: "搜索",
			scanning: "正在搜索同一网络内的设备…",
			noPeers: "还没有发现其他设备",
			noPeersHint: "请确认对方也打开了 LocalSend 或本插件，并与本机连在同一个网络。",
			unreachable: "无法连接",
			scanFound: "找到 {count} 台设备",
			scanEmpty: "没有找到新设备",
			"deviceType.mobile": "手机",
			"deviceType.desktop": "电脑",
			"deviceType.web": "浏览器",
			"deviceType.headless": "终端",
			"deviceType.server": "服务器",
			"deviceType.unknown": "设备",
			dropToSend: "松手即发送",
			dropHint: "把文件拖到设备上即可发送",
			sendingTo: "正在发送到 {alias}",
			sendFiles: "选择文件发送",
			sendPaths: "按路径发送",
			pathsPlaceholder: "每行一个绝对路径",
			pathsSend: "发送这些文件",
			pathsEmpty: "请先填写至少一个文件路径",
			pathsInvalid: "这些路径不可用：{list}",
			incomingTitle: "有设备想发送文件",
			incomingFrom: "{alias} 想发送 {count} 个文件",
			incomingFromOne: "{alias} 想发送 1 个文件",
			incomingTotal: "共 {size}",
			accept: "接收",
			decline: "拒绝",
			transfers: "传输记录",
			noTransfers: "还没有传输记录",
			noTransfersHint: "发送或接收文件后，记录会显示在这里。",
			directionIn: "来自",
			directionOut: "发往",
			filesCount: "{count} 个文件",
			filesCountOne: "1 个文件",
			"status.awaiting": "等待确认",
			"status.transferring": "传输中",
			"status.done": "已完成",
			"status.partial": "部分完成",
			"status.failed": "失败",
			"status.declined": "已拒绝",
			"status.canceled": "已取消",
			"fileStatus.offered": "待接收",
			"fileStatus.transferring": "传输中",
			"fileStatus.done": "已完成",
			"fileStatus.failed": "失败",
			"fileStatus.declined": "已拒绝",
			addToConversation: "加入会话",
			addedToConversation: "已加入输入框",
			addToConversationHint: "在输入框中插入该文件的引用，让当前会话可以读取它",
			noSession: "请先打开一个会话",
			reveal: "在文件夹中显示",
			savedTo: "已保存到 {path}",
			errorGeneric: "操作失败：{message}",
			errorOffline: "无法连接到插件后台，请确认插件已加载。",
			retry: "重试",
			dismiss: "知道了"
		};
		/** English dictionary. */
		const en = {
			nav: "Nearby transfer",
			heading: "Nearby transfer",
			subtitle: "Send files to other devices on this network",
			thisDevice: "This device",
			rename: "Rename",
			renamePlaceholder: "Device name",
			save: "Save",
			cancel: "Cancel",
			serving: "Ready to receive",
			notServing: "Not listening, so it cannot receive right now",
			addressLabel: "Address",
			noAddress: "Not connected to a network",
			nearby: "Nearby",
			rescan: "Search",
			scanning: "Looking for devices on this network…",
			noPeers: "No other devices yet",
			noPeersHint: "Make sure the other device has LocalSend or this plugin open, on the same network as this machine.",
			unreachable: "Not answering",
			scanFound: "Found {count} devices",
			scanEmpty: "No new devices found",
			"deviceType.mobile": "Phone",
			"deviceType.desktop": "Computer",
			"deviceType.web": "Browser",
			"deviceType.headless": "Terminal",
			"deviceType.server": "Server",
			"deviceType.unknown": "Device",
			dropToSend: "Drop to send",
			dropHint: "Drag files onto a device to send them",
			sendingTo: "Sending to {alias}",
			sendFiles: "Choose files",
			sendPaths: "Send by path",
			pathsPlaceholder: "One absolute path per line",
			pathsSend: "Send these files",
			pathsEmpty: "Enter at least one file path",
			pathsInvalid: "These paths are unusable: {list}",
			incomingTitle: "A device wants to send you files",
			incomingFrom: "{alias} wants to send {count} files",
			incomingFromOne: "{alias} wants to send 1 file",
			incomingTotal: "{size} in total",
			accept: "Receive",
			decline: "Decline",
			transfers: "Transfers",
			noTransfers: "No transfers yet",
			noTransfersHint: "Files you send or receive will be listed here.",
			directionIn: "From",
			directionOut: "To",
			filesCount: "{count} files",
			filesCountOne: "1 file",
			"status.awaiting": "Waiting for you",
			"status.transferring": "Transferring",
			"status.done": "Done",
			"status.partial": "Partly done",
			"status.failed": "Failed",
			"status.declined": "Declined",
			"status.canceled": "Canceled",
			"fileStatus.offered": "Waiting",
			"fileStatus.transferring": "Transferring",
			"fileStatus.done": "Done",
			"fileStatus.failed": "Failed",
			"fileStatus.declined": "Declined",
			addToConversation: "Add to conversation",
			addedToConversation: "Added to the composer",
			addToConversationHint: "Insert a reference to this file so the current conversation can read it",
			noSession: "Open a conversation first",
			reveal: "Show in folder",
			savedTo: "Saved to {path}",
			errorGeneric: "That did not work: {message}",
			errorOffline: "Cannot reach the plugin host. Check that the plugin is loaded.",
			retry: "Retry",
			dismiss: "Dismiss"
		};
		//#endregion
		//#region src/client/ReceiveToast.tsx
		/**
		* The receive notification.
		*
		* An offer is the one thing this plugin has to say to somebody who is not
		* looking at it: the sender is holding a connection open and a person has to
		* answer. So this lives in the frame-wide overlay rather than in the panel, and
		* it fires wherever the user happens to be — including inside a conversation
		* with the transfer panel nowhere on screen.
		*
		* It is the product's own `Toast` primitive rather than a bespoke surface,
		* because a notification that looked unlike every other notification in the
		* window would read as an interruption instead of as the application talking. It
		* also portals itself to the document body, which is what lets it escape the
		* overlay layer's own box.
		*
		* The hold is deliberately long. The host gives a sender ninety seconds before
		* answering for the user, and a toast that vanished after the usual three would
		* take the only Accept button with it while the offer was still live.
		*
		* @module dsh-local-send/client/ReceiveToast
		*/
		/**
		* How long the notification stays before fading.
		*
		* Longer than the host's own ninety-second window would be pointless — by then
		* the offer has already been refused — and shorter would drop it while it still
		* mattered. See the module note.
		*/
		const HOLD_MS = 85e3;
		/**
		* Show one notification per offer that is waiting.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function ReceiveToast(props) {
			const { t, store, answer } = props;
			const read = useTransferState(store);
			const [busy, setBusy] = (0, react.useState)(false);
			/** The offer this notification is currently for, so a new one restarts it. */
			const [shown, setShown] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => store.retain(), [store]);
			const waiting = read.status === "ready" ? read.state.transfers.find((transfer) => transfer.direction === "incoming" && transfer.status === "awaiting") : void 0;
			(0, react.useEffect)(() => {
				setShown(waiting?.id);
				setBusy(false);
			}, [waiting?.id]);
			const decide = (0, react.useCallback)((accept) => {
				if (waiting === void 0) return;
				setBusy(true);
				answer(waiting.id, accept).then(() => {
					store.refresh();
				}, () => {
					setBusy(false);
				});
			}, [
				waiting,
				answer,
				store
			]);
			if (waiting === void 0 || shown !== waiting.id) return null;
			const count = waiting.files.length;
			const summary = count === 1 ? t("incomingFromOne", { alias: waiting.peerAlias }) : t("incomingFrom", {
				alias: waiting.peerAlias,
				count
			});
			const detail = `${count === 1 ? waiting.files[0]?.fileName ?? "" : t("filesCount", { count })} · ${t("incomingTotal", { size: formatBytes(waiting.bytesTotal) })}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: `${summary} — ${detail}`,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReceiveIcon, { size: 18 }),
				holdMs: HOLD_MS,
				actions: [{
					label: busy ? t("accept") : t("accept"),
					onClick: () => {
						decide(true);
					}
				}, {
					label: t("decline"),
					onClick: () => {
						decide(false);
					}
				}],
				onDone: () => {
					setShown(void 0);
				}
			}, waiting.id);
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* The panel's stylesheet, injected once when the plugin loads.
		*
		* Three decisions here are load-bearing rather than cosmetic:
		*
		* 1. **A transfer row's progress is its own left edge.** Every row carries a
		*    two-pixel rail whose filled portion is the bytes moved, drawn from a custom
		*    property the component sets. Progress is therefore structure — it reads at
		*    a glance down the column, it survives a row being narrow, and it needs no
		*    second element competing with the file name for the same line.
		* 2. **Every live figure uses tabular numerals.** A byte count that reflows as
		*    it climbs drags the eye to itself and shifts everything beside it; fixed
		*    advance widths keep a transferring row still while its numbers change. This
		*    is the one place the sheet reaches for a typographic detail, and it is a
		*    functional one.
		* 3. **Colour comes from the product's own tokens, never from a literal.** The
		*    panel is a guest in this window and should follow it into dark mode, into a
		*    different accent, and into a reader's own contrast settings. The handful of
		*    `color-mix` calls are all derived from those tokens for the same reason.
		*
		* The class prefix is `dls-`, and selectors stay flat and single-class so no two
		* rules can cancel each other out through specificity.
		*
		* @module dsh-local-send/client/styles
		*/
		/** Element id marking this plugin's injected style tag. */
		const STYLE_ID = "dsh-local-send/styles";
		/** The complete stylesheet, scoped by the `dls-` class prefix. */
		const styles = String.raw`
/* The panel is both the column and the scroll container, the shape every
 * main-slot panel in this product uses: the main column is itself a column
 * flexbox with 'overflow: hidden', so a panel that clips its own overflow is
 * simply cut off. Centring comes from 'align-items: center' plus a per-child
 * width rather than 'margin-inline: auto', which would turn each child into a
 * fit-content box and pin a wide grid to its own overflow. */
.dls-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  block-size: 100%;
  min-block-size: 0;
  overflow: auto;
  padding: 24px clamp(20px, 3.4vw, 40px) 44px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}

.dls-panel > * {
  inline-size: 100%;
  max-inline-size: 1040px;
}

.dls-stack {
  display: flex;
  flex-direction: column;
  gap: 26px;
}

/* ---------------------------------------------------------------- header -- */

.dls-header {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 20px;
  align-items: flex-start;
  justify-content: space-between;
}

.dls-heading {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.dls-subtitle {
  margin: 5px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

/* The identity strip: where this device can be reached, and how to change the
 * name it announces. Laid out as a row of labelled facts rather than a card,
 * because there are three of them and a card would be mostly padding. */
.dls-identity {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 22px;
  align-items: baseline;
  margin-block-start: 12px;
}

.dls-fact {
  display: flex;
  gap: 7px;
  align-items: baseline;
  min-inline-size: 0;
  font-size: 12.5px;
}

.dls-factKey {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
}

.dls-factValue {
  min-inline-size: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A dot whose only job is to say whether this device can be reached at all. */
.dls-state {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary);
}

.dls-state::before {
  content: '';
  inline-size: 6px;
  block-size: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
}

.dls-state[data-ok='true']::before {
  background: var(--dsw-alias-state-success-primary);
}

/* --------------------------------------------------------------- section -- */

.dls-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dls-sectionHead {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-block-size: 26px;
}

.dls-sectionTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}

.dls-count {
  margin-inline-start: 7px;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

/* ---------------------------------------------------------------- peers -- */

/* The grid is the panel's one bold surface: each tile is a drop target, so the
 * layout is sized for a deliberate throw of a file rather than for a list. */
.dls-peers {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
}

.dls-tile {
  display: flex;
  gap: 11px;
  align-items: center;
  padding: 12px 13px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease;
}

.dls-tile:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dls-tile:disabled {
  cursor: default;
  opacity: 0.62;
}

/* The drop state has to be unmistakable at arm's length: a file is about to be
 * sent to this device specifically, and a hover-weight change would not say
 * which tile the pointer is over while the whole panel is dimmed. */
.dls-tile[data-drop='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover-accent);
  transform: scale(1.015);
}

.dls-tile[data-drop='true'] .dls-tileName::after {
  content: ' · ' attr(data-dropLabel);
  color: var(--dsw-alias-brand-text);
  font-weight: 500;
}

.dls-tileMark {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  inline-size: 34px;
  block-size: 34px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}

.dls-tileBody {
  min-inline-size: 0;
}

.dls-tileName {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-tileMeta {
  margin-block-start: 2px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A peer that announced itself but never answered. It stays in the list because
 * its presence is real information; it is dimmed and inert because a send to it
 * can only fail. */
.dls-tile[data-reachable='false'] .dls-tileMark {
  color: var(--dsw-alias-state-warn-primary);
}

/* -------------------------------------------------------------- incoming -- */

/* The one thing on this panel that is waiting on the reader, so it is the one
 * thing drawn with a filled surface instead of a hairline. */
.dls-incoming {
  padding: 14px 15px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-lg, 12px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, var(--dsw-alias-bg-layer-1));
}

.dls-incomingHead {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
  justify-content: space-between;
}

.dls-incomingTitle {
  font-size: 13.5px;
  font-weight: 600;
}

.dls-incomingFiles {
  margin-block-start: 10px;
  padding: 0;
  list-style: none;
}

.dls-incomingFile {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  padding-block: 3px;
  font-size: 12.5px;
}

.dls-incomingName {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-incomingSize {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------------- transfers -- */

.dls-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* The rail is this row's progress. '--dls-fill' is set by the component as a
 * percentage; a row with nothing to show passes 0 and reads as a plain rule. */
.dls-row {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 11px 10px 11px 15px;
  border-radius: 9px;
  transition: background-color 120ms ease;
}

.dls-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dls-row::before,
.dls-row::after {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inline-size: 2px;
  border-radius: 2px;
}

.dls-row::before {
  inset-block: 8px;
  background: var(--dsw-alias-border-l2);
}

.dls-row::after {
  inset-block-start: 8px;
  block-size: calc((100% - 16px) * var(--dls-fill, 0));
  background: var(--dsw-alias-brand-primary);
  transition: block-size 260ms linear, background-color 200ms ease;
}

.dls-row[data-status='done']::after {
  background: var(--dsw-alias-state-success-primary);
}

.dls-row[data-status='failed']::after {
  background: var(--dsw-alias-state-error-primary);
}

.dls-row[data-status='declined']::after,
.dls-row[data-status='canceled']::after {
  background: var(--dsw-alias-label-tertiary);
}

/* A transfer still moving gets a soft pulse on the rail's leading edge, which is
 * the only motion on the panel that is not a response to something the reader
 * did. It is the one piece of information worth drawing attention to. */
.dls-row[data-status='transferring']::after {
  animation: dls-pulse 1.8s ease-in-out infinite;
}

@keyframes dls-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.dls-rowMark {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  inline-size: 26px;
  block-size: 26px;
  color: var(--dsw-alias-label-tertiary);
}

.dls-row[data-direction='incoming'] .dls-rowMark {
  color: var(--dsw-alias-brand-text);
}

.dls-rowBody {
  flex: 1;
  min-inline-size: 0;
}

.dls-rowTitle {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-inline-size: 0;
}

.dls-rowPeer {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-rowStatus {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
}

.dls-row[data-status='failed'] .dls-rowStatus {
  color: var(--dsw-alias-state-error-primary);
}

.dls-row[data-status='done'] .dls-rowStatus {
  color: var(--dsw-alias-state-success-primary);
}

.dls-rowMeta {
  margin-block-start: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.dls-rowActions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
}

/* Files inside an expanded row. Indented to the rail's inner edge so the
 * nesting is legible without a second rule. */
.dls-fileList {
  margin: 6px 0 0;
  padding: 0 0 0 15px;
  list-style: none;
}

.dls-fileRow {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  padding-block: 2.5px;
  font-size: 12px;
}

.dls-fileName {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-fileNote {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dls-fileNote[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
}

/* Size and action share the right-hand cell of a file line, so a long error
 * message wraps against the button rather than pushing it off the row. */
.dls-fileActions {
  display: inline-flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: baseline;
}

/* --------------------------------------------------------------- actions -- */

.dls-action {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 5px 11px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 130ms ease, background-color 130ms ease, color 130ms ease;
}

.dls-action:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dls-action:disabled {
  cursor: default;
  opacity: 0.5;
}

.dls-action[data-tone='primary'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 500;
}

.dls-action[data-tone='primary']:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
  color: var(--dsw-alias-label-primary-foreground);
}

.dls-action[data-tone='quiet'] {
  padding: 4px 7px;
  border-color: transparent;
}

.dls-action[data-tone='quiet']:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l2);
}

/* ----------------------------------------------------------- path sender -- */

.dls-paths {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}

.dls-textarea {
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: 68px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
}

.dls-textarea:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  outline: none;
}

.dls-input {
  box-sizing: border-box;
  padding: 5px 9px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}

.dls-input:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  outline: none;
}

.dls-pathsRow {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

/* ------------------------------------------------------------ empty/hint -- */

.dls-empty {
  padding: 26px 18px;
  border: 0.5px dashed var(--dsw-alias-border-l2);
  border-radius: 10px;
  text-align: center;
}

.dls-emptyTitle {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.dls-emptyHint {
  max-inline-size: 44ch;
  margin: 5px auto 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.55;
}

/* A drag in progress dims everything that cannot receive it, so the tiles that
 * can stand out without any of them having to move. */
.dls-panel[data-dragging='true'] .dls-tile[data-reachable='false'],
.dls-panel[data-dragging='true'] .dls-row,
.dls-panel[data-dragging='true'] .dls-empty {
  opacity: 0.45;
}

.dls-note {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dls-note[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary));
}

.dls-note[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
}

/* -------------------------------------------------------- composer entry -- */

/* The composer seat is a compact tool row, so this is a bare icon button that
 * only grows a label when it has something to say. */
.dls-composerButton {
  position: relative;
  display: inline-grid;
  place-items: center;
  inline-size: 26px;
  block-size: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.dls-composerButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dls-composerButton:disabled {
  cursor: default;
  opacity: 0.45;
}

/* A count of received files waiting, so the button is worth pressing. */
.dls-composerBadge {
  position: absolute;
  inset-block-start: -2px;
  inset-inline-end: -2px;
  min-inline-size: 13px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 13px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* The picker opens from the composer, so it is anchored above its button and
 * constrained to the viewport rather than to the panel. */
.dls-picker {
  position: fixed;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  inline-size: min(380px, calc(100vw - 24px));
  max-block-size: min(340px, 54vh);
  overflow: auto;
  padding: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 11px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2));
  box-shadow: 0 10px 34px var(--dsw-alias-bg-mask-drop);
}

.dls-pickerEmpty {
  padding: 14px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.dls-pickerRow {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.dls-pickerRow:hover,
.dls-pickerRow:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dls-pickerName {
  min-inline-size: 0;
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-pickerMeta {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------------ a11y/motion -- */

.dls-action:focus-visible,
.dls-tile:focus-visible,
.dls-composerButton:focus-visible,
.dls-input:focus-visible,
.dls-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .dls-tile,
  .dls-action,
  .dls-row,
  .dls-row::after,
  .dls-composerButton {
    transition: none;
  }

  .dls-row[data-status='transferring']::after {
    animation: none;
  }

  .dls-tile[data-drop='true'] {
    transform: none;
  }
}

@media (max-width: 560px) {
  .dls-peers {
    grid-template-columns: 1fr;
  }

  .dls-header {
    flex-direction: column;
  }
}
`;
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this panel. */
		const NS = "localSend";
		/** The id shared by the sidebar entry and the main panel it opens. */
		const PANEL_ID = "local-send";
		/** Uploads the panel runs at once, matching what the host does toward a peer. */
		const UPLOAD_CONCURRENCY = 2;
		/**
		* Services required by the slot registrations.
		*
		* `sessions` is deliberately absent: the composer hook only *reads* it, to check
		* whether a conversation is open, and a hard injection would keep this whole
		* plugin from activating in a deployment that mounted no session controller.
		* Every use below goes through {@link sessionsOf}, which tolerates its absence.
		*/
		const inject = [
			"slots",
			"locale",
			"layout"
		];
		/** Read the session service without declaring a dependency on it. */
		function sessionsOf(ctx) {
			const candidate = ctx.get("sessions");
			return candidate !== void 0 && typeof candidate.list?.getSnapshot === "function" ? candidate : void 0;
		}
		/**
		* Whether a conversation is currently open in the centre column.
		*
		* The product's own derivation: the main column retains exactly one session, and
		* that is the one a composer would be bound to. There is no selected-session
		* field to read — the selection store is private to the workspace plugin — so
		* the retention count is the contract every first-party caller uses too.
		*
		* @param ctx - client context.
		* @returns whether a session is bound to the main column.
		*/
		function hasOpenSession(ctx) {
			const sessions = sessionsOf(ctx);
			if (sessions === void 0) return false;
			return Object.values(sessions.list.getSnapshot().byId).some((row) => (row.retainedBy["mainView"] ?? 0) > 0);
		}
		/**
		* Inject this plugin's stylesheet once.
		*
		* A plugin served outside the product's build has to carry and inject its own
		* sheet; the tag is keyed so a reload replaces rather than accumulates.
		*
		* @returns the disposer that removes the tag this call installed.
		*/
		function injectStyles() {
			if (document.querySelector(`style[data-plugin-css="dsh-local-send/styles"]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-local-send";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = styles;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		/**
		* Contribute the Nearby transfer panel, its notification, and its composer hook.
		* @param ctx - Client plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-local-send: dictionaries");
			ctx.effect(() => injectStyles(), "dsh-local-send: stylesheet");
			const t = ctx.locale.bind(NS);
			const store = createTransferStore(fetchState);
			/**
			* Offer browser-held files and stream each accepted one through.
			*
			* The bytes go straight from the panel's request into the host's request to
			* the peer — see the host half's streaming route — so a dropped file is copied
			* once and never staged.
			*
			* @param peer - the peer's stable key.
			* @param files - the dropped or picked files.
			*/
			async function sendBrowserFiles(peer, files) {
				if (files.length === 0) return;
				const prepared = await prepareSend({
					peer,
					files: files.map((file, index) => ({
						id: `f${String(index + 1)}`,
						fileName: file.name,
						size: file.size
					}))
				});
				if (!prepared.accepted) return;
				const wanted = new Set(prepared.files);
				const queue = files.map((file, index) => ({
					id: `f${String(index + 1)}`,
					file
				})).filter((entry) => wanted.has(entry.id));
				let cursor = 0;
				await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
					while (cursor < queue.length) {
						const index = cursor;
						cursor += 1;
						const entry = queue[index];
						if (entry === void 0) continue;
						try {
							await streamFile(prepared.transferId, entry.id, entry.file);
						} catch (error) {}
					}
				}));
			}
			const panelFace = () => ({
				panelId: PANEL_ID,
				locale: () => ctx.locale.getLocale().active,
				store,
				sendFiles: sendBrowserFiles,
				sendLocalPaths: async (peer, paths) => {
					await sendPaths({
						peer,
						paths
					});
				},
				answer: async (transferId, accept) => {
					await decide({
						transferId,
						accept
					});
				},
				renameDevice: async (alias) => {
					await rename(alias);
				},
				scanNow: async () => await scan(),
				revealFile: async (path) => {
					await reveal(path);
				},
				inspectPaths: async (paths) => (await inspect(paths)).candidates,
				addToConversation: (path) => {
					requestReference(path);
					ctx.layout.selectPanel(null);
				}
			});
			const toastFace = () => ({
				store,
				answer: async (transferId, accept) => {
					await decide({
						transferId,
						accept
					});
				}
			});
			const composerFace = () => ({ hasSession: () => hasOpenSession(ctx) });
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: panelFace
			}, LocalSendPanel));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 20,
				label: () => t("nav"),
				locale: NS
			}, HandoffEntryIcon));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "local-send.receive-toast",
				order: 20,
				locale: NS,
				inject: toastFace
			}, ReceiveToast));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "local-send.reference",
				order: 40,
				locale: NS,
				inject: composerFace
			}, ComposerEntry));
		}
		/** The sidebar mark, sized and tinted by the sidebar itself. */
		function HandoffEntryIcon({ size }) {
			return HandoffIcon({ size });
		}
		//#endregion
		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map