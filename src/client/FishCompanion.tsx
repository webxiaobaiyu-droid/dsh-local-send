/**
 * The companion: a small fish in the conversation header that is the transfer's
 * presence while the user is working.
 *
 * It exists because the two surfaces the plugin already had are both somewhere
 * else. The panel is a different screen, and the notification is a banner that
 * fades — so a transfer in flight, or one that just landed, had nothing to say
 * for itself in the place the user actually spends their time. This is that
 * place, and the mark is the answer to "is anything happening?" without opening
 * anything.
 *
 * Three decisions worth stating:
 *
 * - **It hides when there is nothing to say.** A companion that sat in the
 *   header all day would be a control with no content, beside three controls
 *   that have plenty. So idle is *absent* rather than dimmed, and the rule lives
 *   in `companion.ts` where the plugin's other rules live — it is a field on the
 *   view, not a check here. When something does happen it arrives with the news
 *   already on it, which is the part a status dot cannot do.
 * - **It never decides anything by itself.** Everything it can do — take an
 *   offer, stop a transfer, add a received file to the conversation — is one
 *   press away in its popover, and every one of those is a decision the user
 *   makes. The mark reports; it does not act.
 * - **The popover is the product's own menu.** It already carries the keyboard
 *   walk, Escape, outside-click dismissal, and focus return, and a bespoke
 *   popover in the header would have had to reimplement all four to look like the
 *   ones beside it.
 *
 * What is *not* here: a file list for an offer. That can be twenty rows, and the
 * banner above the composer and the panel both show it. The popover offers the
 * choice — take them, refuse them, go and look — and nothing more.
 *
 * @module dsh-local-send/client/FishCompanion
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { companionView } from './companion.ts'
import { FishMark } from './fish.tsx'
import { flash } from './flash.ts'
import { useTransferState, type TransferStore } from './state.ts'

/** Registration-side face the companion reads and acts through. */
export interface FishCompanionInjected {
  /** The shared state store; the companion also keeps it polling. */
  store: TransferStore
  /** Answer an offer, taking or refusing every file on it. */
  answer: (transferId: string, accept: boolean) => Promise<void>
  /** Stop a transfer this device is part of. */
  cancel: (transferId: string) => Promise<void>
  /** Show a received file in the platform's file manager. */
  revealFile: (path: string) => Promise<void>
  /** Ask for a received file to be referenced in the composer. */
  addToConversation: (path: string) => void
  /** Bring the transfer panel forward. */
  openPanel: () => void
}

/** Full component props assembled by the header renderer. */
export type FishCompanionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'localSend'>
  & InjectFace<FishCompanionInjected>

/** One line describing an error, for a message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Show the companion, and offer what can be done about whatever it is showing.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function FishCompanion(props: FishCompanionProps): ReactNode {
  const { t, store, answer, cancel, revealFile, addToConversation, openPanel } = props
  const read = useTransferState(store)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => store.retain(), [store])

  // The clock is read at render time rather than ticked here: the store
  // re-renders this entry on its own cadence, and a window measured against
  // `Date.now()` expires on the next of those renders. A timer of this module's
  // own would be a second schedule to keep in step with the first.
  const view = companionView(read, Date.now())
  const focus = view.focus

  // Retained before this line, so an idle companion costs nothing to keep but
  // still keeps the shared poll alive for the notification — which is always on
  // screen and always needs it.
  if (!view.visible) return null

  // A different situation is a different set of actions, so a press that was slow
  // to settle must not leave the next one looking already answered.
  useEffect(() => { setBusy(false) }, [focus?.id, focus?.status])

  /**
   * Run one action, keeping the popover's buttons honest about being pressed.
   *
   * @param action - what to do.
   */
  const run = useCallback((action: () => Promise<void>): void => {
    if (busy) return
    setBusy(true)
    void action().then(
      () => { void store.refresh(); setBusy(false) },
      (error: unknown) => {
        // Reported through the notification surface rather than the popover: the
        // menu closes on selection, so the popover is gone by the time this
        // rejects.
        flash('errorGeneric', { params: { message: describe(error) }, tone: 'error' })
        setBusy(false)
      },
    )
  }, [busy, store])

  const items: MenuEntry[] = [
    {
      type: 'label',
      id: 'status',
      // The same sentence the mark is standing for, in words. A fish with a ring
      // says roughly what is going on; this says it exactly, and it is also what
      // a screen reader gets from the popover.
      text: t(view.labelKey, view.labelParams),
    },
    { type: 'separator', id: 'sep' },
  ]

  if (focus !== undefined && focus.status === 'awaiting') {
    items.push({ id: 'accept', label: t('accept'), disabled: busy })
    items.push({ id: 'decline', label: t('decline'), disabled: busy })
  }

  if (focus !== undefined && focus.status === 'transferring') {
    items.push({ id: 'stop', label: t('stopTransfer'), disabled: busy, danger: true })
  }

  if (focus !== undefined && view.mood === 'landed' && focus.direction === 'incoming') {
    const saved = focus.files.filter(file => file.status === 'done' && file.savedPath !== undefined)
    if (saved.length > 0) items.push({ id: 'add', label: t('buddyAdd'), disabled: busy })
    if (saved.length === 1) items.push({ id: 'reveal', label: t('reveal'), disabled: busy })
  }

  items.push({ type: 'separator', id: 'sep-panel' })
  items.push({ id: 'panel', label: t('openPanel') })

  return (
    <Menu
      open={open}
      anchor={(
        <button
          type="button"
          className="dls-buddy"
          data-tone={view.tone}
          data-mood={view.mood}
          title={t(view.labelKey, view.labelParams)}
          aria-label={t('buddyLabel')}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <FishMark
            size={18}
            mood={view.mood}
            {...view.progress === undefined ? {} : { progress: view.progress }}
            carrying={view.carrying}
          />
        </button>
      )}
      items={items}
      onSelect={(id) => {
        // Selection closes the menu the way every menu in the product does, so
        // the work starts from a surface that is already on its way out.
        setOpen(false)
        if (focus === undefined) {
          if (id === 'panel') openPanel()
          return
        }
        if (id === 'accept') { run(async () => { await answer(focus.id, true) }); return }
        if (id === 'decline') { run(async () => { await answer(focus.id, false) }); return }
        if (id === 'stop') { run(async () => { await cancel(focus.id) }); return }
        if (id === 'add') {
          const path = focus.files.find(file => file.status === 'done' && file.savedPath !== undefined)?.savedPath
          if (path !== undefined) addToConversation(path)
          return
        }
        if (id === 'reveal') {
          const path = focus.files.find(file => file.status === 'done' && file.savedPath !== undefined)?.savedPath
          if (path !== undefined) void run(async () => { await revealFile(path) })
          return
        }
        if (id === 'panel') openPanel()
      }}
      onClose={() => { setOpen(false) }}
      align="end"
      portal
      className="dls-buddyMenu"
    />
  )
}
