/**
 * Everything the agent is allowed to do, in one place.
 *
 * The robot's own tools are fixed; the Flots ones are discovered at runtime
 * from the granted scopes, so an unpaired robot simply offers fewer verbs
 * instead of failing on every call.
 */

import type { ToolDefinition } from '../../ports/ai'
import type { FlotsPort } from '../../ports/flots'
import { LOCAL_TOOLS, type LocalToolDeps, type ToolOutcome } from './localTools'

/** Names the model must never be offered, whatever Flots advertises. */
const BLOCKED_TOOLS = new Set([
  // Deletion is out of the robot's remit: it holds no delete scope, and a
  // misheard sentence should never be able to destroy someone's work.
  'delete_task',
  'delete_note',
  'delete_project',
  'confirm_action',
])

export interface ToolRegistryDeps extends LocalToolDeps {
  flots: FlotsPort
}

export class ToolRegistry {
  constructor(private readonly deps: ToolRegistryDeps) {}

  /**
   * Tool definitions to offer the model.
   *
   * Flots being unreachable is not fatal: the robot keeps its own tools and
   * the caller decides what to tell the user.
   */
  async definitions(): Promise<{ tools: ToolDefinition[]; flotsAvailable: boolean }> {
    const local = LOCAL_TOOLS.map((tool) => tool.definition)

    try {
      const remote = await this.deps.flots.listTools()
      const usable = remote
        .filter((tool) => !BLOCKED_TOOLS.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.title ?? tool.name,
          parameters: tool.inputSchema,
        }))
      return { tools: [...local, ...usable], flotsAvailable: true }
    } catch {
      return { tools: local, flotsAvailable: false }
    }
  }

  /** Run one tool by name, whether it is local or lives in Flots. */
  async run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const local = LOCAL_TOOLS.find((tool) => tool.definition.name === name)
    if (local) {
      try {
        return await local.run(args, this.deps)
      } catch (error) {
        return {
          ok: false,
          text: error instanceof Error ? error.message : 'outil en erreur',
        }
      }
    }

    if (BLOCKED_TOOLS.has(name)) {
      return { ok: false, text: `l’outil ${name} n’est pas autorisé sur le robot` }
    }

    try {
      const result = await this.deps.flots.callTool(name, args)
      return { ok: result.ok, text: result.text, data: result.data }
    } catch (error) {
      return {
        ok: false,
        text: error instanceof Error ? error.message : 'appel Flots en erreur',
      }
    }
  }
}
