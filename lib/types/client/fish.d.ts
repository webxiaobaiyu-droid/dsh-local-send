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
import type { ReactNode } from 'react';
/** Props every glyph in this module accepts. */
export interface FishProps {
    /** Requested square edge in pixels. */
    readonly size?: number;
    /** Extra class names for the host element. */
    readonly className?: string;
}
/** How the fish is holding itself, which is what says what is going on. */
export type FishMood = 
/** Nothing is happening: present, dim, unhurried. */
'idle'
/** A device is offering files. The fish is alert, looking at you. */
 | 'offered'
/** Bytes are moving. `progress` says how far along. */
 | 'moving'
/** It landed. The fish is pleased. */
 | 'landed'
/** It went wrong. The fish is flat. */
 | 'lost';
/** What the fish is holding, if anything. */
export type FishCarrying = 'one' | 'many' | 'none';
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
export declare function fishRingCircumference(radius: number): number;
/**
 * The companion mark.
 *
 * @param props - size and class, plus the posture and what it is carrying.
 * @returns the fish, as one `<svg>`.
 */
export declare function FishMark({ size, className, mood, progress, carrying, }: FishProps & {
    /** Which posture to draw. */
    readonly mood: FishMood;
    /** Fraction complete, 0–100, used only by `moving`. */
    readonly progress?: number;
    /** What it is carrying, if anything. */
    readonly carrying?: FishCarrying;
}): ReactNode;
