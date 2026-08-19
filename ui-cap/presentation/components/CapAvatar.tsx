'use client'

/**
 * Cap's face on screen.
 *
 * Reacts to what the robot is doing: it leans in when speaking, and perks up
 * when the camera sees somebody. On a robot with no display eyes this is the
 * only face the user gets, so it carries the state on its own.
 */

import Image from 'next/image'

export interface CapAvatarProps {
  /** Cap is talking right now. */
  speaking?: boolean
  /** The camera can see a face. */
  attentive?: boolean
  size?: number
  className?: string
}

export function CapAvatar({
  speaking = false,
  attentive = false,
  size = 150,
  className = '',
}: CapAvatarProps) {
  const halo = speaking
    ? 'bg-purple-main/25 animate-breathe'
    : attentive
      ? 'bg-blue-sec/40'
      : 'bg-blue-light/60'

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <span
        className={`absolute rounded-full transition-colors duration-300 ${halo}`}
        style={{ width: size * 1.15, height: size * 1.15 }}
      />
      <Image
        src={speaking ? '/cap/cap-serious.png' : '/cap/cap-chill.png'}
        alt="Cap"
        width={size}
        height={size}
        priority
        className="relative drop-shadow-sm"
        style={{ width: size, height: 'auto' }}
      />
    </div>
  )
}
