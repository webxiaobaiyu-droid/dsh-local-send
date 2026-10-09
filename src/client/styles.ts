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
`
