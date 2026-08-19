'use client'

/**
 * The screen you look at while talking to Cap.
 *
 * One thing to do at a time: a huge button to start, a huge button to finish,
 * and a running commentary of what Cap is doing with what you said. Every
 * stage is driven by the server's events, never guessed locally.
 */

import { useEffect } from 'react'

import { CapAvatar } from './CapAvatar'
import { ScreenHeader } from './ScreenHeader'
import { BigButton, Card } from './touch'
import { useVoiceInteraction, type VoiceMode } from '../hooks/useVoiceInteraction'

export interface VoiceScreenProps {
  mode: VoiceMode
  title: string
  idleHint: string
  startLabel: string
}

const STAGE_LABEL: Record<string, string> = {
  transcribing: 'Je transcris…',
  saving: 'J’enregistre ta note…',
  thinking: 'Je réfléchis…',
  speaking: 'Je réponds…',
}

export function VoiceScreen({ mode, title, idleHint, startLabel }: VoiceScreenProps) {
  const voice = useVoiceInteraction(mode)

  // Never leave the microphone open behind us.
  useEffect(() => () => void voice.cancel(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const busy = voice.active && !voice.listening
  const finished = voice.state === 'done'
  const failed = voice.state === 'error'

  return (
    <main className="flex h-screen w-screen flex-col gap-3 p-3">
      <ScreenHeader title={title} subtitle={voice.listening ? 'Micro ouvert' : idleHint} />

      <Card className="flex min-h-0 flex-1 items-center gap-5 p-4">
        <CapAvatar
          speaking={voice.state === 'speaking'}
          attentive={voice.listening}
          size={140}
          className={voice.listening ? 'animate-breathe' : ''}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {voice.transcript ? (
            <p className="line-clamp-3 text-2xl font-semibold text-title-blue">
              « {voice.transcript} »
            </p>
          ) : null}

          <p
            className={`text-xl ${failed ? 'font-semibold text-red-main' : 'text-gray-main'}`}
          >
            {failed
              ? (voice.error ?? 'Quelque chose s’est mal passé.')
              : (voice.message ?? STAGE_LABEL[voice.state] ?? idleHint)}
          </p>

          {busy ? (
            <span
              aria-hidden
              className="h-2 w-32 animate-pulse rounded-full bg-purple-main"
            />
          ) : null}
        </div>
      </Card>

      <div className="flex h-[140px] shrink-0 gap-3">
        {voice.listening ? (
          <>
            <BigButton
              label="Annuler"
              icon="close"
              tone="neutral"
              onClick={() => void voice.cancel()}
              className="flex-1"
            />
            <BigButton
              label="Terminer"
              icon="check"
              tone="primary"
              onClick={() => void voice.stop()}
              className="flex-[2]"
            />
          </>
        ) : (
          <BigButton
            label={finished || failed ? 'Recommencer' : startLabel}
            icon="mic"
            tone={mode === 'note' ? 'accent' : 'primary'}
            onClick={() => void voice.start()}
            disabled={busy}
            className="flex-1"
          />
        )}
      </div>
    </main>
  )
}
