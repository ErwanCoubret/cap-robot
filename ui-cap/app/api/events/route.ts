/**
 * The interface's single event stream.
 *
 * Everything the kiosk reacts to arrives here: hardware state, the voice
 * pipeline, agent steps and notifications. Commands are separate POSTs that
 * return immediately; the screen updates when the matching event lands.
 */

import type { NextRequest } from 'next/server'

import type { AppEvent } from '../../../core/domain/events'
import { getContainer } from '../../../infrastructure/container'

/** Comment frames keep proxies and the browser from closing an idle stream. */
const KEEPALIVE_MS = 15_000

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest): Response {
  const { events, capd, scheduler } = getContainer()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const send = (event: AppEvent) => {
        if (closed) {
          return
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // The client vanished between the check and the write.
          cleanup()
        }
      }

      const unsubscribe = events.subscribe(send)
      const keepAlive = setInterval(() => {
        if (closed) {
          return
        }
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        } catch {
          cleanup()
        }
      }, KEEPALIVE_MS)

      function cleanup() {
        if (closed) {
          return
        }
        closed = true
        clearInterval(keepAlive)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed by the runtime.
        }
      }

      request.signal.addEventListener('abort', cleanup)

      // A freshly connected client should not have to wait for the next
      // change to learn the current state.
      send({ type: 'hardware', online: capd.lastStatus() !== null, status: capd.lastStatus() })

      // Including a ringing alarm matters: a kiosk that reloaded mid-ring
      // would otherwise show nothing while the robot keeps making noise.
      const ringing = scheduler.ringingEvent()
      if (ringing) {
        send(ringing)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Tell any intermediary not to buffer, which would defeat the stream.
      'X-Accel-Buffering': 'no',
    },
  })
}
