/**
 * The receive notification.
 *
 * An offer is the one thing this plugin has to say to somebody who is not
 * looking at it: the sender is holding a connection open and a person has to
 * answer. So this lives in the frame-wide overlay rather than in the panel, and
 * it fires wherever the user happens to be — including inside a conversation
 * with the transfer panel nowhere on screen.
 *
 * It is the product's own `Toast` primitive rather than a bespoke surface,
 * because a notification that looked unlike every other notification in the
 * window would read as an interruption instead of as the application talking. It
 * also portals itself to the document body, which is what lets it escape the
 * overlay layer's own box.
 *
 * The hold is deliberately long. The host gives a sender ninety seconds before
 * answering for the user, and a toast that vanished after the usual three would
 * take the only Accept button with it while the offer was still live.
 *
 * @module dsh-local-send/client/ReceiveToast
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatBytes } from './format.ts'
import { ReceiveIcon } from './icons.tsx'
import type { LocalSendLocaleKey } from './locales.ts'
import { noticeOffer } from './notice.ts'
import { useTransferState, type TransferStore } from './state.ts'

/**
 * How long the notification stays before fading.
 *
 * Longer than the host's own ninety-second window would be pointless — by then
 * the offer has already been refused — and shorter would drop it while it still
 * mattered. See the module note.
 */
const HOLD_MS = 85_000

/** Registration-side face the notification reads. */
export interface ReceiveToastInjected {
  /** The shared state store. */
  store: TransferStore
  /** Answer an offer. */
  answer: (transferId: string, accept: boolean) => Promise<void>
}

/** Full component props assembled by the overlay renderer. */
export type ReceiveToastProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'localSend'>
  & InjectFace<ReceiveToastInjected>

/**
 * Show one notification per offer that is waiting.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function ReceiveToast(props: ReceiveToastProps): ReactNode {
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

  useEffect(() => store.retain(), [store])

  const waiting = noticeOffer(read, dismissed)

  // An offer that has been answered or withdrawn disappears on its own, so the
  // busy mark belongs to the offer on screen rather than to this component's
  // lifetime.
  useEffect(() => { setBusy(false) }, [waiting?.id])

  const decide = useCallback((accept: boolean): void => {
    if (waiting === undefined) return
    // The toast primitive has no disabled action, so a second click on a slow
    // answer would post a second decision. The host would drop it — the offer is
    // already settled — but refusing it here is what keeps the surface honest
    // about having been pressed once.
    if (busy) return
    setBusy(true)
    void answer(waiting.id, accept).then(
      () => { void store.refresh() },
      () => { setBusy(false) },
    )
  }, [waiting, busy, answer, store])

  if (waiting === undefined) return null

  const count = waiting.files.length
  const summary = count === 1
    ? t('incomingFromOne', { alias: waiting.peerAlias })
    : t('incomingFrom', { alias: waiting.peerAlias, count })
  const detail = `${count === 1 ? waiting.files[0]?.fileName ?? '' : t('filesCount', { count })}`
    + ` · ${t('incomingTotal', { size: formatBytes(waiting.bytesTotal) })}`

  return (
    <Toast
      // The key is what restarts the hold: a different offer is a new
      // notification rather than the remainder of this one's.
      key={waiting.id}
      text={`${summary} — ${detail}`}
      icon={<ReceiveIcon size={18} />}
      holdMs={HOLD_MS}
      actions={[
        { label: t('accept'), onClick: () => { decide(true) } },
        { label: t('decline'), onClick: () => { decide(false) } },
      ]}
      // Fading is not answering: the offer is still waiting, and the panel still
      // shows it with its own buttons. Dismissing only silences this surface.
      onDone={() => { setDismissed(waiting.id) }}
    />
  )
}

export type { LocalSendLocaleKey }
