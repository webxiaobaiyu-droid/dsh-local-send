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
export const STYLE_ID = 'dsh-local-send/styles'

/** The complete stylesheet, scoped by the `dls-` class prefix. */
export const styles = String.raw`
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
`
