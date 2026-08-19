/**
 * Pairing the robot with a Flots account.
 *
 * The consent screen needs a logged-in Flots session, which a headless daemon
 * cannot have — so the flow is deliberately browser-shaped: the robot builds
 * an authorisation URL, the user signs in (on the robot's own touchscreen, or
 * from a phone or laptop pointed at the robot), and the callback lands back
 * here with a code to exchange.
 */

import type { ConnectionTest, PairingInfo } from '../../core/domain/flots'
import type { McpClient } from './mcpClient'
import {
  CALLBACK_PATH,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  discoverAuthorizationServer,
  discoverProtectedResource,
  exchangeCode,
  grantableScopes,
  registerClient,
} from './oauth'
import { describePairing, isPendingStale, type TokenStore } from './tokenStore'

type Fetch = typeof globalThis.fetch

export interface PairingServiceOptions {
  baseUrl: string
  /** Configured public origin, registered alongside the caller's own. */
  publicUrl: string
  tokens: TokenStore
  mcp: McpClient
  fetchImpl?: Fetch
}

export class PairingService {
  private readonly baseUrl: string
  private readonly publicUrl: string
  private readonly tokens: TokenStore
  private readonly mcp: McpClient
  private readonly fetchImpl: Fetch

  constructor(options: PairingServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.publicUrl = options.publicUrl.replace(/\/$/, '')
    this.tokens = options.tokens
    this.mcp = options.mcp
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** Current state, computed from the stored record alone. */
  async status(): Promise<PairingInfo> {
    return describePairing(await this.tokens.read(), this.baseUrl)
  }

  /**
   * Begin pairing and return the URL the user must open.
   *
   * ``origin`` is where the request came from, so the callback returns to the
   * same place the user is actually browsing from.
   */
  async start(origin: string): Promise<{ authorizeUrl: string }> {
    const resourceMetadata = await discoverProtectedResource(this.baseUrl, this.fetchImpl)
    const issuer = resourceMetadata.authorizationServers[0] ?? this.baseUrl
    const server = await discoverAuthorizationServer(issuer, this.fetchImpl)

    if (!server.codeChallengeMethods.includes('S256')) {
      throw new Error('le serveur Flots n’accepte pas PKCE S256')
    }

    const redirectUri = `${origin.replace(/\/$/, '')}${CALLBACK_PATH}`
    const record = await this.tokens.read()

    let clientId = record.clientId
    if (!clientId || record.redirectUri !== redirectUri) {
      // Registering both origins keeps one client working whether the consent
      // is completed on the robot or from another device on the network.
      const redirectUris = [...new Set([redirectUri, `${this.publicUrl}${CALLBACK_PATH}`])]
      clientId = await registerClient(server.registrationEndpoint, redirectUris, this.fetchImpl)
    }

    const { verifier, challenge } = createPkcePair()
    const state = createState()

    await this.tokens.update((current) => ({
      ...current,
      clientId,
      redirectUri,
      pending: {
        verifier,
        state,
        redirectUri,
        tokenEndpoint: server.tokenEndpoint,
        resource: resourceMetadata.resource,
        createdAt: new Date().toISOString(),
      },
    }))

    return {
      authorizeUrl: buildAuthorizeUrl({
        authorizationEndpoint: server.authorizationEndpoint,
        clientId,
        redirectUri,
        challenge,
        state,
        resource: resourceMetadata.resource,
        scopes: grantableScopes(resourceMetadata.scopesSupported),
      }),
    }
  }

  /** Finish pairing from the callback's `code` and `state`. */
  async complete(code: string, state: string): Promise<PairingInfo> {
    const record = await this.tokens.read()
    const pending = record.pending

    if (!pending || !record.clientId) {
      throw new Error('aucune demande d’appairage en cours')
    }
    if (isPendingStale(pending)) {
      throw new Error('la demande d’appairage a expiré, relance l’appairage')
    }
    // The state binds this callback to the attempt that started it.
    if (pending.state !== state) {
      throw new Error('réponse d’appairage inattendue (state invalide)')
    }

    const token = await exchangeCode(
      {
        tokenEndpoint: pending.tokenEndpoint,
        code,
        clientId: record.clientId,
        redirectUri: pending.redirectUri,
        verifier: pending.verifier,
        resource: pending.resource,
      },
      this.fetchImpl,
    )

    await this.tokens.update((current) => ({
      ...current,
      accessToken: token.accessToken,
      scopes: token.scopes,
      expiresIn: token.expiresIn,
      obtainedAt: new Date().toISOString(),
      pending: null,
      unauthorizedAt: null,
    }))
    this.mcp.invalidate()

    // Naming the account on screen is nice to have, not a reason to fail.
    try {
      const identity = await this.mcp.me()
      await this.tokens.update((current) => ({
        ...current,
        user: identity.user,
        scopes: identity.scopes.length ? identity.scopes : current.scopes,
      }))
    } catch (error) {
      console.warn('paired, but /mcp/me failed', error)
    }

    return this.status()
  }

  /** Forget the credential and the client registration. */
  async reset(): Promise<void> {
    await this.tokens.reset()
    this.mcp.invalidate()
  }

  /** Round-trip check behind the settings screen's "test" button. */
  async test(): Promise<ConnectionTest> {
    const started = Date.now()
    try {
      const identity = await this.mcp.me()
      const tools = await this.mcp.listTools(true)
      return {
        ok: true,
        user: identity.user,
        scopes: identity.scopes,
        toolCount: tools.length,
        latencyMs: Date.now() - started,
      }
    } catch (error) {
      return {
        ok: false,
        user: null,
        scopes: [],
        toolCount: 0,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
