/**
 * The companion's glyph: a small fish, and the postures it holds.
 *
 * Why a fish at all: DSH's own brand mark is a fish, so a companion drawn in
 * that shape reads as the application's own rather than as a widget bolted onto
 * the header. That is the whole argument for spending a drawing on something a
 * status dot could have said.
 *
 * Why mood is geometry and not colour: the mark has to inherit the state its row
 * is in, exactly as every glyph in `icons.tsx` does. Everything here is
 * `currentColor` and class names, so a stylesheet decides what "lost" looks
 * like and the same component works on either theme. A fish that hard-coded a
 * red for failure would be a fish that only had one palette.
 *
 * The stroke family deliberately matches `icons.tsx` — one weight, round joins,
 * the same 24-unit grid — because the companion sits in a row of the product's
 * own controls and a second visual language there would be visible.
 *
 * @module dsh-local-send/client/fish
 */

import type { ReactNode } from 'react'

/** Props every glyph in this module accepts. */
export interface FishProps {
  /** Requested square edge in pixels. */
  readonly size?: number
  /** Extra class names for the host element. */
  readonly className?: string
}

/** How the fish is holding itself, which is what says what is going on. */
export type FishMood =
  /** Nothing is happening: present, dim, unhurried. */
  | 'idle'
  /** A device is offering files. The fish is alert, looking at you. */
  | 'offered'
  /** Bytes are moving. `progress` says how far along. */
  | 'moving'
  /** It landed. The fish is pleased. */
  | 'landed'
  /** It went wrong. The fish is flat. */
  | 'lost'

/** What the fish is holding, if anything. */
export type FishCarrying = 'one' | 'many' | 'none'

/**
 * Shared stroke attributes.
 *
 * Re-declared rather than imported from `icons.tsx` so that module stays the
 * toolbar's family and this one stays the companion's: they happen to agree
 * today, and the reason they agree is a decision written down in both places
 * rather than a shared constant either could drift from silently.
 */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** The progress ring's radius on the 24-unit grid. */
const RING_RADIUS = 10.5

/**
 * The ring's own stroke treatment.
 *
 * Apart from the family's for one reason: **a round cap renders a zero-length
 * dash as a dot.** A progress arc of nothing has to be nothing, and a ring that
 * shows a bead at 0% is claiming a transfer has started when it has not. So the
 * ring's ends are square, and the fish's lines keep the family's round caps.
 */
const RING_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'butt',
  strokeLinejoin: 'round',
} as const

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
export function fishRingCircumference(radius: number): number {
  return 2 * Math.PI * radius
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
function fractionOf(progress: number | undefined): number {
  if (progress === undefined || !Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, progress)) / 100
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
function postureOf(mood: FishMood): string {
  switch (mood) {
    case 'offered':
      // Up and forward: alert.
      return 'rotate(-9 12 12)'
    case 'moving':
      // Nose down slightly, which is what a fish looks like getting somewhere.
      return 'rotate(3 12 12)'
    case 'landed':
      // A hop, and a shallower one than it first looks like it needs: the mark is
      // 18 pixels on screen, and a bigger angle turns a fish into a diagonal.
      return 'rotate(-10 12 12) translate(0 -1)'
    case 'lost':
      // Level but sagging.
      return 'rotate(6 12 12) translate(0 1)'
    case 'idle':
      return 'rotate(0 12 12)'
  }
}

/**
 * The companion mark.
 *
 * @param props - size and class, plus the posture and what it is carrying.
 * @returns the fish, as one `<svg>`.
 */
export function FishMark({
  size = 16,
  className,
  mood,
  progress,
  carrying = 'none',
}: FishProps & {
  /** Which posture to draw. */
  readonly mood: FishMood
  /** Fraction complete, 0–100, used only by `moving`. */
  readonly progress?: number
  /** What it is carrying, if anything. */
  readonly carrying?: FishCarrying
}): ReactNode {
  const fraction = fractionOf(progress)
  const circumference = fishRingCircumference(RING_RADIUS)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      data-fish-mood={mood}
      aria-hidden="true"
      focusable="false"
    >
      {mood === 'moving' ? (
        <>
          {/* The track first, so the filled arc is what the eye lands on. */}
          <circle className="dlsFishRingTrack" cx="12" cy="12" r={RING_RADIUS} {...RING_STROKE} />
          <circle
            className="dlsFishRing"
            cx="12"
            cy="12"
            r={RING_RADIUS}
            // Turned a quarter so the arc starts at the top and grows clockwise,
            // which is how every progress ring in the product reads.
            transform="rotate(-90 12 12)"
            // Both values spelled out rather than one: a single number is a dash
            // and a gap of that length, which happens to be right only because
            // the dash equals the whole circumference — and reads as a typo to
            // anybody who has to change the radius.
            strokeDasharray={`${String(circumference)} ${String(circumference)}`}
            strokeDashoffset={circumference * (1 - fraction)}
            {...RING_STROKE}
          />
        </>
      ) : null}

      {carrying !== 'none' ? (
        <g className="dlsFishLoad" {...STROKE}>
          {/* A stack is a sheet with a second one stepping out behind it, not two
              sheets side by side: at eighteen pixels a side-by-side pair reads as
              one wide blob, while a stepped edge reads as a pile. The back sheet
              is drawn first so the front one's outline stays unbroken. */}
          {carrying === 'many' ? (
            <rect x="9.4" y="3.6" width="4" height="4.4" rx="1" />
          ) : null}
          <rect x={carrying === 'many' ? 11.4 : 10.4} y={carrying === 'many' ? 4.8 : 4.2} width="4" height="4.4" rx="1" />
        </g>
      ) : null}

      <g transform={postureOf(mood)} {...STROKE}>
        {/* The tail is its own element so a stylesheet can flick it; everything
            else is one rigid animal. */}
        <path className="dlsFishTail" d="M6 12 2.6 9.4v5.2L6 12z" />
        <path d="M6 12c0-2.6 2.7-4.6 6-4.6s6 2 6 4.6-2.7 4.6-6 4.6-6-2-6-4.6z" />
        {mood === 'lost' ? (
          // A drooping dorsal fin: flat where the others are raised.
          <path d="M9.4 7.9h4.2" />
        ) : (
          <path d="M9.6 7.9c.7-1.3 1.8-2 3-2.2" />
        )}
        {/* The eye is filled rather than stroked: at 16 pixels a stroked circle
            this small fills in anyway, and an explicit fill is what keeps it
            round on a dense display. */}
        <circle cx="15.4" cy="10.9" r="0.85" fill="currentColor" stroke="none" />
      </g>

      {mood === 'offered' ? (
        <g className="dlsFishBubbles" {...STROKE}>
          <circle cx="18.4" cy="6.4" r="0.9" />
          <circle cx="20.6" cy="3.6" r="0.6" />
        </g>
      ) : null}

      {mood === 'landed' ? (
        // Above and clear of the dorsal fin: at this size a check overlapping the
        // fish is a smudge rather than a tick.
        <path className="dlsFishCheck" d="M15.2 4.6 16.6 6 19.4 2.8" {...STROKE} />
      ) : null}
    </svg>
  )
}
