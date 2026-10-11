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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { companionView } from './companion.ts'
import { FishMark } from './fish.tsx'
import { formatBytes, formatRate, percentOf } from './format.ts'
import { CrossIcon } from './icons.tsx'
import { useTransferState, type TransferStore } from './state.ts'

/** Registration-side face the floating companion reads and acts through. */
export interface FloatingBuddyInjected {
  /** The shared state store; the companion also keeps it polling. */
  store: TransferStore
  /** Answer an offer, taking or refusing every file on it. */
  answer: (transferId: string, accept: boolean) => Promise<void>
  /** Stop a transfer this device is part of. */
  cancel: (transferId: string) => Promise<void>
  /** Bring the transfer panel forward. */
  openPanel: () => void
}

/** Full component props assembled by the overlay renderer. */
export type FloatingBuddyProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'localSend'>
  & InjectFace<FloatingBuddyInjected>

/** Where the user last put it, remembered across reloads. */
const POSITION_KEY = 'dls.buddy.position'

/**
 * How far the pointer must travel before a press counts as a drag.
 *
 * Small enough to feel immediate, large enough that the wobble in a normal click
 * does not turn into a two-pixel move that swallows the press.
 */
const DRAG_THRESHOLD_PX = 4

/** Distance kept from every viewport edge, so the fish can always be grabbed. */
const EDGE_INSET_PX = 16

/** One corner of the viewport, in pixels from the top-left. */
interface Point {
  readonly x: number
  readonly y: number
}

/** The size a drag is clamping against, captured when the drag starts. */
interface DragState {
  readonly pointerX: number
  readonly pointerY: number
  readonly originX: number
  readonly originY: number
  readonly width: number
  readonly height: number
  moved: boolean
}

/** Read the remembered position, tolerating a hand-edited or stale value. */
function storedPosition(): Point | undefined {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { x, y } = parsed as { x?: unknown; y?: unknown }
    return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
      ? { x, y }
      : undefined
  } catch {
    // A browser with storage disabled is not a reason to fail a render.
    return undefined
  }
}

