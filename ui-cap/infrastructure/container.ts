/**
 * Composition root of the server side.
 *
 * Route handlers call {@link getContainer} and receive the same wired object
 * every time. It is cached on `globalThis` rather than in a module variable
 * because the dev server re-evaluates modules on every edit, and a second
 * daemon socket or a second alarm ticker per hot reload would be a real bug.
 */

import { join } from 'node:path'

import { EMPTY_ALARMS, type AlarmsDocument } from '../core/domain/alarm'
import type { DaySummary } from '../core/domain/flots'
import { AgentService } from '../core/usecases/agent/agentService'
import { ToolRegistry } from '../core/usecases/agent/toolRegistry'
import { AlarmScheduler } from '../core/usecases/alarms/alarmScheduler'
import { AlarmService } from '../core/usecases/alarms/alarmService'
import {
  EMPTY_PROACTIVE,
  ProactiveService,
  type ProactiveState,
} from '../core/usecases/proactive/proactiveRules'
import { DayService, EMPTY_DAY } from '../core/usecases/sync/dayService'
import { VoiceInteractionService } from '../core/usecases/voice/voiceInteraction'
import { LlmAdapter } from './ai/llmAdapter'
import { resolveLlmProvider, resolveSttProvider } from './ai/providers'
import { SttAdapter } from './ai/sttAdapter'
import { CapdClient } from './capd/capdClient'
import { loadConfig, type AppConfig } from './config'
import { EventBus } from './events/eventBus'
import { FlotsAdapter } from './mcp/flotsAdapter'
import { McpClient } from './mcp/mcpClient'
import { PairingService } from './mcp/pairingService'
import { TokenStore } from './mcp/tokenStore'
import { JsonStore } from './store/jsonStore'

export interface AppContainer {
  config: AppConfig
  events: EventBus
  capd: CapdClient
  tokens: TokenStore
  mcp: McpClient
  pairing: PairingService
  flots: FlotsAdapter
  llm: LlmAdapter
  stt: SttAdapter
  alarms: AlarmService
  scheduler: AlarmScheduler
  proactive: ProactiveService
  day: DayService
  agent: AgentService
  voice: VoiceInteractionService
}

const CONTAINER_KEY = Symbol.for('cap.container')

type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_KEY]?: AppContainer
}

function build(): AppContainer {
  const config = loadConfig()
  const events = new EventBus()
  const capd = new CapdClient({ baseUrl: config.capdUrl, events })
  const now = () => new Date()

  const tokens = new TokenStore(config.dataDir)
  const mcp = new McpClient({ baseUrl: config.flotsBaseUrl, tokens })
  const pairing = new PairingService({
    baseUrl: config.flotsBaseUrl,
    publicUrl: config.publicUrl,
    tokens,
    mcp,
  })
  const flots = new FlotsAdapter(mcp, pairing)

  // Provider selection is validated here, at boot: a typo or a missing key is
  // reported now rather than when someone is standing in front of the robot
  // waiting for an answer.
  const llm = new LlmAdapter(resolveLlmProvider())
  const stt = new SttAdapter(resolveSttProvider())

  const alarms = new AlarmService(
    new JsonStore<AlarmsDocument>(join(config.dataDir, 'alarms.json'), EMPTY_ALARMS),
    now,
    config.timezone,
  )

  const scheduler = new AlarmScheduler({
    alarms,
    hardware: capd,
    publish: (event) => events.publish(event),
    now,
    timezone: config.timezone,
  })

  const day = new DayService({
    flots,
    store: new JsonStore<DaySummary>(join(config.dataDir, 'day.json'), EMPTY_DAY),
    publish: (event) => events.publish(event),
    now,
    timezone: config.timezone,
  })

  const proactive = new ProactiveService({
    hardware: capd,
    store: new JsonStore<ProactiveState>(
      join(config.dataDir, 'proactive.json'),
      EMPTY_PROACTIVE,
    ),
    publish: (event) => events.publish(event),
    readDay: () => day.read(),
    readPairing: () => pairing.status(),
    now,
    timezone: config.timezone,
    briefingTime: config.briefingTime,
  })

  const toolDeps = {
    hardware: capd,
    alarms,
    flots,
    now,
    locale: config.locale,
    timezone: config.timezone,
    readDay: () => day.read(),
    notify: (notification: { title: string; body: string; speak: boolean }) => {
      events.publish({
        type: 'notification',
        id: `note_${Date.now().toString(36)}`,
        title: notification.title,
        body: notification.body,
        level: 'info',
      })
    },
  }

  const agent = new AgentService({
    llm,
    tools: new ToolRegistry(toolDeps),
    hardware: capd,
    publish: (event) => events.publish(event),
    now,
    locale: config.locale,
    timezone: config.timezone,
    user: async () => (await tokens.read()).user?.email ?? null,
    missing: () => missingHardware(),
  })

  const voice = new VoiceInteractionService({
    hardware: capd,
    stt,
    flots,
    publish: (event) => events.publish(event),
    locale: config.locale,
    timezone: config.timezone,
    // The pipeline speaks the answer itself, so the agent does not repeat it.
    runCommand: (transcript, interactionId) =>
      agent.ask(transcript, { speak: false, turnId: interactionId }),
  })

  /** Parts of the body the robot does not currently have. */
  function missingHardware(): string[] {
    const status = capd.lastStatus()
    if (!status) {
      return ['micro', 'voix', 'caméra']
    }
    const missing: string[] = []
    if (!status.capabilities.mic) missing.push('micro')
    if (!status.capabilities.speaker) missing.push('voix')
    if (!status.camera.available) missing.push('caméra')
    if (!status.capabilities.eyes) missing.push('yeux')
    return missing
  }

  console.info(
    `cap-ui starting capd=${config.capdUrl} flots=${config.flotsBaseUrl} data=${config.dataDir}`,
  )
  console.info(`cap-ui ${llm.describe()}`)
  console.info(`cap-ui ${stt.describe()}`)

  // Keep the day warm in the background, so "what's on today?" answers at
  // conversation speed and still answers when the network is down.
  day.startAutoSync()
  scheduler.start()
  proactive.start()

  return {
    config,
    events,
    capd,
    tokens,
    mcp,
    pairing,
    flots,
    llm,
    stt,
    alarms,
    scheduler,
    proactive,
    day,
    agent,
    voice,
  }
}

/** Return the process-wide container, building it on first use. */
export function getContainer(): AppContainer {
  const scope = globalThis as GlobalWithContainer
  if (!scope[CONTAINER_KEY]) {
    scope[CONTAINER_KEY] = build()
  }
  return scope[CONTAINER_KEY]
}
