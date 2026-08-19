import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_ALARMS, type AlarmsDocument } from '../core/domain/alarm'
import type { AlarmEvent, AppEvent } from '../core/domain/events'
import type { HardwarePort } from '../core/ports/hardware'
import {
  AlarmScheduler,
  MAX_RINGING_MS,
  REPEAT_INTERVAL_MS,
} from '../core/usecases/alarms/alarmScheduler'
import { AlarmService } from '../core/usecases/alarms/alarmService'
import { JsonStore } from '../infrastructure/store/jsonStore'

const PARIS = 'Europe/Paris'
/** 08:00 local time in Paris, in August. */
const AT_0800 = new Date('2026-08-19T06:00:00Z')

let events: AppEvent[]
let alarms: AlarmService
let hardware: HardwarePort
let clock: Date

function makeHardware(): HardwarePort {
  return {
    health: async () => ({ online: true, status: null }),
    lastStatus: () => null,
    startRecording: async () => 'rec',
    stopRecording: async () => ({ recordingId: 'rec', durationSeconds: 1, path: '' }),
    cancelRecording: async () => undefined,
    readRecording: async () => new ArrayBuffer(0),
    speak: vi.fn(async () => 'utt'),
    stopSpeaking: vi.fn(async () => undefined),
    playSound: vi.fn(async () => undefined),
    setExpression: vi.fn(async () => undefined),
    setTracking: async () => undefined,
    setCameraFlip: async () => undefined,
  }
}

function scheduler(): AlarmScheduler {
  return new AlarmScheduler({
    alarms,
    hardware,
    publish: (event) => events.push(event),
    now: () => clock,
    timezone: PARIS,
  })
}

const alarmEvents = () => events.filter((e): e is AlarmEvent => e.type === 'alarm')

beforeEach(async () => {
  events = []
  clock = AT_0800
  hardware = makeHardware()
  const directory = await mkdtemp(join(tmpdir(), 'cap-sched-'))
  alarms = new AlarmService(
    new JsonStore<AlarmsDocument>(join(directory, 'alarms.json'), EMPTY_ALARMS),
    () => clock,
    PARIS,
  )
})

describe('AlarmScheduler', () => {
  it('stays quiet when nothing is due', async () => {
    await alarms.create({ time: '09:00', repeat: 'daily' })
    const subject = scheduler()

    await subject.tick()

    expect(alarmEvents()).toEqual([])
    expect(hardware.playSound).not.toHaveBeenCalled()
  })

  it('rings a due alarm out loud and on screen', async () => {
    await alarms.create({ time: '08:00', label: 'Réveil', repeat: 'daily' })
    const subject = scheduler()

    await subject.tick()

    expect(alarmEvents()).toEqual([
      expect.objectContaining({ state: 'ringing', label: 'Réveil', time: '08:00' }),
    ])
    expect(hardware.playSound).toHaveBeenCalledWith('alert', { interrupt: true })
    expect(hardware.speak).toHaveBeenCalledWith('C’est l’heure : Réveil')
    expect(subject.current?.label).toBe('Réveil')
  })

  it('does not start a second alarm while one is ringing', async () => {
    await alarms.create({ time: '08:00', label: 'A', repeat: 'daily' })
    await alarms.create({ time: '08:00', label: 'B', repeat: 'daily' })
    const subject = scheduler()

    await subject.tick()
    await subject.tick()

    expect(alarmEvents().filter((event) => event.state === 'ringing')).toHaveLength(1)
  })

  it('keeps making noise until somebody answers', async () => {
    // An alarm that gives up after one beep is not an alarm.
    await alarms.create({ time: '08:00', repeat: 'daily' })
    const subject = scheduler()

    await subject.tick()
    clock = new Date(AT_0800.getTime() + REPEAT_INTERVAL_MS + 1000)
    await subject.tick()

    expect(hardware.playSound).toHaveBeenCalledTimes(2)
  })

  it('does not repeat the sound before its interval', async () => {
    await alarms.create({ time: '08:00', repeat: 'daily' })
    const subject = scheduler()

    await subject.tick()
    clock = new Date(AT_0800.getTime() + 1000)
    await subject.tick()

    expect(hardware.playSound).toHaveBeenCalledTimes(1)
  })

  it('stops when dismissed', async () => {
    await alarms.create({ time: '08:00', repeat: 'daily' })
    const subject = scheduler()
    await subject.tick()

    await subject.dismiss()

    expect(subject.current).toBeNull()
    expect(alarmEvents().at(-1)?.state).toBe('stopped')
    expect(hardware.stopSpeaking).toHaveBeenCalled()
  })

  it('does not ring the same alarm again after being dismissed', async () => {
    await alarms.create({ time: '08:00', repeat: 'daily' })
    const subject = scheduler()
    await subject.tick()
    await subject.dismiss()

    clock = new Date(AT_0800.getTime() + 30_000)
    await subject.tick()

    expect(alarmEvents().filter((event) => event.state === 'ringing')).toHaveLength(1)
  })

  it('rings again the next day', async () => {
    await alarms.create({ time: '08:00', repeat: 'daily' })
    const subject = scheduler()
    await subject.tick()
    await subject.dismiss()

    clock = new Date('2026-08-20T06:00:00Z')
    await subject.tick()

    expect(alarmEvents().filter((event) => event.state === 'ringing')).toHaveLength(2)
  })

  it('snoozing schedules a fresh alarm and leaves the original alone', async () => {
    await alarms.create({ time: '08:00', label: 'Réveil', repeat: 'daily' })
    const subject = scheduler()
    await subject.tick()

    await subject.snooze(5)

    const list = await alarms.list()
    expect(list).toHaveLength(2)
    expect(list.map((alarm) => alarm.time)).toContain('08:05')
    // The daily alarm keeps its own schedule.
    expect(list.find((alarm) => alarm.time === '08:00')?.repeat).toBe('daily')
    expect(subject.current).toBeNull()
  })

  it('ignores dismiss and snooze when nothing is ringing', async () => {
    const subject = scheduler()

    await subject.dismiss()
    await subject.snooze()

    expect(events).toEqual([])
  })

  it('gives up when nobody answers, instead of blocking every later alarm', async () => {
    // An alarm that rang to an empty room used to hold the scheduler forever.
    await alarms.create({ time: '08:00', label: 'Personne', repeat: 'daily' })
    await alarms.create({ time: '08:05', label: 'Suivante', repeat: 'daily' })
    const subject = scheduler()
    await subject.tick()

    clock = new Date(AT_0800.getTime() + MAX_RINGING_MS + 1000)
    await subject.tick()

    expect(subject.current).toBeNull()
    expect(alarmEvents().at(-1)?.state).toBe('stopped')

    // And the next alarm rings normally.
    clock = new Date('2026-08-19T06:05:00Z')
    await subject.tick()
    expect(subject.current?.label).toBe('Suivante')
  })

  it('lets a client that connects mid-ring catch up', async () => {
    // The kiosk can reload while an alarm is ringing; it must still see it.
    await alarms.create({ time: '08:00', label: 'Réveil', repeat: 'daily' })
    const subject = scheduler()

    expect(subject.ringingEvent()).toBeNull()

    await subject.tick()

    expect(subject.ringingEvent()).toMatchObject({
      type: 'alarm',
      state: 'ringing',
      label: 'Réveil',
    })

    await subject.dismiss()
    expect(subject.ringingEvent()).toBeNull()
  })
})
