/**
 * Local LAN file transfer, Host half: the transfer API, the discovery loop, and
 * the routes the panel drives them through.
 *
 * This plugin is self-contained on purpose. A Typert Remote namespace would be
 * tidier, but it only reaches the browser when the product's own Remote assembly
 * mounts it, and that list lives inside the harness repository — which would
 * make this package impossible to install on its own. Registered Fetch routes
 * cost a little plumbing and buy a plugin any deployment can load by path.
 *
 * Two listeners exist here and they are not interchangeable:
 *
 * - The **LocalSend API** ({@link LocalSendServer}) is a plain `node:http` server
 *   on the protocol's own port, because the peers that dial it are phones and
 *   laptops running the official app. They carry no session cookie, so nothing
 *   behind the harness's trust fence could ever serve them.
 * - The **panel routes** are registered on this plugin's own Fetch paths, so the
 *   browser half reaches them with the page's own credentials and no extra
 *   listening surface.
 *
 * The panel's byte-streaming route is registered as `streaming` rather than
 * `buffered`, which is the one carrier option that matters here: a file dropped
 * on the panel is piped from the browser's request straight into the request to
 * the peer, so a multi-gigabyte drag-and-drop costs one buffer rather than the
 * whole file in memory, and never touches the disk on the way through.
 *
 * @module dsh-local-send
 */
import type { Context } from '@deepseek-ai/cordis';
import { type LocalSendConfig } from './store.ts';
export type * from './types.ts';
/** Plugin name the loader row addresses. */
export declare const name = "dsh-local-send";
/** Services this plugin cannot work without: the carrier's route registry. */
export declare const inject: string[];
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
export declare function apply(ctx: Context, config?: Partial<LocalSendConfig>): void;
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
export declare function isInside(directory: string, candidate: string): boolean;
