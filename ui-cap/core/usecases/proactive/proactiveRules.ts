/**
 * Cap speaking up on its own.
 *
 * The point of a robot on a desk is that it can tell you something before you
 * think to ask. The discipline is restraint: each thing is said once, and
 * anything that would repeat every ten minutes is remembered as already said.
 */

import type { AppEvent } from '../../domain/events'
import type { DaySummary, PairingInfo, Task } from '../../domain/flots'
import type { HardwarePort } from '../../ports/hardware'
import type { StorePort } from '../../ports/store'
import { localMoment } from '../alarms/alarmClock'

/** A task is announced when it comes this close to its deadline. */
export const DUE_SOON_MINUTES = 30

/** Warn this many days before the Flots token stops working. */
export const TOKEN_WARNING_DAYS = 3

/** What has already been said, so it is not said again. */
export interface ProactiveState {
  /** key -> local day it was last announced. */
  announced: Record<string, string>
}

export const EMPTY_PROACTIVE: ProactiveState = { announced: {} }

export interface ProactiveDeps {
  hardware: HardwarePort
  store: StorePort<ProactiveState>
  publish: (event: AppEvent) => void
  readDay: () => Promise<DaySummary>
  readPairing: () => Promise<PairingInfo>
  now: () => Date
  timezone: string
  /** Local time of the morning briefing, `HH:MM`. */
  briefingTime?: string
}

export class ProactiveService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: ProactiveDeps) {}

  start(intervalMs = 60_000): () => void {
    this.stop()
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        console.debug('proactive tick skipped', error)
      })
    }, intervalMs)
    this.timer.unref?.()
    return () => this.stop()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One pass of the rules. Exposed so each rule can be tested directly. */
  async tick(): Promise<void> {
    const now = this.deps.now()
    const moment = localMoment(now, this.deps.timezone)

    await this.checkPairing(moment.date)
    await this.checkBriefing(moment.date, moment.time)
    await this.checkDueSoon(now, moment.date)
  }

  /** Warn once a day that the Flots connection is about to expire. */
  private async checkPairing(day: string): Promise<void> {
    const pairing = await this.deps.readPairing()

    if (pairing.status === 'expired') {
      await this.announce('pairing-expired', day, {
        title: 'Connexion Flots expirée',
        body: 'Va dans les réglages pour réappairer Cap.',
        speak: 'Ma connexion à Flots a expiré. Réappaire-moi dans les réglages.',
      })
      return
    }

    if (
      pairing.status === 'paired' &&
      pairing.daysRemaining !== null &&
      pairing.daysRemaining <= TOKEN_WARNING_DAYS
    ) {
      await this.announce('pairing-expiring', day, {
        title: 'Connexion Flots bientôt expirée',
        body: `Il reste ${pairing.daysRemaining} jour${pairing.daysRemaining > 1 ? 's' : ''}.`,
        speak: `Ma connexion à Flots expire dans ${pairing.daysRemaining} jours.`,
      })
    }
  }

  /** Read the day out once each morning. */
  private async checkBriefing(day: string, time: string): Promise<void> {
    const briefingTime = this.deps.briefingTime ?? '08:00'
    if (time !== briefingTime) {
      return
    }

    const summary = await this.deps.readDay()
    const count = summary.tasks.length
    const late = summary.overdue.length

    const parts = [
      count === 0
        ? 'Rien de prévu aujourd’hui.'
        : `Tu as ${count} tâche${count > 1 ? 's' : ''} aujourd’hui.`,
    ]
    if (late > 0) {
      parts.push(`Et ${late} en retard.`)
    }
    if (summary.tasks[0]) {
      parts.push(`La première : ${summary.tasks[0].title}.`)
    }

    await this.announce('briefing', day, {
      title: 'Ta journée',
      body: parts.join(' '),
      speak: `Bonjour ! ${parts.join(' ')}`,
    })
  }

  /** Mention a task shortly before it is due, once each. */
  private async checkDueSoon(now: Date, day: string): Promise<void> {
    const summary = await this.deps.readDay()

    for (const task of summary.tasks) {
      const minutes = minutesUntil(task, now)
      if (minutes === null || minutes < 0 || minutes > DUE_SOON_MINUTES) {
        continue
      }
      await this.announce(`due-${task.id}`, day, {
        title: 'Bientôt',
        body: `${task.title} dans ${Math.max(1, Math.round(minutes))} minutes.`,
        speak: `${task.title}, dans ${Math.max(1, Math.round(minutes))} minutes.`,
      })
    }
  }

  /**
   * Say something once per local day.
   *
   * The guard is written before speaking: saying it twice is worse than
   * missing it once, and the robot is talking out loud in someone's room.
   */
  private async announce(
    key: string,
    day: string,
    message: { title: string; body: string; speak?: string },
  ): Promise<void> {
    const state = await this.deps.store.read()
    if (state.announced[key] === day) {
      return
    }

    await this.deps.store.update((current) => ({
      announced: { ...current.announced, [key]: day },
    }))

    this.deps.publish({
      type: 'notification',
      id: `${key}-${day}`,
      title: message.title,
      body: message.body,
      level: key.startsWith('pairing') ? 'warning' : 'info',
    })

    if (message.speak) {
      await this.deps.hardware.playSound('chime').catch(() => undefined)
      await this.deps.hardware.speak(message.speak).catch(() => undefined)
    }
  }
}

/** Minutes between now and a task's deadline, or null when it has none. */
export function minutesUntil(task: Task, now: Date): number | null {
  if (!task.endDate) {
    return null
  }
  const due = Date.parse(task.endDate)
  if (Number.isNaN(due)) {
    return null
  }
  return (due - now.getTime()) / 60_000
}
