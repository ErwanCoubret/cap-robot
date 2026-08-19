/**
 * Language model access over the OpenAI API.
 *
 * The same client talks to the local Ollama box and to hosted providers. Its
 * built-in retries are disabled in favour of the explicit policy in
 * {@link withRetry}, and every response shape is read defensively: small local
 * models are noticeably less disciplined than hosted ones about tool-call
 * formatting.
 */

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import type {
  ChatMessage,
  LlmPort,
  LlmReply,
  LlmRequest,
  ToolCall,
} from '../../core/ports/ai'
import { AiUnavailableError } from '../../core/ports/ai'
import { describeProvider, isUsable, type ProviderDescriptor } from './providers'
import { withRetry } from './retry'

/** Model calls hang the whole conversation, so they get a hard ceiling. */
const REQUEST_TIMEOUT_MS = 120_000

const DEFAULT_MAX_TOKENS = 600
const DEFAULT_TEMPERATURE = 0.2

export class LlmAdapter implements LlmPort {
  private readonly client: OpenAI

  constructor(private readonly provider: ProviderDescriptor) {
    this.client = new OpenAI({
      baseURL: provider.baseUrl,
      // Ollama wants a token and ignores its value; using a placeholder keeps
      // construction from throwing when no credential is configured.
      apiKey: provider.credential ?? 'missing',
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
    })
  }

  get label(): string {
    return `${this.provider.label} · ${this.provider.model}`
  }

  get available(): boolean {
    return isUsable(this.provider)
  }

  /** One-line description for the boot log. */
  describe(): string {
    return describeProvider(this.provider)
  }

  async complete(request: LlmRequest): Promise<LlmReply> {
    if (!this.available) {
      throw new AiUnavailableError(
        `${this.provider.label} n’est pas configuré (${this.provider.credentialVariable} manquant)`,
      )
    }

    const completion = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.provider.model,
          messages: request.messages.map(toWireMessage),
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function' as const,
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
                tool_choice: 'auto' as const,
              }
            : {}),
        }),
      {
        onRetry: ({ attempt, delayMs, error }) => {
          console.warn(
            `llm retry provider=${this.provider.name} attempt=${attempt} delay=${Math.round(delayMs)}ms reason=${describeError(error)}`,
          )
        },
      },
    )

    return readReply(completion)
  }
}

function toWireMessage(message: ChatMessage): ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId ?? '',
    }
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }
  }

  if (message.role === 'system') {
    return { role: 'system', content: message.content }
  }
  if (message.role === 'assistant') {
    return { role: 'assistant', content: message.content }
  }
  return { role: 'user', content: message.content }
}

/** Read a completion, tolerating the shapes small models actually produce. */
export function readReply(completion: unknown): LlmReply {
  const choice = (completion as { choices?: unknown[] })?.choices?.[0] as
    | { message?: Record<string, unknown> }
    | undefined
  const message = choice?.message ?? {}

  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const toolCalls: ToolCall[] = rawCalls.flatMap((entry, index) => {
    const call = entry as {
      id?: string
      function?: { name?: string; arguments?: unknown }
    }
    const name = call.function?.name
    if (typeof name !== 'string') {
      return []
    }
    return [
      {
        id: typeof call.id === 'string' ? call.id : `call_${index}`,
        name,
        arguments: parseArguments(call.function?.arguments),
      },
    ]
  })

  const usage = (completion as { usage?: Record<string, number> })?.usage

  return {
    text: readContent(message.content),
    toolCalls,
    usage: usage
      ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
      : undefined,
  }
}

function readContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }
  // Some providers answer with content parts rather than a plain string.
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const piece = part as { text?: unknown; type?: unknown }
        return typeof piece.text === 'string' ? piece.text : ''
      })
      .join('')
      .trim()
  }
  return ''
}

/**
 * Parse tool-call arguments.
 *
 * Local models sometimes wrap the JSON in a fenced code block or send an
 * object outright; both are accepted rather than failing the turn.
 */
export function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {}
  }

  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    const parsed = JSON.parse(stripped)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    console.warn('unparsable tool arguments, treating as empty', stripped.slice(0, 200))
    return {}
  }
}

function describeError(error: unknown): string {
  const candidate = error as { status?: number; name?: string; message?: string }
  return candidate?.status
    ? `HTTP ${candidate.status}`
    : (candidate?.name ?? candidate?.message ?? 'unknown')
}
