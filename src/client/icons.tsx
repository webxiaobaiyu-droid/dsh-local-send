/**
 * The panel's glyphs.
 *
 * One stroked family at a consistent weight, drawn on the same 24-unit grid the
 * product's own icons use and painted with `currentColor`, so an icon inherits
 * whatever state its row is in rather than carrying a colour of its own. That is
 * what lets a device tile dim its icon when the peer stops answering without a
 * second icon existing for the dimmed case.
 *
 * The device marks are deliberately schematic — a phone is a tall rounded rect,
 * a desktop is a screen on a stand — because their job is to be told apart at
 * 16 pixels in a list, not to be illustrations.
 *
 * @module dsh-local-send/client/icons
 */

import type { ReactNode } from 'react'
import type { DeviceType } from '../types.ts'

/** Props every glyph in this module accepts. */
export interface GlyphProps {
  /** Square edge in pixels. */
  readonly size?: number
  /** Extra class names for the host element. */
  readonly className?: string
}

/** Shared attributes: one weight, round joins, inherited colour. */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Wrap one glyph's paths in the common svg element. */
function Svg(
  { size = 16, className, children, viewBox = '0 0 24 24' }:
  GlyphProps & { readonly children: ReactNode; readonly viewBox?: string },
): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * The sidebar mark: two devices exchanging a file.
 *
 * Two facing brackets with an arrow passing each way between them — the glyph
 * says "transfer" without borrowing LocalSend's own logo, which belongs to that
 * project rather than to this plugin.
 *
 * @param props - size and class.
 */
export function HandoffIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 5.5h3.5v13H4" {...STROKE} />
      <path d="M20 5.5h-3.5v13H20" {...STROKE} />
      <path d="M9 9.5h4.5" {...STROKE} />
      <path d="M11.6 7.6 13.5 9.5l-1.9 1.9" {...STROKE} />
      <path d="M15 14.5h-4.5" {...STROKE} />
      <path d="M12.4 12.6 10.5 14.5l1.9 1.9" {...STROKE} />
    </Svg>
  )
}

/** A phone: tall rounded rect with a home indicator. */
function MobileMark(): ReactNode {
  return (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" {...STROKE} />
      <path d="M10.5 18.5h3" {...STROKE} />
    </>
  )
}

/** A computer: screen on a stand. */
function DesktopMark(): ReactNode {
  return (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" {...STROKE} />
      <path d="M9 20h6" {...STROKE} />
      <path d="M12 16.5V20" {...STROKE} />
    </>
  )
}

/** A browser: window with a chrome bar. */
function WebMark(): ReactNode {
  return (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" {...STROKE} />
      <path d="M2.5 8.5h19" {...STROKE} />
      <path d="M5.5 6.4h.01M8 6.4h.01" {...STROKE} />
    </>
  )
}

/** A terminal: prompt and caret. */
function HeadlessMark(): ReactNode {
  return (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" {...STROKE} />
      <path d="M6.5 9.5 9 12l-2.5 2.5" {...STROKE} />
      <path d="M11.5 14.5H17" {...STROKE} />
    </>
  )
}

/** A server: stacked rack units. */
function ServerMark(): ReactNode {
  return (
    <>
      <rect x="3" y="3.5" width="18" height="7" rx="1.8" {...STROKE} />
      <rect x="3" y="13.5" width="18" height="7" rx="1.8" {...STROKE} />
      <path d="M6.5 7h.01M6.5 17h.01" {...STROKE} />
    </>
  )
}

/**
 * The mark for one device class.
 *
 * An unknown class falls back to the desktop mark, which is what the reference
 * implementation does and what the protocol's own guidance asks for: the field
 * exists so a peer can pick an icon, so an unrecognized value must still leave a
 * peer looking like a device rather than like an error.
 *
 * @param props - size, class, and which class of device.
 */
export function DeviceIcon({ type, ...props }: GlyphProps & { readonly type: DeviceType | null }): ReactNode {
  const marks: Record<DeviceType, ReactNode> = {
    mobile: <MobileMark />,
    desktop: <DesktopMark />,
    web: <WebMark />,
    headless: <HeadlessMark />,
    server: <ServerMark />,
  }
  return <Svg {...props}>{marks[type ?? 'desktop'] ?? <DesktopMark />}</Svg>
}

/** An arrow leaving a device: this file is going out. */
export function SendIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 19V5" {...STROKE} />
      <path d="m6.5 10.5 5.5-5.5 5.5 5.5" {...STROKE} />
    </Svg>
  )
}

/** An arrow arriving at a device: this file is coming in. */
export function ReceiveIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 5v14" {...STROKE} />
      <path d="m6.5 13.5 5.5 5.5 5.5-5.5" {...STROKE} />
    </Svg>
  )
}

/** A completed row. */
export function CheckIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" {...STROKE} />
    </Svg>
  )
}

/** A refused or failed row. */
export function CrossIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" {...STROKE} />
    </Svg>
  )
}

/** A row that was stopped rather than finished. */
export function HaltIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M9 9h6v6H9z" {...STROKE} />
    </Svg>
  )
}

/** An address, for the copy affordance. */
export function LinkIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4" {...STROKE} />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.4-1.4" {...STROKE} />
    </Svg>
  )
}

/** The search action. */
export function SearchIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" {...STROKE} />
      <path d="m16 16 4 4" {...STROKE} />
    </Svg>
  )
}

/** A folder, for revealing a saved file. */
export function FolderIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l1.8 2.2H19a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...STROKE} />
    </Svg>
  )
}

/** A warning that is not a failure: the device is visible but silent. */
export function AlertIcon(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 4.5 21 19.5H3z" {...STROKE} />
      <path d="M12 10v4" {...STROKE} />
      <path d="M12 17h.01" {...STROKE} />
    </Svg>
  )
}
