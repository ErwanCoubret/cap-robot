import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppEvent, NotificationEvent } from '../core/domain/events'
import type { DaySummary, PairingInfo } from '../core/domain/flots'
import type { HardwarePort } from '../core/ports/hardware'
import {
  EMPTY_PROACTIVE,
  ProactiveService,
  minutesUntil,
  type ProactiveState,
} from '../core/usecases/proactive/proactiveRules'
import { JsonStore } from '../infrastructure/store/jsonStore'

const PARIS = 'Europe/Paris'
/** 10:00 local time in Paris. */
const NOW = new Date('2026-08-19T08:00:00Z')

const PAIRED: PairingInfo = {
  status: 'paired',
  user: { email: 'erwan@flots.app' },
  scopes: [],
  expiresAt: null,
  daysRemaining: 20,
  baseUrl: 'https://api-staging.flots.app',
}

const EMPTY_DAY: DaySummary = { date: '2026-08-19', syncedAt: NOW.toISOString(), tasks: [], overdue: [] }

let events: AppEvent[]
let store: JsonStore<ProactiveState>
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
    stopSpeaking: async () => undefined,
    playSound: vi.fn(async () => undefined),
    setExpression: async () => undefined,
    setTracking: async () => undefined,
    setCameraFlip: async () => undefined,
  }
}

function service(options: { day?: DaySummary; pairing?: PairingInfo; briefingTime?: string } = {}) {
  return new ProactiveService({
    hardware,
    store,
    publish: (event) => events.push(event),
    readDay: async () => options.day ?? EMPTY_DAY,
    readPairing: async () => options.pairing ?? PAIRED,
    now: () => clock,
    timezone: PARIS,
    briefingTime: options.briefingTime ?? '08:00',
  })
}

const notifications = () => events.filter((e): e is NotificationEvent => e.type === 'notification')

beforeEach(async () => {
  events = []
  clock = NOW
  hardware = makeHardware()
  const directory = await mkdtemp(join(tmpdir(), 'cap-proactive-'))
  store = new JsonStore<ProactiveState>(join(directory, 'proactive.json'), EMPTY_PROACTIVE)
})

describe('minutesUntil', () => {
  it('measures the time left before a deadline', () => {
    expect(
      minutesUntil({ id: '1', title: 'x', endDate: '2026-08-19T08:20:00Z' }, NOW),
    ).toBe(20)
  })

  it('is unknown for an undated task', () => {
    expect(minutesUntil({ id: '1', title: 'x', endDate: null }, NOW)).toBeNull()
    expect(minutesUntil({ id: '1', title: 'x', endDate: 'demain' }, NOW)).toBeNull()
  })
})

describe('ProactiveService', () => {
  it('says nothing when there is nothing to say', async () => {
    await service().tick()

    expect(notifications()).toEqual([])
    expect(hardware.speak).not.toHaveBeenCalled()
  })

  it('announces a task shortly before it is due', async () => {
    const day: DaySummary = {
      ...EMPTY_DAY,
      tasks: [{ id: 't1', title: 'Point produit', endDate: '2026-08-19T08:20:00Z' }],
    }

    await service({ day }).tick()

    expect(notifications()).toHaveLength(1)
    expect(notifications()[0].body).toContain('Point produit')
    expect(hardware.speak).toHaveBeenCalled()
  })

  it('says it once, not every minute', async () => {
    // The robot is talking out loud in someone's room; repeating is worse
    // than missing.
    const day: DaySummary = {
      ...EMPTY_DAY,
      tasks: [{ id: 't1', title: 'Point produit', endDate: '2026-08-19T08:20:00Z' }],
    }
    const subject = service({ day })

    await subject.tick()
    await subject.tick()
    await subject.tick()

    expect(notifications()).toHaveLength(1)
  })

  it('ignores a task that is still far away or already past', async () => {
    const day: DaySummary = {
      ...EMPTY_DAY,
      tasks: [
        { id: 'later', title: 'Plus tard', endDate: '2026-08-19T14:00:00Z' },
        { id: 'past', title: 'Passée', endDate: '2026-08-19T07:00:00Z' },
      ],
    }

    await service({ day }).tick()

    expect(notifications()).toEqual([])
  })

  it('reads the day out at the briefing time', async () => {
    const day: DaySummary = {
      ...EMPTY_DAY,
      tasks: [{ id: 't1', title: 'Point produit', endDate: '2026-08-19T14:00:00Z' }],
      overdue: [{ id: 't0', title: 'En retard', endDate: '2026-08-18T14:00:00Z' }],
    }

    await service({ day, briefingTime: '10:00' }).tick()

    const briefing = notifications().find((event) => event.title === 'Ta journée')
    expect(briefing?.body).toContain('1 tâche')
    expect(briefing?.body).toContain('1 en retard')
    expect(hardware.speak).toHaveBeenCalledWith(expect.stringContaining('Bonjour'))
  })

  it('does not brief at any other time', async () => {
    await service({ briefingTime: '07:00' }).tick()

    expect(notifications()).toEqual([])
  })

  it('warns when the Flots connection is about to expire', async () => {
    await service({ pairing: { ...PAIRED, daysRemaining: 2 } }).tick()

    const warning = notifications()[0]
    expect(warning.level).toBe('warning')
    expect(warning.body).toContain('2 jours')
  })

  it('warns when the connection has already expired', async () => {
    // There is no refresh grant: the robot cannot fix this by itself.
    await service({ pairing: { ...PAIRED, status: 'expired', daysRemaining: -1 } }).tick()

    expect(notifications()[0].title).toContain('expirée')
  })

  it('stays quiet while the connection is healthy', async () => {
    await service({ pairing: { ...PAIRED, daysRemaining: 20 } }).tick()

    expect(notifications()).toEqual([])
  })

  it('says the same thing again the next day', async () => {
    const subject = service({ pairing: { ...PAIRED, daysRemaining: 2 } })
    await subject.tick()

    clock = new Date('2026-08-20T08:00:00Z')
    await subject.tick()

    expect(notifications()).toHaveLength(2)
  })

  it('remembers what it said across restarts', async () => {
    const day: DaySummary = {
      ...EMPTY_DAY,
      tasks: [{ id: 't1', title: 'Point produit', endDate: '2026-08-19T08:20:00Z' }],
    }
    await service({ day }).tick()

    // A fresh service reading the same file must not repeat the announcement.
    await service({ day }).tick()

    expect(notifications()).toHaveLength(1)
  })
})
