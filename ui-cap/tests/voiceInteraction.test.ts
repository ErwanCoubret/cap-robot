import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppEvent, VoiceEvent } from '../core/domain/events'
import type { McpToolResult } from '../core/domain/flots'
import type { SttPort } from '../core/ports/ai'
import type { FlotsPort } from '../core/ports/flots'
import type { HardwarePort } from '../core/ports/hardware'
import { VoiceInteractionService } from '../core/usecases/voice/voiceInteraction'

/** A body that records what it was asked to do. */
function fakeHardware(overrides: Partial<HardwarePort> = {}) {
  const spoken: string[] = []
  const hardware: HardwarePort = {
    health: async () => ({ online: true, status: null }),
    lastStatus: () => null,
    startRecording: vi.fn(async () => 'rec_1'),
    stopRecording: vi.fn(async () => ({
      recordingId: 'rec_1',
      durationSeconds: 3,
      path: '/tmp/rec_1.wav',
    })),
    cancelRecording: vi.fn(async () => undefined),
    readRecording: vi.fn(async () => new ArrayBuffer(64_000)),
    speak: vi.fn(async (text: string) => {
      spoken.push(text)
      return 'utt_1'
    }),
    stopSpeaking: async () => undefined,
    playSound: vi.fn(async () => undefined),
    setExpression: vi.fn(async () => undefined),
    setTracking: async () => undefined,
    setCameraFlip: async () => undefined,
    ...overrides,
  }
  return { hardware, spoken }
}

function fakeStt(text = 'Acheter du pain'): SttPort {
  return {
    label: 'test',
    available: true,
    transcribe: vi.fn(async () => ({ text, label: 'test' })),
  }
}

function fakeFlots(result: McpToolResult = { ok: true, data: { id: 'note_1' }, text: 'Note créée' }) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const flots: FlotsPort = {
    pairing: async () => ({
      status: 'paired',
      user: null,
      scopes: [],
      expiresAt: null,
      daysRemaining: null,
      baseUrl: 'https://api-staging.flots.app',
    }),
    listTools: async () => [
      {
        name: 'create_note',
        inputSchema: { type: 'object', properties: { title: {}, content: {} } },
      },
    ],
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return result
    }),
    test: async () => ({ ok: true, user: null, scopes: [], toolCount: 1, latencyMs: 1 }),
  }
  return { flots, calls }
}

let events: AppEvent[]
const publish = (event: AppEvent) => {
  events.push(event)
}

const states = () =>
  events.filter((e): e is VoiceEvent => e.type === 'voice').map((e) => e.state)

beforeEach(() => {
  events = []
})

