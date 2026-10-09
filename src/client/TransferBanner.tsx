/**
 * The offer banner: an incoming transfer, offered where the user is typing.
 *
 * This is the narrow answer to a narrow problem. A file arrives while somebody is
 * in the middle of writing, and the places the offer could otherwise appear are
 * both wrong for that moment: the notification is a banner at the top of the
 * window that fades, and the panel is a different screen entirely. So the offer
 * is also offered directly above the composer — full width, one line, between the
 * user and the thing they were about to send.
 *
 * It shows **only offers**. Progress and outcomes belong to the companion in the
 * header, and duplicating them here would turn the strip above the composer into
 * a second panel — the one place in the window that has to stay quiet, because
 * everything the user writes passes through it.
 *
 * No file list, deliberately: a batch of twenty files cannot be ticked off in one
 * line, and the panel is where choosing happens. Accept here takes the lot, which
 * is what "yes, send them" means when the details are a click away.
 *
 * @module dsh-local-send/client/TransferBanner
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatBytes } from './format.ts'
import { ReceiveIcon } from './icons.tsx'
import { noticeOffer } from './notice.ts'
import { useTransferState, type TransferStore } from './state.ts'

/** Registration-side face the banner reads. */
export interface TransferBannerInjected {
  /** The shared state store. */
  store: TransferStore
  /** Answer an offer, taking or refusing every file on it. */
  answer: (transferId: string, accept: boolean) => Promise<void>
  /** Bring the transfer panel forward, for the details this line cannot carry. */
  openPanel: () => void
}

/** Full component props assembled by the composer-dock renderer. */
export type TransferBannerProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'localSend'>
  & InjectFace<TransferBannerInjected>

/**
 * Offer the waiting transfer, or draw nothing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function TransferBanner(props: TransferBannerProps): ReactNode {
  const { t, store, answer, openPanel } = props
  const read = useTransferState(store)
  const [busy, setBusy] = useState(false)

  useEffect(() => store.retain(), [store])

  // The same rule the notification uses, because both are asking the same
  // question — which offer is waiting on a person — and two answers that could
  // disagree would mean a banner offering something the notification had already
  // written off.
  const waiting = noticeOffer(read, undefined)

  // A different offer is a different decision, so a press that was slow to settle
  // must not leave the next one looking already answered.
  useEffect(() => { setBusy(false) }, [waiting?.id])

  const decide = useCallback((accept: boolean): void => {
    if (waiting === undefined || busy) return
    setBusy(true)
    // No file list: the host reads that as every file its own limits left
    // standing. See `DecideRequest`.
    void answer(waiting.id, accept).then(
      () => { void store.refresh() },
      () => { setBusy(false) },
    )
  }, [waiting, busy, answer, store])

  if (waiting === undefined) return null

  const count = waiting.files.length
  const summary = count === 1
    ? t('incomingFromOne', { alias: waiting.peerAlias, name: waiting.files[0]?.fileName ?? '' })
    : t('incomingFrom', { alias: waiting.peerAlias, count })

  return (
    <div className="dls-banner" role="group" aria-label={t('incomingTitle')}>
      <span className="dls-bannerMark" aria-hidden>
        <ReceiveIcon size={15} />
      </span>
      <span className="dls-bannerBody">
        <span className="dls-bannerTitle">{summary}</span>
        <span className="dls-bannerMeta">
          {t('incomingTotal', { size: formatBytes(waiting.bytesTotal) })}
        </span>
      </span>
      <span className="dls-bannerActions">
        <button
          type="button"
          className="dls-action"
          data-tone="primary"
          disabled={busy}
          onClick={() => { decide(true) }}
        >
          {t('accept')}
        </button>
        <button type="button" className="dls-action" disabled={busy} onClick={() => { decide(false) }}>
          {t('decline')}
        </button>
        <button type="button" className="dls-action" data-tone="quiet" onClick={openPanel}>
          {t('openPanel')}
        </button>
      </span>
    </div>
  )
}
