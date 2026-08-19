import { describe, expect, it, vi } from 'vitest'

import {
  MAX_BACKOFF_MS,
  isRetryable,
  retryAfterMs,
  withRetry,
} from '../infrastructure/ai/retry'

/** Never actually wait in tests. */
const sleep = () => Promise.resolve()

function apiError(status: number, headers?: Record<string, string>) {
  return Object.assign(new Error(`HTTP ${status}`), { status, headers })
}

describe('isRetryable', () => {
  it('retries rate limits and server errors', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryable(apiError(status))).toBe(true)
    }
  })

  it('does not retry what will fail identically', () => {
    // A bad request, a refused key or an unknown model fail the same way
    // however many times they are sent.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryable(apiError(status))).toBe(false)
    }
  })

  it('retries connection failures', () => {
    expect(isRetryable(Object.assign(new Error(), { name: 'APIConnectionError' }))).toBe(true)
    expect(isRetryable(Object.assign(new Error(), { code: 'ECONNREFUSED' }))).toBe(true)
  })

  it('ignores anything that is not an error object', () => {
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(new Error('plain'))).toBe(false)
  })
})

describe('retryAfterMs', () => {
  it('reads a delay given in seconds', () => {
    expect(retryAfterMs(apiError(429, { 'retry-after': '3' }))).toBe(3000)
  })

  it('reads a delay given as an HTTP date', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    const later = new Date('2026-01-01T12:00:05Z').toUTCString()

    expect(retryAfterMs(apiError(429, { 'retry-after': later }), now)).toBe(5000)
  })

  it('reads the header from a Headers instance', () => {
    const error = Object.assign(new Error(), {
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    })

    expect(retryAfterMs(error)).toBe(2000)
  })

  it('caps an unreasonable delay', () => {
    expect(retryAfterMs(apiError(429, { 'retry-after': '86400' }))).toBe(MAX_BACKOFF_MS)
  })

  it('never returns a negative delay for a date in the past', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    const past = new Date('2026-01-01T11:00:00Z').toUTCString()

    expect(retryAfterMs(apiError(429, { 'retry-after': past }), now)).toBe(0)
  })

  it('returns null when there is nothing to read', () => {
    expect(retryAfterMs(apiError(429))).toBeNull()
    expect(retryAfterMs(apiError(429, { 'retry-after': 'soon' }))).toBeNull()
  })
})

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const operation = vi.fn().mockResolvedValue('ok')

    expect(await withRetry(operation, { sleep })).toBe('ok')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries a retryable failure once and succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue('recovered')

    expect(await withRetry(operation, { sleep })).toBe('recovered')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt budget', async () => {
    const operation = vi.fn().mockRejectedValue(apiError(500))

    await expect(withRetry(operation, { sleep })).rejects.toThrow('HTTP 500')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('does not retry a failure that cannot be fixed by retrying', async () => {
    const operation = vi.fn().mockRejectedValue(apiError(401))

    await expect(withRetry(operation, { sleep })).rejects.toThrow('HTTP 401')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('waits as long as the server asked', async () => {
    const delays: number[] = []
    const operation = vi
      .fn()
      .mockRejectedValueOnce(apiError(429, { 'retry-after': '7' }))
      .mockResolvedValue('ok')

    await withRetry(operation, {
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    expect(delays).toEqual([7000])
  })

  it('reports each retry to the caller', async () => {
    const onRetry = vi.fn()
    const operation = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValue('ok')

    await withRetry(operation, { sleep, onRetry })

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, delayMs: expect.any(Number) }),
    )
  })
})
