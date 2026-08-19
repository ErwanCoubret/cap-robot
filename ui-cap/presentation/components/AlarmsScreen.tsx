'use client'

/**
 * The alarms the robot keeps.
 *
 * Two states: the list, and the full-screen editor for adding one. Splitting
 * them keeps every control comfortably large instead of squeezing a picker
 * into a corner of the list.
 */

import { useCallback, useEffect, useState } from 'react'

import type { Alarm, AlarmRepeat } from '../../core/domain/alarm'
import { ConfirmSheet } from './ConfirmSheet'
import { Icon } from './Icon'
import { ScreenHeader } from './ScreenHeader'
import { TimeWheel } from './TimeWheel'
import { BigButton, IconButton, TOUCH_MIN_PX } from './touch'

interface AlarmRow extends Alarm {
  next?: string
}

const REPEAT_LABELS: Record<AlarmRepeat, string> = {
  once: 'Une fois',
  daily: 'Tous les jours',
  weekdays: 'En semaine',
}

export function AlarmsScreen() {
  const [alarms, setAlarms] = useState<AlarmRow[]>([])
  const [adding, setAdding] = useState(false)
  const [time, setTime] = useState('08:00')
  const [repeat, setRepeat] = useState<AlarmRepeat>('once')
  const [pendingDelete, setPendingDelete] = useState<AlarmRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/alarms', { cache: 'no-store' })
      const body = (await response.json()) as { alarms: AlarmRow[] }
      setAlarms(body.alarms)
    } catch {
      setError('lecture impossible')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves, not synchronously
    void load()
  }, [load])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time, repeat }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(body.error ?? 'alarme refusée')
        return
      }
      setAdding(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (alarm: AlarmRow) => {
    setPendingDelete(null)
    setBusy(true)
    try {
      await fetch(`/api/alarms?id=${encodeURIComponent(alarm.id)}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (adding) {
    return (
      <main className="flex h-screen w-screen flex-col gap-2 p-2">
        <ScreenHeader title="Nouvelle alarme" subtitle={error ?? undefined} backHref="/alarms" />

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-3xl bg-blue-ulight">
          <TimeWheel value={time} onChange={setTime} />

          <div className="flex gap-2">
            {(Object.keys(REPEAT_LABELS) as AlarmRepeat[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRepeat(option)}
                style={{ minHeight: TOUCH_MIN_PX }}
                className={`rounded-2xl px-6 text-lg font-semibold shadow-sm ${
                  repeat === option
                    ? 'bg-blue-main text-white'
                    : 'bg-white text-gray-dark'
                }`}
              >
                {REPEAT_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex h-[100px] shrink-0 gap-2">
          <BigButton
            label="Annuler"
            tone="neutral"
            size="compact"
            onClick={() => setAdding(false)}
            className="flex-1"
          />
          <BigButton
            label="Enregistrer"
            icon="check"
            tone="primary"
            size="compact"
            onClick={() => void create()}
            disabled={busy}
            className="flex-[2]"
          />
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-screen w-screen flex-col gap-2 p-2">
      <ScreenHeader title="Alarmes" subtitle={error ?? undefined}>
        <IconButton icon="plus" label="Ajouter" tone="primary" onClick={() => setAdding(true)} />
      </ScreenHeader>

      <div className="touch-scroll flex min-h-0 flex-1 flex-col gap-2 pr-1">
        {alarms.length === 0 ? (
          <p className="flex flex-1 items-center justify-center rounded-3xl bg-white text-xl text-gray-main shadow-sm">
            Aucune alarme.
          </p>
        ) : null}

        {alarms.map((alarm) => (
          <div
            key={alarm.id}
            style={{ minHeight: TOUCH_MIN_PX }}
            className="flex shrink-0 items-center gap-4 rounded-2xl bg-white px-4 shadow-sm"
          >
            <span className="w-[110px] shrink-0 text-4xl font-bold tabular-nums text-title-blue">
              {alarm.time}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-lg font-semibold text-gray-dark">
                {alarm.label}
              </span>
              <span className="truncate text-sm text-gray-main">
                {alarm.next ?? REPEAT_LABELS[alarm.repeat]}
              </span>
            </span>
            <button
              type="button"
              aria-label={`Supprimer ${alarm.label}`}
              onClick={() => setPendingDelete(alarm)}
              style={{ minWidth: TOUCH_MIN_PX, minHeight: TOUCH_MIN_PX }}
              className="flex items-center justify-center rounded-2xl text-red-main active:bg-red-main/10"
            >
              <Icon name="trash" size={32} />
            </button>
          </div>
        ))}
      </div>

      {pendingDelete ? (
        <ConfirmSheet
          title="Supprimer cette alarme ?"
          body={`${pendingDelete.time} — ${pendingDelete.label}`}
          confirmLabel="Supprimer"
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </main>
  )
}
