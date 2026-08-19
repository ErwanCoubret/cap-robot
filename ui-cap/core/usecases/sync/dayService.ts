/**
 * The user's day, kept on the robot.
 *
 * Cap answers "what's on today?" from a local snapshot rather than calling
 * Flots each time: the answer has to arrive at conversation speed, and it has
 * to still exist when the network does not. A background sync keeps the
 * snapshot fresh and its age is always visible.
 */

import type { AppEvent } from '../../domain/events'
import type { DaySummary } from '../../domain/flots'
import type { FlotsPort } from '../../ports/flots'
import type { StorePort } from '../../ports/store'
import { localDay, parseTasks, splitByDay } from './parseTasks'

/** How often the snapshot is refreshed in the background. */
export const SYNC_INTERVAL_MS = 10 * 60 * 1000

/** Beyond this the interface warns that the day may be out of date. */
export const STALE_AFTER_MS = 30 * 60 * 1000

export const EMPTY_DAY: DaySummary = {
  date: '',
  syncedAt: null,
  tasks: [],
  overdue: [],
}

export interface DayServiceDeps {
  flots: FlotsPort
  store: StorePort<DaySummary>
  publish: (event: AppEvent) => void
  now: () => Date
  timezone: string
}

export class DayService {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<DaySummary> | null = null

  constructor(private readonly deps: DayServiceDeps) {}

  /** The cached snapshot, without touching the network. */
  read(): Promise<DaySummary> {
    return this.deps.store.read()
  }

  /** Whether ``summary`` is old enough to warn about. */
  isStale(summary: DaySummary): boolean {
    if (!summary.syncedAt) {
      return true
    }
    const age = this.deps.now().getTime() - Date.parse(summary.syncedAt)
    return Number.isNaN(age) || age > STALE_AFTER_MS
  }

  /**
   * Refresh the snapshot from Flots.
   *
   * Concurrent callers share one request: the background timer and someone
   * tapping "refresh" at the same moment should not both hit the API.
   */
  async sync(): Promise<DaySummary> {
    if (this.inFlight) {
      return this.inFlight
    }
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async performSync(): Promise<DaySummary> {
    const now = this.deps.now()
    const result = await this.deps.flots.callTool('list_tasks', {})

    if (!result.ok) {
      throw new Error(result.text || 'Flots a refusé la liste des tâches')
    }

    const { today, overdue } = splitByDay(parseTasks(result.data), now, this.deps.timezone)
    const summary: DaySummary = {
      date: localDay(now.toISOString(), this.deps.timezone) ?? '',
      syncedAt: now.toISOString(),
      tasks: today,
      overdue,
    }

    await this.deps.store.write(summary)
    this.deps.publish({
      type: 'day',
      syncedAt: summary.syncedAt,
      taskCount: summary.tasks.length,
      overdueCount: summary.overdue.length,
    })
    return summary
  }

  /** Mark a task done in Flots, then refresh the snapshot. */
  async completeTask(taskId: string): Promise<{ ok: boolean; text: string }> {
    const result = await this.deps.flots.callTool('complete_task', { id: taskId })
    if (result.ok) {
      // Refreshing is best-effort: the task is already done either way.
      await this.sync().catch(() => undefined)
    }
    return { ok: result.ok, text: result.text }
  }

  /** Start refreshing in the background; returns a function that stops it. */
  startAutoSync(intervalMs = SYNC_INTERVAL_MS): () => void {
    this.stopAutoSync()
    // A first sync now, so a robot that just booted is not blank.
    void this.sync().catch(() => undefined)

    this.timer = setInterval(() => {
      void this.sync().catch((error: unknown) => {
        // An unpaired or offline robot is a normal state, not a reason to log
        // an error every ten minutes.
        console.debug('day sync skipped', error)
      })
    }, intervalMs)
    this.timer.unref?.()

    return () => this.stopAutoSync()
  }

  stopAutoSync(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
