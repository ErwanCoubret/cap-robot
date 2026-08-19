/**
 * The voice pipeline: tap, speak, and Cap does something about it.
 *
 * One interaction at a time — there is one microphone — and every transition
 * is published so the overlay can show what is happening without polling. The
 * user is standing there waiting, so each stage says what it is doing and any
 * failure ends with something spoken rather than a silent stop.
 */

import type { AppEvent, VoiceEvent } from '../../domain/events'
import type { FlotsPort } from '../../ports/flots'
import type { SttPort } from '../../ports/ai'
import type { HardwarePort } from '../../ports/hardware'
import { buildNoteArguments, voiceNoteTitle } from './noteArguments'

export type VoiceMode = 'note' | 'command'
export type VoiceState = VoiceEvent['state']

/** Longest recording accepted before the daemon stops it by itself. */
const MAX_RECORDING_SECONDS = 90

/** Below this, nothing was really said. */
const MIN_RECORDING_SECONDS = 0.4

export interface VoiceInteractionDeps {
  hardware: HardwarePort
  stt: SttPort
  flots: FlotsPort
  publish: (event: AppEvent) => void
  /** Answers a spoken command; supplied by the agent. */
  runCommand?: (transcript: string, interactionId: string) => Promise<string>
  now?: () => Date
  locale?: string
  timezone?: string
}

export interface VoiceSnapshot {
  interactionId: string | null
  mode: VoiceMode | null
  state: VoiceState | 'idle'
  transcript?: string
}

export class VoiceInteractionService {
  private interactionId: string | null = null
  private mode: VoiceMode = 'note'
  private state: VoiceState | 'idle' = 'idle'
  private transcript: string | undefined
  private sequence = 0

  constructor(private readonly deps: VoiceInteractionDeps) {}

  snapshot(): VoiceSnapshot {
    return {
      interactionId: this.interactionId,
      mode: this.interactionId ? this.mode : null,
      state: this.state,
      transcript: this.transcript,
    }
  }

  /** Begin listening. Returns the identifier the overlay follows. */
  async start(mode: VoiceMode): Promise<string> {
    if (this.interactionId) {
      throw new Error('Cap écoute déjà')
    }

    this.sequence += 1
    const interactionId = `voice_${this.sequence}_${this.deps.now?.().getTime() ?? Date.now()}`
    this.interactionId = interactionId
    this.mode = mode
    this.transcript = undefined

    try {
      await this.deps.hardware.startRecording(MAX_RECORDING_SECONDS)
    } catch (error) {
      this.finish('error', { error: describe(error) })
      throw error
    }

    // A sound and a glance are the fastest possible feedback that the robot
    // is listening — long before any text can appear.
    void this.deps.hardware.playSound('listening').catch(() => undefined)
    void this.deps.hardware.setExpression('listening').catch(() => undefined)

    this.emit('recording', { message: 'Je t’écoute…' })
    return interactionId
  }

  /** Stop listening and run the rest of the pipeline. */
  async stop(): Promise<void> {
    const interactionId = this.interactionId
    if (!interactionId) {
      throw new Error('aucune écoute en cours')
    }

    let recordingId: string
    let durationSeconds: number
    try {
      const recording = await this.deps.hardware.stopRecording()
      recordingId = recording.recordingId
      durationSeconds = recording.durationSeconds
    } catch (error) {
      this.fail(describe(error))
      return
    }

    if (durationSeconds < MIN_RECORDING_SECONDS) {
      this.finish('cancelled', { message: 'Je n’ai rien entendu.' })
      await this.say('Je n’ai rien entendu.')
      return
    }

    this.emit('transcribing', { message: 'Je transcris…' })
    void this.deps.hardware.setExpression('thinking', 4000).catch(() => undefined)

    let transcript: string
    try {
      const audio = await this.deps.hardware.readRecording(recordingId)
      transcript = (await this.deps.stt.transcribe(audio)).text
    } catch (error) {
      this.fail(`Transcription impossible : ${describe(error)}`)
      return
    }

    if (transcript.trim() === '') {
      this.finish('cancelled', { message: 'Je n’ai rien compris.' })
      await this.say('Je n’ai rien compris.')
      return
    }

    this.transcript = transcript
    if (this.mode === 'note') {
      await this.saveNote(transcript)
    } else {
      await this.answer(transcript)
    }
  }

  /** Abandon the interaction and throw the recording away. */
  async cancel(): Promise<void> {
    if (!this.interactionId) {
      return
    }
    await this.deps.hardware.cancelRecording().catch(() => undefined)
    this.finish('cancelled', { message: 'Annulé.' })
  }

  private async saveNote(transcript: string): Promise<void> {
    this.emit('saving', { transcript, message: 'J’enregistre ta note…' })

    try {
      // The tool's own schema decides the parameter names.
      const tools = await this.deps.flots.listTools()
      const tool = tools.find((candidate) => candidate.name === 'create_note')
      if (!tool) {
        throw new Error('la création de notes n’est pas autorisée par Flots')
      }

      const title = voiceNoteTitle(
        this.deps.now?.() ?? new Date(),
        this.deps.locale ?? 'fr',
        this.deps.timezone ?? 'Europe/Paris',
      )
      const result = await this.deps.flots.callTool(
        'create_note',
        buildNoteArguments(tool, { title, content: transcript }),
      )

      if (!result.ok) {
        this.fail(result.text || 'Flots a refusé la note')
        await this.say('Je n’ai pas réussi à enregistrer ta note.')
        return
      }

      this.finish('done', { transcript, message: 'C’est noté !' })
      void this.deps.hardware.setExpression('happy').catch(() => undefined)
      await this.say('C’est noté !')
    } catch (error) {
      this.fail(describe(error))
      await this.say('Je n’ai pas réussi à enregistrer ta note.')
    }
  }

  private async answer(transcript: string): Promise<void> {
    const runCommand = this.deps.runCommand
    if (!runCommand) {
      this.fail('les commandes vocales ne sont pas encore disponibles')
      return
    }

    this.emit('thinking', { transcript, message: 'Je réfléchis…' })

    try {
      const reply = await runCommand(transcript, this.interactionId ?? '')
      this.emit('speaking', { transcript, message: reply })
      await this.say(reply)
      this.finish('done', { transcript, message: reply })
    } catch (error) {
      this.fail(describe(error))
      await this.say('Je n’ai pas réussi à répondre.')
    }
  }

  private async say(text: string): Promise<void> {
    await this.deps.hardware.speak(text, { interrupt: true }).catch(() => undefined)
  }

  private emit(state: VoiceState, extra: Partial<VoiceEvent> = {}): void {
    if (!this.interactionId) {
      return
    }
    this.state = state
    this.deps.publish({
      type: 'voice',
      interactionId: this.interactionId,
      mode: this.mode,
      state,
      ...extra,
    })
  }

  private fail(error: string): void {
    // Keep the transcript on the failure: knowing Cap understood you but could
    // not act is very different from knowing it heard nothing.
    this.emit('error', { error, transcript: this.transcript })
    this.reset()
  }

  private finish(state: VoiceState, extra: Partial<VoiceEvent> = {}): void {
    this.emit(state, extra)
    this.reset()
  }

  private reset(): void {
    this.interactionId = null
    this.state = 'idle'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
