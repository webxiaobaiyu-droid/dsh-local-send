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
export declare function formatBytes(bytes: number): string;
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
export declare function formatRate(bytes: number, elapsedMs: number): string | undefined;
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
export declare function formatAge(timestamp: number, now: number): string | undefined;
/**
 * A remaining-time estimate.
 *
 * Clamped and rounded because an estimate is a comfort, not a measurement: a
 * figure that reads "3s" then "1m 40s" is worse than one that counts down
 * smoothly, and the clamp is what stops a transient stall from flashing a
 * number in the hours.
 *
 * @param remaining - bytes still to move.
 * @param bytesPerSecond - the current rate.
 * @returns a string like `12s` or `2m`, or `undefined` when no rate is known.
 */
export declare function formatEta(remaining: number, bytesPerSecond: number): string | undefined;
/**
 * A whole-transfer completion percentage.
 * @param done - bytes moved.
 * @param total - bytes expected.
 * @returns an integer 0–100.
 */
export declare function percentOf(done: number, total: number): number;
/**
 * The last path segment of an absolute path.
 *
 * Handles both separators because a received file's path is rendered beside
 * peers that may have sent it from any platform, and a Windows-style name should
 * still read as a name.
 *
 * @param path - an absolute path.
 * @returns the final segment.
 */
export declare function fileNameOf(path: string): string;
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
export declare function shortenFileName(name: string, limit: number): string;
