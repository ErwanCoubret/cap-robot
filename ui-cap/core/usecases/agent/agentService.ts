/**
 * The agent as the rest of the system sees it.
 *
 * Wraps a turn with the things that belong to the robot rather than to the
 * conversation: only one turn at a time (there is one voice), and the answer
 * is spoken as well as displayed.
 */

import type { AppEvent } from '../../domain/events'
import type { HardwarePort } from '../../ports/hardware'
import { runAgentTurn, type AgentTurnDeps, type AgentTurnResult } from './runAgentTurn'

export interface AgentServiceDeps extends AgentTurnDeps {
  hardware: HardwarePort
}

export class AgentService {
  private running: Promise<AgentTurnResult> | null = null

  constructor(private readonly deps: AgentServiceDeps) {}

  get busy(): boolean {
    return this.running !== null
  }

  /**
   * Answer ``input`` and speak the reply.
   *
   * ``speak`` is turned off when the caller already speaks the result itself,
   * as the voice pipeline does.
   */
  async ask(input: string, options: { speak?: boolean; turnId?: string } = {}): Promise<string> {
    if (this.running) {
      throw new Error('Cap est déjà en train de répondre')
    }

    const turn = runAgentTurn(input, this.deps, options.turnId)
    this.running = turn

    try {
      const result = await turn
      if (options.speak !== false && result.text) {
        await this.deps.hardware.speak(result.text, { interrupt: true }).catch(() => undefined)
      }
      return result.text
    } finally {
      this.running = null
    }
  }

  /** Publish an event on the agent's behalf, used by the notification tool. */
  publish(event: AppEvent): void {
    this.deps.publish(event)
  }
}
