'use client'

/**
 * Subscription to the server's event stream.
 *
 * One `EventSource` per browser session feeds every screen. The browser
 * reconnects on its own after a drop, so the only thing handled here is
 * turning raw messages back into typed events.
 */

import { useEffect, useRef } from 'react'

import { isAppEvent, type AppEvent } from '../../core/domain/events'

/** Path of the server-sent events endpoint. */
export const EVENT_STREAM_PATH = '/api/events'

/**
 * Call ``onEvent`` for every event published by the server.
 *
 * The callback is kept in a ref so a component can pass an inline function
 * without the stream being torn down and reopened on each render.
 */
export function useAppEvents(onEvent: (event: AppEvent) => void): void {
  const handler = useRef(onEvent)

  useEffect(() => {
    handler.current = onEvent
  }, [onEvent])

  useEffect(() => {
    const source = new EventSource(EVENT_STREAM_PATH)

    source.onmessage = (message) => {
      let payload: unknown
      try {
        payload = JSON.parse(message.data as string)
      } catch {
        return
      }
      if (isAppEvent(payload)) {
        handler.current(payload)
      }
    }

    return () => {
      source.close()
    }
  }, [])
}
