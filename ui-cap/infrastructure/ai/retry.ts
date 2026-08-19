/**
 * Retry policy for model calls.
 *
 * The SDK's own retries are turned off so the rules live here, where they can
 * be read and tested: only failures that a second attempt could plausibly fix
 * are retried, and a server asking us to wait is obeyed.
 */

/** Attempts per call, including the first. */
export const MAX_ATTEMPTS = 2

/** Never wait longer than this, whatever the server asks for. */
export const MAX_BACKOFF_MS = 60_000

/** Status codes worth a second attempt. */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

interface ErrorLike {
  status?: number
  code?: string
  name?: string
  headers?: Headers | Record<string, string>
}

/**
 * Whether ``error`` might succeed on a second attempt.
 *
 * Anything else — a bad request, a refused credential, an unknown model — will
 * fail identically however many times it is sent.
 */
export function isRetryable(error: unknown): boolean {
  const candidate = error as ErrorLike | null
  if (!candidate) {
    return false
  }
  if (typeof candidate.status === 'number') {
    return RETRYABLE_STATUS.has(candidate.status)
  }
  // Connection-level failures: the model host may just have been restarting.
  return (
    candidate.name === 'APIConnectionError' ||
    candidate.name === 'APIConnectionTimeoutError' ||
    candidate.name === 'TimeoutError' ||
    candidate.code === 'ECONNREFUSED' ||
    candidate.code === 'ECONNRESET' ||
    candidate.code === 'ETIMEDOUT' ||
    candidate.code === 'UND_ERR_CONNECT_TIMEOUT'
  )
}

/**
 * How long the server asked us to wait, in milliseconds.
 *
 * `Retry-After` may be a number of seconds or an HTTP date; both are accepted,
 * and anything unparsable yields null so the caller falls back to its own
 * backoff.
 */
export function retryAfterMs(error: unknown, now: Date = new Date()): number | null {
  const headers = (error as ErrorLike | null)?.headers
  if (!headers) {
    return null
  }

  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after')
      : ((headers as Record<string, string>)['retry-after'] ??
        (headers as Record<string, string>)['Retry-After'])

  if (!raw) {
    return null
  }

  const seconds = Number(raw)
  if (Number.isFinite(seconds)) {
    return clamp(seconds * 1000)
  }

  const date = Date.parse(raw)
  if (Number.isNaN(date)) {
    return null
  }
  return clamp(date - now.getTime())
}

function clamp(milliseconds: number): number {
  return Math.max(0, Math.min(milliseconds, MAX_BACKOFF_MS))
}

export interface RetryOptions {
  attempts?: number
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
}

/** Run ``operation``, retrying the failures that deserve it. */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_ATTEMPTS
  const sleep = options.sleep ?? defaultSleep
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= attempts || !isRetryable(error)) {
        throw error
      }
      // Honour the server's own pacing when it gave one; otherwise a short
      // jittered pause so two clients do not retry in lockstep.
      const delayMs = retryAfterMs(error) ?? 500 + Math.random() * 500
      options.onRetry?.({ attempt, delayMs, error })
      await sleep(delayMs)
    }
  }

  throw lastError
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
