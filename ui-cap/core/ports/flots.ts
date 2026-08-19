/**
 * Port to the user's Flots account.
 *
 * Access goes exclusively through the MCP server with an OAuth token scoped to
 * what the robot needs, so the credential on the device cannot do more than
 * the tools it was granted.
 */

import type {
  ConnectionTest,
  McpTool,
  McpToolResult,
  PairingInfo,
} from '../domain/flots'

export interface FlotsPort {
  /** Current pairing state, without calling Flots. */
  pairing(): Promise<PairingInfo>

  /** Tools the granted scopes allow, cached briefly. */
  listTools(): Promise<McpTool[]>

  /** Invoke one tool by name. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>

  /** Round-trip check used by the settings screen. */
  test(): Promise<ConnectionTest>
}

/** Raised when Flots refuses the stored token; the robot needs re-pairing. */
export class NotPairedError extends Error {
  constructor(message = 'le robot n’est pas appairé à Flots') {
    super(message)
    this.name = 'NotPairedError'
  }
}
