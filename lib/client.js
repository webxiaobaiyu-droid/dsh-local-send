window.__ModuleLoader__.load({
	id: "dsh-local-send",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/** Exact route that stops a transfer the user no longer wants. */
		const CANCEL_PATH = "/api/dsh-local-send/cancel";
		/** Exact route that sends a settled outgoing transfer again. */
		const RETRY_PATH = "/api/dsh-local-send/retry";
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
		*
		* `fileIds` is left absent when the surface answering had no file list to show —
		* a notification with a single Accept button — which the host reads as "every
		* file its own limits left standing". An empty array means the user unticked
		* everything, and is a refusal rather than an empty transfer.
		*
		* @param request - the offer and the answer.
		* @returns whether a decision was still pending.
		*/
		async function decide(request) {
			return await post(DECIDE_PATH, request);
		}
		/**
		* Stop a transfer this device is part of.
		* @param request - the row to stop.
		*/
		async function cancelTransfer(request) {
			await post(CANCEL_PATH, request);
		}
		/**
		* Send a settled outgoing transfer again, from its files on this machine.
		* @param request - the row to send again.
		* @returns the new row the attempt was recorded as.
		*/
		async function retryTransfer(request) {
			return await post(RETRY_PATH, request);
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
		const listeners$1 = /* @__PURE__ */ new Set();
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
			for (const listener of listeners$1) listener();
		}
		/**
		* Subscribe to changes.
		* @param listener - called after every request.
		* @returns the unsubscribe function.
		*/
		function subscribeReference(listener) {
			listeners$1.add(listener);
			return () => {
				listeners$1.delete(listener);
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
		//#region src/client/reference-action.ts
		/**
		* What to do about a pending "add to conversation" request.
		*
		* The decision is separated from the component that carries it out because it is
		* the part with rules in it, and because getting it wrong is invisible: an
		* insert that happens twice appends the reference twice, and one that happens
		* when no conversation is open puts a path into a draft the user never sees. A
		* pure function is testable; a `useEffect` body is not.
		*
		* @module dsh-local-send/client/reference-action
		*/
		/**
		* Decide what to do about one pending request.
		*
		* @param pending - the path waiting to be referenced, if any.
		* @param hasSession - whether a conversation is currently bound to the composer.
		* @returns the action to take.
		*/
		function referenceAction(pending, hasSession) {
			if (pending === void 0) return { kind: "wait" };
			if (!hasSession) return { kind: "wait" };
			const mention = formatMention(pending);
			if (mention === void 0) return { kind: "drop" };
			return {
				kind: "insert",
				text: `${mention} `
			};
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
				const action = referenceAction(pending, sessionId !== void 0 && hasSession());
				if (action.kind === "wait") return;
				consumeReference();
				if (action.kind === "drop") return;
				const span = inputActions.captureInsertion();
				inputActions.insertText(action.text, span);
			}, [
				pending,
				sessionId,
				inputActions,
				hasSession
			]);
			return null;
		}
		//#endregion
		//#region src/client/context-target.ts
		/** The three conventions, as one selector, so the walk is a single `closest` call. */
		const TARGET_SELECTOR = "[data-files-path], [data-ref-chip], [data-path-label]";
		/**
		* Decide whether a candidate is shaped like a path this plugin will act on.
		*
		* This is deliberately a *shape* check and not a validation. The host is what
		* actually resolves a path — it decides whether the file exists, whether it is
		* inside the workspace, and what kind of entry it is — and no amount of
		* string-reading here can do that job. What this refuses is the
		* obviously-not-a-path: an empty or whitespace-only attribute, a relative path
		* that cannot name anything the host could send, and a value carrying a control
		* character, which is far likelier to be markup soup than a filename. Anything
		* that survives the check is handed on as-is; refusing more aggressively would
		* mean dropping real files whose names this plugin simply did not anticipate.
		*
		* @param candidate - the raw attribute or title text, before trimming.
		* @returns the trimmed path, or `undefined` when it is not path-shaped.
		*/
		function usablePath(candidate) {
			if (candidate === null || candidate === void 0) return void 0;
			const path = candidate.trim();
			if (path.length === 0) return void 0;
			if (/[\u0000-\u001f\u007f]/u.test(path)) return void 0;
			if (!path.startsWith("/") && !path.startsWith("~")) return void 0;
			return path;
		}
		/**
		* Take the `@`-reference wrapper off a chip's `title`.
		*
		* A chip's `title` is the source text the message was written with, so it is
		* `@/absolute/path` — or `@"/a path with spaces"`, because the `@` grammar ends
		* the token at the first whitespace and so quotes a path that contains any. That
		* is the same grammar `formatMention` writes on the other side (see
		* `mention.ts`); this is its reader. Exactly one pair of quotes comes off, since
		* only one pair is ever added, and a lone `"` is left alone so the shape check
		* rejects it rather than turning it into an empty path.
		*
		* @param title - the chip's `title` attribute.
		* @returns the path text with the wrapper removed, or `undefined` when absent.
		*/
		function unwrapReference(title) {
			if (title === null || title === void 0) return void 0;
			const trimmed = title.trim();
			const body = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
			if (body.length >= 2 && body.startsWith("\"") && body.endsWith("\"")) return body.slice(1, -1);
			return body;
		}
		/**
		* Work out what one element's markup says was right-clicked.
		*
		* The three conventions are tried in order of how much they actually assert.
		* Each rule only claims the element when it yields a usable path, so an element
		* that carries one convention's attribute without carrying its payload falls
		* through to the next rather than resolving to a guess. When none of them
		* yields a path — the ordinary case for a right-click anywhere else in the
		* application — the answer is `undefined` and no menu opens.
		*
		* @param marker - what the element said about itself.
		* @returns the target, or `undefined` when nothing here names a path.
		*/
		function resolveTarget(marker) {
			const fromTree = usablePath(marker.filesPath);
			if (fromTree !== void 0) return {
				path: fromTree,
				kind: marker.filesEntry === "directory" ? "folder" : "file"
			};
			if (marker.refChip === "file" || marker.refChip === "folder") {
				const fromChip = usablePath(unwrapReference(marker.title));
				if (fromChip !== void 0) return {
					path: fromChip,
					kind: marker.refChip === "folder" ? "folder" : "file"
				};
			}
			if (marker.hasPathLabel === true) {
				const fromLabel = usablePath(marker.title);
				if (fromLabel !== void 0) return {
					path: fromLabel,
					kind: "file"
				};
			}
		}
		/**
		* Read one element's markup into a marker.
		*
		* Presence of `data-path-label` is read as a non-null `getAttribute` rather than
		* with `hasAttribute`, so the adapter touches exactly one DOM method and a test
		* fake only has to answer that one. The attribute is a valueless marker in the
		* host's markup, so its value is never interpreted.
		*
		* @param element - the element the walk stopped at.
		* @returns what that element said about itself.
		*/
		function markerOf(element) {
			return {
				filesPath: element.getAttribute("data-files-path"),
				filesEntry: element.getAttribute("data-files-entry"),
				refChip: element.getAttribute("data-ref-chip"),
				hasPathLabel: element.getAttribute("data-path-label") !== null,
				title: element.getAttribute("title")
			};
		}
		/**
		* Find the nearest right-clickable target at or above an event target.
		*
		* One `closest` call over the union of the three selectors is the whole walk:
		* it stops at the innermost element matching any convention, which is the one
		* the user actually pointed at. There is no second pass further up the tree,
		* because an ancestor's path is not what was clicked, and offering it would be
		* exactly the guess this module exists to avoid.
		*
		* Everything about this function is defensive, because it runs inside a global
		* `contextmenu` listener: an exception thrown here would break right-click for
		* the entire application, not just for this plugin. So a target that is not an
		* `Element` — a shadow root being the case that actually occurs, since
		* `event.target` is retargeted to the host for a closed tree — or a node
		* detached from the document, or simply nothing, all return `undefined` instead
		* of throwing, and `undefined` means the menu does not open.
		*
		* @param target - the event's `target`, whatever it turned out to be.
		* @returns the target under that element, or `undefined` when there is none.
		*/
		function contextTargetAt(target) {
			if (typeof Element === "undefined") return void 0;
			if (!(target instanceof Element)) return void 0;
			const match = target.closest(TARGET_SELECTOR);
			return match === null ? void 0 : resolveTarget(markerOf(match));
		}
		//#endregion
		//#region src/client/flash.ts
		/** What the overlay reads. */
		let current;
		/** Source of ids. Monotonic, so a dismissal can never match a later message. */
		let nextId = 1;
		/** Everything watching for a message. */
		const listeners = /* @__PURE__ */ new Set();
		/** Tell every watcher that the message changed. */
		function announce() {
			for (const listener of listeners) listener();
		}
		/**
		* Show one confirmation, replacing whatever was on screen.
		*
		* @param key - dictionary key describing what happened.
		* @param options - placeholders for the template, and whether this is a failure.
		*/
		function flash(key, options = {}) {
			current = {
				id: nextId,
				key,
				...options.params === void 0 ? {} : { params: options.params },
				tone: options.tone ?? "info"
			};
			nextId += 1;
			announce();
		}
		/**
		* The message on screen, if any.
		* @returns the current message.
		*/
		function readFlash() {
			return current;
		}
		/**
		* Forget one message, by id.
		*
		* The id is checked rather than trusted: the surface fades on a timer, and a
		* timer that fires after a newer message has replaced this one must not take the
		* newer one down with it.
		*
		* @param id - the message that finished being shown.
		*/
		function clearFlash(id) {
			if (current?.id !== id) return;
			current = void 0;
			announce();
		}
		/**
		* Watch for messages.
		* @param listener - called whenever the message changes.
		* @returns the unsubscribe function.
		*/
		function subscribeFlash(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		//#endregion
		//#region src/client/icons.tsx
		/** Shared attributes: one weight, round joins, inherited colour. */
		const STROKE$1 = {
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
						...STROKE$1
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M20 5.5h-3.5v13H20",
						...STROKE$1
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M9 9.5h4.5",
						...STROKE$1
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M11.6 7.6 13.5 9.5l-1.9 1.9",
						...STROKE$1
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M15 14.5h-4.5",
						...STROKE$1
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M12.4 12.6 10.5 14.5l1.9 1.9",
						...STROKE$1
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
				...STROKE$1
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M10.5 18.5h3",
				...STROKE$1
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
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9 20h6",
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 16.5V20",
					...STROKE$1
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
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.5 8.5h19",
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.5 6.4h.01M8 6.4h.01",
					...STROKE$1
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
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.5 9.5 9 12l-2.5 2.5",
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M11.5 14.5H17",
					...STROKE$1
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
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "13.5",
					width: "18",
					height: "7",
					rx: "1.8",
					...STROKE$1
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6.5 7h.01M6.5 17h.01",
					...STROKE$1
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
					...STROKE$1
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m6.5 10.5 5.5-5.5 5.5 5.5",
					...STROKE$1
				})]
			});
		}
		/** An arrow arriving at a device: this file is coming in. */
		function ReceiveIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 5v14",
					...STROKE$1
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m6.5 13.5 5.5 5.5 5.5-5.5",
					...STROKE$1
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
					...STROKE$1
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m16 16 4 4",
					...STROKE$1
				})]
			});
		}
		/** A folder, for revealing a saved file. */
		function FolderIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3 7.5A2 2 0 0 1 5 5.5h3.6l1.8 2.2H19a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
					...STROKE$1
				})
			});
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
		function describe$3(error) {
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
						message: describe$3(error)
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
							message: describe$3(error)
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
		//#region src/client/ContextSendMenu.tsx
		/**
		* The "send this file to…" menu, opened where the user right-clicked.
		*
		* DSH has no plugin-extensible context menu, so this is not an item added to
		* somebody else's menu: it is a listener on the document plus a menu of this
		* plugin's own, and the whole feature rests on one property — **it must be
		* invisible everywhere it does not apply.** So the listener resolves a target
		* first (`context-target.ts`) and returns without touching the event when there
		* is none. Only a right-click that landed on a path this plugin can actually act
		* on has its default suppressed and a menu drawn over it.
		*
		* That is why this lives in the frame-wide overlay rather than beside the panel:
		* the file tree, the document preview, and a sent message are three different
		* parts of the window owned by three different packages, and the only place they
		* have in common is the document.
		*
		* Three decisions worth stating:
		*
		* - **The menu closes before the transfer starts.** The host runs a path send to
		*   completion before it answers, so a menu left open across a large file would
		*   look like a hang. The transfer then reports itself through the notification
		*   surface — first as "sending", then as the outcome — which is also what
		*   `flash.ts` exists for.
		* - **A folder is offered nothing to send.** The protocol and the host's own
		*   resolution both work in files, so the send rows are replaced by a line
		*   saying so rather than by a round trip that comes back as an error. Adding a
		*   folder to the conversation is still offered, because that one works.
		* - **"Show in folder" appears only for a file this device received.** The host
		*   route deliberately refuses anything outside the receive directory — it
		*   spawns a process with the path as an argument — so offering the row for an
		*   arbitrary workspace file would be offering a button whose only outcome is a
		*   403.
		*
		* @module dsh-local-send/client/ContextSendMenu
		*/
		/** One line describing an error, for a message. */
		function describe$2(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Whether a path looks like it is inside the receive directory.
		*
		* A string prefix check rather than the host's own resolution, and deliberately
		* so: this only decides whether the row is *offered*, and the host re-checks for
		* real before it runs anything. A check here that tried to be authoritative
		* would be a second implementation of a security decision, which is the one
		* thing it must not be.
		*
		* @param path - the candidate absolute path.
		* @param inbox - the receive directory, when the state has been read.
		* @returns whether the row is worth offering.
		*/
		function looksReceived(path, inbox) {
			if (inbox === void 0 || inbox.length === 0) return false;
			return path.startsWith(`${inbox.replace(/\/+$/u, "")}/`);
		}
		/**
		* Listen for a right-click on a file, and offer to send it.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function ContextSendMenu(props) {
			const { t, store, sendLocalPaths, revealFile, addToConversation } = props;
			const read = useTransferState(store);
			/** Where the menu was asked for, and what was under the pointer. */
			const [at, setAt] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				const onContextMenu = (event) => {
					const target = contextTargetAt(event.target);
					if (target === void 0) return;
					event.preventDefault();
					setAt({
						x: event.clientX,
						y: event.clientY,
						target
					});
				};
				document.addEventListener("contextmenu", onContextMenu);
				return () => {
					document.removeEventListener("contextmenu", onContextMenu);
				};
			}, []);
			const close = (0, react.useCallback)(() => {
				setAt(void 0);
			}, []);
			/**
			* Send the file to one device.
			*
			* @param peer - the device to send to.
			*/
			const send = (0, react.useCallback)((peer) => {
				const path = at?.target.path;
				if (path === void 0) return;
				close();
				flash("menuSending", { params: { alias: peer.alias } });
				sendLocalPaths(peer.fingerprint, [path]).then((state) => {
					store.refresh();
					const failed = state.failed[0];
					if (failed !== void 0) {
						flash("menuSendFailed", {
							params: { message: failed.reason },
							tone: "error"
						});
						return;
					}
					flash("menuSent", { params: { alias: peer.alias } });
				}, (error) => {
					flash("menuSendFailed", {
						params: { message: describe$2(error) },
						tone: "error"
					});
				});
			}, [
				at,
				close,
				sendLocalPaths,
				store
			]);
			const copy = (0, react.useCallback)(() => {
				const path = at?.target.path;
				close();
				if (path === void 0) return;
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(path).then((copied) => {
					if (copied) flash("menuCopied");
					else flash("menuCopyFailed", { tone: "error" });
				});
			}, [at, close]);
			const add = (0, react.useCallback)(() => {
				const path = at?.target.path;
				close();
				if (path === void 0) return;
				addToConversation(path);
			}, [
				at,
				close,
				addToConversation
			]);
			const reveal = (0, react.useCallback)(() => {
				const path = at?.target.path;
				close();
				if (path === void 0) return;
				revealFile(path).then(() => {}, (error) => {
					flash("menuSendFailed", {
						params: { message: describe$2(error) },
						tone: "error"
					});
				});
			}, [
				at,
				close,
				revealFile
			]);
			const peers = read.status === "ready" ? read.state.peers.filter((peer) => peer.reachable) : [];
			const inbox = read.status === "ready" ? read.state.inbox : void 0;
			const folder = at?.target.kind === "folder";
			const items = [];
			items.push({
				type: "label",
				id: "send-label",
				text: t("menuSendTo")
			});
			if (folder) items.push({
				id: "send-folder",
				label: t("menuFoldersUnsupported"),
				disabled: true
			});
			else if (peers.length === 0) items.push({
				id: "send-none",
				label: t("menuNoPeers"),
				disabled: true
			});
			else for (const peer of peers) items.push({
				id: `send:${peer.fingerprint}`,
				label: peer.alias,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeviceIcon, {
					type: peer.deviceType,
					size: 15
				})
			});
			items.push({
				type: "separator",
				id: "sep-actions"
			});
			items.push({
				id: "add",
				label: t("addToConversation"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HandoffIcon, { size: 15 })
			});
			if (at !== void 0 && looksReceived(at.target.path, inbox)) items.push({
				id: "reveal",
				label: t("reveal")
			});
			items.push({
				type: "separator",
				id: "sep-copy"
			});
			items.push({
				id: "copy",
				label: t("menuCopyPath")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: at !== void 0,
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dls-menuAnchor" }),
				items,
				onSelect: (id) => {
					if (id === "add") {
						add();
						return;
					}
					if (id === "copy") {
						copy();
						return;
					}
					if (id === "reveal") {
						reveal();
						return;
					}
					if (!id.startsWith("send:")) return;
					const peer = peers.find((candidate) => candidate.fingerprint === id.slice(5));
					if (peer !== void 0) send(peer);
				},
				onClose: close,
				portal: true,
				getAnchorRect: () => at === void 0 ? null : new DOMRect(at.x, at.y, 0, 0),
				className: "dls-menu"
			});
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
		//#region src/client/companion.ts
		/**
		* How long a finished transfer keeps the companion's attention.
		*
		* Deliberately short — about two polls — because the state is what expires it:
		* the store re-renders on its own cadence and this window is measured against
		* the clock at render time, so no timer of this module's own is involved.
		*/
		const AFTERGLOW_MS = 8e3;
		/** The number of files an offer carries, for the label and the load. */
		function carryingOf(files) {
			if (files === 0) return "none";
			return files === 1 ? "one" : "many";
		}
		/** Whether a settled transfer is recent enough to still be worth mentioning. */
		function isFresh(transfer, now) {
			return now - transfer.updatedAt <= AFTERGLOW_MS;
		}
		/** Whether a transfer is over, whichever way it went. */
		function isSettled(transfer) {
			return transfer.status !== "transferring" && transfer.status !== "awaiting";
		}
		/**
		* Work out what the companion should be showing.
		*
		* @param read - the state as the shared store last published it.
		* @param now - the clock at render time, so the afterglow can be tested without waiting.
		* @returns the view, never undefined: the companion is present whether or not anything is happening.
		*/
		function companionView(read, now) {
			if (read.status !== "ready") return {
				visible: false,
				mood: "idle",
				carrying: "none",
				labelKey: "buddyIdleHint",
				tone: "calm"
			};
			const { transfers } = read.state;
			const offered = transfers.find((transfer) => transfer.direction === "incoming" && transfer.status === "awaiting");
			if (offered !== void 0) {
				const count = offered.files.length;
				const name = offered.files[0]?.fileName ?? "";
				return {
					mood: "offered",
					carrying: carryingOf(count),
					labelKey: count === 1 ? "buddyOfferedOne" : "buddyOffered",
					labelParams: count === 1 ? { name } : { count },
					tone: "attention",
					focus: offered,
					visible: true
				};
			}
			const moving = transfers.filter((transfer) => transfer.status === "transferring").sort((left, right) => right.updatedAt - left.updatedAt)[0];
			if (moving !== void 0) {
				const percent = percentOf(moving.bytesDone, moving.bytesTotal);
				return {
					mood: "moving",
					carrying: "none",
					progress: percent,
					labelKey: "buddyBusy",
					labelParams: { percent },
					tone: "busy",
					focus: moving,
					visible: true
				};
			}
			const settled = [...transfers].filter((transfer) => isSettled(transfer) && isFresh(transfer, now)).sort((left, right) => right.updatedAt - left.updatedAt)[0];
			if (settled !== void 0) {
				const good = settled.status === "done";
				return {
					mood: good ? "landed" : "lost",
					carrying: "none",
					labelKey: good ? "buddyDone" : "buddyFailed",
					tone: good ? "good" : "bad",
					focus: settled,
					visible: true
				};
			}
			return {
				visible: false,
				mood: "idle",
				carrying: "none",
				labelKey: "buddyIdleHint",
				tone: "calm"
			};
		}
		//#endregion
		//#region src/client/fish.tsx
		/**
		* Shared stroke attributes.
		*
		* Re-declared rather than imported from `icons.tsx` so that module stays the
		* toolbar's family and this one stays the companion's: they happen to agree
		* today, and the reason they agree is a decision written down in both places
		* rather than a shared constant either could drift from silently.
		*/
		const STROKE = {
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		/** The progress ring's radius on the 24-unit grid. */
		const RING_RADIUS = 10.5;
		/**
		* The ring's own stroke treatment.
		*
		* Apart from the family's for one reason: **a round cap renders a zero-length
		* dash as a dot.** A progress arc of nothing has to be nothing, and a ring that
		* shows a bead at 0% is claiming a transfer has started when it has not. So the
		* ring's ends are square, and the fish's lines keep the family's round caps.
		*/
		const RING_STROKE = {
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "butt",
			strokeLinejoin: "round"
		};
		/**
		* The straight-line distance around the ring the companion draws.
		*
		* Exported because two places need the same number and only one of them can
		* compute it: the component turns it into a dash offset, and a test asserts that
		* arithmetic rather than a rendered picture. A stylesheet cannot do it — `stroke-
		* dasharray` needs a length, and `100%` would be a percentage of the wrong thing.
		*
		* @param radius - the ring's radius in user units.
		* @returns the circumference.
		*/
		function fishRingCircumference(radius) {
			return 2 * Math.PI * radius;
		}
		/**
		* Clamp a progress figure into the range the ring can draw.
		*
		* A transfer whose fraction is unknowable — a total of zero bytes, a `NaN` out of
		* some division — is drawn as *not started* rather than as complete. That is the
		* honest direction to fail in: an empty ring says "nothing has moved yet", which
		* a reader can act on, while a full ring says "this is done", which they cannot.
		*
		* @param progress - the reported fraction, if any.
		* @returns a fraction between 0 and 1.
		*/
		function fractionOf(progress) {
			if (progress === void 0 || !Number.isFinite(progress)) return 0;
			return Math.min(100, Math.max(0, progress)) / 100;
		}
		/**
		* The posture, as a transform on the fish's own group.
		*
		* Tilt and lift rather than redrawn outlines: the fish is the same animal in
		* every mood, and a reader recognises it as the same thing because it is the
		* same paths. Only the angle and the height change, which is also what makes the
		* five states comparable at a glance.
		*
		* @param mood - which posture to hold.
		* @returns the SVG transform for the fish group.
		*/
		function postureOf(mood) {
			switch (mood) {
				case "offered": return "rotate(-9 12 12)";
				case "moving": return "rotate(3 12 12)";
				case "landed": return "rotate(-10 12 12) translate(0 -1)";
				case "lost": return "rotate(6 12 12) translate(0 1)";
				case "idle": return "rotate(0 12 12)";
			}
		}
		/**
		* The companion mark.
		*
		* @param props - size and class, plus the posture and what it is carrying.
		* @returns the fish, as one `<svg>`.
		*/
		function FishMark({ size = 16, className, mood, progress, carrying = "none" }) {
			const fraction = fractionOf(progress);
			const circumference = fishRingCircumference(RING_RADIUS);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				className,
				"data-fish-mood": mood,
				"aria-hidden": "true",
				focusable: "false",
				children: [
					mood === "moving" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						className: "dlsFishRingTrack",
						cx: "12",
						cy: "12",
						r: RING_RADIUS,
						...RING_STROKE
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						className: "dlsFishRing",
						cx: "12",
						cy: "12",
						r: RING_RADIUS,
						transform: "rotate(-90 12 12)",
						strokeDasharray: `${String(circumference)} ${String(circumference)}`,
						strokeDashoffset: circumference * (1 - fraction),
						...RING_STROKE
					})] }) : null,
					carrying !== "none" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						className: "dlsFishLoad",
						...STROKE,
						children: [carrying === "many" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "9.4",
							y: "3.6",
							width: "4",
							height: "4.4",
							rx: "1"
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: carrying === "many" ? 11.4 : 10.4,
							y: carrying === "many" ? 4.8 : 4.2,
							width: "4",
							height: "4.4",
							rx: "1"
						})]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						transform: postureOf(mood),
						...STROKE,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								className: "dlsFishTail",
								d: "M6 12 2.6 9.4v5.2L6 12z"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 12c0-2.6 2.7-4.6 6-4.6s6 2 6 4.6-2.7 4.6-6 4.6-6-2-6-4.6z" }),
							mood === "lost" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.4 7.9h4.2" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.6 7.9c.7-1.3 1.8-2 3-2.2" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "15.4",
								cy: "10.9",
								r: "0.85",
								fill: "currentColor",
								stroke: "none"
							})
						]
					}),
					mood === "offered" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						className: "dlsFishBubbles",
						...STROKE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "18.4",
							cy: "6.4",
							r: "0.9"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "20.6",
							cy: "3.6",
							r: "0.6"
						})]
					}) : null,
					mood === "landed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						className: "dlsFishCheck",
						d: "M15.2 4.6 16.6 6 19.4 2.8",
						...STROKE
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/FishCompanion.tsx
		/**
		* The companion: a small fish in the conversation header that is the transfer's
		* presence while the user is working.
		*
		* It exists because the two surfaces the plugin already had are both somewhere
		* else. The panel is a different screen, and the notification is a banner that
		* fades — so a transfer in flight, or one that just landed, had nothing to say
		* for itself in the place the user actually spends their time. This is that
		* place, and the mark is the answer to "is anything happening?" without opening
		* anything.
		*
		* Three decisions worth stating:
		*
		* - **It hides when there is nothing to say.** A companion that sat in the
		*   header all day would be a control with no content, beside three controls
		*   that have plenty. So idle is *absent* rather than dimmed, and the rule lives
		*   in `companion.ts` where the plugin's other rules live — it is a field on the
		*   view, not a check here. When something does happen it arrives with the news
		*   already on it, which is the part a status dot cannot do.
		* - **It never decides anything by itself.** Everything it can do — take an
		*   offer, stop a transfer, add a received file to the conversation — is one
		*   press away in its popover, and every one of those is a decision the user
		*   makes. The mark reports; it does not act.
		* - **The popover is the product's own menu.** It already carries the keyboard
		*   walk, Escape, outside-click dismissal, and focus return, and a bespoke
		*   popover in the header would have had to reimplement all four to look like the
		*   ones beside it.
		*
		* What is *not* here: a file list for an offer. That can be twenty rows, and the
		* banner above the composer and the panel both show it. The popover offers the
		* choice — take them, refuse them, go and look — and nothing more.
		*
		* @module dsh-local-send/client/FishCompanion
		*/
		/** One line describing an error, for a message. */
		function describe$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Show the companion, and offer what can be done about whatever it is showing.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function FishCompanion(props) {
			const { t, store, answer, cancel, revealFile, addToConversation, openPanel } = props;
			const read = useTransferState(store);
			const [open, setOpen] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => store.retain(), [store]);
			const view = companionView(read, Date.now());
			const focus = view.focus;
			if (!view.visible) return null;
			(0, react.useEffect)(() => {
				setBusy(false);
			}, [focus?.id, focus?.status]);
			/**
			* Run one action, keeping the popover's buttons honest about being pressed.
			*
			* @param action - what to do.
			*/
			const run = (0, react.useCallback)((action) => {
				if (busy) return;
				setBusy(true);
				action().then(() => {
					store.refresh();
					setBusy(false);
				}, (error) => {
					flash("errorGeneric", {
						params: { message: describe$1(error) },
						tone: "error"
					});
					setBusy(false);
				});
			}, [busy, store]);
			const items = [{
				type: "label",
				id: "status",
				text: t(view.labelKey, view.labelParams)
			}, {
				type: "separator",
				id: "sep"
			}];
			if (focus !== void 0 && focus.status === "awaiting") {
				items.push({
					id: "accept",
					label: t("accept"),
					disabled: busy
				});
				items.push({
					id: "decline",
					label: t("decline"),
					disabled: busy
				});
			}
			if (focus !== void 0 && focus.status === "transferring") items.push({
				id: "stop",
				label: t("stopTransfer"),
				disabled: busy,
				danger: true
			});
			if (focus !== void 0 && view.mood === "landed" && focus.direction === "incoming") {
				const saved = focus.files.filter((file) => file.status === "done" && file.savedPath !== void 0);
				if (saved.length > 0) items.push({
					id: "add",
					label: t("buddyAdd"),
					disabled: busy
				});
				if (saved.length === 1) items.push({
					id: "reveal",
					label: t("reveal"),
					disabled: busy
				});
			}
			items.push({
				type: "separator",
				id: "sep-panel"
			});
			items.push({
				id: "panel",
				label: t("openPanel")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dls-buddy",
					"data-tone": view.tone,
					"data-mood": view.mood,
					title: t(view.labelKey, view.labelParams),
					"aria-label": t("buddyLabel"),
					"aria-expanded": open,
					onClick: () => {
						setOpen((value) => !value);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FishMark, {
						size: 18,
						mood: view.mood,
						...view.progress === void 0 ? {} : { progress: view.progress },
						carrying: view.carrying
					})
				}),
				items,
				onSelect: (id) => {
					setOpen(false);
					if (focus === void 0) {
						if (id === "panel") openPanel();
						return;
					}
					if (id === "accept") {
						run(async () => {
							await answer(focus.id, true);
						});
						return;
					}
					if (id === "decline") {
						run(async () => {
							await answer(focus.id, false);
						});
						return;
					}
					if (id === "stop") {
						run(async () => {
							await cancel(focus.id);
						});
						return;
					}
					if (id === "add") {
						const path = focus.files.find((file) => file.status === "done" && file.savedPath !== void 0)?.savedPath;
						if (path !== void 0) addToConversation(path);
						return;
					}
					if (id === "reveal") {
						const path = focus.files.find((file) => file.status === "done" && file.savedPath !== void 0)?.savedPath;
						if (path !== void 0) run(async () => {
							await revealFile(path);
						});
						return;
					}
					if (id === "panel") openPanel();
				},
				onClose: () => {
					setOpen(false);
				},
				align: "end",
				portal: true,
				className: "dls-buddyMenu"
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
		* Behaviours worth stating because they are not obvious from the markup:
		*
		* - **It owns no polling.** The state arrives from a shared store that the
		*   notification and the companion also read, and the panel merely retains it
		*   while mounted. See `state.ts` for why the cadence follows the host's own work.
		* - **A drop lands on a device, and anywhere else on the panel.** The tiles are
		*   the precise targets, but dropping onto empty space used to do nothing at all,
		*   which is indistinguishable from the panel being broken — so a drop anywhere
		*   is staged, and sent straight away when there is exactly one device it could
		*   possibly mean. The counter that tracks dragging exists because `dragleave`
		*   fires when the pointer crosses into a child element, so a boolean would
		*   flicker the whole panel on every internal boundary.
		* - **A received file is offered to the conversation, not committed to it.** The
		*   "add" action leaves a reference for the composer to insert; whether to send
		*   is still the user's.
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
			const { t, store, sendFiles, sendLocalPaths, answer, cancel, retry, renameDevice, scanNow, revealFile, inspectPaths, addToConversation, hasSession } = props;
			const read = useTransferState(store);
			const [dropTarget, setDropTarget] = (0, react.useState)(void 0);
			const [dragging, setDragging] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(void 0);
			const [busyAction, setBusyAction] = (0, react.useState)(void 0);
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [showPaths, setShowPaths] = (0, react.useState)(false);
			/**
			* Files waiting for the user to say which device they are for.
			*
			* Held rather than sent because the panel cannot guess: a drop onto empty
			* space, or a file chosen from the picker, names no device at all. When there
			* is exactly one device it could possibly mean, `stageFiles` does not stage —
			* a chooser with a single option is a step that exists only to be dismissed.
			*/
			const [staged, setStaged] = (0, react.useState)(void 0);
			/** Nested drag depth; see the module note on why this is a counter. */
			const dragDepth = (0, react.useRef)(0);
			/** The hidden picker the "choose files" button drives. */
			const picker = (0, react.useRef)(null);
			(0, react.useEffect)(() => store.retain(), [store]);
			/** Run one action, surfacing its failure and clearing its busy mark. */
			const run = (0, react.useCallback)(async (key, action) => {
				setBusyAction(key);
				setNotice(void 0);
				try {
					await action();
				} catch (error) {
					setNotice({
						text: t("errorGeneric", { message: describe(error) }),
						tone: "error"
					});
				} finally {
					setBusyAction(void 0);
				}
			}, [t]);
			/** Re-read immediately, so an action's effect is on screen without waiting a tick. */
			const refresh = (0, react.useCallback)(async () => {
				await store.refresh();
			}, [store]);
			const peers = read.status === "ready" ? read.state.peers : [];
			const reachable = (0, react.useMemo)(() => peers.filter((peer) => peer.reachable), [peers]);
			/**
			* Take files the user did not aim at a particular device.
			*
			* @param files - the files, from a drop on empty space or from the picker.
			*/
			const stageFiles = (0, react.useCallback)((files) => {
				if (files.length === 0) return;
				const only = reachable.length === 1 ? reachable[0] : void 0;
				if (only !== void 0) {
					run(`send:${only.fingerprint}`, async () => {
						await sendFiles(only.fingerprint, files);
						await refresh();
					});
					return;
				}
				setStaged(files);
			}, [
				reachable,
				run,
				sendFiles,
				refresh
			]);
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
			/**
			* A drop that did not land on a device.
			*
			* Staged rather than ignored, because a drop that does nothing looks exactly
			* like a panel that is not working. See the module note.
			*
			* @param event - the drop event.
			*/
			const onDrop = (0, react.useCallback)((event) => {
				event.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				setDropTarget(void 0);
				stageFiles([...event.dataTransfer.files]);
			}, [stageFiles]);
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
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dls-action",
										"data-tone": "primary",
										disabled: busyAction !== void 0,
										onClick: () => {
											picker.current?.click();
										},
										children: t("sendFiles")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dls-action",
										"data-tone": "quiet",
										disabled: busyAction !== void 0,
										onClick: () => {
											setShowPaths((value) => !value);
										},
										children: t("sendPaths")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dls-action",
										disabled: busyAction === "scan",
										onClick: () => {
											run("scan", async () => {
												const result = await scanNow();
												setNotice({
													text: result.found > 0 ? t("scanFound", { count: result.found }) : t("scanEmpty"),
													tone: "info"
												});
											});
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, { size: 13 }), busyAction === "scan" ? t("scanning") : t("rescan")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dls-action",
										"data-tone": "quiet",
										title: t("openInbox"),
										"aria-label": t("openInbox"),
										disabled: busyAction !== void 0,
										onClick: () => {
											run("inbox", async () => {
												if (read.status !== "ready") return;
												await revealFile(read.state.inbox);
											});
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, { size: 13 })
									})
								]
							}) : null]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: picker,
							type: "file",
							multiple: true,
							className: "dls-picker",
							onChange: (event) => {
								stageFiles([...event.target.files ?? []]);
								event.target.value = "";
							}
						}),
						read.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-note",
							children: t("loading")
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
							children: warningText(t, read.state.warning)
						}) : null,
						notice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dls-note",
							"data-tone": notice.tone,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: notice.text }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								onClick: () => {
									setNotice(void 0);
								},
								children: t("dismiss")
							})]
						}) : null,
						staged !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StagedFiles, {
							files: staged,
							peers: reachable,
							busy: busyAction !== void 0,
							t,
							onCancel: () => {
								setStaged(void 0);
							},
							onSend: (peer) => {
								const files = staged;
								setStaged(void 0);
								run(`send:${peer}`, async () => {
									await sendFiles(peer, files);
									await refresh();
								});
							}
						}) : null,
						incoming.map((transfer) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IncomingOffer, {
							transfer,
							busy: busyAction === `answer:${transfer.id}`,
							t,
							onAnswer: (accept, fileIds) => {
								run(`answer:${transfer.id}`, async () => {
									await answer(transfer.id, accept, fileIds);
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
							transfers: read.state.transfers.filter((transfer) => !(transfer.direction === "incoming" && transfer.status === "awaiting")),
							busyAction,
							t,
							now: Date.now(),
							onAddToConversation: (path) => {
								if (!hasSession()) {
									setNotice({
										text: t("noSession"),
										tone: "warn"
									});
									return;
								}
								addToConversation(path);
							},
							onReveal: (path) => {
								run(`reveal:${path}`, async () => {
									await revealFile(path);
								});
							},
							onStop: (transferId) => {
								run(`stop:${transferId}`, async () => {
									await cancel(transferId);
									await refresh();
								});
							},
							onRetry: (transferId) => {
								run(`retry:${transferId}`, async () => {
									await retry(transferId);
									await refresh();
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
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dls-state",
							"data-ok": state.device.serving ? "true" : "false",
							children: [
								state.device.alias,
								" · ",
								state.device.serving ? t("serving") : t("notServing")
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dls-fact",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-factKey",
								children: t("addressLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-factValue",
								children: address === void 0 ? t("noAddress") : `${address}:${String(state.device.port)}`
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dls-fact",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-factKey",
								children: t("inboxLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-factValue",
								title: state.inbox,
								children: state.inbox
							})]
						})
					]
				})]
			});
		}
		/**
		* Files waiting for a device to be named.
		*
		* Shown instead of guessing whenever a drop or a pick could mean more than one
		* device. The devices are buttons rather than a select, because there is exactly
		* one decision to make here and a select would hide it behind a second press.
		*/
		function StagedFiles({ files, peers, busy, t, onCancel, onSend }) {
			const bytes = files.reduce((sum, file) => sum + file.size, 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section dls-staged",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-sectionHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dls-sectionTitle",
							children: [t("sendFiles"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-count",
								children: fileCountLabel(t, files.length)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-rowActions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								disabled: busy,
								onClick: onCancel,
								children: t("cancel")
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dls-note",
						children: t("incomingTotal", { size: formatBytes(bytes) })
					}),
					peers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dls-note",
						"data-tone": "warn",
						children: t("noPeers")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dls-peers",
						children: peers.map((peer) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dls-tile",
							disabled: busy,
							onClick: () => {
								onSend(peer.fingerprint);
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
									children: peer.alias
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dls-tileMeta",
									children: [
										deviceTypeLabel(t, peer.deviceType),
										" · ",
										peer.address
									]
								})]
							})]
						}, peer.fingerprint))
					})
				]
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
		/**
		* An offer waiting on the reader, file by file.
		*
		* The tick boxes are the reason this is a component rather than a paragraph: the
		* protocol carries a per-file decision and the panel is where it is made, so a
		* batch of twenty holiday photos does not force the user to take the one
		* document they did not want. Everything this device's own limits already
		* refused is listed without a box, because there is nothing left to decide.
		*/
		function IncomingOffer({ transfer, busy, t, onAnswer }) {
			const selectable = transfer.files.filter((file) => file.status === "offered");
			const [chosen, setChosen] = (0, react.useState)(() => new Set(selectable.map((file) => file.id)));
			const all = selectable.length > 0 && chosen.size === selectable.length;
			const none = chosen.size === 0;
			const toggle = (id) => {
				setChosen((previous) => {
					const next = new Set(previous);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};
			/**
			* Hand the decision up.
			*
			* Every file ticked is sent as `undefined` rather than as the full list: the
			* host has a word for "all of them" that does not depend on the panel and the
			* host agreeing about which ids exist, and this is the case it exists for.
			*/
			const submit = () => {
				if (none) return;
				onAnswer(true, all ? void 0 : [...chosen]);
			};
			const count = transfer.files.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-incoming",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								disabled: busy || none,
								onClick: submit,
								children: t("acceptSelected", { count: chosen.size })
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
					}),
					selectable.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-pickBar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-note",
								children: t("selectedOf", {
									count: chosen.size,
									total: selectable.length
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								disabled: busy || all,
								onClick: () => {
									setChosen(new Set(selectable.map((file) => file.id)));
								},
								children: t("selectAll")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								disabled: busy || none,
								onClick: () => {
									setChosen(/* @__PURE__ */ new Set());
								},
								children: t("selectNone")
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dls-incomingFiles",
						children: transfer.files.map((file) => {
							const offered = file.status === "offered";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "dls-incomingFile",
								children: [offered ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dls-tick",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: chosen.has(file.id),
										disabled: busy,
										onChange: () => {
											toggle(file.id);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dls-incomingName",
										children: shortenFileName(file.fileName, 64)
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-incomingName",
									"data-tone": "muted",
									children: shortenFileName(file.fileName, 64)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-incomingSize",
									children: offered ? formatBytes(file.size) : file.error ?? t(`fileStatus.${file.status}`)
								})]
							}, file.id);
						})
					}),
					none && selectable.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dls-note",
						"data-tone": "warn",
						children: t("noFileSelected")
					}) : null
				]
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
		function Transfers({ transfers, busyAction, t, now, onAddToConversation, onReveal, onStop, onRetry }) {
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
						onReveal,
						onStop,
						onRetry
					}, transfer.id))
				})]
			});
		}
		/**
		* One transfer, with its outcome as its own left edge.
		*
		* The rail means two different things at two different times, and conflating
		* them is what makes a progress bar lie: **while a transfer moves it is the byte
		* fraction**, and **once it has settled it is the outcome**, full height and
		* coloured by how it ended. A finished batch drawn at its byte fraction shows a
		* stub of a few percent — a picture of "barely started" for something that is
		* over.
		*
		* The meta line carries what the row is actually about, in the order a reader
		* asks: which file (or how many), how it went, how much, and when.
		*/
		function TransferLine({ transfer, busyAction, t, now, onAddToConversation, onReveal, onStop, onRetry }) {
			const incoming = transfer.direction === "incoming";
			const [open, setOpen] = (0, react.useState)(false);
			const live = transfer.status === "transferring" || transfer.status === "awaiting";
			const settled = !live;
			const percent = percentOf(transfer.bytesDone, transfer.bytesTotal);
			const single = transfer.files.length === 1 ? transfer.files[0] : void 0;
			const done = transfer.status === "done" || transfer.status === "partial";
			/** Received files that are on disk, which are the ones worth referencing. */
			const saved = transfer.files.filter((file) => file.status === "done" && file.savedPath !== void 0);
			/** A retry is only possible when the host still has the source files. */
			const retryable = settled && transfer.status !== "done" && transfer.canRetry === true;
			const busy = busyAction !== void 0;
			const meta = (0, react.useMemo)(() => {
				const parts = [];
				parts.push(single === void 0 ? fileCountLabel(t, transfer.files.length) : shortenFileName(single.fileName, 44));
				const failed = transfer.files.filter((file) => file.status === "failed").length;
				const declined = transfer.files.filter((file) => file.status === "declined").length;
				if (settled && single === void 0 && (failed > 0 || declined > 0)) parts.push(t("outcomeMixed", {
					arrived: transfer.files.filter((file) => file.status === "done").length,
					lost: failed + declined
				}));
				if (transfer.bytesTotal > 0) parts.push(transfer.status === "transferring" ? `${formatBytes(transfer.bytesDone)} / ${formatBytes(transfer.bytesTotal)} · ${String(percent)}%` : formatBytes(transfer.bytesTotal));
				if (settled) {
					const age = formatAge(transfer.updatedAt, now);
					if (age !== void 0) parts.push(age);
				}
				return parts.join(" · ");
			}, [
				transfer,
				single,
				settled,
				percent,
				now,
				t
			]);
			const fill = settled ? 1 : percent / 100;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dls-row",
				"data-status": transfer.status,
				"data-direction": transfer.direction,
				style: { "--dls-fill": fill },
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dls-rowMeta",
								children: meta
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
							transfer.files.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								"aria-expanded": open,
								onClick: () => {
									setOpen((value) => !value);
								},
								children: fileCountLabel(t, transfer.files.length)
							}) : null,
							live ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								disabled: busy,
								onClick: () => {
									onStop(transfer.id);
								},
								children: t("stopTransfer")
							}) : null,
							retryable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								title: t("retryTransferHint"),
								disabled: busy,
								onClick: () => {
									onRetry(transfer.id);
								},
								children: t("retryTransfer")
							}) : null,
							done && incoming && saved.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "primary",
								disabled: busy,
								title: t("addToConversationHint"),
								onClick: () => {
									if (single?.savedPath !== void 0) onAddToConversation(single.savedPath);
									else setOpen(true);
								},
								children: t("addToConversation")
							}) : null,
							single?.savedPath !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								title: t("reveal"),
								"aria-label": t("reveal"),
								disabled: busy,
								onClick: () => {
									onReveal(single.savedPath);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, { size: 13 })
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
		/**
		* Say one host condition in the reader's language.
		*
		* The two halves are treated differently on purpose: the clause is ours and is
		* translated, while the detail is the operating system's own message and is
		* passed through untouched — it is the string a search for the problem will
		* match, and translating it would help nobody.
		*
		* @param t - the locale seat.
		* @param warning - the structured condition.
		* @returns the sentence to show.
		*/
		function warningText(t, warning) {
			if (warning.code === "portUnavailable") return t("warning.portUnavailable", {
				port: warning.port,
				detail: warning.detail
			});
			return t("warning.discoveryUnavailable", { detail: warning.detail });
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
			incomingFromOne: "{alias} 想发送 {name}",
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
			outcomeMixed: "{arrived} 个成功，{lost} 个未完成",
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
			"fileStatus.skipped": "未选择",
			addToConversation: "加入会话",
			addedToConversation: "已加入输入框",
			addToConversationHint: "在输入框中插入该文件的引用，让当前会话可以读取它",
			noSession: "请先打开一个会话",
			reveal: "在文件夹中显示",
			savedTo: "已保存到 {path}",
			sendFilesHint: "选择本机文件，然后拖到下方设备上或直接发送",
			openInbox: "打开收件箱",
			inboxLabel: "收件箱",
			loading: "正在读取状态…",
			selectAll: "全选",
			selectNone: "全不选",
			selectedOf: "已选 {count}/{total}",
			acceptSelected: "接收所选（{count}）",
			noFileSelected: "请至少选择一个文件，或点「拒绝」",
			stopTransfer: "停止",
			retryTransfer: "重试",
			retryTransferHint: "用同样的文件再发一次",
			menuSendTo: "隔空发送到",
			menuNoPeers: "现在没有可发送的设备",
			menuFoldersUnsupported: "这个插件发送文件，不发送文件夹",
			menuCopyPath: "复制路径",
			menuCopied: "路径已复制",
			menuCopyFailed: "无法访问剪贴板",
			menuSending: "正在发送到 {alias}…",
			menuSent: "已发送到 {alias}",
			menuSendFailed: "发送失败：{message}",
			openPanel: "打开面板",
			buddyLabel: "隔空传文件",
			buddyOffered: "{count} 个文件等待确认",
			buddyOfferedOne: "{name} 等待确认",
			buddyBusy: "正在传输 · {percent}%",
			buddyDone: "刚刚完成一次传输",
			buddyFailed: "有一次传输没有完成",
			buddyIdleHint: "附近没有设备，也没有进行中的传输",
			buddyAdd: "加入会话",
			"warning.portUnavailable": "无法监听 {port} 端口，暂时收不到文件：{detail}",
			"warning.discoveryUnavailable": "设备发现已停用，看不到同一网络内的其他设备：{detail}",
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
			incomingFromOne: "{alias} wants to send {name}",
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
			outcomeMixed: "{arrived} arrived, {lost} did not",
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
			"fileStatus.skipped": "Not selected",
			addToConversation: "Add to conversation",
			addedToConversation: "Added to the composer",
			addToConversationHint: "Insert a reference to this file so the current conversation can read it",
			noSession: "Open a conversation first",
			reveal: "Show in folder",
			savedTo: "Saved to {path}",
			sendFilesHint: "Choose files on this machine, then drop them on a device or send them straight away",
			openInbox: "Open the inbox",
			inboxLabel: "Inbox",
			loading: "Reading the current state…",
			selectAll: "All",
			selectNone: "None",
			selectedOf: "{count} of {total} selected",
			acceptSelected: "Receive {count}",
			noFileSelected: "Pick at least one file, or decline the offer",
			stopTransfer: "Stop",
			retryTransfer: "Send again",
			retryTransferHint: "Send the same files again",
			menuSendTo: "Send over the network to",
			menuNoPeers: "No device is available to send to right now",
			menuFoldersUnsupported: "This plugin sends files, not folders",
			menuCopyPath: "Copy path",
			menuCopied: "Path copied",
			menuCopyFailed: "The clipboard is not available",
			menuSending: "Sending to {alias}…",
			menuSent: "Sent to {alias}",
			menuSendFailed: "Sending failed: {message}",
			openPanel: "Open the panel",
			buddyLabel: "Nearby transfer",
			buddyOffered: "{count} files are waiting for you",
			buddyOfferedOne: "{name} is waiting for you",
			buddyBusy: "Transferring · {percent}%",
			buddyDone: "A transfer just finished",
			buddyFailed: "A transfer did not finish",
			buddyIdleHint: "No devices nearby and nothing in flight",
			buddyAdd: "Add to conversation",
			"warning.portUnavailable": "Cannot listen on port {port}, so files cannot arrive right now: {detail}",
			"warning.discoveryUnavailable": "Device discovery is off, so other devices on this network cannot be seen: {detail}",
			errorGeneric: "That did not work: {message}",
			errorOffline: "Cannot reach the plugin host. Check that the plugin is loaded.",
			retry: "Retry",
			dismiss: "Dismiss"
		};
		//#endregion
		//#region src/client/notice.ts
		/**
		* The incoming offer worth notifying about.
		*
		* Only `awaiting` qualifies. An offer that has been answered is no longer
		* waiting on anyone, and one that is transferring is already visible as progress
		* in the panel — a notification for it would be telling the reader something
		* they did not need to act on.
		*
		* @param read - the current state.
		* @param dismissed - the id of an offer the reader has already dismissed, if any.
		* @returns the offer to surface, or `undefined` when there is nothing to say.
		*/
		function noticeOffer(read, dismissed) {
			if (read.status !== "ready") return void 0;
			return read.state.transfers.find((transfer) => transfer.direction === "incoming" && transfer.status === "awaiting" && transfer.id !== dismissed);
		}
		//#endregion
		//#region src/client/NoticeToast.tsx
		/**
		* The notification surface: the one thing this plugin has to say to somebody who
		* is not looking at it.
		*
		* Two messages want the top of the window, and they overlap in exactly the way
		* that argues for one component owning both:
		*
		* - **An offer.** The sender is holding a connection open and a person has to
		*   answer, so this has to fire wherever the user happens to be — including
		*   inside a conversation with the transfer panel nowhere on screen. The hold is
		*   deliberately long: the host gives a sender ninety seconds, and a toast that
		*   vanished after the usual three would take the only Accept button with it
		*   while the offer was still live.
		* - **A confirmation.** "Added to the composer", "copied", "sent to…". These are
		*   short, and they exist because the gesture that earned them took the surface
		*   that would otherwise have shown them away — see `flash.ts`.
		*
		* Two independent toasts would be two banners drawn in the same place, one
		* across the other. So one component arbitrates, and the rule is that **an offer
		* always wins**: it is a request from another person with a deadline, and a
		* three-second acknowledgement of something the user already watched happen can
		* afford to lose. A confirmation that arrives while an offer is on screen is
		* discarded rather than queued — by the time the offer is answered, the
		* connection between the gesture and the message would be gone, and a stale
		* confirmation is worse than none.
		*
		* It is the product's own `Toast` primitive rather than a bespoke surface,
		* because a notification that looked unlike every other notification in the
		* window would read as an interruption instead of as the application talking. It
		* also portals itself to the document body, which is what lets it escape the
		* overlay layer's own box.
		*
		* @module dsh-local-send/client/NoticeToast
		*/
		/**
		* How long an offer stays before fading.
		*
		* Longer than the host's own ninety-second window would be pointless — by then
		* the offer has already been refused — and shorter would drop it while it still
		* mattered. See the module note.
		*/
		const OFFER_HOLD_MS = 85e3;
		/**
		* How long a confirmation stays.
		*
		* Shorter than the product's own default, because these have nothing to act on:
		* the user has already done the thing, and the message is only telling them it
		* worked. Long enough to read a short sentence and no longer.
		*/
		const FLASH_HOLD_MS = 2600;
		/**
		* What sits between the sentence and each action.
		*
		* Punctuation rather than copy, which is why it is not in the dictionary — the
		* same reason the panel joins a row's figures with it directly.
		*/
		const ACTION_SEPARATOR = " · ";
		/**
		* Show an offer, a confirmation, or nothing.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function NoticeToast(props) {
			const { t, store, answer } = props;
			const read = useTransferState(store);
			const [busy, setBusy] = (0, react.useState)(false);
			/**
			* The offer the reader has already dismissed.
			*
			* Held here and passed down rather than latched inside a render guard, so that
			* dismissing one offer cannot suppress the next one. See `notice.ts`.
			*/
			const [dismissed, setDismissed] = (0, react.useState)(void 0);
			/** Drives re-render when a confirmation is posted, which is not React state. */
			const [, setRevision] = (0, react.useState)(0);
			(0, react.useEffect)(() => store.retain(), [store]);
			(0, react.useEffect)(() => subscribeFlash(() => {
				setRevision((value) => value + 1);
			}), []);
			const waiting = noticeOffer(read, dismissed);
			const message = readFlash();
			(0, react.useEffect)(() => {
				setBusy(false);
			}, [waiting?.id]);
			(0, react.useEffect)(() => {
				if (waiting === void 0 || message === void 0) return;
				clearFlash(message.id);
			}, [waiting, message]);
			const decide = (0, react.useCallback)((accept) => {
				if (waiting === void 0) return;
				if (busy) return;
				setBusy(true);
				answer(waiting.id, accept).then(() => {
					store.refresh();
				}, () => {
					setBusy(false);
				});
			}, [
				waiting,
				busy,
				answer,
				store
			]);
			if (waiting !== void 0) {
				const count = waiting.files.length;
				const text = `${count === 1 ? t("incomingFromOne", {
					alias: waiting.peerAlias,
					name: waiting.files[0]?.fileName ?? ""
				}) : t("incomingFrom", {
					alias: waiting.peerAlias,
					count
				})} · ${t("incomingTotal", { size: formatBytes(waiting.bytesTotal) })}`;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
					text,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReceiveIcon, { size: 18 }),
					holdMs: OFFER_HOLD_MS,
					actions: [{
						prefix: ACTION_SEPARATOR,
						label: t("accept"),
						onClick: () => {
							decide(true);
						}
					}, {
						prefix: ACTION_SEPARATOR,
						label: t("decline"),
						onClick: () => {
							decide(false);
						}
					}],
					onDone: () => {
						setDismissed(waiting.id);
					}
				}, waiting.id);
			}
			if (message === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: t(message.key, message.params),
				...message.tone === "error" ? {} : { tone: "success" },
				holdMs: FLASH_HOLD_MS,
				onDone: () => {
					clearFlash(message.id);
				}
			}, message.id);
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

