'use client'

/** Shared header for secondary screens: a big back button and a title. */

import { IconButton } from './touch'

export interface ScreenHeaderProps {
  title: string
  subtitle?: string
  /** Where the back button goes; the home screen by default. */
  backHref?: string
  children?: React.ReactNode
}

export function ScreenHeader({
  title,
  subtitle,
  backHref = '/',
  children,
}: ScreenHeaderProps) {
  return (
    <header className="flex h-[88px] shrink-0 items-center gap-4">
      <IconButton icon="back" label="Retour" href={backHref} />
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-3xl font-bold text-title-blue">{title}</h1>
        {subtitle ? (
          <p className="truncate text-base text-gray-main">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-1 items-center justify-end gap-3">{children}</div>
    </header>
  )
}
