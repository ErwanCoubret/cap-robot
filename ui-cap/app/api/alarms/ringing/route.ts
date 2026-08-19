/** Stopping or postponing the alarm that is ringing. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<Response> {
  const { scheduler } = getContainer()
  const body = (await request.json().catch(() => ({}))) as { action?: string }

  if (body.action === 'snooze') {
    await scheduler.snooze()
    return Response.json({ snoozed: true })
  }

  await scheduler.dismiss()
  return Response.json({ dismissed: true })
}
