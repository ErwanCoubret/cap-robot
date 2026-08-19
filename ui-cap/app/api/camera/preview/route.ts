/**
 * Same-origin proxy for the daemon's MJPEG preview.
 *
 * The daemon binds to localhost, so the browser cannot reach it directly. The
 * response body is piped through untouched, and the daemon releases the sensor
 * when this request is aborted — which is what closing the settings screen
 * does.
 */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  const { capd } = getContainer()

  try {
    const upstream = await fetch(capd.previewUrl, {
      signal: request.signal,
      cache: 'no-store',
    })

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: 'preview unavailable', status: upstream.status },
        { status: 503 },
      )
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=capframe',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    if (request.signal.aborted) {
      // The viewer navigated away mid-stream; nothing to report.
      return new Response(null, { status: 499 })
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'preview failed' },
      { status: 503 },
    )
  }
}
