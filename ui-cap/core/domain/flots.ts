/**
 * The Flots side of the robot: what Cap can see and change in the user's
 * account, and the state of the connection that allows it.
 */

/** How the robot currently stands with Flots. */
export type PairingStatus = 'unpaired' | 'pending' | 'paired' | 'expired'

/** The account the robot is paired with. */
export interface PairedUser {
  id?: string
  email?: string
}

/** Connection state as shown on the settings screen. */
export interface PairingInfo {
  status: PairingStatus
  user: PairedUser | null
  scopes: string[]
  /** When the 30-day token stops working; there is no refresh grant. */
  expiresAt: string | null
  daysRemaining: number | null
  baseUrl: string
  error?: string
}

/** Result of the "test the connection" button. */
export interface ConnectionTest {
  ok: boolean
  user: PairedUser | null
  scopes: string[]
  toolCount: number
  latencyMs: number
  error?: string
}

/** A tool advertised by the Flots MCP server. */
export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
}

/** Outcome of a tool call. */
export interface McpToolResult {
  ok: boolean
  /** Parsed structured payload when the server provided one. */
  data: unknown
  /** Human-readable summary, suitable for speaking aloud. */
  text: string
}

/** A task as the robot displays it. */
export interface Task {
  id: string
  title: string
  startDate?: string | null
  endDate?: string | null
  completed?: boolean
  categoryName?: string | null
}

/** The cached snapshot of the user's day. */
export interface DaySummary {
  /** ISO date the snapshot describes. */
  date: string
  /** When it was fetched, so staleness can be shown. */
  syncedAt: string | null
  tasks: Task[]
  overdue: Task[]
}
