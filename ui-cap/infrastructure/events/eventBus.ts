/**
 * In-process fan-out of {@link AppEvent}s to every open SSE connection.
 *
 * There is exactly one kiosk browser in practice, but the bus also decouples
 * the daemon WebSocket, the alarm scheduler and the agent loop from whoever is
 * listening — none of them should know whether anybody is watching.
 */

import type { AppEvent } from '../../core/domain/events'

/** Callback receiving every published event. */
export type EventListener = (event: AppEvent) => void

export class EventBus {
  private readonly listeners = new Set<EventListener>()

  /** Number of active listeners, exposed for diagnostics. */
  get listenerCount(): number {
    return this.listeners.size
  }

  /** Register ``listener`` and return a function removing it. */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Deliver ``event`` to every listener.
   *
   * A listener that throws must not prevent the others from being called: one
   * broken SSE connection cannot be allowed to silence the whole interface.
   */
  publish(event: AppEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.warn('event listener failed', error)
      }
    }
  }
}
