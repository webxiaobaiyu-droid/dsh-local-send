/**
 * The notification surface: the one thing this plugin has to say to somebody who
 * is not looking at it.
 *
 * Two messages want the top of the window, and they overlap in exactly the way
 * that argues for one component owning both:
 *
 * - **An offer.** The sender is holding a connection open and a person has to
 *   answer, so this has to fire wherever the user happens to be — including
 *   inside a conversation with the transfer panel nowhere on screen. The hold is
 *   deliberately long: the host gives a sender ninety seconds, and a toast that
 *   vanished after the usual three would take the only Accept button with it
 *   while the offer was still live.
 * - **A confirmation.** "Added to the composer", "copied", "sent to…". These are
 *   short, and they exist because the gesture that earned them took the surface
 *   that would otherwise have shown them away — see `flash.ts`.
 *
 * Two independent toasts would be two banners drawn in the same place, one
 * across the other. So one component arbitrates, and the rule is that **an offer
 * always wins**: it is a request from another person with a deadline, and a
 * three-second acknowledgement of something the user already watched happen can
 * afford to lose. A confirmation that arrives while an offer is on screen is
 * discarded rather than queued — by the time the offer is answered, the
 * connection between the gesture and the message would be gone, and a stale
 * confirmation is worse than none.
 *
 * It is the product's own `Toast` primitive rather than a bespoke surface,
 * because a notification that looked unlike every other notification in the
 * window would read as an interruption instead of as the application talking. It
 * also portals itself to the document body, which is what lets it escape the
 * overlay layer's own box.
 *
 * @module dsh-local-send/client/NoticeToast
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { clearFlash, readFlash, subscribeFlash } from './flash.ts'
import { formatBytes } from './format.ts'
import { ReceiveIcon } from './icons.tsx'
import { noticeOffer } from './notice.ts'
import { useTransferState, type TransferStore } from './state.ts'

/**
 * How long an offer stays before fading.
 *
 * Longer than the host's own ninety-second window would be pointless — by then
 * the offer has already been refused — and shorter would drop it while it still
 * mattered. See the module note.
 */
const OFFER_HOLD_MS = 85_000

/**
 * How long a confirmation stays.
 *
 * Shorter than the product's own default, because these have nothing to act on:
 * the user has already done the thing, and the message is only telling them it
 * worked. Long enough to read a short sentence and no longer.
 */
const FLASH_HOLD_MS = 2_600

/**
 * What sits between the sentence and each action.
 *
 * Punctuation rather than copy, which is why it is not in the dictionary — the
 * same reason the panel joins a row's figures with it directly.
 */
const ACTION_SEPARATOR = ' · '

/** Registration-side face the notification reads. */
export interface NoticeToastInjected {
  /** The shared state store. */
  store: TransferStore
  /** Answer an offer. */
  answer: (
    transferId: string,
    accept: boolean,
    fileIds?: readonly string[],
  ) => Promise<void>
}

/** Full component props assembled by the overlay renderer. */
export type NoticeToastProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'localSend'>
  & InjectFace<NoticeToastInjected>

/**
 * Show an offer, a confirmation, or nothing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function NoticeToast(props: NoticeToastProps): ReactNode {
  const { t, store, answer } = props
  const read = useTransferState(store)
  const [busy, setBusy] = useState(false)
  /**
   * The offer the reader has already dismissed.
   *
   * Held here and passed down rather than latched inside a render guard, so that
   * dismissing one offer cannot suppress the next one. See `notice.ts`.
   */
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  /** Drives re-render when a confirmation is posted, which is not React state. */
  const [, setRevision] = useState(0)

  useEffect(() => store.retain(), [store])
  useEffect(() => subscribeFlash(() => { setRevision(value => value + 1) }), [])

  const waiting = noticeOffer(read, dismissed)
  const message = readFlash()

  // An offer that has been answered or withdrawn disappears on its own, so the
  // busy mark belongs to the offer on screen rather than to this component's
  // lifetime.
  useEffect(() => { setBusy(false) }, [waiting?.id])

  // The arbitration in the module note, carried out in an effect rather than
  // during render because it writes to the flash store: a render-phase write
  // would run twice under React's strict double-invocation.
  useEffect(() => {
    if (waiting === undefined || message === undefined) return
    clearFlash(message.id)
  }, [waiting, message])

  const decide = useCallback((accept: boolean): void => {
    if (waiting === undefined) return
    // The toast primitive has no disabled action, so a second click on a slow
    // answer would post a second decision. The host would drop it — the offer is
    // already settled — but refusing it here is what keeps the surface honest
    // about having been pressed once.
    if (busy) return
    setBusy(true)
    // No file list, so the host reads this as "every file its own limits left
    // standing" rather than as an empty selection. See `DecideRequest`.
    void answer(waiting.id, accept).then(
      () => { void store.refresh() },
      () => { setBusy(false) },
    )
  }, [waiting, busy, answer, store])

  if (waiting !== undefined) {
    const count = waiting.files.length
    // The summary states what is being offered and, for a single file, which one.
    // The detail then adds only what the summary cannot: how much.
    const summary = count === 1
      ? t('incomingFromOne', { alias: waiting.peerAlias, name: waiting.files[0]?.fileName ?? '' })
      : t('incomingFrom', { alias: waiting.peerAlias, count })
    const text = `${summary} · ${t('incomingTotal', { size: formatBytes(waiting.bytesTotal) })}`

    return (
      <Toast
        // The key is what restarts the hold: a different offer is a new
        // notification rather than the remainder of this one's.
        key={waiting.id}
        text={text}
        icon={<ReceiveIcon size={18} />}
        holdMs={OFFER_HOLD_MS}
        // The separators ride on the actions rather than on the text, which is
        // what the product's own toasts do: a prefix is read as punctuation
        // introducing the next action, so it never doubles up on a label the way
        // a separator baked into the sentence would.
        actions={[
          { prefix: ACTION_SEPARATOR, label: t('accept'), onClick: () => { decide(true) } },
          { prefix: ACTION_SEPARATOR, label: t('decline'), onClick: () => { decide(false) } },
        ]}
        // Fading is not answering: the offer is still waiting, and the panel still
        // shows it with its own buttons. Dismissing only silences this surface.
        onDone={() => { setDismissed(waiting.id) }}
      />
    )
  }

  if (message === undefined) return null

  return (
    <Toast
      // Keyed by the message, so a confirmation replacing another restarts the
      // hold instead of inheriting the time the first one had already used.
      key={message.id}
      text={t(message.key, message.params)}
      // A confirmation that worked gets the product's own success glyph; one
      // that failed keeps no glyph rather than a green tick beside bad news.
      // Spread rather than set to `undefined`, because the property is optional
      // under `exactOptionalPropertyTypes` and an explicit undefined is not the
      // same thing as leaving it out.
      {...message.tone === 'error' ? {} : { tone: 'success' as const }}
      holdMs={FLASH_HOLD_MS}
      onDone={() => { clearFlash(message.id) }}
    />
  )
}
