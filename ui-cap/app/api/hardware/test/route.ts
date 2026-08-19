/** Hardware self-checks triggered from the settings screen. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../../infrastructure/container'

export const dynamic = 'force-dynamic'

const VOICE_CHECK = "Bonjour, ici Cap. Ma voix fonctionne."

export async function POST(request: NextRequest): Promise<Response> {
  const { capd } = getContainer()
  const body = (await request.json().catch(() => ({}))) as { kind?: string }

  try {
    if (body.kind === 'voice') {
      await capd.speak(VOICE_CHECK, { interrupt: true })
    } else if (body.kind === 'eyes') {
      await capd.setExpression('wiggle')
    } else {
      return Response.json({ error: 'test inconnu' }, { status: 400 })
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'test impossible' },
      { status: 503 },
    )
  }

  return Response.json({ ok: true })
}