describe('VoiceInteractionService · notes', () => {
  it('records, transcribes and saves the note to Flots', async () => {
    const { hardware, spoken } = fakeHardware()
    const { flots, calls } = fakeFlots()
    const service = new VoiceInteractionService({
      hardware,
      stt: fakeStt(),
      flots,
      publish,
      now: () => new Date('2026-08-19T13:40:00Z'),
    })

    await service.start('note')
    await service.stop()

    expect(states()).toEqual(['recording', 'transcribing', 'saving', 'done'])
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('create_note')
    expect(calls[0].args).toEqual({
      title: 'Note vocale du 19 août à 15:40',
      content: 'Acheter du pain',
    })
    // The user gets an audible confirmation, not just a screen update.
    expect(spoken).toContain('C’est noté !')
  })

  it('signals that it is listening as soon as the microphone opens', async () => {
    const { hardware } = fakeHardware()
    const { flots } = fakeFlots()
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('note')

    expect(hardware.playSound).toHaveBeenCalledWith('listening')
    expect(hardware.setExpression).toHaveBeenCalledWith('listening')
  })

  it('refuses to listen twice at once', async () => {
    const { hardware } = fakeHardware()
    const { flots } = fakeFlots()
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('note')

    // There is one microphone; a second interaction would fight for it.
    await expect(service.start('note')).rejects.toThrow('écoute déjà')
  })

  it('discards a recording too short to contain anything', async () => {
    const { hardware, spoken } = fakeHardware({
      stopRecording: vi.fn(async () => ({
        recordingId: 'rec_1',
        durationSeconds: 0.1,
        path: '/tmp/rec_1.wav',
      })),
    })
    const { flots, calls } = fakeFlots()
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('note')
    await service.stop()

    expect(states()).toEqual(['recording', 'cancelled'])
    expect(calls).toHaveLength(0)
    expect(spoken).toContain('Je n’ai rien entendu.')
  })

  it('stops rather than saving an empty transcript', async () => {
    const { hardware } = fakeHardware()
    const { flots, calls } = fakeFlots()
    const service = new VoiceInteractionService({
      hardware,
      stt: fakeStt('   '),
      flots,
      publish,
    })

    await service.start('note')
    await service.stop()

    expect(states()).toEqual(['recording', 'transcribing', 'cancelled'])
    expect(calls).toHaveLength(0)
  })

  it('reports a transcription failure and frees the microphone', async () => {
    const { hardware } = fakeHardware()
    const { flots } = fakeFlots()
    const stt: SttPort = {
      label: 'test',
      available: true,
      transcribe: vi.fn(async () => {
        throw new Error('service indisponible')
      }),
    }
    const service = new VoiceInteractionService({ hardware, stt, flots, publish })

    await service.start('note')
    await service.stop()

    expect(states()).toEqual(['recording', 'transcribing', 'error'])
    // The failure must not leave the robot stuck: a new interaction can start.
    await expect(service.start('note')).resolves.toBeTruthy()
  })

  it('says so out loud when Flots refuses the note', async () => {
    const { hardware, spoken } = fakeHardware()
    const { flots } = fakeFlots({ ok: false, data: null, text: 'Abonnement requis' })
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('note')
    await service.stop()

    expect(states()).toEqual(['recording', 'transcribing', 'saving', 'error'])
    expect(spoken).toContain('Je n’ai pas réussi à enregistrer ta note.')
  })

  it('reports when Flots does not allow note creation at all', async () => {
    const { hardware } = fakeHardware()
    const { flots } = fakeFlots()
    flots.listTools = async () => []
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('note')
    await service.stop()

    const last = events.at(-1) as VoiceEvent
    expect(last.state).toBe('error')
    expect(last.error).toContain('pas autorisée')
  })

  it('throws the recording away when cancelled', async () => {
    const { hardware } = fakeHardware()
    const { flots, calls } = fakeFlots()
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('note')
    await service.cancel()

    expect(hardware.cancelRecording).toHaveBeenCalled()
    expect(states()).toEqual(['recording', 'cancelled'])
    expect(calls).toHaveLength(0)
  })

  it('ignores a cancel when nothing is running', async () => {
    const { hardware } = fakeHardware()
    const { flots } = fakeFlots()
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.cancel()

    expect(events).toEqual([])
  })
})

describe('VoiceInteractionService · commands', () => {
  it('answers through the injected command handler and speaks the reply', async () => {
    const { hardware, spoken } = fakeHardware()
    const { flots } = fakeFlots()
    const service = new VoiceInteractionService({
      hardware,
      stt: fakeStt('Quelle heure est-il ?'),
      flots,
      publish,
      runCommand: async () => 'Il est huit heures.',
    })

    await service.start('command')
    await service.stop()

    expect(states()).toEqual(['recording', 'transcribing', 'thinking', 'speaking', 'done'])
    expect(spoken).toContain('Il est huit heures.')
  })

  it('says plainly when commands are not wired up', async () => {
    const { hardware } = fakeHardware()
    const { flots } = fakeFlots()
    const service = new VoiceInteractionService({ hardware, stt: fakeStt(), flots, publish })

    await service.start('command')
    await service.stop()

    expect(states().at(-1)).toBe('error')
  })
})
