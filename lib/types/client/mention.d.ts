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
export declare function formatMention(path: string): string | undefined;
