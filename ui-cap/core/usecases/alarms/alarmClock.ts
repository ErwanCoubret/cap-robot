/**
 * Alarm arithmetic, in the robot's own timezone.
 *
 * Everything the user types is wall-clock time — "eight o'clock" means eight
 * o'clock on the robot's wall, whatever the server thinks UTC is. These
 * helpers convert between the two using `Intl`, so daylight saving is handled
 * without pulling in a date library.
 */

import type { Alarm } from '../../domain/alarm'

/** Local calendar fields of an instant, in ``timeZone``. */
export interface LocalMoment {
  /** `YYYY-MM-DD` */
  date: string
  /** `HH:MM` */
  time: string
  /** 1 = Monday … 7 = Sunday */
  weekday: number
  minutes: number
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Break an instant into the local calendar fields the alarms are written in. */
export function localMoment(instant: Date, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(instant)

  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = field('hour') === '24' ? '00' : field('hour')
  const weekdayIndex = WEEKDAYS.indexOf(field('weekday').toLowerCase().slice(0, 3))

  return {
    date: `${field('year')}-${field('month')}-${field('day')}`,
    time: `${hour}:${field('minute')}`,
    weekday: weekdayIndex + 1,
    minutes: Number(hour) * 60 + Number(field('minute')),
  }
}

/** Whether ``alarm`` should ring at ``instant``. */
export function isDue(alarm: Alarm, instant: Date, timeZone: string): boolean {
  if (!alarm.enabled) {
    return false
  }

  const moment = localMoment(instant, timeZone)
  if (alarm.time !== moment.time) {
    return false
  }

  // An alarm that already rang this minute must not ring again on the next
  // tick of the scheduler.
  if (alarm.lastFiredAt) {
    const last = localMoment(new Date(alarm.lastFiredAt), timeZone)
    if (last.date === moment.date && last.time === moment.time) {
      return false
    }
  }

  switch (alarm.repeat) {
    case 'daily':
      return true
    case 'weekdays':
      return moment.weekday <= 5
    case 'once':
      return alarm.date === undefined || alarm.date === moment.date
  }
}

/**
 * Describe when an alarm will next ring, in words.
 *
 * Used to confirm out loud what was just set: "demain à 08:00" is checkable by
 * ear in a way a raw timestamp is not.
 */
export function describeNext(alarm: Alarm, now: Date, timeZone: string): string {
  const moment = localMoment(now, timeZone)
  const [hours, minutes] = alarm.time.split(':').map(Number)
  const alarmMinutes = hours * 60 + minutes

  if (alarm.repeat === 'daily') {
    return alarmMinutes > moment.minutes
      ? `tous les jours, prochaine fois aujourd’hui à ${alarm.time}`
      : `tous les jours, prochaine fois demain à ${alarm.time}`
  }
  if (alarm.repeat === 'weekdays') {
    return `en semaine à ${alarm.time}`
  }
  if (alarm.date && alarm.date !== moment.date) {
    return `le ${alarm.date} à ${alarm.time}`
  }
  return alarmMinutes > moment.minutes
    ? `aujourd’hui à ${alarm.time}`
    : `demain à ${alarm.time}`
}

/**
 * Resolve the date a one-off alarm belongs to.
 *
 * "Set an alarm for eight" said at nine in the evening means tomorrow morning,
 * not a time that has already passed.
 */
export function resolveOneOffDate(time: string, now: Date, timeZone: string): string {
  const moment = localMoment(now, timeZone)
  const [hours, minutes] = time.split(':').map(Number)
  if (hours * 60 + minutes > moment.minutes) {
    return moment.date
  }
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
  return localMoment(tomorrow, timeZone).date
}
