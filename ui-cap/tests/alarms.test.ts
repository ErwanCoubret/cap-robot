import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { EMPTY_ALARMS, type Alarm, type AlarmsDocument } from '../core/domain/alarm'
import {
  describeNext,
  isDue,
  localMoment,
  resolveOneOffDate,
} from '../core/usecases/alarms/alarmClock'
import { AlarmService, AlarmValidationError } from '../core/usecases/alarms/alarmService'
import { JsonStore } from '../infrastructure/store/jsonStore'

const PARIS = 'Europe/Paris'

function alarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: 'alarm_1',
    label: 'Réveil',
    time: '07:30',
    repeat: 'daily',
    enabled: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }
}

/** 07:30 local time in Paris, in August (UTC+2). */
const AT_0730 = new Date('2026-08-19T05:30:00Z')

describe('localMoment', () => {
  it('reads wall-clock time in the robot’s timezone', () => {
    const moment = localMoment(AT_0730, PARIS)

    expect(moment.date).toBe('2026-08-19')
    expect(moment.time).toBe('07:30')
    // 2026-08-19 is a Wednesday.
    expect(moment.weekday).toBe(3)
  })

  it('follows daylight saving rather than a fixed offset', () => {
    // Same UTC instant, six months apart: Paris is UTC+2 then UTC+1.
    expect(localMoment(new Date('2026-08-19T05:30:00Z'), PARIS).time).toBe('07:30')
    expect(localMoment(new Date('2026-01-19T05:30:00Z'), PARIS).time).toBe('06:30')
  })

  it('reports midnight as 00:00', () => {
    expect(localMoment(new Date('2026-08-18T22:00:00Z'), PARIS).time).toBe('00:00')
  })
})

describe('isDue', () => {
  it('rings a daily alarm at its time', () => {
    expect(isDue(alarm(), AT_0730, PARIS)).toBe(true)
  })

  it('stays quiet at any other minute', () => {
    expect(isDue(alarm(), new Date('2026-08-19T05:31:00Z'), PARIS)).toBe(false)
  })

  it('never rings a disabled alarm', () => {
    expect(isDue(alarm({ enabled: false }), AT_0730, PARIS)).toBe(false)
  })

  it('does not ring twice in the same minute', () => {
    // The scheduler ticks several times a minute; one ring is enough.
    const fired = alarm({ lastFiredAt: AT_0730.toISOString() })

    expect(isDue(fired, new Date('2026-08-19T05:30:30Z'), PARIS)).toBe(false)
  })

  it('rings again the next day', () => {
    const fired = alarm({ lastFiredAt: AT_0730.toISOString() })

    expect(isDue(fired, new Date('2026-08-20T05:30:00Z'), PARIS)).toBe(true)
  })

  it('skips the weekend for a weekdays alarm', () => {
    const weekday = alarm({ repeat: 'weekdays' })

    expect(isDue(weekday, AT_0730, PARIS)).toBe(true)
    // 2026-08-22 is a Saturday.
    expect(isDue(weekday, new Date('2026-08-22T05:30:00Z'), PARIS)).toBe(false)
  })

  it('rings a one-off only on its own date', () => {
    const once = alarm({ repeat: 'once', date: '2026-08-19' })

    expect(isDue(once, AT_0730, PARIS)).toBe(true)
    expect(isDue(once, new Date('2026-08-20T05:30:00Z'), PARIS)).toBe(false)
  })
})

describe('resolveOneOffDate', () => {
  it('means today when the hour is still ahead', () => {
    expect(resolveOneOffDate('09:00', AT_0730, PARIS)).toBe('2026-08-19')
  })

  it('means tomorrow when the hour has passed', () => {
    // "Set an alarm for seven" said at half past seven means tomorrow.
    expect(resolveOneOffDate('07:00', AT_0730, PARIS)).toBe('2026-08-20')
  })
})

describe('describeNext', () => {
  it('describes a daily alarm in words', () => {
    expect(describeNext(alarm({ time: '09:00' }), AT_0730, PARIS)).toContain(
      'aujourd’hui à 09:00',
    )
    expect(describeNext(alarm({ time: '07:00' }), AT_0730, PARIS)).toContain(
      'demain à 07:00',
    )
  })

  it('describes a weekdays alarm', () => {
    expect(describeNext(alarm({ repeat: 'weekdays' }), AT_0730, PARIS)).toBe(
      'en semaine à 07:30',
    )
  })
})

describe('AlarmService', () => {
  let service: AlarmService

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cap-alarms-'))
    service = new AlarmService(
      new JsonStore<AlarmsDocument>(join(directory, 'alarms.json'), EMPTY_ALARMS),
      () => AT_0730,
      PARIS,
    )
  })

  it('creates and lists an alarm', async () => {
    await service.create({ time: '08:15', label: 'Réunion' })

    const alarms = await service.list()
    expect(alarms).toHaveLength(1)
    expect(alarms[0]).toMatchObject({ time: '08:15', label: 'Réunion', repeat: 'once' })
  })

  it('dates a one-off alarm for the next time that hour comes round', async () => {
    const created = await service.create({ time: '07:00' })

    expect(created.date).toBe('2026-08-20')
  })

  it('names an unlabelled alarm', async () => {
    expect((await service.create({ time: '08:00' })).label).toBe('Alarme')
  })

  it('rejects a time it cannot ring', async () => {
    await expect(service.create({ time: '25:00' })).rejects.toThrow(AlarmValidationError)
    await expect(service.create({ time: 'huit heures' })).rejects.toThrow(
      AlarmValidationError,
    )
  })

  it('rejects a malformed date', async () => {
    await expect(service.create({ time: '08:00', date: '19/08/2026' })).rejects.toThrow(
      AlarmValidationError,
    )
  })

  it('lists alarms in chronological order', async () => {
    await service.create({ time: '09:00' })
    await service.create({ time: '07:00' })

    expect((await service.list()).map((item) => item.time)).toEqual(['07:00', '09:00'])
  })

  it('deletes an alarm and reports whether it existed', async () => {
    const created = await service.create({ time: '08:00' })

    expect(await service.delete(created.id)).toBe(true)
    expect(await service.delete(created.id)).toBe(false)
    expect(await service.list()).toEqual([])
  })

  it('records when an alarm rang', async () => {
    const created = await service.create({ time: '08:00' })

    await service.markFired(created.id, AT_0730)

    expect((await service.list())[0].lastFiredAt).toBe(AT_0730.toISOString())
  })

  it('can silence an alarm without deleting it', async () => {
    const created = await service.create({ time: '08:00' })

    await service.setEnabled(created.id, false)

    expect((await service.list())[0].enabled).toBe(false)
  })
})
