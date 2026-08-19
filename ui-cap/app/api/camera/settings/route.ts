/** Camera orientation and face-tracking toggles. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../../infrastructure/container'

export const dynamic = 'force-dynamic'

interface CameraSettingsBody {
  vflip?: boolean
  tracking?: boolean
}

export async function POST(request: NextRequest): Promise<Response> {
  const { capd } = getContainer()
  const body = (await request.json().catch(() => ({}))) as CameraSettingsBody

  try {
    if (typeof body.vflip === 'boolean') {
      await capd.setCameraFlip(body.vflip)
    }
    if (typeof body.tracking === 'boolean') {
      await capd.setTracking(body.tracking)
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'camera command failed' },
      { status: 503 },
    )
  }

  return Response.json(await capd.health())
}