/* --------------------------------------------------------- file picker -- */

/* The picker is driven by a button, so the input itself is never shown: a bare
 * file input cannot be made to match anything else in this product. It stays in
 * the tree rather than being left out, because opening the platform's dialog
 * needs a real user gesture and a synthetic click on a detached input is not
 * reliably one. */
.dls-picker {
  display: none;
}

/* --------------------------------------------------------- staged files -- */

/* Files the user has produced but not yet aimed at a device. Drawn like an
 * offer, because from the reader's side it is the same situation: something is
 * waiting on a decision, and here the decision is which device. */
.dls-staged {
  padding: 14px 15px;
  border: 0.5px solid var(--dsw-alias-brand-primary);
  border-radius: var(--dsw-radius-lg, 12px);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1));
}

/* ----------------------------------------------------------- selection -- */

/* How many of an offer's files are ticked, and the two gestures that answer it
 * in one press. Right-aligned so it sits under the buttons it belongs to. */
.dls-pickBar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: flex-end;
  margin-block-start: 10px;
}

.dls-tick {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-inline-size: 0;
  cursor: pointer;
}

.dls-tick input {
  flex-shrink: 0;
  accent-color: var(--dsw-alias-brand-primary);
}

/* A file this device's own limits refused, listed without a box because there
 * is nothing left to decide about it. */
