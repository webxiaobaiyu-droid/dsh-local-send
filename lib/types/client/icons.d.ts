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
import type { ReactNode } from 'react';
import type { DeviceType } from '../types.ts';
/** Props every glyph in this module accepts. */
export interface GlyphProps {
    /** Square edge in pixels. */
    readonly size?: number;
    /** Extra class names for the host element. */
    readonly className?: string;
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
export declare function HandoffIcon(props: GlyphProps): ReactNode;
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
export declare function DeviceIcon({ type, ...props }: GlyphProps & {
    readonly type: DeviceType | null;
}): ReactNode;
/** An arrow leaving a device: this file is going out. */
export declare function SendIcon(props: GlyphProps): ReactNode;
/** An arrow arriving at a device: this file is coming in. */
export declare function ReceiveIcon(props: GlyphProps): ReactNode;
/** A completed row. */
export declare function CheckIcon(props: GlyphProps): ReactNode;
/** A refused or failed row. */
export declare function CrossIcon(props: GlyphProps): ReactNode;
/** A row that was stopped rather than finished. */
export declare function HaltIcon(props: GlyphProps): ReactNode;
/** An address, for the copy affordance. */
export declare function LinkIcon(props: GlyphProps): ReactNode;
/** The search action. */
export declare function SearchIcon(props: GlyphProps): ReactNode;
/** A folder, for revealing a saved file. */
export declare function FolderIcon(props: GlyphProps): ReactNode;
/** A warning that is not a failure: the device is visible but silent. */
export declare function AlertIcon(props: GlyphProps): ReactNode;
