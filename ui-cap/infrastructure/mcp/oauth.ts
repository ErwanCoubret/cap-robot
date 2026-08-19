/**
 * OAuth 2.1 against the Flots authorisation server.
 *
 * Flots issues public-client tokens with PKCE and no refresh grant, so the
 * robot holds a 30-day credential and has to be paired again by hand when it
 * expires. Everything here is a pure function of its inputs plus an injected
 * `fetch`, which is what makes the flow testable without a browser.
 */

import { createHash, randomBytes } from 'node:crypto'

/** Client name shown on the Flots consent screen and in the user's settings. */
export const CLIENT_NAME = 'Cap Robot'

/** Path the authorisation server redirects back to. */
export const CALLBACK_PATH = '/oauth/callback'

/**
 * Scopes the robot asks for.
 *
 * Deliberately narrower than what Flots offers: Cap reads the day, creates
 * tasks and notes, and completes tasks. It never deletes anything, so asking
 * for delete scopes would put a destructive capability on a device that lives
 * in a room with other people.
 */
export const REQUESTED_SCOPES = [
  'tasks:read',
  'tasks:write',
  'projects:read',
  'categories:read',
  'notes:read',
  'notes:write',
]

/**
 * Intersect what the robot wants with what the server offers.
 *
 * Asking for a scope the server does not know would fail the whole
 * authorisation, and taking everything the server supports would grant far
 * more than the robot uses.
 */
export function grantableScopes(supported: string[]): string[] {
  if (supported.length === 0) {
    return REQUESTED_SCOPES
  }
  const offered = new Set(supported)
  return REQUESTED_SCOPES.filter((scope) => offered.has(scope))
}

type Fetch = typeof globalThis.fetch

export interface ProtectedResourceMetadata {
  resource: string
  authorizationServers: string[]
  scopesSupported: string[]
}

export interface AuthorizationServerMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scopesSupported: string[]
  codeChallengeMethods: string[]
}

export interface PkcePair {
  verifier: string
  challenge: string
}

export interface TokenResponse {
  accessToken: string
  tokenType: string
  expiresIn: number | null
  scopes: string[]
}

/** Generate a PKCE verifier and its S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Generate an opaque `state` value binding the callback to this attempt. */
export function createState(): string {
  return base64url(randomBytes(16))
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

/** Read the protected-resource document that names the authorisation server. */
export async function discoverProtectedResource(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<ProtectedResourceMetadata> {
  const payload = await getJson(
    `${baseUrl}/.well-known/oauth-protected-resource`,
    fetchImpl,
  )
  return {
    resource: String(payload.resource ?? `${baseUrl}/mcp`),
    authorizationServers: asStringArray(payload.authorization_servers, [baseUrl]),
    scopesSupported: asStringArray(payload.scopes_supported, []),
  }
}

/** Read the authorisation server's endpoints. */
export async function discoverAuthorizationServer(
  issuer: string,
  fetchImpl: Fetch = fetch,
): Promise<AuthorizationServerMetadata> {
  const payload = await getJson(
    `${issuer}/.well-known/oauth-authorization-server`,
    fetchImpl,
  )
  return {
    issuer: String(payload.issuer ?? issuer),
    authorizationEndpoint: String(payload.authorization_endpoint),
    tokenEndpoint: String(payload.token_endpoint),
    registrationEndpoint: String(payload.registration_endpoint),
    scopesSupported: asStringArray(payload.scopes_supported, []),
    codeChallengeMethods: asStringArray(payload.code_challenge_methods_supported, []),
  }
}

/**
 * Register the robot as an OAuth client (RFC 7591).
 *
 * Several redirect URIs are registered at once so the same client works
 * whether the user completes the consent on the robot's own screen or from a
 * laptop on the same network.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUris: string[],
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: redirectUris }),
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof payload.client_id !== 'string') {
    throw new Error(
      `l’enregistrement du client a échoué (HTTP ${response.status}) ${
        typeof payload.error === 'string' ? payload.error : ''
      }`.trim(),
    )
  }
  return payload.client_id
}

export interface AuthorizeUrlInput {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  /** RFC 8707 audience: the token is bound to this MCP endpoint. */
  resource: string
  scopes?: string[]
}

/** Build the URL the user has to open to grant access. */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(input.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('resource', input.resource)
  url.searchParams.set('scope', (input.scopes ?? REQUESTED_SCOPES).join(' '))
  return url.toString()
}

export interface ExchangeCodeInput {
  tokenEndpoint: string
  code: string
  clientId: string
  redirectUri: string
  verifier: string
  resource: string
}

/** Exchange an authorisation code for an access token. */
export async function exchangeCode(
  input: ExchangeCodeInput,
  fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    resource: input.resource,
  })

  const response = await fetchImpl(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok || typeof payload.access_token !== 'string') {
    const reason =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
    throw new Error(`l’échange du code a échoué : ${reason}`)
  }

  return {
    accessToken: payload.access_token,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
  }
}

async function getJson(url: string, fetchImpl: Fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`${url} a répondu HTTP ${response.status}`)
  }
  return (await response.json()) as Record<string, unknown>
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback
}
