import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppEvent } from '../core/domain/events'
import type { DaySummary, McpToolResult } from '../core/domain/flots'
import type { FlotsPort } from '../core/ports/flots'
import { DayService, EMPTY_DAY, STALE_AFTER_MS } from '../core/usecases/sync/dayService'
import { localDay, parseTasks, splitByDay } from '../core/usecases/sync/parseTasks'
import { JsonStore } from '../infrastructure/store/jsonStore'

const PARIS = 'Europe/Paris'
/** 2026-08-19 at 10:00 local time in Paris. */
const NOW = new Date('2026-08-19T08:00:00Z')

describe('parseTasks', () => {
  it('reads the documented shape', () => {
    const tasks = parseTasks({
      tasks: [
        {
          id: 'task_1',
          title: 'Acheter du pain',
          endDate: '2026-08-19T16:00:00.000Z',
          completed: false,
          category: { name: 'Courses' },
        },
      ],
    })

    expect(tasks).toEqual([
      {
        id: 'task_1',
        title: 'Acheter du pain',
        startDate: null,
        endDate: '2026-08-19T16:00:00.000Z',
        completed: false,
        categoryName: 'Courses',
      },
    ])
  })

  it('accepts a bare array', () => {
    expect(parseTasks([{ id: 't1', title: 'Une tâche' }])).toHaveLength(1)
  })

  it('accepts the other names a due date has gone by', () => {
    expect(parseTasks([{ title: 'A', dueDate: '2026-08-19' }])[0].endDate).toBe('2026-08-19')
    expect(parseTasks([{ title: 'B', due_date: '2026-08-19' }])[0].endDate).toBe('2026-08-19')
  })

  it('reads completion however it is expressed', () => {
    expect(parseTasks([{ title: 'A', status: 'done' }])[0].completed).toBe(true)
    expect(parseTasks([{ title: 'B', isCompleted: true }])[0].completed).toBe(true)
    expect(parseTasks([{ title: 'C' }])[0].completed).toBe(false)
  })

  it('skips entries with nothing to show', () => {
    // A task with no title has nothing to display and nothing to say aloud.
    expect(parseTasks({ tasks: [{ id: 'x' }, 'nonsense', null] })).toEqual([])
  })

  it('survives a payload of the wrong shape entirely', () => {
    expect(parseTasks(null)).toEqual([])
    expect(parseTasks('nope')).toEqual([])
    expect(parseTasks({ unexpected: true })).toEqual([])
  })
})

describe('splitByDay', () => {
  const tasks = [
    { id: '1', title: 'Aujourd’hui', endDate: '2026-08-19T14:00:00Z', completed: false },
    { id: '2', title: 'Hier', endDate: '2026-08-18T14:00:00Z', completed: false },
    { id: '3', title: 'Demain', endDate: '2026-08-20T14:00:00Z', completed: false },
    { id: '4', title: 'Déjà faite', endDate: '2026-08-19T09:00:00Z', completed: true },
    { id: '5', title: 'Sans date', endDate: null, completed: false },
  ]

  it('keeps today and what is late, and nothing else', () => {
    const { today, overdue } = splitByDay(tasks, NOW, PARIS)

    expect(today.map((task) => task.id)).toEqual(['1'])
    expect(overdue.map((task) => task.id)).toEqual(['2'])
  })

  it('sorts by time so the next thing is first', () => {
    const { today } = splitByDay(
      [
        { id: 'late', title: 'B', endDate: '2026-08-19T18:00:00Z', completed: false },
        { id: 'early', title: 'A', endDate: '2026-08-19T09:00:00Z', completed: false },
      ],
      NOW,
      PARIS,
    )

    expect(today.map((task) => task.id)).toEqual(['early', 'late'])
  })

  it('uses the robot’s timezone to decide what "today" means', () => {
    // 23:30 UTC is already the next day in Paris.
    const lateEvening = [
      { id: '1', title: 'Tard', endDate: '2026-08-19T23:30:00Z', completed: false },
    ]

    expect(splitByDay(lateEvening, NOW, PARIS).today).toHaveLength(0)
    expect(localDay('2026-08-19T23:30:00Z', PARIS)).toBe('2026-08-20')
  })
})

