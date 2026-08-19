import { describe, expect, it } from 'vitest'

import {
  McpRpcError,
  parseToolResult,
  parseTools,
  unwrapRpc,
} from '../infrastructure/mcp/mcpParsing'

describe('unwrapRpc', () => {
  it('returns the result of a successful reply', () => {
    expect(unwrapRpc({ jsonrpc: '2.0', id: 1, result: { tools: [] } })).toEqual({ tools: [] })
  })

  it('throws with the server message on an error reply', () => {
    expect(() =>
      unwrapRpc({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'outil inconnu' } }),
    ).toThrow(McpRpcError)
  })
})

describe('parseTools', () => {
  it('reads the advertised tools', () => {
    const tools = parseTools({
      tools: [
        {
          name: 'create_task',
          title: 'Create task',
          description: 'Create a new one-off task',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
        },
      ],
    })

    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('create_task')
    expect(tools[0].inputSchema).toMatchObject({ type: 'object' })
  })

  it('skips malformed entries and empty payloads', () => {
    expect(parseTools({ tools: [{ description: 'nameless' }] })).toEqual([])
    expect(parseTools({})).toEqual([])
  })

  it('substitutes an empty schema when the server omits one', () => {
    expect(parseTools({ tools: [{ name: 'list_tasks' }] })[0].inputSchema).toEqual({
      type: 'object',
      properties: {},
    })
  })
})

describe('parseToolResult', () => {
  it('prefers structuredContent', () => {
    const result = parseToolResult({
      content: [
        { type: 'text', text: 'Tâche créée : Acheter du pain' },
        { type: 'text', text: '{"id":"task_1","title":"Acheter du pain"}' },
      ],
      structuredContent: { id: 'task_1', title: 'Acheter du pain' },
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: 'task_1', title: 'Acheter du pain' })
    // The summary is the human sentence, which is what gets spoken aloud.
    expect(result.text).toBe('Tâche créée : Acheter du pain')
  })

  it('falls back to the JSON carried in the text parts', () => {
    const result = parseToolResult({
      content: [
        { type: 'text', text: 'Voici tes tâches' },
        { type: 'text', text: '{"tasks":[{"id":"t1"}]}' },
      ],
    })

    expect(result.data).toEqual({ tasks: [{ id: 't1' }] })
    expect(result.text).toBe('Voici tes tâches')
  })

  it('handles a text-only result', () => {
    const result = parseToolResult({ content: [{ type: 'text', text: 'Rien à afficher' }] })

    expect(result.data).toBeNull()
    expect(result.text).toBe('Rien à afficher')
  })

  it('reports a tool-level refusal as a result, not an exception', () => {
    // A refusal still answers HTTP 200; the agent has to see it and react.
    const result = parseToolResult({
      isError: true,
      content: [{ type: 'text', text: 'Confirmation requise avant suppression' }],
    })

    expect(result.ok).toBe(false)
    expect(result.text).toContain('Confirmation requise')
  })

  it('survives an empty or missing payload', () => {
    expect(parseToolResult({})).toEqual({ ok: true, data: null, text: '' })
    expect(parseToolResult(null)).toEqual({ ok: true, data: null, text: '' })
  })
})
