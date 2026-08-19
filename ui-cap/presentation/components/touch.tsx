'use client'

/**
 * Touch primitives.
 *
 * The panel is a resistive-feeling 5" 800x480 screen operated with a
 * fingertip: roughly 1 cm (50 px) is *not* reliably tappable on it. Every
 * interactive element in the interface is built from these components so the
 * minimum sizes below hold everywhere, including in a hurry.
 */

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Icon, type IconName } from './Icon'

/** Minimum edge of any secondary control (gear, back, toggles, chips). */
export const TOUCH_MIN_PX = 88

/** Minimum height of a primary action button. */
export const PRIMARY_MIN_PX = 140

export type Tone = 'primary' | 'neutral' | 'danger' | 'accent'

const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-blue-main text-white active:bg-blue-dark',
  neutral: 'bg-white text-gray-dark active:bg-blue-ulight border border-gray-light',
  danger: 'bg-red-main text-white active:brightness-90',
  accent: 'bg-purple-main text-white active:brightness-90',
}

/**
 * Two sizes of action button.
 *
 * `primary` is the home screen's headline action; `compact` is for secondary
 * screens where several actions stack in a column — still at the 88 px touch
 * floor, never below it.
 */
export type ButtonSize = 'primary' | 'compact'

export interface BigButtonProps {
  label: string
  icon?: IconName
  hint?: string
  tone?: Tone
  size?: ButtonSize
  href?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}

export function BigButton({
  label,
  icon,
  hint,
  tone = 'primary',
  size = 'primary',
  href,
  onClick,
  disabled = false,
  className = '',
}: BigButtonProps) {
  const compact = size === 'compact'

  const classes = [
    'flex items-center justify-center rounded-3xl text-center',
    compact
      ? 'flex-row gap-2 rounded-2xl px-3 py-2'
      : 'flex-col gap-3 px-4 py-5',
    'shadow-sm transition-transform duration-100 active:scale-[0.97]',
    'disabled:opacity-40 disabled:active:scale-100',
    TONE_CLASSES[tone],
    className,
  ].join(' ')

  const content = (
    <>
      {icon ? <Icon name={icon} size={compact ? 28 : 48} strokeWidth={2.2} /> : null}
      <span
        className={`font-semibold leading-tight text-balance ${
          compact ? 'text-lg' : 'text-2xl'
        }`}
      >
        {label}
      </span>
      {hint ? <span className="text-sm leading-tight opacity-80">{hint}</span> : null}
    </>
  )

  const style = { minHeight: compact ? TOUCH_MIN_PX : PRIMARY_MIN_PX }

  if (href && !disabled) {
    return (
      <Link href={href} className={classes} style={style}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classes}
      style={style}
    >
      {content}
    </button>
  )
}

export interface IconButtonProps {
  icon: IconName
  /** Always required: it labels the control for assistive technology. */
  label: string
  href?: string
  onClick?: () => void
  tone?: Tone
  disabled?: boolean
  className?: string
}

/** A secondary control, never smaller than {@link TOUCH_MIN_PX} square. */
export function IconButton({
  icon,
  label,
  href,
  onClick,
  tone = 'neutral',
  disabled = false,
  className = '',
}: IconButtonProps) {
  const classes = [
    'flex items-center justify-center rounded-2xl shadow-sm',
    'transition-transform duration-100 active:scale-[0.95] disabled:opacity-40',
    TONE_CLASSES[tone],
    className,
  ].join(' ')
  const size = { minWidth: TOUCH_MIN_PX, minHeight: TOUCH_MIN_PX }

  if (href && !disabled) {
    return (
      <Link href={href} aria-label={label} className={classes} style={size}>
        <Icon name={icon} size={36} />
      </Link>
    )
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={classes}
      style={size}
    >
      <Icon name={icon} size={36} />
    </button>
  )
}

export interface CardProps {
  children: ReactNode
  className?: string
}

/** The standard white surface, matching Flots' rounded cards. */
export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-3xl bg-white p-5 shadow-sm ${className}`}>{children}</div>
  )
}

export type ChipState = 'ok' | 'warn' | 'off'

const DOT_CLASSES: Record<ChipState, string> = {
  ok: 'bg-green-main',
  warn: 'bg-red-main',
  off: 'bg-gray-sec',
}

export interface StatusChipProps {
  label: string
  state: ChipState
  detail?: string
  href?: string
  onClick?: () => void
}

/**
 * A labelled status indicator.
 *
 * The whole chip is the touch target — a bare coloured dot would be far too
 * small to press — and it takes the user to the settings screen where the
 * underlying problem can actually be dealt with.
 */
export function StatusChip({ label, state, detail, href, onClick }: StatusChipProps) {
  const inner = (
    <>
      <span className={`h-4 w-4 shrink-0 rounded-full ${DOT_CLASSES[state]}`} />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-base font-semibold">{label}</span>
        {detail ? <span className="text-xs text-gray-main">{detail}</span> : null}
      </span>
    </>
  )

  const classes =
    'flex items-center gap-3 rounded-2xl border border-gray-light bg-white px-5 shadow-sm active:bg-blue-ulight'
  const size = { minHeight: TOUCH_MIN_PX }

  if (href) {
    return (
      <Link href={href} className={classes} style={size}>
        {inner}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={classes} style={size}>
      {inner}
    </button>
  )
}
