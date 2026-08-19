'use client'

/**
 * The cached day, for screens that only want to show it.
 *
 * Reads the snapshot the server keeps warm rather than triggering a sync, and
 * refreshes when a background sync announces itself.
 */

import { useCallback, useEffect, useState } from 'react'

import type { DaySummary, Task } from '../../core/domain/flots'
import { useApp } from '../deps/AppProvider'

export interface DayView extends DaySummary {
  stale?: boolean
  /** The next thing due today, if anything is. */
  next: Task | null
  loaded: boolean
}

const EMPTY: DayView = {
  date: '',
  syncedAt: null,
  tasks: [],
  overdue: [],
  next: null,
  loaded: false,
}

export function useDay(): DayView {
  const { onEvent } = useApp()
  const [day, setDay] = useState<DayView>(EMPTY)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/day', { cache: 'no-store' })
      const body = (await response.json()) as DaySummary & { stale?: boolean }
      setDay({
        ...body,
        // Overdue work comes first: it is the thing most worth surfacing.
        next: body.overdue[0] ?? body.tasks[0] ?? null,
        loaded: true,
      })
    } catch {
      setDay((current) => ({ ...current, loaded: true }))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      onEvent((event) => {
        if (event.type === 'day') {
          void load()
        }
      }),
    [onEvent, load],
  )

  return day
}
