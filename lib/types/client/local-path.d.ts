/**
 * The absolute path behind a dropped or picked file, when the desktop shell
 * can name one.
 *
 * A browser `File` is bytes, not a location: the only thing the renderer can do
 * with one is stream it to the host, and the host then streams it to the peer.
 * That works for anything the host could not otherwise reach — pasted images,
 * files inside a sandbox — but for a file that already lives on this disk it is
 * one avoidable copy, and for a multi-gigabyte image it is the copy that has to
 * be avoided: the bytes would travel renderer → web server → host → peer, with
 * the browser's own upload machinery in the middle.
 *
 * The desktop shell exposes `__DSH_HOST_PATHS__.pathFor(file)`, which is
 * Electron's `webUtils.getPathForFile`. When it answers, the plugin can hand the
 * *path* to the host instead and let it read the disk directly — the same route
 * 「按路径发送」 takes, with the same zero-copy behaviour.
 *
 * Everything here tolerates absence: the web deployment has no shell, a pasted
 * `File` has no path, and a shell that throws must not turn a drop into an error.
 *
 * @module dsh-local-send/client/local-path
 */
/** The bridge the desktop preload publishes. */
export interface HostPathsBridge {
    /** Absolute path of a file the user dropped or picked, or `''`. */
    readonly pathFor?: (file: File) => string;
}
/**
 * Read the bridge off the page, if this deployment has one.
 * @returns the bridge, or `undefined` outside the desktop shell.
 */
export declare function hostPathsBridge(): HostPathsBridge | undefined;
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
export declare function localPathOf(file: File, bridge: HostPathsBridge | undefined): string | undefined;
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
export declare function localPathsOf(files: readonly File[], bridge: HostPathsBridge | undefined): readonly string[] | undefined;
