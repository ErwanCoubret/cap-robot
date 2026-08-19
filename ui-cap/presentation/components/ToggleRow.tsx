'use client'

/**
 * A full-width on/off control.
 *
 * A conventional switch would put the hit area in a ~40 px track, far too
 * small here, so the entire row is the target and the state is spelled out in
 * words as well as colour.
 */

import { TOUCH_MIN_PX } from './touch'

export interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  hint?: string
  disabled?: boolean
  onLabel?: string
  offLabel?: string
  /** Stack the label above the state, for narrow columns. */
  stacked?: boolean
}

export function ToggleRow({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
  onLabel = 'Activé',
  offLabel = 'Désactivé',
  stacked = false,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{ minHeight: TOUCH_MIN_PX }}
      className={[
        'flex w-full rounded-2xl border px-3 py-2 text-left shadow-sm',
        'transition-colors active:scale-[0.99] disabled:opacity-40',
        stacked
          ? 'flex-1 flex-col items-center justify-center gap-1 text-center'
          : 'items-center justify-between gap-3 px-4',
        checked
          ? 'border-blue-main bg-blue-ulight text-title-blue'
          : 'border-gray-light bg-white text-gray-dark',
      ].join(' ')}
    >
      <span
        className={`flex min-w-0 flex-col ${stacked ? 'items-center' : 'flex-1'}`}
      >
        <span className="text-base font-semibold leading-tight">{label}</span>
        {hint ? (
          <span className="text-xs leading-tight text-gray-main">{hint}</span>
        ) : null}
      </span>
      <span
        className={[
          'shrink-0 rounded-full px-3 py-1 text-xs font-bold',
          checked ? 'bg-blue-main text-white' : 'bg-gray-light text-gray-main',
        ].join(' ')}
      >
        {checked ? onLabel : offLabel}
      </span>
    </button>
  )
}
