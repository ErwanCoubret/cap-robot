/** Driving a voice interaction: start listening, stop, or abandon it. */

import type { NextRequest } from 'next/server'

import { getContainer } from '../../../infrastructure/container'

export const dynamic = 'force-dynamic'

interface VoiceBody {
  action?: 'start' | 'stop' | 'cancel'
  mode?: 'note' | 'command'
}

export async function GET(): Promise<Response> {
  return Response.json(getContainer().voice.snapshot())
}

export async function POST(request: NextRequest): Promise<Response> {
  const { voice } = getContainer()
  const body = (await request.json().catch(() => ({}))) as VoiceBody

  try {
    switch (body.action) {
      case 'start': {
        const interactionId = await voice.start(body.mode === 'command' ? 'command' : 'note')
        return Response.json({ interactionId })
      }
      case 'stop':
        // The pipeline keeps running after the response: the interface
        // follows it on the event stream rather than holding the request open.
        void voice.stop()
        return Response.json({ stopping: true })
      case 'cancel':
        await voice.cancel()
        return Response.json({ cancelled: true })
      default:
        return Response.json({ error: 'action inconnue' }, { status: 400 })
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'commande vocale impossible' },
      { status: 409 },
    )
  }
}
