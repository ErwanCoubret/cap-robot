/**
 * Inline icon set.
 *
 * Drawn as SVG rather than emoji: the kiosk runs a minimal Raspberry Pi OS
 * image where an emoji font may simply not be installed, and a missing glyph
 * on a button the user has to find at a glance is not an acceptable risk.
 */

export type IconName =
  | 'mic'
  | 'note'
  | 'calendar'
  | 'alarm'
  | 'gear'
  | 'camera'
  | 'back'
  | 'check'
  | 'close'
  | 'flip'
  | 'link'
  | 'refresh'
  | 'trash'
  | 'plus'
  | 'speaker'

const PATHS: Record<IconName, React.ReactNode> = {
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </>
  ),
  note: (
    <>
      <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2" />
      <path d="M5 3 2 6M19 3l3 3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8h4l2-3h6l2 3h4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  back: <path d="M15 5 8 12l7 7" />,
  check: <path d="m4 13 5 5L20 6" />,
  close: <path d="M6 6 18 18M18 6 6 18" />,
  flip: (
    <>
      <path d="M3 12h18" />
      <path d="M8 8 12 4l4 4" />
      <path d="M16 16l-4 4-4-4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 6 .5l2.5-2.5a4 4 0 0 0-5.7-5.7L11.5 7.5" />
      <path d="M14 10a4 4 0 0 0-6-.5L5.5 12a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  speaker: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4Z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
}

export interface IconProps {
  name: IconName
  /** Pixel size of the square viewport. */
  size?: number
  className?: string
  /** Stroke width; larger reads better at kiosk distance. */
  strokeWidth?: number
}

/** Render one icon from the set. */
export function Icon({ name, size = 32, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
