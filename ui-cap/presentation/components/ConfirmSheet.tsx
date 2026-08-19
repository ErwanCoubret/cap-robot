'use client'

/**
 * Full-screen confirmation for destructive actions.
 *
 * A small dialog would be easy to dismiss by accident on a touch panel, so the
 * choice takes over the screen and both answers are large, clearly labelled
 * buttons — no stray tap can resolve it.
 */

import { BigButton } from './touch'

export interface ConfirmSheetProps {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Annuler',
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex animate-pop-in flex-col justify-center gap-6 bg-white/95 p-8 backdrop-blur-sm"
    >
      <div className="text-center">
        <h2 className="text-3xl font-bold text-title-blue">{title}</h2>
        {body ? <p className="mt-2 text-lg text-gray-main">{body}</p> : null}
      </div>
      <div className="flex gap-4">
        <BigButton
          label={cancelLabel}
          tone="neutral"
          onClick={onCancel}
          className="flex-1"
        />
        <BigButton
          label={confirmLabel}
          tone="danger"
          onClick={onConfirm}
          className="flex-1"
        />
      </div>
    </div>
  )
}
