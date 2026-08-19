'use client'

/**
 * The headline clock.
 *
 * The current time is an external, mutable source, so it is read through
 * `useSyncExternalStore` rather than mirrored into state. That also gives a
 * server snapshot of `null`, which renders a placeholder: a clock that
 * visibly jumps a second after load looks broken on a device whose main job is
 * telling you the time.
 */

import { useSyncExternalStore } from 'react'

export interface ClockProps {
  timezone: string
  locale: string
}

/** Re-render every second, on the second. */
function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, 1000)
  return () => clearInterval(timer)
}

/** Whole minutes: the display has no seconds, so nothing changes between them. */
function getSnapshot(): number {
  return Math.floor(Date.now() / 60_000)
}

function getServerSnapshot(): null {
  return null
}

export function Clock({ timezone, locale }: ClockProps) {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const now = minute === null ? null : new Date(minute * 60_000)

  return (
    <div className="flex flex-col">
      <span className="text-[4.5rem] font-bold leading-none tracking-tight text-title-blue tabular-nums">
        {now ? formatTime(now, locale, timezone) : '--:--'}
      </span>
      <span className="mt-1 text-lg font-medium capitalize text-gray-main">
        {now ? formatDate(now, locale, timezone) : ''}
      </span>
    </div>
  )
}

function formatTime(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date)
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date)
}
