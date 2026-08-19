'use client'

/**
 * The screen the robot sits on all day.
 *
 * Laid out to fit 800x480 exactly, with no scrolling: a clock band, one row of
 * four large actions, and a footer of labelled status chips. The vertical
 * budget is tight, which is why the actions sit on a single row — four
 * ~185x200 targets beat a 2x2 grid squeezed under the minimum height.
 */

import { CapAvatar } from './CapAvatar'
import { Clock } from './Clock'
import { BigButton, IconButton, StatusChip, type ChipState } from './touch'
import { useApp } from '../deps/AppProvider'
import { useDay } from '../hooks/useDay'

export function HomeScreen() {
  const { hardware, faceVisible, speaking, timezone, locale, ready } = useApp()
  const day = useDay()
  const status = hardware.status

  const chip = (present: boolean | undefined): ChipState => {
    if (!hardware.online) {
      return 'off'
    }
    return present ? 'ok' : 'warn'
  }

  return (
    <main className="flex h-screen w-screen flex-col gap-3 p-3">
      <header className="flex h-[116px] shrink-0 items-center justify-between gap-4">
        <Clock timezone={timezone} locale={locale} />

        {!hardware.online && ready ? (
          <p className="flex-1 rounded-2xl bg-red-main/10 px-4 py-3 text-center text-base font-semibold text-red-main">
            Le corps de Cap ne répond pas.
            <span className="block text-sm font-normal">
              Micro, voix et caméra sont indisponibles.
            </span>
          </p>
        ) : day.next ? (
          <a
            href="/day"
            className="flex min-w-0 flex-1 flex-col justify-center rounded-2xl bg-white px-4 py-3 shadow-sm"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-main">
              {day.overdue.length > 0 ? 'En retard' : 'Prochaine échéance'}
            </span>
            <span className="truncate text-lg font-semibold text-title-blue">
              {day.next.title}
            </span>
            <span className="text-sm text-gray-main">
              {formatDue(day.next.endDate, locale, timezone)}
              {day.tasks.length > 1 ? ` · ${day.tasks.length} tâches aujourd’hui` : ''}
            </span>
          </a>
        ) : null}

        <CapAvatar speaking={speaking} attentive={faceVisible} size={104} />
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-4 gap-3">
        <BigButton label="Parler" icon="mic" tone="primary" href="/talk" />
        <BigButton label="Note vocale" icon="note" tone="accent" href="/note" />
        <BigButton label="Ma journée" icon="calendar" tone="neutral" href="/day" />
        <BigButton label="Alarmes" icon="alarm" tone="neutral" href="/alarms" />
      </section>

      <footer className="flex h-[88px] shrink-0 items-stretch gap-3">
        <StatusChip
          label="Micro"
          state={chip(status?.capabilities.mic)}
          detail={hardware.online ? undefined : 'hors ligne'}
          href="/settings"
        />
        <StatusChip
          label="Voix"
          state={chip(status?.capabilities.speaker)}
          detail={status?.speaking.engine === 'mock' ? 'simulée' : undefined}
          href="/settings"
        />
        <StatusChip
          label="Caméra"
          state={chip(status?.camera.available)}
          detail={status?.tracking.active ? 'suivi actif' : undefined}
          href="/settings"
        />
        <div className="flex-1" />
        <IconButton icon="gear" label="Réglages" href="/settings" />
      </footer>
    </main>
  )
}

function formatDue(
  iso: string | null | undefined,
  locale: string,
  timeZone: string,
): string {
  if (!iso) {
    return 'sans heure'
  }
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) {
    return 'sans heure'
  }
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(parsed))
}