describe('DayService', () => {
  let events: AppEvent[]
  let store: JsonStore<DaySummary>

  const flotsWith = (result: McpToolResult): FlotsPort => ({
    pairing: async () => ({
      status: 'paired',
      user: null,
      scopes: [],
      expiresAt: null,
      daysRemaining: null,
      baseUrl: 'https://api-staging.flots.app',
    }),
    listTools: async () => [],
    callTool: vi.fn(async () => result),
    test: async () => ({ ok: true, user: null, scopes: [], toolCount: 0, latencyMs: 1 }),
  })

  const service = (flots: FlotsPort) =>
    new DayService({
      flots,
      store,
      publish: (event) => events.push(event),
      now: () => NOW,
      timezone: PARIS,
    })

  beforeEach(async () => {
    events = []
    const directory = await mkdtemp(join(tmpdir(), 'cap-day-'))
    store = new JsonStore<DaySummary>(join(directory, 'day.json'), EMPTY_DAY)
  })

  it('stores the day and announces the refresh', async () => {
    const day = service(
      flotsWith({
        ok: true,
        text: '',
        data: {
          tasks: [
            { id: '1', title: 'Réunion', endDate: '2026-08-19T14:00:00Z' },
            { id: '2', title: 'En retard', endDate: '2026-08-17T14:00:00Z' },
          ],
        },
      }),
    )

    const summary = await day.sync()

    expect(summary.date).toBe('2026-08-19')
    expect(summary.tasks).toHaveLength(1)
    expect(summary.overdue).toHaveLength(1)
    expect(await day.read()).toEqual(summary)
    expect(events).toEqual([
      { type: 'day', syncedAt: summary.syncedAt, taskCount: 1, overdueCount: 1 },
    ])
  })

  it('shares one request between concurrent callers', async () => {
    // The background timer and a tap on "refresh" must not both hit Flots.
    const flots = flotsWith({ ok: true, text: '', data: { tasks: [] } })
    const day = service(flots)

    await Promise.all([day.sync(), day.sync(), day.sync()])

    expect(flots.callTool).toHaveBeenCalledTimes(1)
  })

  it('raises when Flots refuses, leaving the cache intact', async () => {
    const day = service(flotsWith({ ok: false, text: 'Abonnement requis', data: null }))

    await expect(day.sync()).rejects.toThrow('Abonnement requis')
    expect((await day.read()).syncedAt).toBeNull()
  })

  it('treats a never-synced day as stale', async () => {
    expect(service(flotsWith({ ok: true, text: '', data: {} })).isStale(EMPTY_DAY)).toBe(true)
  })

  it('treats a fresh sync as current and an old one as stale', () => {
    const day = service(flotsWith({ ok: true, text: '', data: {} }))

    expect(day.isStale({ ...EMPTY_DAY, syncedAt: NOW.toISOString() })).toBe(false)
    expect(
      day.isStale({
        ...EMPTY_DAY,
        syncedAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1000).toISOString(),
      }),
    ).toBe(true)
  })

  it('completes a task and refreshes afterwards', async () => {
    const flots = flotsWith({ ok: true, text: 'Tâche terminée', data: null })
    const day = service(flots)

    const result = await day.completeTask('task_1')

    expect(result.ok).toBe(true)
    expect(flots.callTool).toHaveBeenCalledWith('complete_task', { id: 'task_1' })
    expect(flots.callTool).toHaveBeenCalledWith('list_tasks', {})
  })

  it('does not resync when completing failed', async () => {
    const flots = flotsWith({ ok: false, text: 'refusé', data: null })
    const day = service(flots)

    await day.completeTask('task_1')

    expect(flots.callTool).toHaveBeenCalledTimes(1)
  })
})
