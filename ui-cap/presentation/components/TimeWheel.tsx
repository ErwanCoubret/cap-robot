'use client'

/**
 * Picking a time with a fingertip.
 *
 * The browser's own time input is unusable here: it opens a keyboard the
 * kiosk does not have, and its spinners are a few pixels tall. This is four
 * big buttons either side of a large readout — laid out horizontally, because
 * on a 480 px-tall panel a stacked picker leaves no room for anything else.
 */

import { Icon } from './Icon'
import { TOUCH_MIN_PX } from './touch'

export interface TimeWheelProps {
  value: string
  onChange: (next: string) => void
  /** Minutes added or removed by the minute buttons. */
  step?: number
}

export function TimeWheel({ value, onChange, step = 5 }: TimeWheelProps) {
  const [hours, minutes] = parse(value)

  const shift = (deltaHours: number, deltaMinutes: number) => {
    const total =
      (hours * 60 + minutes + deltaHours * 60 + deltaMinutes + 24 * 60) % (24 * 60)
    onChange(format(Math.floor(total / 60), total % 60))
  }

  return (
    <div className="flex items-center justify-center gap-3">
      <Group
        label="Heures"
        value={pad(hours)}
        onUp={() => shift(1, 0)}
        onDown={() => shift(-1, 0)}
      />
      <span className="text-5xl font-bold text-gray-sec">:</span>
      <Group
        label="Minutes"
        value={pad(minutes)}
        onUp={() => shift(0, step)}
        onDown={() => shift(0, -step)}
      />
    </div>
  )
}

function Group({
  label,
  value,
  onUp,
  onDown,
}: {
  label: string
  value: string
  onUp: () => void
  onDown: () => void
}) {
  const button =
    'flex items-center justify-center rounded-2xl bg-white text-title-blue shadow-sm active:bg-blue-ulight'
  const size = { minWidth: TOUCH_MIN_PX, minHeight: TOUCH_MIN_PX }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`${label} -`}
        onClick={onDown}
        className={button}
        style={size}
      >
        <span className="text-4xl leading-none">−</span>
      </button>
      <span className="w-[110px] text-center text-6xl font-bold tabular-nums text-title-blue">
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        onClick={onUp}
        className={button}
        style={size}
      >
        <Icon name="plus" size={34} />
      </button>
    </div>
  )
}

function parse(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) {
    return [8, 0]
  }
  return [Number(match[1]) % 24, Number(match[2]) % 60]
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function format(hours: number, minutes: number): string {
  return `${pad(hours)}:${pad(minutes)}`
}
