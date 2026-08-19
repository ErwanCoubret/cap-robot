'use client'

/**
 * Client side of a voice interaction.
 *
 * Commands are fire-and-forget POSTs; everything the screen shows comes from
 * the event stream, so the overlay reflects what the server is actually doing
 * rather than what the browser hoped would happen.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppEvent, VoiceEvent } from '../../core/domain/events'
import { useApp } from '../deps/AppProvider'

export type VoiceMode = 'note' | 'command'

export interface VoiceInteractionState {
  active: boolean
  state: VoiceEvent['state'] | 'idle'
  transcript?: string
  message?: string
  error?: string
}

const INITIAL: VoiceInteractionState = { active: false, state: 'idle' }

/** Stages during which the microphone is open. */
const LISTENING: VoiceEvent['state'][] = ['recording']

/** Stages that end the interaction. */
const TERMINAL: VoiceEvent['state'][] = ['done', 'cancelled', 'error']

export function useVoiceInteraction(mode: VoiceMode) {
  const { onEvent } = useApp()
  const [state, setState] = useState<VoiceInteractionState>(INITIAL)
  const interactionId = useRef<string | null>(null)

  useEffect(
    () =>
      onEvent((event: AppEvent) => {
        if (event.type !== 'voice') {
          return
        }
        // Ignore an interaction started by another screen.
        if (interactionId.current && event.interactionId !== interactionId.current) {
          return
        }
        setState({
          active: !TERMINAL.includes(event.state),
          state: event.state,
          transcript: event.transcript,
          message: event.message,
          error: event.error,
        })
        if (TERMINAL.includes(event.state)) {
          interactionId.current = null
        }
      }),
    [onEvent],
  )

  const start = useCallback(async () => {
    setState({ active: true, state: 'recording', message: 'Je t’écoute…' })
    try {
      const response = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode }),
      })
      const body = (await response.json()) as { interactionId?: string; error?: string }
      if (!response.ok || !body.interactionId) {
        setState({ active: false, state: 'error', error: body.error ?? 'écoute impossible' })
        return
      }
      interactionId.current = body.interactionId
    } catch (error) {
      setState({
        active: false,
        state: 'error',
        error: error instanceof Error ? error.message : 'écoute impossible',
      })
    }
  }, [mode])

  const stop = useCallback(async () => {
    setState((current) => ({ ...current, state: 'transcribing', message: 'Je transcris…' }))
    await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).catch(() => undefined)
  }, [])

  const cancel = useCallback(async () => {
    interactionId.current = null
    setState(INITIAL)
    await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }).catch(() => undefined)
  }, [])

  const reset = useCallback(() => setState(INITIAL), [])

  return {
    ...state,
    listening: LISTENING.includes(state.state as VoiceEvent['state']),
    start,
    stop,
    cancel,
    reset,
  }
}
