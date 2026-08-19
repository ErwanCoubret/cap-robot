'use client'

/**
 * Today, at a glance.
 *
 * Rows are the touch targets: tapping one asks to complete the task, behind a
 * confirmation, because a mis-tap that silently ticks something off is worse
 * than one extra press.
 */

import { useCallback, useEffect, useState } from 'react'

import type { DaySummary, Task } from '../../core/domain/flots'
import { useApp } from '../deps/AppProvider'
import { ConfirmSheet } from './ConfirmSheet'
import { ScreenHeader } from './ScreenHeader'
import { Icon } from './Icon'
import { IconButton, TOUCH_MIN_PX } from './touch'

interface DayPayload extends DaySummary {
  stale?: boolean
  error?: string
}

export function DayScreen() {
  const { onEvent, timezone, locale } = useApp()
  const [day, setDay] = useState<DayPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Task | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true)
    try {
      const response = await fetch('/api/day', {
        method: refresh ? 'POST' : 'GET',
        cache: 'no-store',
      })
      const body = (await response.json()) as DayPayload
      setDay(body)
      setMessage(body.error ?? null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'lecture impossible')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  // A background sync landing while the screen is open should show up.
  useEffect(
    () =>
      onEvent((event) => {
        if (event.type === 'day') {
          void load(false)
        }
      }),
    [onEvent, load],
  )

  const complete = async (task: Task) => {
    setPending(null)
    setBusy(true)
    try {
      const response = await fetch('/api/day/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      const body = (await response.json()) as { ok?: boolean; text?: string }
      setMessage(body.ok ? `« ${task.title} » terminée.` : (body.text ?? 'action refusée'))
      await load(false)
    } finally {
      setBusy(false)
    }
  }

  const tasks = day?.tasks ?? []
  const overdue = day?.overdue ?? []
  const empty = tasks.length === 0 && overdue.length === 0

  return (
    <main className="flex h-screen w-screen flex-col gap-2 p-2">
      <ScreenHeader
        title="Ma journée"
        subtitle={message ?? describeSync(day, locale, timezone)}
      >
        <IconButton
          icon="refresh"
          label="Actualiser"
          onClick={() => void load(true)}
          disabled={busy}
        />
      </ScreenHeader>

      <div className="touch-scroll flex min-h-0 flex-1 flex-col gap-2 pr-1">
        {empty ? (
          <p className="flex flex-1 items-center justify-center rounded-3xl bg-white text-xl text-gray-main shadow-sm">
            {day?.syncedAt
              ? 'Rien de prévu aujourd’hui.'
              : 'Pas encore synchronisé avec Flots.'}
          </p>
        ) : null}

        {overdue.map((task) => (
          <TaskRow key={task.id} task={task} late onPick={setPending} timezone={timezone} locale={locale} />
        ))}
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onPick={setPending} timezone={timezone} locale={locale} />
        ))}
      </div>

      {pending ? (
        <ConfirmSheet
          title="Terminer cette tâche ?"
          body={pending.title}
          confirmLabel="Terminer"
          onConfirm={() => void complete(pending)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </main>
  )
}

function TaskRow({
  task,
  late = false,
  onPick,
  timezone,
  locale,
}: {
  task: Task
  late?: boolean
  onPick: (task: Task) => void
  timezone: string
  locale: string
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(task)}
      style={{ minHeight: TOUCH_MIN_PX }}
      className="flex w-full shrink-0 items-center gap-4 rounded-2xl bg-white px-4 text-left shadow-sm active:bg-blue-ulight"
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
          late ? 'bg-red-main/10 text-red-main' : 'bg-blue-ulight text-blue-main'
        }`}
      >
        <Icon name="check" size={26} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xl font-semibold text-title-blue">{task.title}</span>
        {task.categoryName ? (
          <span className="truncate text-sm text-gray-main">{task.categoryName}</span>
        ) : null}
      </span>

      <span
        className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${
          late ? 'bg-red-main text-white' : 'bg-blue-light text-title-blue'
        }`}
      >
        {late ? 'En retard' : formatTime(task.endDate, locale, timezone)}
      </span>
    </button>
  )
}

function formatTime(iso: string | null | undefined, locale: string, timeZone: string): string {
  if (!iso) {
    return '—'
  }
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) {
    return '—'
  }
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(parsed))
}

function describeSync(
  day: DayPayload | null,
  locale: string,
  timeZone: string,
): string | undefined {
  if (!day?.syncedAt) {
    return undefined
  }
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(day.syncedAt))
  return day.stale ? `Synchronisé à ${time} — peut-être dépassé` : `Synchronisé à ${time}`
}
