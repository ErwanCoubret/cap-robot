/**
 * Managing the robot's alarms.
 *
 * A thin service over the stored document: create, list, delete. Ringing them
 * is the scheduler's job; this is what the agent and the alarms screen both
 * talk to.
 */

import {
  DATE_PATTERN,
  TIME_PATTERN,
  type Alarm,
  type AlarmRepeat,
  type AlarmsDocument,
} from '../../domain/alarm'
import type { StorePort } from '../../ports/store'
import { describeNext, resolveOneOffDate } from './alarmClock'

/** More than this and the list stops being usable on a touch screen. */
export const MAX_ALARMS = 20

export interface CreateAlarmInput {
  time: string
  label?: string
  date?: string
  repeat?: AlarmRepeat
}

export class AlarmValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlarmValidationError'
  }
}

export class AlarmService {
  constructor(
    private readonly store: StorePort<AlarmsDocument>,
    private readonly now: () => Date = () => new Date(),
    private readonly timezone = 'Europe/Paris',
  ) {}

  async list(): Promise<Alarm[]> {
    const document = await this.store.read()
    return [...document.alarms].sort((left, right) => left.time.localeCompare(right.time))
  }

  async create(input: CreateAlarmInput): Promise<Alarm> {
    const time = (input.time ?? '').trim()
    if (!TIME_PATTERN.test(time)) {
      throw new AlarmValidationError(
        `heure invalide : "${input.time}" (format attendu HH:MM)`,
      )
    }
    if (input.date && !DATE_PATTERN.test(input.date)) {
      throw new AlarmValidationError(
        `date invalide : "${input.date}" (format attendu AAAA-MM-JJ)`,
      )
    }

    const repeat: AlarmRepeat = input.repeat ?? 'once'
    const now = this.now()
    const alarm: Alarm = {
      id: `alarm_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      label: (input.label ?? '').trim() || 'Alarme',
      time,
      // A one-off with no date means the next time that hour comes round.
      date: repeat === 'once' ? (input.date ?? resolveOneOffDate(time, now, this.timezone)) : undefined,
      repeat,
      enabled: true,
      createdAt: now.toISOString(),
    }

    await this.store.update((current) => {
      if (current.alarms.length >= MAX_ALARMS) {
        throw new AlarmValidationError(`trop d’alarmes (maximum ${MAX_ALARMS})`)
      }
      return { alarms: [...current.alarms, alarm] }
    })

    return alarm
  }

  async delete(id: string): Promise<boolean> {
    let removed = false
    await this.store.update((current) => {
      const alarms = current.alarms.filter((alarm) => alarm.id !== id)
      removed = alarms.length !== current.alarms.length
      return { alarms }
    })
    return removed
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.store.update((current) => ({
      alarms: current.alarms.map((alarm) =>
        alarm.id === id ? { ...alarm, enabled } : alarm,
      ),
    }))
  }

  /** Record that an alarm just rang, so it does not ring twice. */
  async markFired(id: string, at: Date): Promise<void> {
    await this.store.update((current) => ({
      alarms: current.alarms.map((alarm) =>
        alarm.id === id ? { ...alarm, lastFiredAt: at.toISOString() } : alarm,
      ),
    }))
  }

  /** Human sentence describing when an alarm rings next. */
  describe(alarm: Alarm): string {
    return describeNext(alarm, this.now(), this.timezone)
  }
}
