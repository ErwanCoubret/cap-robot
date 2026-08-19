import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_TOKEN_TTL_SECONDS,
  TokenStore,
  describePairing,
  expiresAt,
  isPendingStale,
  type PairingRecord,
} from '../infrastructure/mcp/tokenStore'

const BASE = 'https://api-staging.flots.app'

function record(overrides: Partial<PairingRecord> = {}): PairingRecord {
  return {
    clientId: 'client_42',
    redirectUri: 'http://localhost:3000/oauth/callback',
    accessToken: null,
    scopes: [],
    obtainedAt: null,
    expiresIn: null,
    user: null,
    pending: null,
    unauthorizedAt: null,
    ...overrides,
  }
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cap-token-'))
})

describe('TokenStore', () => {
  it('starts empty', async () => {
    expect((await new TokenStore(directory).read()).accessToken).toBeNull()
  })

  it('persists the credential with owner-only permissions', async () => {
    const store = new TokenStore(directory)

    await store.update((current) => ({ ...current, accessToken: 'mcp_secret' }))

    const mode = (await stat(join(directory, 'flots-pairing.json'))).mode & 0o777
    // The file grants access to the user's tasks and notes; nobody else on the
    // device should be able to read it.
    expect(mode).toBe(0o600)
    expect((await new TokenStore(directory).read()).accessToken).toBe('mcp_secret')
  })

  it('forgets everything on reset', async () => {
    const store = new TokenStore(directory)
    await store.update((current) => ({
      ...current,
      accessToken: 'mcp_secret',
      clientId: 'client_42',
      user: { email: 'a@b.c' },
    }))

    await store.reset()

    const cleared = await store.read()
    expect(cleared.accessToken).toBeNull()
    expect(cleared.clientId).toBeNull()
    expect(cleared.user).toBeNull()
  })
})

describe('expiresAt', () => {
  it('assumes the documented 30-day lifetime when none is given', () => {
    const expiry = expiresAt(record({ obtainedAt: '2026-01-01T00:00:00.000Z' }))

    expect(expiry?.toISOString()).toBe(
      new Date(Date.parse('2026-01-01T00:00:00.000Z') + DEFAULT_TOKEN_TTL_SECONDS * 1000).toISOString(),
    )
  })

  it('is unknown without a token', () => {
    expect(expiresAt(record())).toBeNull()
  })
})

describe('describePairing', () => {
  const now = new Date('2026-01-10T12:00:00.000Z')

  it('reports an unpaired robot', () => {
    expect(describePairing(record(), BASE, now).status).toBe('unpaired')
  })

  it('reports a live pairing with the days left', () => {
    const info = describePairing(
      record({
        accessToken: 'mcp_secret',
        obtainedAt: '2026-01-01T12:00:00.000Z',
        expiresIn: DEFAULT_TOKEN_TTL_SECONDS,
        user: { email: 'erwan@flots.app' },
        scopes: ['tasks:read'],
      }),
      BASE,
      now,
    )

    expect(info.status).toBe('paired')
    expect(info.user?.email).toBe('erwan@flots.app')
    expect(info.daysRemaining).toBe(21)
  })

  it('reports an expired token', () => {
    const info = describePairing(
      record({
        accessToken: 'mcp_secret',
        obtainedAt: '2025-11-01T12:00:00.000Z',
        expiresIn: DEFAULT_TOKEN_TTL_SECONDS,
      }),
      BASE,
      now,
    )

    expect(info.status).toBe('expired')
    expect(info.daysRemaining).toBeLessThan(0)
  })

  it('treats a token Flots already refused as expired', () => {
    // There is no refresh grant: a 401 means the same thing as an expiry.
    const info = describePairing(
      record({
        accessToken: 'mcp_secret',
        obtainedAt: '2026-01-09T12:00:00.000Z',
        unauthorizedAt: '2026-01-10T09:00:00.000Z',
      }),
      BASE,
      now,
    )

    expect(info.status).toBe('expired')
  })

  it('reports a pairing in progress', () => {
    const info = describePairing(
      record({
        pending: {
          verifier: 'v',
          state: 's',
          redirectUri: 'http://localhost:3000/oauth/callback',
          tokenEndpoint: `${BASE}/oauth/token`,
          resource: `${BASE}/mcp`,
          createdAt: '2026-01-10T11:58:00.000Z',
        },
      }),
      BASE,
      now,
    )

    expect(info.status).toBe('pending')
  })

  it('ignores an abandoned pairing attempt', () => {
    const info = describePairing(
      record({
        pending: {
          verifier: 'v',
          state: 's',
          redirectUri: 'http://localhost:3000/oauth/callback',
          tokenEndpoint: `${BASE}/oauth/token`,
          resource: `${BASE}/mcp`,
          createdAt: '2026-01-10T10:00:00.000Z',
        },
      }),
      BASE,
      now,
    )

    expect(info.status).toBe('unpaired')
  })
})

describe('isPendingStale', () => {
  const pending = {
    verifier: 'v',
    state: 's',
    redirectUri: 'http://localhost:3000/oauth/callback',
    tokenEndpoint: `${BASE}/oauth/token`,
    resource: `${BASE}/mcp`,
    createdAt: '2026-01-10T12:00:00.000Z',
  }

  it('accepts a recent attempt', () => {
    expect(isPendingStale(pending, new Date('2026-01-10T12:05:00.000Z'))).toBe(false)
  })

  it('rejects an attempt older than the window', () => {
    expect(isPendingStale(pending, new Date('2026-01-10T12:20:00.000Z'))).toBe(true)
  })

  it('rejects an unparsable timestamp', () => {
    expect(isPendingStale({ ...pending, createdAt: 'not a date' })).toBe(true)
  })
})
