/** Pairing state, starting a pairing, and resetting the connection. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../infrastructure/container'

export const dynamic = 'force-dynamic'

/** Current connection state. */
export async function GET(): Promise<Response> {
  const { pairing } = getContainer()
  return Response.json(await pairing.status())
}

/**
 * Begin pairing.
 *
 * The callback has to come back to wherever the user is browsing from — the
 * robot's own screen or a laptop on the network — so the redirect is built
 * from this request's origin.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const { pairing } = getContainer()
  const origin = requestOrigin(request)

  try {
    const { authorizeUrl } = await pairing.start(origin)
    return Response.json({ authorizeUrl })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'appairage impossible' },
      { status: 502 },
    )
  }
}

/** Forget the Flots credential entirely. */
export async function DELETE(): Promise<Response> {
  const { pairing } = getContainer()
  await pairing.reset()
  return Response.json(await pairing.status())
}

function requestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    return `${forwardedProto ?? 'http'}://${forwardedHost}`
  }
  return new URL(request.url).origin
}