.dls-incomingName[data-tone='muted'] {
  color: var(--dsw-alias-label-tertiary);
}

/* The dismiss button rides at the end of a note's line, which is already a flex
 * row — so a note with an action does not grow a second line for one word. */
.dls-note > .dls-action {
  margin-inline-start: auto;
}

/* -------------------------------------------------------------- banner -- */

/* The offer banner, directly above the composer. This is the one strip in the
 * window that sits between the reader and what they were about to send, so it
 * stays a single line: who, how much, and the answers. */
.dls-banner {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-lg, 12px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 12.5px;
}

.dls-bannerMark {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  color: var(--dsw-alias-state-warn-primary);
}

.dls-bannerBody {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  min-inline-size: 0;
}

.dls-bannerTitle {
  font-weight: 500;
}

.dls-bannerMeta {
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dls-bannerActions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  margin-inline-start: auto;
}

/* ----------------------------------------------------------- companion -- */

/* The fish in the conversation header. Idle it is deliberately quiet: a pet that
 * shouted while nothing was happening would be a notification with no news, and
 * the tone attribute is what escalates it. The size is fixed so the header's
 * other controls do not shift when the mood changes. */
.dls-buddy {
  display: grid;
  place-items: center;
  inline-size: 26px;
  block-size: 26px;
  padding: 0;
  border: 0.5px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
}

