/**
 * One turn of conversation with Cap.
 *
 * The model may call tools, see their results, and call more, until it has an
 * answer. Each step is published so the screen can narrate what is happening —
 * on a robot, silence for four seconds reads as a crash.
 */

import type { AgentEvent, AppEvent } from '../../domain/events'
import type { ChatMessage, LlmPort } from '../../ports/ai'
import { buildSystemPrompt, describeToolCall } from './prompts'
import type { ToolRegistry } from './toolRegistry'

/**
 * Ceiling on tool round-trips.
 *
 * Reached only when the model is going in circles; the user gets whatever it
 * managed to say rather than an endless "thinking".
 */
export const MAX_ITERATIONS = 6

/** Spoken answers are short, so the budget can be small and the wait shorter. */
const MAX_TOKENS = 400

export interface AgentTurnDeps {
  llm: LlmPort
  tools: ToolRegistry
  publish: (event: AppEvent) => void
  now: () => Date
  locale: string
  timezone: string
  /** Account name shown in the prompt, when paired. */
  user?: () => string | null | Promise<string | null>
  /** Missing hardware, mentioned so Cap does not offer what it cannot do. */
  missing?: () => string[]
}

export interface AgentTurnResult {
  turnId: string
  text: string
  toolsUsed: string[]
  iterations: number
}

/** Answer ``input``, using tools as needed. */
export async function runAgentTurn(
  input: string,
  deps: AgentTurnDeps,
  turnId = `turn_${Date.now().toString(36)}`,
): Promise<AgentTurnResult> {
  const publish = (event: Omit<AgentEvent, 'type' | 'turnId'>) =>
    deps.publish({ type: 'agent', turnId, ...event })

  publish({ state: 'started', text: input })

  const { tools, flotsAvailable } = await deps.tools.definitions()
  const user = (await deps.user?.()) ?? null
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt({
        now: formatNow(deps),
        user,
        flotsAvailable,
        missing: deps.missing?.(),
      }),
    },
    { role: 'user', content: input },
  ]

  const toolsUsed: string[] = []
  let iterations = 0

  try {
    for (iterations = 1; iterations <= MAX_ITERATIONS; iterations += 1) {
      const reply = await deps.llm.complete({ messages, tools, maxTokens: MAX_TOKENS })

      if (reply.toolCalls.length === 0) {
        const text = reply.text || fallbackText(toolsUsed)
        publish({ state: 'finished', text })
        return { turnId, text, toolsUsed, iterations }
      }

      messages.push({
        role: 'assistant',
        content: reply.text,
        toolCalls: reply.toolCalls,
      })

      for (const call of reply.toolCalls) {
        toolsUsed.push(call.name)
        publish({ state: 'tool', tool: call.name, label: describeToolCall(call.name) })

        const outcome = await deps.tools.run(call.name, call.arguments)
        publish({
          state: 'tool_result',
          tool: call.name,
          ok: outcome.ok,
          label: outcome.text.slice(0, 200),
        })

        // The model sees the same sentence the user does, plus the structured
        // payload when there is one.
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({
            ok: outcome.ok,
            summary: outcome.text,
            data: outcome.data ?? null,
          }),
        })
      }
    }

    // Out of iterations: say something rather than leaving the user waiting.
    const text = 'Je n’ai pas réussi à aller au bout de cette demande.'
    publish({ state: 'finished', text })
    return { turnId, text, toolsUsed, iterations: MAX_ITERATIONS }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish({ state: 'error', error: message })
    throw error
  }
}

function formatNow(deps: AgentTurnDeps): string {
  return new Intl.DateTimeFormat(deps.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: deps.timezone,
  }).format(deps.now())
}

/**
 * What to say when the model answers with nothing.
 *
 * Small models sometimes stop after a successful tool call without adding a
 * sentence; confirming the action is better than silence.
 */
function fallbackText(toolsUsed: string[]): string {
  return toolsUsed.length > 0 ? 'C’est fait.' : 'Je n’ai pas de réponse à donner.'
}
