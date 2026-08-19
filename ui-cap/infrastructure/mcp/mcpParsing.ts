/**
 * Reading what the Flots MCP server sends back.
 *
 * Tool results arrive twice over: a human-readable summary and a JSON string
 * in `content`, plus the same payload in `structuredContent`. Both shapes are
 * accepted here, preferring the structured one, so a client keeps working if
 * either is dropped.
 */

import type { McpTool, McpToolResult } from '../../core/domain/flots'

type Raw = Record<string, unknown>

/** A JSON-RPC error returned by the server. */
export class McpRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'McpRpcError'
  }
}

/** Extract the `result` of a JSON-RPC response, throwing on an error reply. */
export function unwrapRpc(payload: unknown): unknown {
  const raw = (payload ?? {}) as Raw
  if (raw.error) {
    const error = raw.error as Raw
    throw new McpRpcError(
      typeof error.message === 'string' ? error.message : 'appel MCP en erreur',
      typeof error.code === 'number' ? error.code : -1,
    )
  }
  return raw.result
}

/** Read a `tools/list` result. */
export function parseTools(result: unknown): McpTool[] {
  const raw = (result ?? {}) as Raw
  if (!Array.isArray(raw.tools)) {
    return []
  }
  return raw.tools.flatMap((entry) => {
    const tool = entry as Raw
    if (typeof tool.name !== 'string') {
      return []
    }
    return [
      {
        name: tool.name,
        title: typeof tool.title === 'string' ? tool.title : undefined,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema:
          typeof tool.inputSchema === 'object' && tool.inputSchema !== null
            ? (tool.inputSchema as Record<string, unknown>)
            : { type: 'object', properties: {} },
      },
    ]
  })
}

/**
 * Read a `tools/call` result.
 *
 * `isError` is part of the payload rather than the transport: a tool that
 * refuses still answers HTTP 200, and the agent needs to see the refusal as a
 * result it can react to, not as an exception.
 */
export function parseToolResult(result: unknown): McpToolResult {
  const raw = (result ?? {}) as Raw
  const content = Array.isArray(raw.content) ? raw.content : []

  const texts = content.flatMap((item) => {
    const part = item as Raw
    return part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
  })

  let data: unknown = raw.structuredContent ?? null
  if (data === null) {
    // Fall back to the JSON copy carried in the text parts.
    for (const text of texts) {
      try {
        data = JSON.parse(text)
        break
      } catch {
        // Not the JSON part; keep looking.
      }
    }
  }

  const summary = texts.find((text) => !isJson(text)) ?? texts[0] ?? ''

  return {
    ok: raw.isError !== true,
    data,
    text: summary,
  }
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
