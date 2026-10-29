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
		* Ask for files to be referenced in the composer.
		*
		* A list rather than a path because a received batch is usually several files
		* and one press should reference all of them. A later request still replaces an
		* earlier one rather than queueing behind it: the user pressed a button, and two
		* batches added by two impatient clicks should not both appear — the second
		* press is the one that counts.
		*
		* @param paths - absolute paths of the received files.
		*/
		function requestReference(paths) {
			if (paths.length === 0) return;
			pending = {
				paths: [...paths],
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
		* @returns the pending paths, or `undefined`.
		*/
		function readReference() {
			if (pending === void 0) return void 0;
			if (Date.now() - pending.at > REQUEST_TTL_MS) {
				pending = void 0;
				return;
			}
			return pending.paths;
		}
		/**
		* Take the pending request.
		* @returns the paths that were waiting, or `undefined` when there were none.
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
		//#region src/client/session-target.ts
		/**
		* Whether a project timestamp is one this module can rank.
		*
		* The value arrives from the host as an ISO string, but it crosses a protocol
		* boundary, so "a date" is an assumption rather than a guarantee. Asking
		* `Date.parse` is what turns that assumption into an answer; `NaN` is the
		* signal, and `''` is treated the same way because `Date.parse` happens to
		* reject it too and being explicit about the empty case costs nothing.
		*
		* @param value - the project's raw `updatedAt`.
		* @returns whether the value is a non-empty date string.
		*/
		function isDated(value) {
			return value.length > 0 && !Number.isNaN(Date.parse(value));
		}
		/**
		* Rank two projects by recency, newest first.
		*
		* ISO 8601 in UTC sorts the same lexicographically as it does chronologically,
		* which is why the comparison is on the strings: no parse is needed to order
		* two values that are both dates. A value that is not a date is oldest, not
		* equal-to-everything and not a thrown error — a picker whose list collapsed
		* because one project's clock was unreadable would be a far worse failure than
		* a project sitting at the bottom of it.
		*
		* @param left - one project's raw `updatedAt`.
		* @param right - the other's.
		* @returns negative when `left` is newer, positive when `right` is.
		*/
		function byRecency(left, right) {
			const leftDated = isDated(left);
			if (leftDated !== isDated(right)) return leftDated ? -1 : 1;
			if (!leftDated || left === right) return 0;
			return left > right ? -1 : 1;
		}
		/**
		* The sessions of one project that a send could actually reach.
		*
		* Two kinds of id are dropped, for the same reason: neither names a place a
		* person can send to. An id with no row is a session the host no longer knows —
		* rendering it would offer a destination that fails at send time — and a row
		* whose `origin` is `subagent` belongs to a machine's own conversation. The
		* order here is the caller's; ordering by recency is `targetTree`'s job.
		*
		* @param project - the project whose ids to resolve.
		* @param input - the snapshot the ids are resolved against.
		* @returns the resolved rows, in the order the project listed them.
		*/
		function reachableSessions(project, input) {
			const resolved = [];
			for (const id of project.sessionIds) {
				const session = input.sessions[id];
				if (session === void 0) continue;
				if (session.origin === "subagent") continue;
				resolved.push(session);
			}
			return resolved;
		}
		/**
		* The label a person will recognise a session by.
		*
		* A user-given title wins over the generated one because it is the one the user
		* chose and can therefore search for. "Non-empty" is read as "has something in
		* it other than whitespace": a title of three spaces would otherwise become a
		* nameless row, which is indistinguishable from a bug.
		*
		* @param session - the session to name.
		* @returns the title, or the display title when there is no usable one.
		*/
		function labelOf(session) {
			const title = session.title;
			return title !== void 0 && title.trim().length > 0 ? title : session.displayTitle;
		}
		/**
		* Turn one metadata row into the picker's own row.
		*
		* @param session - the session to describe.
		* @param currentSessionId - the session on screen, if any.
		* @returns the choice the picker draws.
		*/
		function choiceOf(session, currentSessionId) {
			return {
				id: session.id,
				label: labelOf(session),
				running: session.running,
				isCurrent: session.id === currentSessionId,
				updatedAt: session.updatedAt,
				stale: session.blank
			};
		}
		/**
		* Build the picker's two-level model from the host's snapshots.
		*
		* The order this produces is the whole of the picker's default behaviour: the
		* current project first, everything else newest first, and inside each project
		* the most recently touched session first. A project that has nothing to send to
		* is not a row at all — an empty heading is a place the user can move a
		* highlight onto and then find no way to act, which is worse than a shorter
		* list.
		*
		* @param input - the projects, session metadata and current session.
		* @returns the tree, projects ordered as they should be listed.
		*/
		function targetTree(input) {
			const entries = [];
			for (const project of input.projects) {
				const sessions = reachableSessions(project, input).map((session) => choiceOf(session, input.currentSessionId)).sort((left, right) => right.updatedAt - left.updatedAt);
				if (sessions.length === 0) continue;
				entries.push({
					choice: {
						id: project.workspaceId,
						label: project.title,
						detail: project.path,
						sessions,
						isCurrent: sessions.some((session) => session.isCurrent)
					},
					updatedAt: project.updatedAt
				});
			}
			entries.sort((left, right) => {
				if (left.choice.isCurrent !== right.choice.isCurrent) return left.choice.isCurrent ? -1 : 1;
				return byRecency(left.updatedAt, right.updatedAt);
			});
			return { projects: entries.map((entry) => entry.choice) };
		}
		/**
		* The tree as one list, for the picker's arrow keys.
		*
		* A highlight moving through a two-level list has to be a single index
		* somewhere, and this is the list that index counts. The current session is put
		* first inside its project rather than left wherever recency sorted it, because
		* the current session is what the picker opens on and what a user returning to
		* the keyboard expects one press away.
		*
		* @param tree - the tree to flatten.
		* @returns every session in the tree, projects in order, current session first in its project.
		*/
		function orderedChoices(tree) {
			const ordered = [];
			for (const project of tree.projects) {
				const current = project.sessions.find((session) => session.isCurrent);
				if (current !== void 0) ordered.push(current);
				for (const session of project.sessions) if (session !== current) ordered.push(session);
			}
			return ordered;
		}
		/**
		* The session a freshly opened picker should highlight.
		*
		* The current session when the tree holds it — that is the answer the user is
		* almost always looking for — and otherwise the first session of the first
		* project, which is the newest thing on offer. An empty tree has no answer, and
		* the picker draws its empty state rather than a highlight on nothing.
		*
		* @param tree - the tree to choose from.
		* @returns the session to highlight, or `undefined` when there is none.
		*/
		function firstChoice(tree) {
			for (const project of tree.projects) for (const session of project.sessions) if (session.isCurrent) return session;
			return tree.projects[0]?.sessions[0];
		}
		/**
		* The message body that sends one or more files to a session.
		*
		* A received transfer is often several files, and one message carrying all of
		* them is what the user meant by accepting them together, so the body is the
		* mentions joined by a single space — the separator the `@` grammar already
		* requires between tokens, and no trailing one, because the message ends when
		* the last mention does and a trailing space would be an invisible character
		* sitting in the draft.
		*
		* A path the grammar refuses — one carrying a quote or a control character — is
		* dropped rather than failing the whole message: the other files are still what
		* the user asked to send, and refusing them all because of one name would be
		* losing the send over a detail the caller can report separately. A list that is
		* empty, or where nothing at all could be written as a mention, has no message
		* and answers `undefined`; the caller reports that instead of sending a token
		* the composer would parse as something else.
		*
		* The formatter is injected so that this module holds none of the mention
		* grammar: `mention.ts` owns that, and passing it in also lets a caller supply
		* the editor's own formatter if the two ever need to differ.
		*
		* @param paths - absolute paths of the files to reference, in the order to send them.
		* @param formatMention - the mention grammar, from `mention.ts`.
		* @returns the message text, or `undefined` when nothing in the list has a mention.
		*/
		function targetMessage(paths, formatMention) {
			const mentions = [];
			for (const path of paths) {
				const mention = formatMention(path);
				if (mention !== void 0) mentions.push(mention);
			}
			return mentions.length === 0 ? void 0 : mentions.join(" ");
		}
		/**
		* Whether a haystack contains the already-lowercased needle.
		*
		* @param haystack - the text to search, in its own casing.
		* @param needle - the search text, already trimmed and lowercased.
		* @returns whether the haystack contains the needle.
		*/
		function matches(haystack, needle) {
			return haystack.toLowerCase().includes(needle);
		}
		/**
		* Narrow the tree to what matches the picker's search box.
		*
		* A project whose own name or directory matches is kept *whole* — all of its
		* sessions — because a user who typed the project's path wants the project, not
		* the one session whose title happened to contain the same letters. Only when
		* the project itself does not match are its sessions sifted, and a project left
		* holding nothing is dropped rather than shown as an empty heading.
		*
		* Filtering narrows the list; it does not re-derive the model, so every project
		* keeps the order and the marks it was built with. An empty or whitespace-only
		* query is not a filter at all and hands the same tree back, which also keeps
		* the picker from rebuilding its list on every keystroke of a space.
		*
		* @param tree - the tree to narrow.
		* @param query - the raw search text, in any casing.
		* @returns a tree holding only what matches, or the input tree when the query says nothing.
		*/
		function filterTree(tree, query) {
			const needle = query.trim().toLowerCase();
			if (needle.length === 0) return tree;
			const projects = [];
			for (const project of tree.projects) {
				const sessions = matches(project.label, needle) || matches(project.detail, needle) ? project.sessions : project.sessions.filter((session) => matches(session.label, needle));
				if (sessions.length === 0) continue;
				projects.push({
					...project,
					sessions
				});
			}
			return { projects };
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
		* The text itself is built by `session-target.ts`'s `targetMessage`, the same
		* function the "send to a conversation" picker uses: one press references every
		* file in the batch, and both entry points have to spell that list the same way.
		*
		* @module dsh-local-send/client/reference-action
		*/
		/**
		* Decide what to do about one pending request.
		*
		* @param pending - the paths waiting to be referenced, if any.
		* @param hasSession - whether a conversation is currently bound to the composer.
		* @returns the action to take.
		*/
		function referenceAction(pending, hasSession) {
			if (pending === void 0 || pending.length === 0) return { kind: "wait" };
			if (!hasSession) return { kind: "wait" };
			const message = targetMessage(pending, formatMention);
			if (message === void 0) return { kind: "drop" };
			return {
				kind: "insert",
				text: `${message} `
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
		/** A refused or failed row. */
		function CrossIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6 6l12 12M18 6L6 18",
					...STROKE$1
				})
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
		function describe$2(error) {
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
						message: describe$2(error)
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
							message: describe$2(error)
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
		function describe$1(error) {
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
						params: { message: describe$1(error) },
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
						params: { message: describe$1(error) },
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
		* A transfer rate, in bytes per second.
		*
		* Returns `undefined` rather than a number for a rate that is not yet
		* meaningful, so the caller can leave the slot empty instead of printing a
		* figure computed from too little time to mean anything.
		*
		* @param bytes - bytes moved.
		* @param elapsedMs - milliseconds over which they moved.
		* @returns a string like `12.4 MB/s`, or `undefined` when there is nothing to say.
		*/
		function formatRate(bytes, elapsedMs) {
			if (elapsedMs < 500 || bytes <= 0) return void 0;
			const perSecond = bytes / elapsedMs * 1e3;
			if (!Number.isFinite(perSecond) || perSecond <= 0) return void 0;
			return `${formatBytes(perSecond)}/s`;
		}
		/**
		* How long ago something happened, as a dictionary entry and its figures.
		*
		* Coarse on purpose: a peer list ticks, and a figure that changes every second
		* draws the eye to the least important column. Past a minute the answer is a
		* count of minutes, and past an hour it is not worth showing at all.
		*
		* Returned as a key rather than as a sentence, because this module formats
		* *numbers* and the dictionary formats *words* — a `"5s ago"` built here would
		* be an English fragment sitting in a Chinese panel, which is exactly what the
		* first version shipped and this signature exists to prevent.
		*
		* @param timestamp - epoch milliseconds.
		* @param now - the current time, injected so the result is testable.
		* @returns the key and placeholders, or `undefined` beyond an hour.
		*/
		function ageOf(timestamp, now) {
			const elapsed = now - timestamp;
			if (elapsed < 5e3) return {
				key: "ageNow",
				params: {}
			};
			if (elapsed < 6e4) return {
				key: "ageSeconds",
				params: { seconds: Math.floor(elapsed / 1e3) }
			};
			if (elapsed < 36e5) return {
				key: "ageMinutes",
				params: { minutes: Math.floor(elapsed / 6e4) }
			};
		}
		/**
		* A remaining-time estimate, as a dictionary entry and its figures.
		*
		* Clamped and rounded because an estimate is a comfort, not a measurement: a
		* figure that reads "3" then "100" is worse than one that counts down smoothly,
		* and the clamp is what stops a transient stall from flashing a number in the
		* hours. Like {@link ageOf}, the unit word belongs to the dictionary.
		*
		* @param remaining - bytes still to move.
		* @param bytesPerSecond - the current rate.
		* @returns the key and placeholders, or `undefined` when no rate is known.
		*/
		function etaOf(remaining, bytesPerSecond) {
			if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0 || remaining <= 0) return void 0;
			const seconds = Math.min(remaining / bytesPerSecond, 3600);
			if (seconds < 60) return {
				key: "etaSeconds",
				params: { seconds: Math.max(1, Math.round(seconds)) }
			};
			return {
				key: "etaMinutes",
				params: { minutes: Math.round(seconds / 60) }
			};
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
		//#region src/client/FloatingBuddy.tsx
		/**
		* The floating companion: a small fish that carries the transfer's progress and
		* stays out of the way of everything else.
		*
		* This is the surface that replaced the header mark **and** the strip above the
		* composer. Both of those lived inside the conversation's own layout, which meant
		* a transfer was only visible while the user happened to be looking at that
		* conversation — and the offer banner, in particular, sat *between* the user and
		* the thing they were typing, in the one place the product deliberately keeps
		* quiet. One floating mark answers for the whole window instead: it is drawn in
		* the frame-wide overlay, so it is present whichever panel or conversation is
		* open, and it is never in the typing path.
		*
		* Four decisions worth stating:
		*
		* - **It is absent when there is nothing to say.** The rule is `companionView`'s,
		*   unchanged and shared with the tests that already pin it: an offer waiting on a
		*   person, bytes moving, or something that just finished. An idle fish sitting in
		*   the corner all day would be a control with no content.
		* - **It is draggable, and it remembers where you put it.** A floating element
		*   that covers the thing you are reading is worse than no floating element, so
		*   the position is the user's and is kept across reloads. Dragging is not a
		*   click: movement past a small threshold suppresses the press, or every attempt
		*   to move the fish out of the way would also open the panel.
		* - **It shows the progress as a number and a rail, not only as a ring.** The
		*   ring is the fish's own posture (`fish.tsx`) and reads at a glance across the
		*   room; the rail and the percentage are for when the user actually looks at it.
		*   A transfer with an unknowable total gets no percentage rather than a
		*   confident zero.
		* - **It can be put away.** `×` hides it until the next *different* event — an
		*   offer, a new transfer — so dismissing one thing cannot swallow the next one.
		*
		* @module dsh-local-send/client/FloatingBuddy
		*/
		/** Where the user last put it, remembered across reloads. */
		const POSITION_KEY = "dls.buddy.position";
		/**
		* How far the pointer must travel before a press counts as a drag.
		*
		* Small enough to feel immediate, large enough that the wobble in a normal click
		* does not turn into a two-pixel move that swallows the press.
		*/
		const DRAG_THRESHOLD_PX = 4;
		/** Distance kept from every viewport edge, so the fish can always be grabbed. */
		const EDGE_INSET_PX = 16;
		/** Read the remembered position, tolerating a hand-edited or stale value. */
		function storedPosition() {
			try {
				const raw = window.localStorage.getItem(POSITION_KEY);
				if (raw === null) return void 0;
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return void 0;
				const { x, y } = parsed;
				return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? {
					x,
					y
				} : void 0;
			} catch {
				return;
			}
		}
		/** Keep a coordinate inside the viewport. */
		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), Math.max(min, max));
		}
		/**
		* Show the companion, and let the user act on whatever it is showing.
		*
		* @param props - slot props, locale seat, and the injected face.
		*/
		function FloatingBuddy(props) {
			const { t, store, answer, cancel, openPanel } = props;
			const read = useTransferState(store);
			const [position, setPosition] = (0, react.useState)(storedPosition);
			const [busy, setBusy] = (0, react.useState)(false);
			/**
			* The event the user has already put away.
			*
			* Keyed by the thing being reported rather than latched as a boolean, so
			* dismissing one offer cannot suppress the next one.
			*/
			const [hidden, setHidden] = (0, react.useState)(void 0);
			const card = (0, react.useRef)(null);
			const drag = (0, react.useRef)(void 0);
			/** Set by a drag that moved, read by the next click so it is not a press. */
			const dragged = (0, react.useRef)(false);
			(0, react.useEffect)(() => store.retain(), [store]);
			const view = companionView(read, Date.now());
			const focus = view.focus;
			const key = focus === void 0 ? void 0 : `${focus.id}:${focus.status}`;
			const visible = view.visible && key !== void 0 && key !== hidden;
			(0, react.useEffect)(() => {
				setBusy(false);
			}, [key]);
			(0, react.useEffect)(() => {
				if (!visible) return;
				function onMove(event) {
					const state = drag.current;
					if (state === void 0) return;
					const dx = event.clientX - state.pointerX;
					const dy = event.clientY - state.pointerY;
					if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
					state.moved = true;
					setPosition({
						x: clamp(state.originX + dx, EDGE_INSET_PX, window.innerWidth - state.width - EDGE_INSET_PX),
						y: clamp(state.originY + dy, EDGE_INSET_PX, window.innerHeight - state.height - EDGE_INSET_PX)
					});
				}
				function onUp() {
					const state = drag.current;
					drag.current = void 0;
					if (state === void 0 || !state.moved) return;
					dragged.current = true;
					const node = card.current;
					if (node === null) return;
					const rect = node.getBoundingClientRect();
					const settled = {
						x: rect.left,
						y: rect.top
					};
					setPosition(settled);
					try {
						window.localStorage.setItem(POSITION_KEY, JSON.stringify(settled));
					} catch {}
				}
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
				return () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
				};
			}, [visible]);
			const onPointerDown = (0, react.useCallback)((event) => {
				if (event.button !== 0) return;
				const rect = card.current?.getBoundingClientRect();
				if (rect === void 0) return;
				dragged.current = false;
				drag.current = {
					pointerX: event.clientX,
					pointerY: event.clientY,
					originX: rect.left,
					originY: rect.top,
					width: rect.width,
					height: rect.height,
					moved: false
				};
			}, []);
			/** Open the panel, unless this press was the end of a drag. */
			const onOpen = (0, react.useCallback)(() => {
				if (dragged.current) {
					dragged.current = false;
					return;
				}
				openPanel();
			}, [openPanel]);
			const run = (0, react.useCallback)((action) => {
				if (busy) return;
				setBusy(true);
				action().then(() => {
					store.refresh();
					setBusy(false);
				}, () => {
					setBusy(false);
				});
			}, [busy, store]);
			if (!visible || focus === void 0 || key === void 0) return null;
			const moving = view.mood === "moving";
			const offered = view.mood === "offered";
			const percent = moving ? percentOf(focus.bytesDone, focus.bytesTotal) : 0;
			const known = focus.bytesTotal > 0;
			const rate = moving && known ? formatRate(focus.bytesDone, Math.max(1, Date.now() - focus.createdAt)) : void 0;
			const detail = moving && known ? `${formatBytes(focus.bytesDone)} / ${formatBytes(focus.bytesTotal)}` : t("incomingTotal", { size: formatBytes(focus.bytesTotal) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dls-pet",
				"data-placed": position === void 0 ? "false" : "true",
				...position === void 0 ? {} : { style: {
					left: `${String(position.x)}px`,
					top: `${String(position.y)}px`
				} },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: card,
					className: "dls-petCard",
					"data-tone": view.tone,
					"data-mood": view.mood,
					role: "status",
					"aria-live": "polite",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dls-petHead",
							title: t("buddyDragHint"),
							"aria-label": t("openPanel"),
							onPointerDown,
							onClick: onOpen,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-petMark",
								"aria-hidden": true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FishMark, {
									size: 30,
									mood: view.mood,
									carrying: view.carrying,
									...view.progress === void 0 ? {} : { progress: view.progress }
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dls-petText",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-petTitle",
									children: t(view.labelKey, view.labelParams)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dls-petMeta",
									children: [detail, rate === void 0 ? null : ` · ${rate}`]
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-petHide",
							"aria-label": t("buddyHide"),
							title: t("buddyHide"),
							onClick: () => {
								setHidden(key);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CrossIcon, { size: 12 })
						}),
						moving || offered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-petBar",
							"aria-hidden": true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-petBarFill",
								style: { inlineSize: `${String(percent)}%` }
							})
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dls-petActions",
							children: [
								offered ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dls-action",
									"data-tone": "primary",
									disabled: busy,
									onClick: () => {
										run(async () => {
											await answer(focus.id, true);
										});
									},
									children: t("accept")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dls-action",
									disabled: busy,
									onClick: () => {
										run(async () => {
											await answer(focus.id, false);
										});
									},
									children: t("decline")
								})] }) : null,
								moving ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dls-action",
									disabled: busy,
									onClick: () => {
										run(async () => {
											await cancel(focus.id);
										});
									},
									children: t("stopTransfer")
								}) : null,
								!moving && !offered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dls-action",
									"data-tone": "quiet",
									onClick: onOpen,
									children: t("openPanel")
								}) : null
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/SessionPicker.tsx
		/**
		* The picker that sends a received file into a specific conversation.
		*
		* "Add to the conversation I have open" only ever addressed one session, and only
		* the one on screen. A file that lands while the user is working in one project
		* is very often wanted in another — the one it belongs to — so the plugin needs a
		* way to name a target rather than assume it. That is this dialog: projects on the
		* left of the reading order, their sessions under them, one press to send.
		*
		* Four decisions worth stating:
		*
		* - **It is the product's `Modal`, not a bespoke overlay.** Escape, the mask, the
		*   focus trap, and returning focus to the button that opened it are all already
		*   handled there, and a plugin dialog that behaved differently from every other
		*   dialog in the window would read as a bug.
		* - **Projects and sessions are one list, not two steps.** The brief was "pick a
		*   project, then pick a session", and grouping is a superset of that: the project
		*   is a heading over its own sessions, so the second step is visible without a
		*   second screen. Searching narrows both levels at once (`filterTree`).
		* - **Subagent sessions and empty projects never appear**, and neither does a
		*   session that has never had a message in it — the rule lives in
		*   `session-target.ts`, where it is tested, rather than here.
		* - **The keyboard is the same walk as the mouse.** Arrow keys move a highlight
		*   over exactly the rows on screen (the flat list `orderedChoices` produces),
		*   Enter sends to the highlighted one, and nothing here reorders anything.
		*
		* @module dsh-local-send/client/SessionPicker
		*/
		/**
		* Offer every conversation this file could be sent to.
		*
		* @param props - the dialog's props, assembled by the panel.
		*/
		function SessionPicker(props) {
			const { open, onClose, onPick, tree, busy, t } = props;
			const [query, setQuery] = (0, react.useState)("");
			const [active, setActive] = (0, react.useState)(void 0);
			const shown = (0, react.useMemo)(() => filterTree(tree, query), [tree, query]);
			const flat = (0, react.useMemo)(() => orderedChoices(shown), [shown]);
			(0, react.useEffect)(() => {
				if (!open) return;
				if ((active === void 0 ? void 0 : flat.find((choice) => choice.id === active)) !== void 0) return;
				setActive(firstChoice(shown)?.id);
			}, [
				open,
				flat,
				shown,
				active
			]);
			(0, react.useEffect)(() => {
				if (open) setQuery("");
			}, [open]);
			const onKeyDown = (event) => {
				if (flat.length === 0) return;
				if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
				event.preventDefault();
				if (event.key === "Enter") {
					const choice = flat.find((candidate) => candidate.id === active);
					if (choice !== void 0 && !busy) onPick(choice.id, choice.label);
					return;
				}
				const index = flat.findIndex((candidate) => candidate.id === active);
				const step = event.key === "ArrowDown" ? 1 : -1;
				const next = flat[(index + step + flat.length) % flat.length];
				if (next !== void 0) setActive(next.id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose,
				title: t("pickTitle"),
				description: t("pickDescription"),
				closeLabel: t("cancel"),
				className: "dls-pickDialog",
				contentClassName: "dls-pickContent",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "search",
					className: "dls-input dls-pickSearch",
					placeholder: t("pickSearchPlaceholder"),
					value: query,
					"aria-label": t("pickSearchPlaceholder"),
					"data-modal-autofocus": true,
					onChange: (event) => {
						setQuery(event.target.value);
					},
					onKeyDown
				}), flat.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-empty",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dls-emptyTitle",
						children: query.trim() === "" ? t("pickEmpty") : t("pickNoMatch")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dls-emptyHint",
						children: query.trim() === "" ? t("pickEmptyHint") : t("pickNoMatchHint")
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dls-pickList",
					role: "listbox",
					"aria-label": t("pickTitle"),
					children: shown.projects.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dls-pickGroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dls-pickProject",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickProjectName",
									children: project.label
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickProjectPath",
									title: project.detail,
									children: project.detail
								}),
								project.isCurrent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickBadge",
									children: t("pickCurrent")
								}) : null
							]
						}), project.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": session.id === active,
							className: "dls-pickSession",
							"data-active": session.id === active ? "true" : "false",
							disabled: busy,
							onMouseEnter: () => {
								setActive(session.id);
							},
							onClick: () => {
								onPick(session.id, session.label);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickSessionName",
									children: session.label
								}),
								session.running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickRunning",
									children: t("pickRunning")
								}) : null,
								session.stale ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickNote",
									children: t("pickStale")
								}) : null,
								session.isCurrent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-pickBadge",
									children: t("pickCurrent")
								}) : null
							]
						}, session.id))]
					}, project.id))
				})]
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
			const { t, store, sendFiles, sendLocalPaths, answer, cancel, retry, renameDevice, scanNow, revealFile, inspectPaths, addToConversation, hasSession, readTargets, openInSession } = props;
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
			/**
			* The received files the picker is choosing a conversation for.
			*
			* Held as the paths rather than as the transfer id, because what the send
			* actually needs is the files on disk: a row can be re-read, but the paths are
			* the thing the message has to name.
			*/
			const [pickFor, setPickFor] = (0, react.useState)(void 0);
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
			/**
			* Put a received file's reference into the composer of the open conversation.
			*
			* Warned here rather than after the switch, because the switch is the problem:
			* the centre column would go to a blank-session screen and the reference would
			* sit parked behind it with nothing on screen to explain it.
			*
			* @param path - absolute path of a received file.
			*/
			const addReceived = (0, react.useCallback)((path) => {
				if (!hasSession()) {
					setNotice({
						text: t("noSession"),
						tone: "warn"
					});
					return;
				}
				addToConversation(path);
			}, [
				hasSession,
				addToConversation,
				t
			]);
			/** Show one received file in the platform's file manager. */
			const revealOne = (0, react.useCallback)((path) => {
				run(`reveal:${path}`, async () => {
					await revealFile(path);
				});
			}, [run, revealFile]);
			/**
			* Ask which conversation these files should go into.
			*
			* The picker's answer is the send, so nothing is sent from here: this only
			* records what is being sent and opens the dialog.
			*
			* @param paths - absolute paths of files that are on disk.
			*/
			const openPickerFor = (0, react.useCallback)((paths) => {
				if (paths.length === 0) return;
				setNotice(void 0);
				setPickFor(paths);
			}, []);
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
				event.stopPropagation();
				dragDepth.current += 1;
				setDragging(true);
			}, []);
			const onDragLeave = (0, react.useCallback)((event) => {
				event.stopPropagation();
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
				event.stopPropagation();
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
				event.stopPropagation();
				event.nativeEvent.stopImmediatePropagation();
				dragDepth.current = 0;
				setDragging(false);
				setDropTarget(void 0);
				stageFiles([...event.dataTransfer.files]);
			}, [stageFiles]);
			const dropOn = (0, react.useCallback)((peer, event) => {
				event.preventDefault();
				event.stopPropagation();
				event.nativeEvent.stopImmediatePropagation();
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dls-panel",
				"data-dragging": dragging ? "true" : "false",
				onDragEnter,
				onDragLeave,
				onDragOver,
				onDrop,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Transfers, {
							variant: "live",
							transfers: read.state.transfers.filter((transfer) => !(transfer.direction === "incoming" && transfer.status === "awaiting")),
							busyAction,
							t,
							now: Date.now(),
							onAddToConversation: addReceived,
							onSendToSession: openPickerFor,
							onReveal: revealOne,
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
						read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Nearby, {
							peers: read.state.peers,
							dragging,
							dropTarget,
							busyAction,
							t,
							onDragOverTile: setDropTarget,
							onDropOnTile: dropOn,
							onScan: () => {
								run("scan", async () => {
									const result = await scanNow();
									setNotice({
										text: result.found > 0 ? t("scanFound", { count: result.found }) : t("scanEmpty"),
										tone: "info"
									});
								});
							}
						}) : null,
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
						read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Transfers, {
							variant: "history",
							transfers: read.state.transfers.filter((transfer) => !(transfer.direction === "incoming" && transfer.status === "awaiting")),
							busyAction,
							t,
							now: Date.now(),
							onAddToConversation: addReceived,
							onSendToSession: openPickerFor,
							onReveal: revealOne,
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
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionPicker, {
					open: pickFor !== void 0,
					busy: false,
					tree: pickFor === void 0 ? { projects: [] } : readTargets(),
					t,
					onClose: () => {
						setPickFor(void 0);
					},
					onPick: (sessionId, label) => {
						const paths = pickFor ?? [];
						setPickFor(void 0);
						openInSession(sessionId, paths);
						setNotice({
							text: t("openedInSession", { title: label }),
							tone: "info"
						});
					}
				})]
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "dls-ident",
				"aria-label": t("thisDevice"),
				children: renaming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-identRename",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dls-input",
							value: draft,
							autoFocus: true,
							maxLength: 64,
							placeholder: t("renamePlaceholder"),
							"aria-label": t("renamePlaceholder"),
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
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dls-identBody",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-identName",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-stateDot",
							"data-ok": state.device.serving ? "true" : "false",
							"aria-hidden": true
						}), state.device.alias]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-identMeta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-tone": state.device.serving ? "ok" : "warn",
								children: state.device.serving ? t("serving") : t("notServing")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-identSep",
								"aria-hidden": true,
								children: "·"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-identFact",
								title: t("addressLabel"),
								children: address === void 0 ? t("noAddress") : `${address}:${String(state.device.port)}`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-identSep",
								"aria-hidden": true,
								children: "·"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dls-identFact",
								title: state.inbox,
								children: state.inbox
							})
						]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dls-action",
					"data-tone": "quiet",
					onClick: onStartRename,
					children: t("rename")
				})] })
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
							children: [t("stagedTitle"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
		function Nearby({ peers, dragging, dropTarget, busyAction, t, onDragOverTile, onDropOnTile, onScan }) {
			const now = Date.now();
			const scanning = busyAction === "scan";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section",
				"data-dragging": dragging ? "true" : "false",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-sectionHead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-sectionTitle",
						children: [t("nearby"), peers.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-count",
							children: peers.length
						}) : null]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-rowActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-note",
							children: peers.length > 0 ? t("dropHint") : null
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dls-action",
							"data-tone": "quiet",
							disabled: scanning,
							onClick: onScan,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, { size: 13 }), scanning ? t("scanning") : t("rescan")]
						})]
					})]
				}), peers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-empty",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dls-emptyTitle",
							children: t("noPeers")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dls-emptyHint",
							children: t("noPeersHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dls-action",
							"data-tone": "primary",
							disabled: scanning,
							onClick: onScan,
							children: t("rescan")
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dls-peers",
					children: peers.map((peer) => {
						const age = ageOf(peer.lastSeen, now);
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dls-tileMark",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeviceIcon, {
									type: peer.deviceType,
									size: 20
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-tileDot",
									"data-ok": peer.reachable ? "true" : "false",
									"aria-hidden": true
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dls-tileBody",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-tileName",
									"data-dropLabel": t("dropToSend"),
									children: peer.alias
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dls-tileMeta",
									children: sending ? t("sendingTo", { alias: peer.alias }) : peer.reachable ? `${deviceTypeLabel(t, peer.deviceType)} · ${peer.address}` : `${t("unreachable")}${age === void 0 ? "" : ` · ${t(age.key, age.params)}`}`
								})]
							})]
						}, peer.fingerprint);
					})
				})]
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
		/**
		* The transfer list, as one of its two readings.
		*
		* The panel draws this twice rather than once because the two halves answer
		* different questions and belong in different places: **live** rows are what is
		* happening now and sit above everything else, and **history** is a record and
		* sits at the bottom. One list in the middle of the panel made the reader do that
		* sorting themselves, and made a transfer that finishes jump the queue.
		*/
		function Transfers({ variant, transfers, busyAction, t, now, onAddToConversation, onSendToSession, onReveal, onStop, onRetry }) {
			const rows = variant === "live" ? transfers.filter((transfer) => transfer.status === "transferring") : transfers.filter((transfer) => transfer.status !== "transferring");
			if (variant === "live" && rows.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dls-section",
				"data-variant": variant,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dls-sectionHead",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dls-sectionTitle",
						children: [variant === "live" ? t("liveTitle") : t("transfers"), rows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dls-count",
							children: rows.length
						}) : null]
					}), variant === "history" && rows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dls-note",
						children: t("transfersHint")
					}) : null]
				}), rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					children: rows.map((transfer) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TransferLine, {
						transfer,
						busyAction,
						t,
						now,
						onAddToConversation,
						onSendToSession,
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
		function TransferLine({ transfer, busyAction, t, now, onAddToConversation, onSendToSession, onReveal, onStop, onRetry }) {
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
				if (transfer.bytesTotal > 0) {
					if (transfer.status === "transferring") {
						const elapsed = Math.max(1, now - transfer.createdAt);
						parts.push(`${formatBytes(transfer.bytesDone)} / ${formatBytes(transfer.bytesTotal)} · ${String(percent)}%`);
						const rate = formatRate(transfer.bytesDone, elapsed);
						if (rate !== void 0) parts.push(rate);
						const eta = etaOf(transfer.bytesTotal - transfer.bytesDone, transfer.bytesDone / (elapsed / 1e3));
						if (eta !== void 0) parts.push(t(eta.key, eta.params));
					} else parts.push(formatBytes(transfer.bytesTotal));
				}
				if (settled) {
					const age = ageOf(transfer.updatedAt, now);
					if (age !== void 0) parts.push(t(age.key, age.params));
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
									"data-status": transfer.status,
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
								onClick: () => {
									onSendToSession(saved.map((file) => file.savedPath));
								},
								children: t("sendToSession")
							}) : null,
							done && incoming && saved.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dls-action",
								"data-tone": "quiet",
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
		//#region src/client/local-path.ts
		/**
		* Read the bridge off the page, if this deployment has one.
		* @returns the bridge, or `undefined` outside the desktop shell.
		*/
		function hostPathsBridge() {
			const candidate = globalThis.__DSH_HOST_PATHS__;
			return typeof candidate === "object" && candidate !== null ? candidate : void 0;
		}
		/**
		* The absolute path of one file, when the shell can name it.
		*
		* Only a POSIX-absolute answer is accepted: `''` is the shell saying "this file
		* has no path" (pasted bytes), and anything relative would be resolved against
		* the host process's own working directory, which is not where the user's file
		* is.
		*
		* @param file - the file the user dropped or picked.
		* @param bridge - the shell bridge, if the deployment has one.
		* @returns the absolute path, or `undefined` when there is none.
		*/
		function localPathOf(file, bridge) {
			if (bridge?.pathFor === void 0) return void 0;
			try {
				const answer = bridge.pathFor(file);
				return typeof answer === "string" && answer.startsWith("/") ? answer : void 0;
			} catch {
				return;
			}
		}
		/**
		* The absolute paths of a whole batch, when every file has one.
		*
		* All-or-nothing on purpose: a batch that mixed a path send with a streamed
		* upload would arrive as two offers, two sessions and two rows, which is a
		* worse answer than one consistent path send or one consistent stream. A pasted
		* image in the batch therefore keeps the whole batch on the streaming route,
		* where every file is treated the same way.
		*
		* @param files - the files the user dropped or picked.
		* @param bridge - the shell bridge, if the deployment has one.
		* @returns the paths, or `undefined` when any file has none.
		*/
		function localPathsOf(files, bridge) {
			if (files.length === 0) return void 0;
			const paths = [];
			for (const file of files) {
				const path = localPathOf(file, bridge);
				if (path === void 0) return void 0;
				paths.push(path);
			}
			return paths;
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
			incomingFrom: "{alias} 想发送 {count} 个文件",
			incomingFromOne: "{alias} 想发送 {name}",
			incomingTotal: "共 {size}",
			accept: "接收",
			decline: "拒绝",
			transfers: "传输记录",
			liveTitle: "正在传输",
			stagedTitle: "待发送的文件",
			transfersHint: "本机收发过的文件都会留在这里；收件箱不会自动清理。",
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
			buddyDragHint: "拖动可以挪动位置",
			buddyHide: "暂时收起",
			ageNow: "刚刚",
			ageSeconds: "{seconds} 秒前",
			ageMinutes: "{minutes} 分钟前",
			etaSeconds: "还剩 {seconds} 秒",
			etaMinutes: "还剩 {minutes} 分钟",
			sendToSession: "发送到会话…",
			openedInSession: "已切到「{title}」，引用已放进输入框",
			sessionSwitchFailed: "无法切换到那个会话，请从左侧列表打开它再试",
			pickTitle: "发送到会话",
			pickDescription: "选一个项目，再选要发进去的会话",
			pickSearchPlaceholder: "搜索项目或会话",
			pickCurrent: "当前",
			pickRunning: "进行中",
			pickStale: "空会话",
			pickEmpty: "还没有可以发送的会话",
			pickEmptyHint: "先在左侧打开或新建一个会话，再回到这里发送。",
			pickNoMatch: "没有匹配的项目或会话",
			pickNoMatchHint: "换个关键词试试。",
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
			incomingFrom: "{alias} wants to send {count} files",
			incomingFromOne: "{alias} wants to send {name}",
			incomingTotal: "{size} in total",
			accept: "Receive",
			decline: "Decline",
			transfers: "Transfers",
			liveTitle: "Moving now",
			stagedTitle: "Files ready to send",
			transfersHint: "Everything this device has sent and received; the inbox is never cleared automatically.",
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
			buddyDragHint: "Drag to move it",
			buddyHide: "Hide for now",
			ageNow: "just now",
			ageSeconds: "{seconds}s ago",
			ageMinutes: "{minutes}m ago",
			etaSeconds: "{seconds}s left",
			etaMinutes: "{minutes}m left",
			sendToSession: "Send to conversation…",
			openedInSession: "Opened \"{title}\" with the reference in the composer",
			sessionSwitchFailed: "Could not open that conversation — open it from the sidebar and try again",
			pickTitle: "Send to conversation",
			pickDescription: "Pick a project, then the conversation to send it into",
			pickSearchPlaceholder: "Search projects or conversations",
			pickCurrent: "Open",
			pickRunning: "Running",
			pickStale: "Empty",
			pickEmpty: "No conversations to send to yet",
			pickEmptyHint: "Open or start a conversation in the sidebar, then come back.",
			pickNoMatch: "No matching project or conversation",
			pickNoMatchHint: "Try a different word.",
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

/* The identity card: who this device is, whether anything can arrive here, where
 * it is reachable, and where files land — with renaming attached to the name it
 * changes rather than to a settings row somewhere else. A card rather than a
 * labelled section, because all four facts are about one thing and the heading
 * above the panel already said what that thing is. */
.dls-ident {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
}

.dls-identBody {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-inline-size: 0;
}

.dls-identName {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* The one dot in this panel that is not about a transfer: whether this device can
 * be reached at all. The halo is what makes it readable as a state rather than as
 * a stray pixel at 7px across. */
.dls-stateDot {
  flex-shrink: 0;
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
}

.dls-stateDot[data-ok='true'] {
  background: var(--dsw-alias-state-success-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent);
}

.dls-identMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  min-inline-size: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dls-identMeta [data-tone='ok'] {
  color: var(--dsw-alias-state-success-primary);
}

.dls-identMeta [data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}

.dls-identFact {
  min-inline-size: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-identSep {
  color: var(--dsw-alias-label-tertiary);
}

.dls-identRename {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
}

/* --------------------------------------------------------------- section -- */

.dls-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dls-sectionHead {
  display: flex;
  gap: 10px;
  align-items: center;
  min-block-size: 24px;
}

/* The heading, then a hairline that runs out to the edge of the column. The rule
 * is not decoration: this panel scrolls, and a heading has to stay separable from
 * whatever scrolled up above it. */
.dls-sectionTitle {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}

.dls-sectionTitle::after {
  content: '';
  flex: 1;
  block-size: 1px;
  background: var(--dsw-alias-border-l2);
}

/* A count is a figure, so it is set apart from the sentence as one. */
.dls-count {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 500;
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
  padding: 13px 14px;
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
  position: relative;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  inline-size: 38px;
  block-size: 38px;
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}

/* Whether the device is answering, drawn on the glyph it belongs to. A device can
 * be discovered and still not answer, so this is a different fact from whether
 * the tile is a usable drop target. */
.dls-tileDot {
  position: absolute;
  inset-block-end: -2px;
  inset-inline-end: -2px;
  inline-size: 9px;
  block-size: 9px;
  border: 2px solid var(--dsw-alias-bg-layer-1);
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
}

.dls-tileDot[data-ok='true'] {
  background: var(--dsw-alias-state-success-primary);
}

/* With a file in hand, every tile that would take it says so at once: the drop
 * targets are the answer to the only question a drag is asking. */
.dls-section[data-dragging='true'] .dls-tile[data-reachable='true'] {
  border-color: var(--dsw-alias-brand-primary);
  border-style: dashed;
}

.dls-section[data-dragging='true'] .dls-tile[data-drop='true'] {
  border-style: solid;
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
  gap: 4px;
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

/* The verdict as a pill rather than as grey text after the title: every row now
 * carries one, which is what lets a reader scan the column for the ones that went
 * wrong instead of reading each line to its end. */
.dls-rowStatus {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
}

.dls-rowStatus[data-status='done'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.dls-rowStatus[data-status='transferring'] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-text);
}

.dls-rowStatus[data-status='awaiting'] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.dls-rowStatus[data-status='failed'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

/* The live list is the only place a row gets a surface of its own. It is what is
 * happening, it sits at the top of the panel, and the raised edge is what says
 * "this one, not the record below it". */
.dls-section[data-variant='live'] .dls-row {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
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

/* An empty screen is an invitation to act, so the action that ends the emptiness
 * belongs inside it rather than only in the section's own header. */
.dls-empty > .dls-action {
  margin-block-start: 12px;
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

/* ---------------------------------------------------- floating companion -- */

/* The companion is pinned to a corner of the window by default and to the user's
 * own coordinates once they have moved it. The wrapper is the anchor and takes no
 * pointer events, so a card sitting over a button can never eat the click; only
 * the card itself is interactive. */
.dls-pet {
  position: fixed;
  inset-block-end: 24px;
  inset-inline-end: 24px;
  z-index: 40;
  pointer-events: none;
}

/* A placed card is positioned by its own coordinates, so the default corner must
 * stop applying or the two would fight. */
.dls-pet[data-placed='true'] {
  inset-block-end: auto;
  inset-inline-end: auto;
}

.dls-petCard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  inline-size: max-content;
  max-inline-size: 324px;
  padding: 11px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 10px 30px rgb(0 0 0 / 14%);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  pointer-events: auto;
  /* The drag is the gesture, so the browser must not claim it for scrolling. */
  touch-action: none;
}

/* The tone escalates the card's edge rather than its fill: a tinted card over the
 * page would read as an alert, and two of these states are not alerts. */
.dls-petCard[data-tone='attention'] {
  border-color: var(--dsw-alias-state-warn-primary);
  animation: dls-pet-ask 1.9s ease-in-out infinite;
}

.dls-petCard[data-tone='busy'] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l2));
}

.dls-petCard[data-tone='good'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, var(--dsw-alias-border-l2));
}

.dls-petCard[data-tone='bad'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-border-l2));
}

/* The one state that is waiting on a person gets a halo, because it is the only
 * state where the transfer cannot proceed without the reader. */
@keyframes dls-pet-ask {
  0%,
  100% {
    box-shadow: 0 10px 30px rgb(0 0 0 / 14%), 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);
  }

  55% {
    box-shadow: 0 10px 30px rgb(0 0 0 / 14%), 0 0 0 6px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 0%, transparent);
  }
}

