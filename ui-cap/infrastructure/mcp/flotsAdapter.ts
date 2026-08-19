/**
 * The {@link FlotsPort} implementation backed by the MCP server.
 *
 * Use cases depend on this port rather than on MCP itself, so the agent can be
 * tested against a fake account with no network and no pairing.
 */

import type {
  ConnectionTest,
  McpTool,
  McpToolResult,
  PairingInfo,
} from '../../core/domain/flots'
import type { FlotsPort } from '../../core/ports/flots'
import type { McpClient } from './mcpClient'
import type { PairingService } from './pairingService'

export class FlotsAdapter implements FlotsPort {
  constructor(
    private readonly mcp: McpClient,
    private readonly pairingService: PairingService,
  ) {}

  pairing(): Promise<PairingInfo> {
    return this.pairingService.status()
  }

  listTools(): Promise<McpTool[]> {
    return this.mcp.listTools()
  }

  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return this.mcp.callTool(name, args)
  }

  test(): Promise<ConnectionTest> {
    return this.pairingService.test()
  }
}
