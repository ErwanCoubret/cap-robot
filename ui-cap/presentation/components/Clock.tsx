'use client'

/**
 * The headline clock.
 *
 * Rendered client-side only: the server's idea of "now" would be wrong for a
 * second or two after hydration, and a clock that visibly jumps on load looks
 * broken on a device whose main job is telling you the time.
 */

import { useEffect, useState } from 'react'

export interface ClockProps {
  timezone: string
  locale: string
}

export function Clock({ timezone, locale }: ClockProps) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const time = now ? formatTime(now, locale, timezone) : '--:--'
  const date = now ? formatDate(now, locale, timezone) : ''

  return (
    <div className="flex flex-col">
      <span className="text-[4.5rem] font-bold leading-none tracking-tight text-title-blue tabular-nums">
        {time}
      </span>
      <span className="mt-1 text-lg font-medium capitalize text-gray-main">{date}</span>
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