/* The whole head is the drag handle and the way to the panel, which is why it is
 * one button: pressing the fish to open the panel and dragging the fish to move it
 * are the same gesture until they are not. */
.dls-petHead {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 0 16px 0 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: grab;
}

.dls-petHead:active {
  cursor: grabbing;
}

.dls-petMark {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  color: var(--dsw-alias-label-secondary);
}

.dls-petCard[data-tone='attention'] .dls-petMark {
  color: var(--dsw-alias-state-warn-primary);
}

.dls-petCard[data-tone='busy'] .dls-petMark {
  color: var(--dsw-alias-brand-text);
}

.dls-petCard[data-tone='good'] .dls-petMark {
  color: var(--dsw-alias-state-success-primary);
}

.dls-petCard[data-tone='bad'] .dls-petMark {
  color: var(--dsw-alias-state-error-primary);
}

.dls-petText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-inline-size: 0;
}

.dls-petTitle {
  font-size: 13px;
  font-weight: 500;
}

.dls-petMeta {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-petBar {
  overflow: hidden;
  block-size: 3px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}

.dls-petBarFill {
  display: block;
  block-size: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-brand-primary);
  transition: inline-size 400ms linear;
}

.dls-petActions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

/* Discoverable by hover and by focus, never permanently on screen: putting the
 * fish away is not the common case, and a third button in the corner would make
 * the card look like a dialog. */
