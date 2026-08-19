/** The robot's own alarms. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../infrastructure/container'
import { AlarmValidationError } from '../../../core/usecases/alarms/alarmService'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const { alarms, scheduler } = getContainer()
  const list = await alarms.list()

  return Response.json({
    alarms: list.map((alarm) => ({ ...alarm, next: alarms.describe(alarm) })),
    ringing: scheduler.current?.id ?? null,
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const { alarms } = getContainer()
  const body = (await request.json().catch(() => ({}))) as {
    time?: string
    label?: string
    repeat?: 'once' | 'daily' | 'weekdays'
  }

  try {
    const alarm = await alarms.create({
      time: body.time ?? '',
      label: body.label,
      repeat: body.repeat,
    })
    return Response.json({ ...alarm, next: alarms.describe(alarm) })
  } catch (error) {
    if (error instanceof AlarmValidationError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const { alarms } = getContainer()
  const id = new URL(request.url).searchParams.get('id') ?? ''

  return Response.json({ deleted: await alarms.delete(id) })
}