.dls-buddy:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dls-buddy:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.dls-buddy[data-tone='busy'] {
  color: var(--dsw-alias-brand-text);
}

.dls-buddy[data-tone='good'] {
  color: var(--dsw-alias-state-success-primary);
}

.dls-buddy[data-tone='bad'] {
  color: var(--dsw-alias-state-error-primary);
}

/* The one state that is waiting on a person gets a halo, because it is the only
 * state where the transfer cannot proceed without the reader. */
.dls-buddy[data-tone='attention'] {
  border-color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-state-warn-primary);
  animation: dls-buddy-ask 1.9s ease-in-out infinite;
}

@keyframes dls-buddy-ask {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
  }

  55% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 0%, transparent);
  }
}

/* The tail is the only part of the fish that moves on its own, which is what
 * makes the mark read as swimming rather than as a static shape that happens to
 * have a ring round it. 'fill-box' puts the origin on the tail's own edge. */
.dlsFishTail {
  transform-box: fill-box;
  transform-origin: 100% 50%;
  animation: dls-fish-tail 2.4s ease-in-out infinite;
}

/* Faster while bytes are moving: the pace is the progress the ring is also
 * drawing, said in a second way that needs no reading. */
.dls-buddy[data-mood='moving'] .dlsFishTail {
  animation-duration: 0.7s;
}

