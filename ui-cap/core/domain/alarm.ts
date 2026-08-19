/**
 * Alarms and reminders the robot keeps by itself.
 *
 * These live on the robot rather than in Flots: they are about this device
 * making a noise in this room, and they must keep working when the robot is
 * not paired or the network is down.
 */

/** How often an alarm comes back. */
export type AlarmRepeat = 'once' | 'daily' | 'weekdays'

export interface Alarm {
  id: string
  /** What the robot says when it rings. */
  label: string
  /** Local wall-clock time, `HH:MM`. */
  time: string
  /** For a one-off alarm, the local date `YYYY-MM-DD` it belongs to. */
  date?: string
  repeat: AlarmRepeat
  enabled: boolean
  createdAt: string
  /** Last time it actually rang, so it does not ring twice a minute. */
  lastFiredAt?: string
}

/** The stored document. */
export interface AlarmsDocument {
  alarms: Alarm[]
}

export const EMPTY_ALARMS: AlarmsDocument = { alarms: [] }

/** `HH:MM` on a 24-hour clock. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `YYYY-MM-DD`. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
