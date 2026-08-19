/**
 * JSON-RPC client for the Flots MCP server.
 *
 * The transport is a plain HTTP POST per call — no SSE, no session — so the
 * client is little more than a bearer token plus the initialise handshake,
 * done lazily once per process.
 */

import type { McpTool, McpToolResult, PairedUser } from '../../core/domain/flots'
import { NotPairedError } from '../../core/ports/flots'
import { McpRpcError, parseToolResult, parseTools, unwrapRpc } from './mcpParsing'
import type { TokenStore } from './tokenStore'

/** MCP revision the Flots server speaks. */
export const PROTOCOL_VERSION = '2025-06-18'

/** How long a tools/list answer is reused. */
const TOOLS_TTL_MS = 10 * 60 * 1000

const REQUEST_TIMEOUT_MS = 20_000

type Fetch = typeof globalThis.fetch

export interface McpClientOptions {
  baseUrl: string
  tokens: TokenStore
  fetchImpl?: Fetch
}

export class McpClient {
  private readonly baseUrl: string
  private readonly tokens: TokenStore
  private readonly fetchImpl: Fetch
  private handshake: Promise<void> | null = null
  private toolsCache: { tools: McpTool[]; at: number } | null = null

  constructor(options: McpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.tokens = options.tokens
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** The MCP endpoint, which is also the token's audience. */
  get endpoint(): string {
    return `${this.baseUrl}/mcp`
  }

  /** Forget the cached tool list, e.g. after re-pairing with new scopes. */
  invalidate(): void {
    this.toolsCache = null
    this.handshake = null
  }

  /** Identify the paired account. Doubles as the connection health check. */
  async me(): Promise<{ user: PairedUser; scopes: string[] }> {
    const payload = (await this.get('/mcp/me')) as {
      user?: PairedUser
      scopes?: string[]
    }
    return {
      user: payload.user ?? {},
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    }
  }

  /** Tools the granted scopes expose, cached for a few minutes. */
  async listTools(force = false): Promise<McpTool[]> {
    const cached = this.toolsCache
    if (!force && cached && Date.now() - cached.at < TOOLS_TTL_MS) {
      return cached.tools
    }
    const tools = parseTools(await this.rpc('tools/list', {}))
    this.toolsCache = { tools, at: Date.now() }
    return tools
  }

  /** Invoke a tool. Tool-level refusals come back as a result, not a throw. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      return parseToolResult(await this.rpc('tools/call', { name, arguments: args }))
    } catch (error) {
      if (error instanceof McpRpcError) {
        return { ok: false, data: null, text: error.message }
      }
      throw error
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.handshake) {
      this.handshake = this.performHandshake().catch((error: unknown) => {
        // A failed handshake must not be cached, or the client would stay
        // broken until the process restarts.
        this.handshake = null
        throw error
      })
    }
    return this.handshake
  }

  private async performHandshake(): Promise<void> {
    await this.rpc(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'cap-robot', version: '0.1.0' },
      },
      { skipInit: true },
    )
    // A notification carries no id and expects no result.
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    options: { skipInit?: boolean } = {},
  ): Promise<unknown> {
    if (!options.skipInit) {
      await this.ensureInitialized()
    }
    const payload = await this.post({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    })
    return unwrapRpc(payload)
  }

  private async post(body: Record<string, unknown>): Promise<unknown> {
    const token = await this.requireToken()
    const response = await this.send(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    await this.guardAuthorization(response)

    if (!response.ok) {
      throw new Error(`Flots a répondu HTTP ${response.status} sur ${this.endpoint}`)
    }
    if (response.status === 202) {
      return null
    }
    return response.json().catch(() => null)
  }

  private async get(path: string): Promise<unknown> {
    const token = await this.requireToken()
    const response = await this.send(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })

    await this.guardAuthorization(response)

    if (!response.ok) {
      throw new Error(`Flots a répondu HTTP ${response.status} sur ${path}`)
    }
    return response.json()
  }

  /**
   * Turn a rejected token into a state the interface can explain.
   *
   * There is no refresh grant, so a 401 always means the same thing: the user
   * has to pair the robot again.
   */
  private async guardAuthorization(response: Response): Promise<void> {
    if (response.status !== 401 && response.status !== 403) {
      return
    }
    await this.tokens.update((current) => ({
      ...current,
      unauthorizedAt: new Date().toISOString(),
    }))
    this.invalidate()
    throw new NotPairedError(
      response.status === 401
        ? 'Flots a refusé le jeton du robot, il faut le réappairer'
        : 'Flots a refusé la demande : abonnement ou permissions insuffisants',
    )
  }

  private async requireToken(): Promise<string> {
    const record = await this.tokens.read()
    if (!record.accessToken) {
      throw new NotPairedError()
    }
    return record.accessToken
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (error) {
      throw new Error(
        `Flots injoignable (${this.baseUrl}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
