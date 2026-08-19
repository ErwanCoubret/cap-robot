'use client'

/**
 * Live view of what the camera sees.
 *
 * The stream is an `<img>` pointed at the MJPEG proxy, which means the browser
 * holds the connection and the daemon releases the sensor the moment this
 * component unmounts. That teardown is the point: leaving the settings screen
 * must hand the camera back.
 */

import { useState } from 'react'

export interface CameraPreviewProps {
  available: boolean
}

export function CameraPreview({ available }: CameraPreviewProps) {
  if (!available) {
    return (
      <Placeholder
        text="Caméra non détectée"
        hint="Le suivi du visage est indisponible."
      />
    )
  }

  // Keyed on availability so a camera coming back gets a fresh stream and a
  // clean error state, without an effect resetting either.
  return <Stream key="available" />
}

function Stream() {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <Placeholder
        text="Aperçu indisponible"
        hint="La caméra est peut-être utilisée ailleurs."
      />
    )
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-gray-dark">
      {/* eslint-disable-next-line @next/next/no-img-element -- a live MJPEG stream cannot go through next/image */}
      <img
        // The proxy answers no-store, so a remount always opens a new stream
        // rather than reusing one the daemon has already closed.
        src="/api/camera/preview"
        alt="Aperçu de la caméra"
        className="absolute inset-0 h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function Placeholder({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-2xl bg-gray-ulight p-3 text-center">
      <p className="text-base font-semibold text-gray-main">{text}</p>
      {hint ? <p className="mt-1 text-xs text-gray-sec">{hint}</p> : null}
    </div>
  )
}
