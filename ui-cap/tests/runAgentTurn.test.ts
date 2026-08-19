import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_ALARMS, type AlarmsDocument } from '../core/domain/alarm'
import type { AgentEvent, AppEvent } from '../core/domain/events'
import type { LlmPort, LlmReply, LlmRequest, ToolCall } from '../core/ports/ai'
import type { FlotsPort } from '../core/ports/flots'
import type { HardwarePort } from '../core/ports/hardware'
import { AlarmService } from '../core/usecases/alarms/alarmService'
import { MAX_ITERATIONS, runAgentTurn } from '../core/usecases/agent/runAgentTurn'
import { ToolRegistry } from '../core/usecases/agent/toolRegistry'
import { JsonStore } from '../infrastructure/store/jsonStore'

const NOW = new Date('2026-08-19T06:00:00Z')

/** A model that replays a fixed script of replies. */
class ScriptedLlm implements LlmPort {
  label = 'scripted'
  available = true
  readonly requests: LlmRequest[] = []

  constructor(private readonly script: LlmReply[]) {}

  async complete(request: LlmRequest): Promise<LlmReply> {
    this.requests.push(request)
    const next = this.script.shift()
    if (!next) {
      throw new Error('script exhausted')
    }
    return next
  }
}

function say(text: string): LlmReply {
  return { text, toolCalls: [] }
}

function call(name: string, args: Record<string, unknown> = {}): LlmReply {
  const toolCall: ToolCall = { id: `call_${name}`, name, arguments: args }
  return { text: '', toolCalls: [toolCall] }
}

function fakeHardware(): HardwarePort {
  return {
    health: async () => ({ online: true, status: null }),
    lastStatus: () => null,
    startRecording: async () => 'rec_1',
    stopRecording: async () => ({ recordingId: 'rec_1', durationSeconds: 1, path: '/tmp/a' }),
    cancelRecording: async () => undefined,
    readRecording: async () => new ArrayBuffer(8),
    speak: vi.fn(async () => 'utt_1'),
    stopSpeaking: async () => undefined,
    playSound: async () => undefined,
    setExpression: vi.fn(async () => undefined),
    setTracking: async () => undefined,
    setCameraFlip: async () => undefined,
  }
}

function fakeFlots(overrides: Partial<FlotsPort> = {}): FlotsPort {
  return {
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
        name: 'create_task',
        description: 'Créer une tâche',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
      {
        name: 'delete_task',
        description: 'Supprimer une tâche',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      },
    ],
    callTool: vi.fn(async () => ({ ok: true, data: { id: 'task_1' }, text: 'Tâche créée' })),
    test: async () => ({ ok: true, user: null, scopes: [], toolCount: 2, latencyMs: 3 }),
    ...overrides,
  }
}

let events: AppEvent[]
let alarms: AlarmService

const publish = (event: AppEvent) => {
  events.push(event)
}

const agentEvents = () => events.filter((e): e is AgentEvent => e.type === 'agent')

async function makeRegistry(flots: FlotsPort, hardware: HardwarePort) {
  return new ToolRegistry({
    hardware,
    alarms,
    flots,
    now: () => NOW,
    locale: 'fr',
    timezone: 'Europe/Paris',
  })
}

function deps(llm: LlmPort, tools: ToolRegistry) {
  return {
    llm,
    tools,
    publish,
    now: () => NOW,
    locale: 'fr',
    timezone: 'Europe/Paris',
  }
}

beforeEach(async () => {
  events = []
  const directory = await mkdtemp(join(tmpdir(), 'cap-agent-'))
  alarms = new AlarmService(
    new JsonStore<AlarmsDocument>(join(directory, 'alarms.json'), EMPTY_ALARMS),
    () => NOW,
    'Europe/Paris',
  )
})

