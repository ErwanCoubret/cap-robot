/** Ask Cap something in writing; the answer also comes back on the stream. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  const { agent } = getContainer()
  const body = (await request.json().catch(() => ({}))) as { text?: string; speak?: boolean }
  const text = (body.text ?? '').trim()

  if (!text) {
    return Response.json({ error: 'question vide' }, { status: 400 })
  }

  try {
    return Response.json({ text: await agent.ask(text, { speak: body.speak !== false }) })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cap n’a pas pu répondre' },
      { status: 503 },
    )
  }
}