@keyframes dls-fish-tail {
  0%,
  100% {
    transform: rotate(-9deg);
  }

  50% {
    transform: rotate(9deg);
  }
}

.dlsFishRingTrack {
  opacity: 0.15;
}

.dlsFishRing {
  color: var(--dsw-alias-brand-primary);
  transition: stroke-dashoffset 500ms linear;
}

.dlsFishBubbles {
  animation: dls-fish-bubbles 2.2s ease-in-out infinite;
}

@keyframes dls-fish-bubbles {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0.5px);
  }

  50% {
    opacity: 1;
    transform: translateY(-0.8px);
  }
}

/* A landed transfer is the one thing worth colouring green, and only for as long
 * as the companion keeps mentioning it. */
.dlsFishCheck {
  color: var(--dsw-alias-state-success-primary);
}

/* --------------------------------------------------------------- menus -- */

/* The right-click menu's wrapper is inert: the trigger is the pointer, and the
 * rect the menu is placed from comes from the click rather than from this box.
 * 'display: contents' keeps it from being a box that could catch a pointer or
 * add a row to the overlay. */
.dls-menuAnchor {
  display: contents;
}

/* The menu's material is the product's; only the width is ours, so a long device
 * name wraps rather than stretching the menu across the window. */
.dls-menu,
.dls-buddyMenu {
  min-inline-size: 184px;
  max-inline-size: 320px;
  font-family: var(--dsw-font-family);
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
  .dls-composerButton,
  .dls-buddy,
  .dlsFishRing {
    transition: none;
  }

  .dls-row[data-status='transferring']::after {
    animation: none;
  }

  .dls-tile[data-drop='true'] {
    transform: none;
  }

  /* The companion keeps its posture and its ring — those carry information — and
   * gives up only the motion that carries none. A fish that stopped moving would
   * still say everything it says. */
  .dls-buddy[data-tone='attention'],
  .dlsFishTail,
  .dlsFishBubbles {
    animation: none;
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
		//#region src/client/TransferBanner.tsx
		/**
		* The offer banner: an incoming transfer, offered where the user is typing.
		*
		* This is the narrow answer to a narrow problem. A file arrives while somebody is
		* in the middle of writing, and the places the offer could otherwise appear are
		* both wrong for that moment: the notification is a banner at the top of the
		* window that fades, and the panel is a different screen entirely. So the offer
		* is also offered directly above the composer — full width, one line, between the
		* user and the thing they were about to send.
		*
		* It shows **only offers**. Progress and outcomes belong to the companion in the
		* header, and duplicating them here would turn the strip above the composer into
		* a second panel — the one place in the window that has to stay quiet, because
		* everything the user writes passes through it.
		*
		* No file list, deliberately: a batch of twenty files cannot be ticked off in one
		* line, and the panel is where choosing happens. Accept here takes the lot, which
		* is what "yes, send them" means when the details are a click away.
		*
		* @module dsh-local-send/client/TransferBanner
		*/
		/**
		* Offer the waiting transfer, or draw nothing.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function TransferBanner(props) {
			const { t, store, answer, openPanel } = props;
			const read = useTransferState(store);
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => store.retain(), [store]);
			const waiting = noticeOffer(read, void 0);
			(0, react.useEffect)(() => {
				setBusy(false);
			}, [waiting?.id]);
			const decide = (0, react.useCallback)((accept) => {
				if (waiting === void 0 || busy) return;
				setBusy(true);
				answer(waiting.id, accept).then(() => {
					store.refresh();
				}, () => {
					setBusy(false);
				});
			}, [
				waiting,
				busy,
				answer,
				store
			]);
			if (waiting === void 0) return null;
			const count = waiting.files.length;
			const summary = count === 1 ? t("incomingFromOne", {
				alias: waiting.peerAlias,
				name: waiting.files[0]?.fileName ?? ""
			}) : t("incomingFrom", {
				alias: waiting.peerAlias,
				count
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dls-banner",
				role: "group",
				"aria-label": t("incomingTitle"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dls-bannerMark",
						"aria-hidden": true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReceiveIcon, { size: 15 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-bannerBody",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-bannerTitle",
							children: summary
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-bannerMeta",
							children: t("incomingTotal", { size: formatBytes(waiting.bytesTotal) })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-bannerActions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "primary",
								disabled: busy,
								onClick: () => {
									decide(true);
								},
								children: t("accept")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								disabled: busy,
								onClick: () => {
									decide(false);
								},
								children: t("decline")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
								onClick: openPanel,
								children: t("openPanel")
							})
						]
					})
				]
			});
		}
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
			/**
			* Answer an incoming offer.
			*
			* `fileIds` is passed only by a surface that showed the file list. Left out,
			* the host reads the answer as "every file its own limits left standing" —
			* which is what the notification's single Accept button means.
			*
			* @param transferId - the offer's row.
			* @param accept - whether to take it.
			* @param fileIds - the files the user ticked, when a list was on screen.
			*/
			async function answerOffer(transferId, accept, fileIds) {
				await decide({
					transferId,
					accept,
					...fileIds === void 0 ? {} : { fileIds }
				});
			}
			/**
			* Ask for a received file to be referenced by the composer.
			*
			* The insert itself happens in the composer, which is the only component
			* holding that editor's input actions; this leaves the request and brings the
			* conversation back so the composer exists to carry it out.
			*
			* The confirmation is raised here rather than in whichever surface asked,
			* because this call is what switches that surface away — see `flash.ts`. It is
			* optimistic by one render: the composer inserts as soon as it mounts, and the
			* only case `reference-action.ts` refuses is a path that cannot be written as
			* a mention at all, which the panel has already shown the user in full.
			*
			* @param path - absolute path of a file this device received.
			*/
			function addToConversation(path) {
				if (!hasOpenSession(ctx)) {
					flash("noSession", { tone: "error" });
					return;
				}
				requestReference(path);
				ctx.layout.selectPanel(null);
				flash("addedToConversation");
			}
			/**
			* Everything any surface can ask for, implemented once.
			*
			* One implementation handed out in slices rather than one literal per slot:
			* this plugin now draws in six seats — the panel, the sidebar, the
			* notification, the composer hook, the header companion, and the banner above
			* the composer — and five hand-written copies of `answer` is five places for
			* the host contract to drift.
			*/
			const facade = {
				store,
				locale: () => ctx.locale.getLocale().active,
				sendFiles: sendBrowserFiles,
				sendLocalPaths: async (peer, paths) => await sendPaths({
					peer,
					paths
				}),
				answer: answerOffer,
				cancel: async (transferId) => {
					await cancelTransfer({ transferId });
				},
				retry: async (transferId) => {
					await retryTransfer({ transferId });
				},
				renameDevice: async (alias) => {
					await rename(alias);
				},
				scanNow: async () => await scan(),
				revealFile: async (path) => {
					await reveal(path);
				},
				inspectPaths: async (paths) => (await inspect(paths)).candidates,
				addToConversation,
				hasSession: () => hasOpenSession(ctx),
				/** Bring the transfer panel forward, for a surface that is only a summary. */
				openPanel: () => {
					ctx.layout.selectPanel(PANEL_ID);
				}
			};
			const panelFace = () => ({
				...facade,
				panelId: PANEL_ID
			});
			const noticeFace = () => ({
				store,
				answer: answerOffer
			});
			const composerFace = () => ({ hasSession: facade.hasSession });
			const buddyFace = () => ({
				store,
				answer: answerOffer,
				cancel: facade.cancel,
				revealFile: facade.revealFile,
				addToConversation,
				openPanel: facade.openPanel
			});
			const bannerFace = () => ({
				store,
				answer: answerOffer,
				openPanel: facade.openPanel
			});
			const menuFace = () => ({
				store,
				sendLocalPaths: facade.sendLocalPaths,
				revealFile: facade.revealFile,
				addToConversation
			});
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
				id: "local-send.notice",
				order: 20,
				locale: NS,
				inject: noticeFace
			}, NoticeToast));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "local-send.context-menu",
				order: 30,
				locale: NS,
				inject: menuFace
			}, ContextSendMenu));
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "local-send.companion",
				order: 10,
				locale: NS,
				inject: buddyFace
			}, FishCompanion));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "local-send.banner",
				order: 30,
				locale: NS,
				inject: bannerFace
			}, TransferBanner));
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
		exports.HostError = HostError;
		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map