/**
 * Composition root of the server side.
 *
 * Route handlers call {@link getContainer} and receive the same wired object
 * every time. It is cached on `globalThis` rather than in a module variable
 * because the dev server re-evaluates modules on every edit, and a second
 * daemon socket or a second alarm ticker per hot reload would be a real bug.
 */

import { CapdClient } from './capd/capdClient'
import { loadConfig, type AppConfig } from './config'
import { EventBus } from './events/eventBus'
import { FlotsAdapter } from './mcp/flotsAdapter'
import { McpClient } from './mcp/mcpClient'
import { PairingService } from './mcp/pairingService'
import { TokenStore } from './mcp/tokenStore'

export interface AppContainer {
  config: AppConfig
  events: EventBus
  capd: CapdClient
  tokens: TokenStore
  mcp: McpClient
  pairing: PairingService
  flots: FlotsAdapter
}

const CONTAINER_KEY = Symbol.for('cap.container')

type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_KEY]?: AppContainer
}

function build(): AppContainer {
  const config = loadConfig()
  const events = new EventBus()
  const capd = new CapdClient({ baseUrl: config.capdUrl, events })

  const tokens = new TokenStore(config.dataDir)
  const mcp = new McpClient({ baseUrl: config.flotsBaseUrl, tokens })
  const pairing = new PairingService({
    baseUrl: config.flotsBaseUrl,
    publicUrl: config.publicUrl,
    tokens,
    mcp,
  })
  const flots = new FlotsAdapter(mcp, pairing)

  console.info(
    `cap-ui starting capd=${config.capdUrl} flots=${config.flotsBaseUrl} data=${config.dataDir}`,
  )

  return { config, events, capd, tokens, mcp, pairing, flots }
}

/** Return the process-wide container, building it on first use. */
export function getContainer(): AppContainer {
  const scope = globalThis as GlobalWithContainer
  if (!scope[CONTAINER_KEY]) {
    scope[CONTAINER_KEY] = build()
  }
  return scope[CONTAINER_KEY]
}