.dls-petHide {
  position: absolute;
  inset-block-start: 5px;
  inset-inline-end: 5px;
  display: grid;
  place-items: center;
  inline-size: 20px;
  block-size: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 140ms ease, color 140ms ease;
}

.dls-petCard:hover .dls-petHide,
.dls-petHide:focus-visible {
  opacity: 1;
}

.dls-petHide:hover {
  color: var(--dsw-alias-label-primary);
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
.dls-petCard[data-mood='moving'] .dlsFishTail {
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
.dls-menu {
  min-inline-size: 184px;
  max-inline-size: 320px;
  font-family: var(--dsw-font-family);
}

/* ------------------------------------------------------------- picker -- */

/* Sending a received file into a conversation: projects as headings, their
 * sessions under them, one press to send. The grouping is the two-step flow the
 * brief asked for with the second step already visible, because a project list
 * that replaced itself with a session list would hide the thing just chosen. */
.dls-pickDialog {
  inline-size: min(560px, 92vw);
}

.dls-pickContent {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-block-size: 0;
}

.dls-pickSearch {
  inline-size: 100%;
}

.dls-pickList {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-block-size: 52vh;
  overflow: auto;
  padding-inline-end: 2px;
}

.dls-pickGroup {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.dls-pickProject {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-inline-size: 0;
  padding: 0 10px 4px;
}

.dls-pickProjectName {
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
}

.dls-pickProjectPath {
  flex: 1;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-pickSession {
  display: flex;
  gap: 8px;
  align-items: center;
  inline-size: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

/* The highlight is what the keyboard is pointing at, so it follows the pointer as
 * well: two marks for one selection would disagree the moment a mouse moved. */
.dls-pickSession[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dls-pickSession:disabled {
  cursor: default;
  opacity: 0.6;
}

.dls-pickSessionName {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dls-pickRunning {
  flex-shrink: 0;
  color: var(--dsw-alias-state-success-primary);
  font-size: 11px;
}

.dls-pickNote {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.dls-pickBadge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
}

/* ------------------------------------------------------------ a11y/motion -- */

.dls-action:focus-visible,
.dls-tile:focus-visible,
.dls-composerButton:focus-visible,
.dls-input:focus-visible,
.dls-textarea:focus-visible,
.dls-petHead:focus-visible,
.dls-petHide:focus-visible,
.dls-pickSession:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .dls-tile,
  .dls-action,
  .dls-row,
  .dls-row::after,
  .dls-composerButton,
  .dls-petCard,
  .dls-petBarFill,
  .dls-petHide,
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
  .dls-petCard[data-tone='attention'],
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
		* The session currently open in the centre column.
		*
		* The product's own derivation: the main column retains exactly one session, and
		* that is the one a composer would be bound to. There is no selected-session
		* field to read — the selection store is private to the workspace plugin — so
		* the retention count is the contract every first-party caller uses too.
		*
		* @param ctx - client context.
		* @returns the open session's id, or `undefined` when none is bound.
		*/
		function currentSessionId(ctx) {
			const sessions = sessionsOf(ctx);
			if (sessions === void 0) return void 0;
			return Object.entries(sessions.list.getSnapshot().byId).find(([, row]) => (row.retainedBy["mainView"] ?? 0) > 0)?.[0];
		}
		/**
		* Every known session, in the shape the picker's model wants.
		*
		* Defaults are filled in here rather than trusted from the snapshot: a session row
		* missing `displayTitle` should read as a nameless session, not crash the dialog.
		*
		* @param ctx - client context.
		* @returns session rows keyed by id, empty when the service is absent.
		*/
		function sessionRowsOf(ctx) {
			const sessions = sessionsOf(ctx);
			if (sessions === void 0) return {};
			const rows = {};
			for (const [id, row] of Object.entries(sessions.list.getSnapshot().byId)) rows[id] = {
				id,
				displayTitle: typeof row.displayTitle === "string" && row.displayTitle !== "" ? row.displayTitle : id,
				...typeof row.title === "string" ? { title: row.title } : {},
				running: row.running === true,
				blank: row.blank === true,
				updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
				...row.origin === "subagent" ? { origin: "subagent" } : {}
			};
			return rows;
		}
		/**
		* Every project, in the shape the picker's model wants.
		*
		* @param ctx - client context.
		* @returns project rows, empty when the service is absent.
		*/
		function projectsOf(ctx) {
			const items = ctx.get("workspaces")?.list.getSnapshot().items;
			if (!Array.isArray(items)) return [];
			return items.map((item) => ({
				workspaceId: item.workspaceId,
				path: item.path,
				title: item.title,
				sessionIds: item.sessionIds,
				updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : ""
			}));
		}
		/**
		* Whether a conversation is currently open in the centre column.
		*
		* @param ctx - client context.
		* @returns whether a session is bound to the main column.
		*/
		function hasOpenSession(ctx) {
			return currentSessionId(ctx) !== void 0;
		}
		/**
		* Open one conversation and leave the files' references in its composer.
		*
		* Two steps, in this order: switch the centre column to that conversation, then
		* park the request. Parking first would let whichever composer is mounted
		* *right now* take it — the one belonging to the conversation the user is
		* leaving — which is the one bug this ordering exists to prevent. The insert
		* itself is performed by `ComposerEntry`, which only exists inside a
		* conversation's slot tree.
		*
		* Nothing is sent: the user asked for the reference to land in the draft so they
		* can say what they want said about it.
		*
		* @param ctx - client context.
		* @param sessionId - the conversation to open.
		* @param paths - absolute paths of the received files.
		*/
		function openInSession(ctx, sessionId, paths) {
			const workspace = ctx.get("uiWorkspace");
			if (workspace?.openSession !== void 0) try {
				workspace.openSession(sessionId);
			} catch {}
			if (currentSessionId(ctx) !== sessionId) {
				flash("sessionSwitchFailed", { tone: "error" });
				return;
			}
			ctx.layout.selectPanel(null);
			requestReference(paths);
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
				const localPaths = localPathsOf(files, hostPathsBridge());
				if (localPaths !== void 0) {
					await sendPaths({
						peer,
						paths: localPaths
					});
					return;
				}
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
				requestReference([path]);
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
				/** Every project and session a received file could be sent to. */
				readTargets: () => targetTree({
					projects: projectsOf(ctx),
					sessions: sessionRowsOf(ctx),
					currentSessionId: currentSessionId(ctx)
				}),
				openInSession: (sessionId, paths) => {
					openInSession(ctx, sessionId, paths);
				},
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
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "local-send.buddy",
				order: 25,
				locale: NS,
				inject: buddyFace
			}, FloatingBuddy));
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