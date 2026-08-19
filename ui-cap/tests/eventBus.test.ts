import { describe, expect, it, vi } from 'vitest'

import type { AppEvent } from '../core/domain/events'
import { EventBus } from '../infrastructure/events/eventBus'

const PING: AppEvent = { type: 'ping' }

describe('EventBus', () => {
  it('delivers events to every subscriber', () => {
    const bus = new EventBus()
    const first: AppEvent[] = []
    const second: AppEvent[] = []
    bus.subscribe((event) => first.push(event))
    bus.subscribe((event) => second.push(event))

    bus.publish(PING)

    expect(first).toEqual([PING])
    expect(second).toEqual([PING])
  })

  it('stops delivering after unsubscribing', () => {
    const bus = new EventBus()
    const received: AppEvent[] = []
    const unsubscribe = bus.subscribe((event) => received.push(event))

    unsubscribe()
    bus.publish(PING)

    expect(received).toEqual([])
    expect(bus.listenerCount).toBe(0)
  })

  it('keeps delivering when one listener throws', () => {
    // A dropped SSE connection must not silence the rest of the interface.
    const bus = new EventBus()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const received: AppEvent[] = []
    bus.subscribe(() => {
      throw new Error('broken pipe')
    })
    bus.subscribe((event) => received.push(event))

    bus.publish(PING)

    expect(received).toEqual([PING])
    warn.mockRestore()
  })

  it('lets a listener unsubscribe while an event is being delivered', () => {
    const bus = new EventBus()
    const received: AppEvent[] = []
    const unsubscribe = bus.subscribe(() => unsubscribe())
    bus.subscribe((event) => received.push(event))

    bus.publish(PING)

    expect(received).toEqual([PING])
    expect(bus.listenerCount).toBe(1)
  })
})
