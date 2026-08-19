'use client'

/**
 * What Cap shows without being asked.
 *
 * Two very different things live here on purpose. A notification is a toast
 * that fades: worth a glance, never in the way. A ringing alarm takes the
 * whole screen, because it is asking for a decision and must be impossible to
 * miss or to dismiss by accident.
 */

import { useCallback, useEffect, useState } from 'react'

import type { AppEvent } from '../../core/domain/events'
import { useApp } from '../deps/AppProvider'
import { BigButton } from '../components/touch'

/** How long a toast stays on screen. */
const TOAST_MS = 8_000

interface Toast {
  id: string
  title: string
  body: string
  level: 'info' | 'warning'
}

interface Ringing {
  alarmId: string
  label: string
  time: string
}

export function NotificationLayer() {
  const { onEvent } = useApp()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [ringing, setRinging] = useState<Ringing | null>(null)

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  useEffect(
    () =>
      onEvent((event: AppEvent) => {
        if (event.type === 'notification') {
          const toast: Toast = {
            id: event.id,
            title: event.title,
            body: event.body,
            level: event.level,
          }
          setToasts((current) => [...current.filter((item) => item.id !== toast.id), toast])
          setTimeout(() => dismissToast(toast.id), TOAST_MS)
        }

        if (event.type === 'alarm') {
          setRinging(
            event.state === 'ringing'
              ? {
                  alarmId: event.alarmId,
                  label: event.label ?? 'Alarme',
                  time: event.time ?? '',
                }
              : null,
          )
        }
      }),
    [onEvent, dismissToast],
  )

  const answer = async (action: 'dismiss' | 'snooze') => {
    setRinging(null)
    await fetch('/api/alarms/ringing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => undefined)
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex flex-col items-center gap-2 p-2">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismissToast(toast.id)}
            className={`pointer-events-auto flex w-full max-w-[600px] animate-pop-in flex-col items-start rounded-2xl px-5 py-3 text-left shadow-sm ${
              toast.level === 'warning'
                ? 'bg-red-main text-white'
                : 'bg-white text-title-blue'
            }`}
            style={{ minHeight: 72 }}
          >
            <span className="text-lg font-bold">{toast.title}</span>
            {toast.body ? <span className="text-base opacity-90">{toast.body}</span> : null}
          </button>
        ))}
      </div>

      {ringing ? (
        <div
          role="alertdialog"
          aria-label="Alarme"
          className="fixed inset-0 z-50 flex animate-pop-in flex-col items-center justify-center gap-6 bg-blue-main p-6 text-white"
        >
          <div className="text-center">
            <p className="text-[6rem] font-bold leading-none tabular-nums">{ringing.time}</p>
            <p className="mt-2 text-3xl font-semibold">{ringing.label}</p>
          </div>
          <div className="flex w-full max-w-[640px] gap-4">
            <BigButton
              label="+5 min"
              tone="neutral"
              onClick={() => void answer('snooze')}
              className="flex-1"
            />
            <BigButton
              label="Arrêter"
              icon="check"
              tone="danger"
              onClick={() => void answer('dismiss')}
              className="flex-[2]"
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
