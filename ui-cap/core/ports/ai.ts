/**
 * Ports to the language and speech models.
 *
 * Cap runs its models locally by default and can fall back to hosted ones, so
 * use cases never learn which is in play — only that they can ask a question
 * or transcribe a recording.
 */

/** One turn of the conversation sent to the model. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool calls the assistant asked for, when replaying its own turn. */
  toolCalls?: ToolCall[]
  /** Identifies which call a tool result answers. */
  toolCallId?: string
  name?: string
}

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** A tool the model may call, in JSON-schema form. */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** What the model answered. */
export interface LlmReply {
  text: string
  toolCalls: ToolCall[]
  /** Token usage when the provider reports it. */
  usage?: { promptTokens?: number; completionTokens?: number }
}

export interface LlmRequest {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
}

export interface LlmPort {
  /** Provider and model, for the settings screen and the boot log. */
  readonly label: string
  readonly available: boolean
  complete(request: LlmRequest): Promise<LlmReply>
}

export interface Transcript {
  text: string
  /** Provider and model that produced it. */
  label: string
}

export interface SttPort {
  readonly label: string
  readonly available: boolean
  transcribe(audio: ArrayBuffer, options?: { language?: string }): Promise<Transcript>
}

/** Raised when a provider is configured but cannot be used. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailableError'
  }
}