/** Keep a coordinate inside the viewport. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Show the companion, and let the user act on whatever it is showing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function FloatingBuddy(props: FloatingBuddyProps): ReactNode {
  const { t, store, answer, cancel, openPanel } = props
  const read = useTransferState(store)
  const [position, setPosition] = useState<Point | undefined>(storedPosition)
  const [busy, setBusy] = useState(false)
  /**
   * The event the user has already put away.
   *
   * Keyed by the thing being reported rather than latched as a boolean, so
   * dismissing one offer cannot suppress the next one.
   */
  const [hidden, setHidden] = useState<string | undefined>(undefined)
  const card = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | undefined>(undefined)
  /** Set by a drag that moved, read by the next click so it is not a press. */
  const dragged = useRef(false)

  useEffect(() => store.retain(), [store])

  // The same derivation the header mark used, and the same one the tests already
  // pin: the pet has no rules of its own about what is worth showing.
  const view = companionView(read, Date.now())
  const focus = view.focus
  const key = focus === undefined ? undefined : `${focus.id}:${focus.status}`
  const visible = view.visible && key !== undefined && key !== hidden

  // A different situation is a different decision, so a press that was slow to
  // settle must not leave the next one looking already answered.
  useEffect(() => { setBusy(false) }, [key])

  useEffect(() => {
    if (!visible) return
    // Pointer events are followed on the window rather than on the card, because
    // a fast drag outruns the element under the pointer and the card would stop
    // receiving moves halfway through the gesture.
    function onMove(event: PointerEvent): void {
      const state = drag.current
      if (state === undefined) return
      const dx = event.clientX - state.pointerX
      const dy = event.clientY - state.pointerY
      if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      state.moved = true
      setPosition({
        x: clamp(state.originX + dx, EDGE_INSET_PX, window.innerWidth - state.width - EDGE_INSET_PX),
        y: clamp(state.originY + dy, EDGE_INSET_PX, window.innerHeight - state.height - EDGE_INSET_PX),
      })
    }
    function onUp(): void {
      const state = drag.current
      drag.current = undefined
      if (state === undefined || !state.moved) return
      dragged.current = true
      const node = card.current
      if (node === null) return
      const rect = node.getBoundingClientRect()
      const settled = { x: rect.left, y: rect.top }
      setPosition(settled)
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(settled))
      } catch {
        // Not being able to remember the position is not worth telling anyone about.
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [visible])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const rect = card.current?.getBoundingClientRect()
    if (rect === undefined) return
    dragged.current = false
    drag.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    }
  }, [])

  /** Open the panel, unless this press was the end of a drag. */
  const onOpen = useCallback((): void => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    openPanel()
  }, [openPanel])

  const run = useCallback((action: () => Promise<void>): void => {
    if (busy) return
    setBusy(true)
    void action().then(
      () => { void store.refresh(); setBusy(false) },
      () => { setBusy(false) },
    )
  }, [busy, store])

  if (!visible || focus === undefined || key === undefined) return null

  const moving = view.mood === 'moving'
  const offered = view.mood === 'offered'
  const percent = moving ? percentOf(focus.bytesDone, focus.bytesTotal) : 0
  // An unknowable total draws no figure at all: "0%" beside a transfer that is
  // really moving would be a claim this surface cannot support.
  const known = focus.bytesTotal > 0
  const rate = moving && known ? formatRate(focus.bytesDone, Math.max(1, Date.now() - focus.createdAt)) : undefined
  const detail = moving && known
    ? `${formatBytes(focus.bytesDone)} / ${formatBytes(focus.bytesTotal)}`
    : t('incomingTotal', { size: formatBytes(focus.bytesTotal) })

  return (
    <div
      className="dls-pet"
      data-placed={position === undefined ? 'false' : 'true'}
      {...position === undefined ? {} : { style: { left: `${String(position.x)}px`, top: `${String(position.y)}px` } }}
    >
      <div
        ref={card}
        className="dls-petCard"
        data-tone={view.tone}
        data-mood={view.mood}
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          className="dls-petHead"
          title={t('buddyDragHint')}
          aria-label={t('openPanel')}
          onPointerDown={onPointerDown}
          onClick={onOpen}
        >
          <span className="dls-petMark" aria-hidden>
            <FishMark
              size={30}
              mood={view.mood}
              carrying={view.carrying}
              {...view.progress === undefined ? {} : { progress: view.progress }}
            />
          </span>
          <span className="dls-petText">
            <span className="dls-petTitle">{t(view.labelKey, view.labelParams)}</span>
            <span className="dls-petMeta">
              {detail}
              {rate === undefined ? null : ` · ${rate}`}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="dls-petHide"
          aria-label={t('buddyHide')}
          title={t('buddyHide')}
          onClick={() => { setHidden(key) }}
        >
          <CrossIcon size={12} />
        </button>

        {moving || offered
          ? (
            <span className="dls-petBar" aria-hidden>
              <span className="dls-petBarFill" style={{ inlineSize: `${String(percent)}%` }} />
            </span>
          )
          : null}

        <span className="dls-petActions">
          {offered
            ? (
              <>
                <button
                  type="button"
                  className="dls-action"
                  data-tone="primary"
                  disabled={busy}
                  onClick={() => { run(async () => { await answer(focus.id, true) }) }}
                >
                  {t('accept')}
                </button>
                <button
                  type="button"
                  className="dls-action"
                  disabled={busy}
                  onClick={() => { run(async () => { await answer(focus.id, false) }) }}
                >
                  {t('decline')}
                </button>
              </>
            )
            : null}
          {moving
            ? (
              <button
                type="button"
                className="dls-action"
                disabled={busy}
                onClick={() => { run(async () => { await cancel(focus.id) }) }}
              >
                {t('stopTransfer')}
              </button>
            )
            : null}
          {!moving && !offered
            ? (
              <button type="button" className="dls-action" data-tone="quiet" onClick={onOpen}>
                {t('openPanel')}
              </button>
            )
            : null}
        </span>
      </div>
    </div>
  )
}
