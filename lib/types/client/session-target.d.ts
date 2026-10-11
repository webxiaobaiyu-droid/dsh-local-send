/**
 * Where a send could land: projects, the sessions inside them, and the message
 * that reaches the chosen one.
 *
 * Sending a file to yourself is a send to a *conversation*, not to a device, and
 * the picker that chooses one therefore has two levels: a project (the product
 * calls it a workspace) and then a session within it. Both levels are decisions —
 * what is a place a person can send to, which of two things is the answer when
 * neither is obviously first, and what the message body has to look like — so
 * every one of them is made here and the Modal that draws the picker makes none.
 * A component that decided, say, to hide empty projects would be deciding that
 * hidden thing twice, once in a place a test cannot see.
 *
 * Four of these decisions are the ones that go wrong quietly:
 *
 * - **A subagent's session is not a destination.** It is a machine talking to
 *   itself; a file dropped into it is read by nobody, and the sender would see a
 *   successful transfer into a conversation no person ever opens.
 * - **A session with no metadata row is dropped rather than invented.** A
 *   placeholder row for an id the host no longer knows would be a destination
 *   that fails on send, which is worse than a shorter list.
 * - **The project holding the current session leads**, however old it is. The
 *   most common send is to the conversation already on screen, and the second
 *   most common is to one beside it; a picker that buried the current project
 *   under newer ones would make the ordinary case the slow one.
 * - **The message is the mentions joined by a single space**, built through the
 *   caller's own `formatMention` rather than this module's idea of the grammar.
 *   The grammar belongs to `mention.ts`; duplicating it here would mean two
 *   spellings that can drift apart.
 *
 * @module dsh-local-send/client/session-target
 */
/** One project (called a workspace in the product). */
export interface ProjectRow {
    /** The workspace's identifier. */
    readonly workspaceId: string;
    /** Canonical host directory of the project. */
    readonly path: string;
    /** The project's display name. */
    readonly title: string;
    /** The sessions the project holds, in no particular order. */
    readonly sessionIds: readonly string[];
    /** ISO 8601 timestamp of the project's last activity. */
    readonly updatedAt: string;
}
/** One session's metadata. */
export interface SessionRow {
    /** The session's identifier, which is also its key in `TargetInput.sessions`. */
    readonly id: string;
    /** The title to fall back on when there is no user-given one. */
    readonly displayTitle: string;
    /** A title the user gave the session; absent in the ordinary case. */
    readonly title?: string;
    /** Whether the session is working right now. */
    readonly running: boolean;
    /** A session with no messages yet — nothing has ever been said in it. */
    readonly blank: boolean;
    /** Epoch milliseconds of the session's last activity. */
    readonly updatedAt: number;
    /** Present only for a session a subagent runs. */
    readonly origin?: 'subagent';
}
/** What the caller knows about the world. */
export interface TargetInput {
    /** Every project the host reported. */
    readonly projects: readonly ProjectRow[];
    /** Session metadata, keyed by session id. */
    readonly sessions: Readonly<Record<string, SessionRow>>;
    /**
     * The session the user is looking at, when there is one.
     *
     * `undefined` is a real case rather than a failure — the picker can be opened
     * from a place with no conversation behind it — and it means no project and no
     * session is marked as current.
     */
    readonly currentSessionId: string | undefined;
    /**
     * A corpus of file paths that no longer exist on disk.
     *
     * Carried because the caller reads it from the same snapshot, and reserved for
     * the send path that has a path to check; none of the rules below consult it,
     * so it never changes what this module returns.
     */
    readonly absentPaths?: readonly string[];
}
/** One session as the picker will draw it. */
export interface SessionChoice {
    /** The session's identifier, which is what a send is addressed to. */
    readonly id: string;
    /** What to print for the session. */
    readonly label: string;
    /** Whether the session is working right now. */
    readonly running: boolean;
    /** Whether this is the session the user is already looking at. */
    readonly isCurrent: boolean;
    /** Epoch milliseconds of the session's last activity, for the picker's own use. */
    readonly updatedAt: number;
    /**
     * Whether the session has never been used — a session with no messages yet.
     *
     * Named for what the row *looks* like rather than for its cause, because that
     * is the only thing the picker does with it: a blank session is the one that
     * gets the quieter treatment, since it has no history to recognise it by.
     */
    readonly stale: boolean;
}
/** One project as the picker will draw it, with its sessions already in order. */
export interface ProjectChoice {
    /** The workspace's identifier. */
    readonly id: string;
    /** The project's display name. */
    readonly label: string;
    /** The project's directory, shown under the name so two projects of one name differ. */
    readonly detail: string;
    /** The sessions a send can reach, newest first. */
    readonly sessions: readonly SessionChoice[];
    /** Whether the current session is one of them. */
    readonly isCurrent: boolean;
}
/** The whole picker model, projects in the order they should be listed. */
export interface TargetTree {
    /** The projects worth offering. Never contains an empty one. */
    readonly projects: readonly ProjectChoice[];
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
export declare function targetTree(input: TargetInput): TargetTree;
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
export declare function orderedChoices(tree: TargetTree): readonly SessionChoice[];
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
export declare function firstChoice(tree: TargetTree): SessionChoice | undefined;
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
export declare function targetMessage(paths: readonly string[], formatMention: (path: string) => string | undefined): string | undefined;
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
export declare function filterTree(tree: TargetTree, query: string): TargetTree;