describe('runAgentTurn', () => {
  it('answers directly when no tool is needed', async () => {
    const llm = new ScriptedLlm([say('Bonjour !')])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    const result = await runAgentTurn('Bonjour', deps(llm, registry))

    expect(result.text).toBe('Bonjour !')
    expect(result.toolsUsed).toEqual([])
    expect(agentEvents().map((e) => e.state)).toEqual(['started', 'finished'])
  })

  it('runs a tool and feeds the result back to the model', async () => {
    const llm = new ScriptedLlm([
      call('create_task', { title: 'Acheter du pain' }),
      say('J’ai créé la tâche.'),
    ])
    const flots = fakeFlots()
    const registry = await makeRegistry(flots, fakeHardware())

    const result = await runAgentTurn('Crée une tâche', deps(llm, registry))

    expect(flots.callTool).toHaveBeenCalledWith('create_task', { title: 'Acheter du pain' })
    expect(result.toolsUsed).toEqual(['create_task'])
    expect(agentEvents().map((e) => e.state)).toEqual([
      'started',
      'tool',
      'tool_result',
      'finished',
    ])
    // The second request carries the tool result, so the model can confirm it.
    expect(JSON.stringify(llm.requests[1].messages)).toContain('Tâche créée')
  })

  it('narrates each step in French for the screen', async () => {
    const llm = new ScriptedLlm([call('create_task', { title: 'x' }), say('Fait.')])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    await runAgentTurn('Crée une tâche', deps(llm, registry))

    const step = agentEvents().find((event) => event.state === 'tool')
    expect(step?.label).toBe('Je crée la tâche…')
  })

  it('offers the robot tools alongside the Flots ones', async () => {
    const llm = new ScriptedLlm([say('ok')])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    await runAgentTurn('Bonjour', deps(llm, registry))

    const offered = (llm.requests[0].tools ?? []).map((tool) => tool.name)
    expect(offered).toContain('get_current_datetime')
    expect(offered).toContain('set_alarm')
    expect(offered).toContain('create_task')
  })

  it('never offers destructive Flots tools', async () => {
    // The robot holds no delete scope, and a misheard sentence must not be
    // able to destroy someone's work.
    const llm = new ScriptedLlm([say('ok')])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    await runAgentTurn('Bonjour', deps(llm, registry))

    const offered = (llm.requests[0].tools ?? []).map((tool) => tool.name)
    expect(offered).not.toContain('delete_task')
  })

  it('refuses a blocked tool even if the model asks for it anyway', async () => {
    const llm = new ScriptedLlm([call('delete_task', { id: 't1' }), say('Je ne peux pas.')])
    const flots = fakeFlots()
    const registry = await makeRegistry(flots, fakeHardware())

    await runAgentTurn('Supprime tout', deps(llm, registry))

    expect(flots.callTool).not.toHaveBeenCalled()
    const outcome = agentEvents().find((event) => event.state === 'tool_result')
    expect(outcome?.ok).toBe(false)
  })

  it('sets an alarm through the robot’s own tool', async () => {
    const llm = new ScriptedLlm([
      call('set_alarm', { time: '07:30', label: 'Réveil', repeat: 'daily' }),
      say('Alarme réglée.'),
    ])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    await runAgentTurn('Réveille-moi à 7h30', deps(llm, registry))

    const stored = await alarms.list()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ time: '07:30', label: 'Réveil', repeat: 'daily' })
  })

  it('reports a failing tool without abandoning the turn', async () => {
    const llm = new ScriptedLlm([
      call('create_task', { title: 'x' }),
      say('Je n’ai pas réussi.'),
    ])
    const flots = fakeFlots({
      callTool: vi.fn(async () => ({ ok: false, data: null, text: 'Abonnement requis' })),
    })
    const registry = await makeRegistry(flots, fakeHardware())

    const result = await runAgentTurn('Crée une tâche', deps(llm, registry))

    expect(result.text).toBe('Je n’ai pas réussi.')
    expect(JSON.stringify(llm.requests[1].messages)).toContain('Abonnement requis')
  })

  it('keeps working when Flots is unreachable', async () => {
    const llm = new ScriptedLlm([say('Je ne suis pas connecté à Flots.')])
    const flots = fakeFlots({
      listTools: async () => {
        throw new Error('not paired')
      },
    })
    const registry = await makeRegistry(flots, fakeHardware())

    await runAgentTurn('Mes tâches ?', deps(llm, registry))

    const offered = (llm.requests[0].tools ?? []).map((tool) => tool.name)
    expect(offered).toContain('get_current_datetime')
    expect(offered).not.toContain('create_task')
    // The prompt tells the model to say so rather than pretending.
    expect(String(llm.requests[0].messages[0].content)).toContain('pas connecté à Flots')
  })

  it('stops looping when the model keeps calling tools', async () => {
    const llm = new ScriptedLlm(
      Array.from({ length: MAX_ITERATIONS + 2 }, () => call('get_current_datetime')),
    )
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    const result = await runAgentTurn('Boucle', deps(llm, registry))

    expect(result.iterations).toBe(MAX_ITERATIONS)
    // The user gets a sentence rather than an endless "thinking".
    expect(result.text).toContain('pas réussi')
  })

  it('confirms an action when the model answers with nothing', async () => {
    const llm = new ScriptedLlm([call('set_expression', { name: 'happy' }), say('')])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    const result = await runAgentTurn('Fais-moi un sourire', deps(llm, registry))

    expect(result.text).toBe('C’est fait.')
  })

  it('reports a model failure as an error event', async () => {
    const llm: LlmPort = {
      label: 'broken',
      available: true,
      complete: async () => {
        throw new Error('modèle injoignable')
      },
    }
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    await expect(runAgentTurn('Bonjour', deps(llm, registry))).rejects.toThrow('injoignable')
    expect(agentEvents().at(-1)).toMatchObject({ state: 'error' })
  })

  it('tells the model what time it is', async () => {
    const llm = new ScriptedLlm([say('ok')])
    const registry = await makeRegistry(fakeFlots(), fakeHardware())

    await runAgentTurn('Bonjour', deps(llm, registry))

    // 06:00 UTC is 08:00 in Paris in August.
    expect(String(llm.requests[0].messages[0].content)).toContain('08:00')
  })
})
