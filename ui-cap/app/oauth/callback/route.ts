/**
 * Where Flots sends the user back after they grant access.
 *
 * The result is always a redirect to the settings screen rather than a JSON
 * body: whoever completed the consent is looking at a browser, and on the
 * robot that browser is the kiosk with no address bar.
 */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  const { pairing } = getContainer()
  const url = new URL(request.url)
  const settings = new URL('/settings', url.origin)

  const denied = url.searchParams.get('error')
  if (denied) {
    settings.searchParams.set(
      'pairing_error',
      url.searchParams.get('error_description') ?? denied,
    )
    return Response.redirect(settings, 303)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    settings.searchParams.set('pairing_error', 'réponse d’appairage incomplète')
    return Response.redirect(settings, 303)
  }

  try {
    await pairing.complete(code, state)
    settings.searchParams.set('paired', '1')
  } catch (error) {
    settings.searchParams.set(
      'pairing_error',
      error instanceof Error ? error.message : 'appairage impossible',
    )
  }

  return Response.redirect(settings, 303)
}
