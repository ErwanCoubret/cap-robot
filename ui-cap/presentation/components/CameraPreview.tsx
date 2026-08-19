'use client'

/**
 * Live view of what the camera sees.
 *
 * The stream is an `<img>` pointed at the MJPEG proxy, which means the browser
 * holds the connection and the daemon releases the sensor the moment this
 * component unmounts. That teardown is the point: leaving the settings screen
 * must hand the camera back.
 */

import { useEffect, useState } from 'react'

export interface CameraPreviewProps {
  available: boolean
}

export function CameraPreview({ available }: CameraPreviewProps) {
  const [failed, setFailed] = useState(false)
  // A fresh query string per mount avoids the browser reusing a stream it has
  // already closed.
  const [nonce, setNonce] = useState<number | null>(null)

  useEffect(() => {
    setNonce(Date.now())
    setFailed(false)
  }, [available])

  if (!available) {
    return (
      <Placeholder text="Caméra non détectée" hint="Le suivi du visage est indisponible." />
    )
  }

  if (failed || nonce === null) {
    return (
      <Placeholder
        text={failed ? 'Aperçu indisponible' : 'Ouverture de la caméra…'}
        hint={failed ? 'La caméra est peut-être utilisée ailleurs.' : undefined}
      />
    )
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-gray-dark">
      {/* eslint-disable-next-line @next/next/no-img-element -- a live MJPEG stream cannot go through next/image */}
      <img
        src={`/api/camera/preview?t=${nonce}`}
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
