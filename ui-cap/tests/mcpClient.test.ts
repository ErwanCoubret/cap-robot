import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotPairedError } from '../core/ports/flots'
import { McpClient, PROTOCOL_VERSION } from '../infrastructure/mcp/mcpClient'
import { TokenStore } from '../infrastructure/mcp/tokenStore'

const BASE = 'https://api-staging.flots.app'

let tokens: TokenStore

beforeEach(async () => {
  tokens = new TokenStore(await mkdtemp(join(tmpdir(), 'cap-mcp-')))
  await tokens.update((current) => ({ ...current, accessToken: 'mcp_secret' }))
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A fake server answering by JSON-RPC method. */
function server(handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as { method?: string }
    const method = body.method ?? ''
    if (method === 'notifications/initialized') {
      return new Response('', { status: 202 })
    }
    if (!(method in handlers)) {
      return jsonResponse({ jsonrpc: '2.0', error: { code: -32601, message: 'inconnu' } })
    }
    return jsonResponse({ jsonrpc: '2.0', id: 1, result: handlers[method] })
  })
}

function client(fetchImpl: unknown): McpClient {
  return new McpClient({ baseUrl: BASE, tokens, fetchImpl: fetchImpl as typeof fetch })
}

describe('McpClient', () => {
  it('performs the initialise handshake once, before the first call', async () => {
    const fetchImpl = server({ initialize: {}, 'tools/list': { tools: [{ name: 'list_tasks' }] } })
    const mcp = client(fetchImpl)

    await mcp.listTools()
    await mcp.listTools(true)

    const methods = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).method,
    )
    expect(methods).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/list',
    ])
  })

  it('announces the protocol revision Flots speaks', async () => {
    const fetchImpl = server({ initialize: {}, 'tools/list': { tools: [] } })

    await client(fetchImpl).listTools()

    const initialize = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(initialize.params.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('sends the bearer token on every call', async () => {
    const fetchImpl = server({ initialize: {}, 'tools/list': { tools: [] } })

    await client(fetchImpl).listTools()

    for (const call of fetchImpl.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer mcp_secret')
    }
  })

  it('caches the tool list between calls', async () => {
    const fetchImpl = server({ initialize: {}, 'tools/list': { tools: [{ name: 'list_tasks' }] } })
    const mcp = client(fetchImpl)

    await mcp.listTools()
    await mcp.listTools()

    const listCalls = fetchImpl.mock.calls.filter(
      (call) => JSON.parse((call[1] as RequestInit).body as string).method === 'tools/list',
    )
    expect(listCalls).toHaveLength(1)
  })

  it('refuses to call anything when the robot is not paired', async () => {
    await tokens.reset()
    const fetchImpl = server({ initialize: {} })

    await expect(client(fetchImpl).listTools()).rejects.toThrow(NotPairedError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('marks the pairing as rejected on a 401 and asks for re-pairing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_token' }, 401))

    await expect(client(fetchImpl).listTools()).rejects.toThrow(NotPairedError)

    // The settings screen reads this to say "reconnect me" rather than
    // failing silently on every later call.
    expect((await tokens.read()).unauthorizedAt).not.toBeNull()
  })

  it('explains a 403 as a subscription or permission problem', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'forbidden' }, 403))

    await expect(client(fetchImpl).listTools()).rejects.toThrow(/abonnement|permissions/)
  })

  it('returns a tool refusal as a result the agent can react to', async () => {
    const fetchImpl = server({
      initialize: {},
      'tools/call': {
        isError: true,
        content: [{ type: 'text', text: 'Confirmation requise' }],
      },
    })

    const result = await client(fetchImpl).callTool('delete_task', { id: 't1' })

    expect(result.ok).toBe(false)
    expect(result.text).toBe('Confirmation requise')
  })

  it('turns a JSON-RPC error into a failed result rather than throwing', async () => {
    const fetchImpl = server({ initialize: {} })

    const result = await client(fetchImpl).callTool('unknown_tool', {})

    expect(result.ok).toBe(false)
    expect(result.text).toContain('inconnu')
  })

  it('does not cache a failed handshake', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockImplementation(server({ initialize: {}, 'tools/list': { tools: [] } }))
    const mcp = client(fetchImpl)

    await expect(mcp.listTools()).rejects.toThrow()
    // A transient failure must not leave the client permanently broken.
    await expect(mcp.listTools()).resolves.toEqual([])
  })

  it('identifies the paired account', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ user: { id: 'u1', email: 'erwan@flots.app' }, scopes: ['tasks:read'] }),
      )

    const identity = await client(fetchImpl).me()

    expect(identity.user.email).toBe('erwan@flots.app')
    expect(identity.scopes).toEqual(['tasks:read'])
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/mcp/me`)
  })
})
