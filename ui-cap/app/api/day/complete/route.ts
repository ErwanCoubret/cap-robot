/** Mark a task done from the day view. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  const { day, capd } = getContainer()
  const body = (await request.json().catch(() => ({}))) as { taskId?: string }
  const taskId = (body.taskId ?? '').trim()

  if (!taskId) {
    return Response.json({ error: 'tâche manquante' }, { status: 400 })
  }

  try {
    const result = await day.completeTask(taskId)
    if (result.ok) {
      // A small acknowledgement, so the user knows it landed without reading.
      void capd.playSound('chime').catch(() => undefined)
    }
    return Response.json(result, { status: result.ok ? 200 : 502 })
  } catch (error) {
    return Response.json(
      { ok: false, text: error instanceof Error ? error.message : 'action impossible' },
      { status: 503 },
    )
  }
}
