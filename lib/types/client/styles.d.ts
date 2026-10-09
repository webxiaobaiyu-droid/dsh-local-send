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
export declare const STYLE_ID = "dsh-local-send/styles";
/** The complete stylesheet, scoped by the `dls-` class prefix. */
export declare const styles: string;
