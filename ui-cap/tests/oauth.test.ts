import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  REQUESTED_SCOPES,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  discoverAuthorizationServer,
  discoverProtectedResource,
  exchangeCode,
  grantableScopes,
  registerClient,
} from '../infrastructure/mcp/oauth'

/** The documents the Flots staging server actually returns. */
const PROTECTED_RESOURCE = {
  resource: 'https://api-staging.flots.app/mcp',
  authorization_servers: ['https://api-staging.flots.app'],
  scopes_supported: ['tasks:read', 'tasks:write', 'notes:read', 'notes:write'],
  bearer_methods_supported: ['header'],
}

const AUTH_SERVER = {
  issuer: 'https://api-staging.flots.app',
  authorization_endpoint: 'https://api-staging.flots.app/oauth/authorize',
  token_endpoint: 'https://api-staging.flots.app/oauth/token',
  registration_endpoint: 'https://api-staging.flots.app/oauth/register',
  scopes_supported: ['tasks:read'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PKCE', () => {
  it('derives the challenge as the S256 hash of the verifier', () => {
    const { verifier, challenge } = createPkcePair()

    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('produces URL-safe values with no padding', () => {
    const { verifier, challenge } = createPkcePair()

    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    // RFC 7636 requires 43..128 characters.
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('never repeats a verifier or a state', () => {
    const verifiers = new Set(Array.from({ length: 25 }, () => createPkcePair().verifier))
    const states = new Set(Array.from({ length: 25 }, () => createState()))

    expect(verifiers.size).toBe(25)
    expect(states.size).toBe(25)
  })
})

describe('discovery', () => {
  it('reads the protected resource document', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(PROTECTED_RESOURCE))

    const metadata = await discoverProtectedResource(
      'https://api-staging.flots.app',
      fetchImpl as unknown as typeof fetch,
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-staging.flots.app/.well-known/oauth-protected-resource',
      expect.anything(),
    )
    expect(metadata.resource).toBe('https://api-staging.flots.app/mcp')
    expect(metadata.authorizationServers).toEqual(['https://api-staging.flots.app'])
  })

  it('reads the authorisation server endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(AUTH_SERVER))

    const metadata = await discoverAuthorizationServer(
      'https://api-staging.flots.app',
      fetchImpl as unknown as typeof fetch,
    )

    expect(metadata.tokenEndpoint).toBe('https://api-staging.flots.app/oauth/token')
    expect(metadata.codeChallengeMethods).toContain('S256')
  })

  it('reports a discovery failure rather than guessing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }))

    await expect(
      discoverProtectedResource('https://api-staging.flots.app', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('404')
  })
})

describe('registerClient', () => {
  it('registers every redirect URI and returns the client id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ client_id: 'client_42' }))

    const clientId = await registerClient(
      AUTH_SERVER.registration_endpoint,
      ['http://localhost:3000/oauth/callback', 'http://192.168.1.20:3000/oauth/callback'],
      fetchImpl as unknown as typeof fetch,
    )

    expect(clientId).toBe('client_42')
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body.client_name).toBe('Cap Robot')
    expect(body.redirect_uris).toHaveLength(2)
  })

  it('fails loudly when no client id comes back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_request' }, 400))

    await expect(
      registerClient(AUTH_SERVER.registration_endpoint, ['http://x/cb'], fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('invalid_request')
  })
})

describe('grantableScopes', () => {
  it('never asks for the destructive scopes the server offers', () => {
    // Flots advertises delete scopes; a device sitting in a shared room has no
    // business holding a credential that can wipe tasks or notes.
    const scopes = grantableScopes([
      'tasks:read',
      'tasks:write',
      'tasks:delete',
      'projects:read',
      'projects:write',
      'projects:delete',
      'categories:read',
      'notes:read',
      'notes:write',
      'notes:delete',
    ])

    expect(scopes).toEqual(REQUESTED_SCOPES)
    expect(scopes.some((scope) => scope.endsWith(':delete'))).toBe(false)
  })

  it('drops scopes the server does not know about', () => {
    expect(grantableScopes(['tasks:read', 'notes:read'])).toEqual([
      'tasks:read',
      'notes:read',
    ])
  })

  it('falls back to the full request when the server lists nothing', () => {
    expect(grantableScopes([])).toEqual(REQUESTED_SCOPES)
  })
})

describe('buildAuthorizeUrl', () => {
  it('carries PKCE, the state and the RFC 8707 audience', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizationEndpoint: AUTH_SERVER.authorization_endpoint,
        clientId: 'client_42',
        redirectUri: 'http://localhost:3000/oauth/callback',
        challenge: 'chal',
        state: 'st',
        resource: 'https://api-staging.flots.app/mcp',
        scopes: ['tasks:read', 'notes:write'],
      }),
    )

    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('chal')
    expect(url.searchParams.get('state')).toBe('st')
    // Without the resource the token would not be bound to this MCP server.
    expect(url.searchParams.get('resource')).toBe('https://api-staging.flots.app/mcp')
    expect(url.searchParams.get('scope')).toBe('tasks:read notes:write')
  })
})

describe('exchangeCode', () => {
  it('posts a form-encoded body including the verifier', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'mcp_secret',
        token_type: 'Bearer',
        expires_in: 2592000,
        scope: 'tasks:read tasks:write',
      }),
    )

    const token = await exchangeCode(
      {
        tokenEndpoint: AUTH_SERVER.token_endpoint,
        code: 'auth_code',
        clientId: 'client_42',
        redirectUri: 'http://localhost:3000/oauth/callback',
        verifier: 'the_verifier',
        resource: 'https://api-staging.flots.app/mcp',
      },
      fetchImpl as unknown as typeof fetch,
    )

    expect(token.accessToken).toBe('mcp_secret')
    expect(token.expiresIn).toBe(2592000)
    expect(token.scopes).toEqual(['tasks:read', 'tasks:write'])

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    const form = new URLSearchParams(init.body as string)
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code_verifier')).toBe('the_verifier')
    expect(form.get('resource')).toBe('https://api-staging.flots.app/mcp')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    )
  })

  it('surfaces the server description when the exchange is refused', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'invalid_grant', error_description: 'code déjà utilisé' }, 400),
    )

    await expect(
      exchangeCode(
        {
          tokenEndpoint: AUTH_SERVER.token_endpoint,
          code: 'used',
          clientId: 'client_42',
          redirectUri: 'http://localhost:3000/oauth/callback',
          verifier: 'v',
          resource: 'https://api-staging.flots.app/mcp',
        },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('code déjà utilisé')
  })
})
