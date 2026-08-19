/**
 * The tools that belong to the robot rather than to Flots.
 *
 * These work with no network and no pairing: the clock, the alarms, the voice
 * and the eyes. They are what makes Cap useful as an object in a room, not
 * just a client for a web app.
 */

import type { DaySummary } from '../../domain/flots'
import type { ToolDefinition } from '../../ports/ai'
import type { ExpressionName, HardwarePort } from '../../ports/hardware'
import type { AlarmService } from '../alarms/alarmService'

/** Result of running a tool, as fed back to the model. */
export interface ToolOutcome {
  ok: boolean
  /** Short sentence the interface can show and the model can quote. */
  text: string
  data?: unknown
}

export interface LocalToolDeps {
  hardware: HardwarePort
  alarms: AlarmService
  now: () => Date
  locale: string
  timezone: string
  /** Publishes a notification onto the screen. */
  notify?: (notification: { title: string; body: string; speak: boolean }) => void
  /** Reads the cached view of the day, without calling Flots. */
  readDay?: () => Promise<DaySummary>
}

export interface LocalTool {
  definition: ToolDefinition
  run(args: Record<string, unknown>, deps: LocalToolDeps): Promise<ToolOutcome>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const getCurrentDatetime: LocalTool = {
  definition: {
    name: 'get_current_datetime',
    description:
      "Donne la date et l'heure actuelles du robot. À utiliser dès qu'une question porte sur l'heure, le jour ou une échéance relative comme « demain ».",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_args, deps) {
    const now = deps.now()
    const formatted = new Intl.DateTimeFormat(deps.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: deps.timezone,
    }).format(now)

    return {
      ok: true,
      text: formatted,
      data: { iso: now.toISOString(), formatted, timezone: deps.timezone },
    }
  },
}

const setAlarm: LocalTool = {
  definition: {
    name: 'set_alarm',
    description:
      "Programme une alarme sur le robot. L'heure est au format 24 h HH:MM. Utiliser repeat=daily pour tous les jours, weekdays pour le lundi au vendredi, once pour une seule fois.",
    parameters: {
      type: 'object',
      properties: {
        time: { type: 'string', description: 'Heure au format HH:MM, par exemple 07:30' },
        label: { type: 'string', description: "Ce que l'alarme rappelle" },
        repeat: { type: 'string', enum: ['once', 'daily', 'weekdays'] },
        date: { type: 'string', description: 'Date AAAA-MM-JJ pour une alarme unique' },
      },
      required: ['time'],
      additionalProperties: false,
    },
  },
  async run(args, deps) {
    try {
      const alarm = await deps.alarms.create({
        time: text(args.time),
        label: text(args.label),
        date: text(args.date) || undefined,
        repeat: ['once', 'daily', 'weekdays'].includes(text(args.repeat))
          ? (text(args.repeat) as 'once' | 'daily' | 'weekdays')
          : undefined,
      })
      return {
        ok: true,
        text: `Alarme « ${alarm.label} » réglée ${deps.alarms.describe(alarm)}.`,
        data: alarm,
      }
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : 'alarme refusée' }
    }
  },
}

const listAlarms: LocalTool = {
  definition: {
    name: 'list_alarms',
    description: 'Liste les alarmes programmées sur le robot.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_args, deps) {
    const alarms = await deps.alarms.list()
    if (alarms.length === 0) {
      return { ok: true, text: 'Aucune alarme programmée.', data: { alarms: [] } }
    }
    const lines = alarms.map(
      (alarm) => `${alarm.time} — ${alarm.label} (${deps.alarms.describe(alarm)})`,
    )
    return { ok: true, text: lines.join(' ; '), data: { alarms } }
  },
}

const deleteAlarm: LocalTool = {
  definition: {
    name: 'delete_alarm',
    description:
      "Supprime une alarme du robot. Utiliser list_alarms d'abord pour connaître son identifiant.",
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  async run(args, deps) {
    const removed = await deps.alarms.delete(text(args.id))
    return removed
      ? { ok: true, text: 'Alarme supprimée.' }
      : { ok: false, text: 'Aucune alarme avec cet identifiant.' }
  },
}

const speakTool: LocalTool = {
  definition: {
    name: 'speak',
    description:
      "Fait parler Cap à voix haute immédiatement, avant la réponse finale. Utile pour faire patienter pendant une action longue. Ne pas l'utiliser pour la réponse elle-même : elle est déjà prononcée.",
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  async run(args, deps) {
    const spoken = text(args.text)
    if (!spoken) {
      return { ok: false, text: 'rien à dire' }
    }
    await deps.hardware.speak(spoken)
    return { ok: true, text: `Dit à voix haute : ${spoken}` }
  },
}

const showNotification: LocalTool = {
  definition: {
    name: 'show_notification',
    description:
      "Affiche une notification sur l'écran du robot, et la prononce si speak vaut true.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        speak: { type: 'boolean' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  async run(args, deps) {
    const title = text(args.title)
    const body = text(args.body)
    deps.notify?.({ title, body, speak: args.speak === true })
    if (args.speak === true) {
      await deps.hardware.speak(`${title}. ${body}`.trim())
    }
    return { ok: true, text: `Notification affichée : ${title}` }
  },
}

const EXPRESSIONS: ExpressionName[] = [
  'center',
  'happy',
  'thinking',
  'listening',
  'look_left',
  'look_right',
  'wiggle',
]

const setExpression: LocalTool = {
  definition: {
    name: 'set_expression',
    description: 'Change brièvement l’expression des yeux du robot.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', enum: EXPRESSIONS } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  async run(args, deps) {
    const name = text(args.name) as ExpressionName
    if (!EXPRESSIONS.includes(name)) {
      return { ok: false, text: `expression inconnue : ${name}` }
    }
    await deps.hardware.setExpression(name)
    return { ok: true, text: `Expression : ${name}` }
  },
}

const getDaySummary: LocalTool = {
  definition: {
    name: 'get_day_summary',
    description:
      "Donne les tâches du jour et les tâches en retard, telles que le robot les a en mémoire. À utiliser pour « ma journée », « qu'est-ce que j'ai aujourd'hui », « suis-je en retard ».",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_args, deps) {
    const day = await deps.readDay?.()
    if (!day || !day.syncedAt) {
      return {
        ok: false,
        text: 'La journée n’a pas encore été synchronisée avec Flots.',
      }
    }

    if (day.tasks.length === 0 && day.overdue.length === 0) {
      return { ok: true, text: 'Rien de prévu aujourd’hui.', data: day }
    }

    const parts: string[] = []
    if (day.tasks.length > 0) {
      parts.push(
        `Aujourd’hui : ${day.tasks.map((task) => task.title).join(', ')}`,
      )
    }
    if (day.overdue.length > 0) {
      parts.push(
        `En retard : ${day.overdue.map((task) => task.title).join(', ')}`,
      )
    }
    return { ok: true, text: parts.join('. '), data: day }
  },
}

/** Every tool the robot provides on its own. */
export const LOCAL_TOOLS: LocalTool[] = [
  getCurrentDatetime,
  getDaySummary,
  setAlarm,
  listAlarms,
  deleteAlarm,
  speakTool,
  showNotification,
  setExpression,
]
