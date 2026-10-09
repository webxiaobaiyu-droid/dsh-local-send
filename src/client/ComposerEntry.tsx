/**
 * The composer's end of "add to conversation".
 *
 * This component is why that gesture works at all. Inserting text into the
 * composer needs the composer's own input actions — a revision-guarded caret
 * span and a CAS-checked insert — and those exist only inside the conversation's
 * slot tree, which the main column cannot reach. So the panel leaves a request
 * in a module store, switches the centre column back to the conversation, and
 * this entry performs the insert once it is mounted.
 *
 * It renders nothing while idle. A button here would have nothing to act on:
 * the file list lives in the panel, and duplicating it would mean this component
 * polling the host for a list the panel already holds. Its whole job is to be
 * the thing with the caret.
 *
 * The insert goes through `captureInsertion` + `insertText` — the voice-input
 * pattern — rather than `setDraft`, because `setDraft` replaces the entire draft
 * and would silently discard anything the user had already typed, including any
 * `@` or `/` tokens the editor had resolved into chips.
 *
 * @module dsh-local-send/client/ComposerEntry
 */

import { useEffect, useState, type ReactNode } from 'react'
// Type-only: pulls the conversation package's SlotMap merge, which is what
// declares 'conversation.input.left' and the session-scoped standard props
// (sessionId, inputActions) this entry is handed.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatMention } from './mention.ts'
import { consumeReference, readReference, subscribeReference } from './pending.ts'
import type { LocalSendLocaleKey } from './locales.ts'

/** Registration-side face the composer entry reads. */
export interface ComposerEntryInjected {
  /**
   * Whether a session is currently bound to the composer.
   *
   * Read at call time rather than captured: this entry outlives session
   * switches, and a captured value would let a reference be inserted into a
   * conversation the user had already left.
   */
  hasSession: () => boolean
}

/** Full component props assembled by the session-slot renderer. */
export type ComposerEntryProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'localSend'>
  & InjectFace<ComposerEntryInjected>

/**
 * Watch for a pending reference and insert it.
 *
 * The insert happens in an effect rather than during render because it writes to
 * the editor, and a render-phase write would run twice under React's strict
 * double-invocation and insert the mention twice.
 *
 * @param props - slot props, locale seat, and the injected face.
 */
export function ComposerEntry(props: ComposerEntryProps): ReactNode {
  const { inputActions, sessionId, hasSession } = props
  const pending = readReference()
  /** Drives re-render when a request arrives while this entry is mounted. */
  const [, setRevision] = useState(0)

  useEffect(() => subscribeReference(() => { setRevision(value => value + 1) }), [])

  useEffect(() => {
    if (pending === undefined) return
    if (sessionId === undefined || !hasSession()) return
    const mention = formatMention(pending)
    if (mention === undefined) {
      // A path the grammar cannot represent — one carrying a quote or a control
      // character. Dropped rather than inserted as a token that would parse as
      // two, and the panel still shows the file and its location.
      consumeReference()
      return
    }
    // Consumed before the insert, so a failing edit cannot leave a request that
    // re-fires on the next render and appends the mention repeatedly.
    consumeReference()
    // One trailing space: the grammar needs whitespace after a token for the
    // next `@` to start a new one, and a user typing straight on would otherwise
    // extend this path.
    const span = inputActions.captureInsertion()
    inputActions.insertText(`${mention} `, span)
  }, [pending, sessionId, inputActions, hasSession])

  return null
}

export type { LocalSendLocaleKey }
