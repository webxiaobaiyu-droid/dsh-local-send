/**
 * The picker that sends a received file into a specific conversation.
 *
 * "Add to the conversation I have open" only ever addressed one session, and only
 * the one on screen. A file that lands while the user is working in one project
 * is very often wanted in another — the one it belongs to — so the plugin needs a
 * way to name a target rather than assume it. That is this dialog: projects on the
 * left of the reading order, their sessions under them, one press to send.
 *
 * Four decisions worth stating:
 *
 * - **It is the product's `Modal`, not a bespoke overlay.** Escape, the mask, the
 *   focus trap, and returning focus to the button that opened it are all already
 *   handled there, and a plugin dialog that behaved differently from every other
 *   dialog in the window would read as a bug.
 * - **Projects and sessions are one list, not two steps.** The brief was "pick a
 *   project, then pick a session", and grouping is a superset of that: the project
 *   is a heading over its own sessions, so the second step is visible without a
 *   second screen. Searching narrows both levels at once (`filterTree`).
 * - **Subagent sessions and empty projects never appear**, and neither does a
 *   session that has never had a message in it — the rule lives in
 *   `session-target.ts`, where it is tested, rather than here.
 * - **The keyboard is the same walk as the mouse.** Arrow keys move a highlight
 *   over exactly the rows on screen (the flat list `orderedChoices` produces),
 *   Enter sends to the highlighted one, and nothing here reorders anything.
 *
 * @module dsh-local-send/client/SessionPicker
 */

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { filterTree, firstChoice, orderedChoices, type TargetTree } from './session-target.ts'

/** The locale function a sub-component is handed; the panel already owns one. */
type Translate = PropsLocale<'localSend'>['t']

/** Props assembled by the panel, which owns the transfer being sent. */
export interface SessionPickerProps {
  /** Whether the dialog is showing. */
  readonly open: boolean
  /** Close without sending. */
  readonly onClose: () => void
  /** Send the waiting file(s) into this session. */
  readonly onPick: (sessionId: string, label: string) => void
  /** Every project and session that can be addressed. */
  readonly tree: TargetTree
  /** Whether a send is in flight, which disables the rows. */
  readonly busy: boolean
  /** Locale function from the panel's own slot seat. */
  readonly t: Translate
}

/**
 * Offer every conversation this file could be sent to.
 *
 * @param props - the dialog's props, assembled by the panel.
 */
export function SessionPicker(props: SessionPickerProps): ReactNode {
  const { open, onClose, onPick, tree, busy, t } = props
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | undefined>(undefined)

  const shown = useMemo(() => filterTree(tree, query), [tree, query])
  const flat = useMemo(() => orderedChoices(shown), [shown])

  // The highlight follows what is on screen: reopening the dialog, or typing a
  // query that removes the highlighted row, must not leave the keyboard pointing
  // at something invisible.
  useEffect(() => {
    if (!open) return
    const preferred = active === undefined ? undefined : flat.find(choice => choice.id === active)
    if (preferred !== undefined) return
    setActive(firstChoice(shown)?.id)
  }, [open, flat, shown, active])

  // A fresh search each time it opens: the previous query would hide the very
  // list the user came back for.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (flat.length === 0) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
    event.preventDefault()
    if (event.key === 'Enter') {
      const choice = flat.find(candidate => candidate.id === active)
      if (choice !== undefined && !busy) onPick(choice.id, choice.label)
      return
    }
    const index = flat.findIndex(candidate => candidate.id === active)
    const step = event.key === 'ArrowDown' ? 1 : -1
    // Wrapping rather than stopping: a list this short is faster to cycle than to
    // walk back from the end.
    const next = flat[(index + step + flat.length) % flat.length]
    if (next !== undefined) setActive(next.id)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pickTitle')}
      description={t('pickDescription')}
      closeLabel={t('cancel')}
      className="dls-pickDialog"
      contentClassName="dls-pickContent"
    >
      <input
        type="search"
        className="dls-input dls-pickSearch"
        placeholder={t('pickSearchPlaceholder')}
        value={query}
        aria-label={t('pickSearchPlaceholder')}
        data-modal-autofocus
        onChange={(event) => { setQuery(event.target.value) }}
        onKeyDown={onKeyDown}
      />

      {flat.length === 0
        ? (
          <div className="dls-empty">
            <div className="dls-emptyTitle">{query.trim() === '' ? t('pickEmpty') : t('pickNoMatch')}</div>
            <p className="dls-emptyHint">{query.trim() === '' ? t('pickEmptyHint') : t('pickNoMatchHint')}</p>
          </div>
        )
        : (
          <div className="dls-pickList" role="listbox" aria-label={t('pickTitle')}>
            {shown.projects.map(project => (
              <div className="dls-pickGroup" key={project.id}>
                <div className="dls-pickProject">
                  <span className="dls-pickProjectName">{project.label}</span>
                  <span className="dls-pickProjectPath" title={project.detail}>{project.detail}</span>
                  {project.isCurrent ? <span className="dls-pickBadge">{t('pickCurrent')}</span> : null}
                </div>
                {project.sessions.map(session => (
                  <button
                    key={session.id}
                    type="button"
                    role="option"
                    aria-selected={session.id === active}
                    className="dls-pickSession"
                    data-active={session.id === active ? 'true' : 'false'}
                    disabled={busy}
                    onMouseEnter={() => { setActive(session.id) }}
                    onClick={() => { onPick(session.id, session.label) }}
                  >
                    <span className="dls-pickSessionName">{session.label}</span>
                    {session.running ? <span className="dls-pickRunning">{t('pickRunning')}</span> : null}
                    {session.stale ? <span className="dls-pickNote">{t('pickStale')}</span> : null}
                    {session.isCurrent ? <span className="dls-pickBadge">{t('pickCurrent')}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
    </Modal>
  )
}
