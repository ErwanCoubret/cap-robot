/**
 * Composition root of the server side.
 *
 * Route handlers call {@link getContainer} and receive the same wired object
 * every time. It is cached on `globalThis` rather than in a module variable
 * because the dev server re-evaluates modules on every edit, and a second
 * daemon socket or a second alarm ticker per hot reload would be a real bug.
 */

import { loadConfig, type AppConfig } from './config'
import { CapdClient } from './capd/capdClient'
import { EventBus } from './events/eventBus'

export interface AppContainer {
  config: AppConfig
  events: EventBus
  capd: CapdClient
}

const CONTAINER_KEY = Symbol.for('cap.container')

type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_KEY]?: AppContainer
}

function build(): AppContainer {
  const config = loadConfig()
  const events = new EventBus()
  const capd = new CapdClient({ baseUrl: config.capdUrl, events })

  console.info(
    `cap-ui starting capd=${config.capdUrl} flots=${config.flotsBaseUrl} data=${config.dataDir}`,
  )

  return { config, events, capd }
}

/** Return the process-wide container, building it on first use. */
export function getContainer(): AppContainer {
  const scope = globalThis as GlobalWithContainer
  if (!scope[CONTAINER_KEY]) {
    scope[CONTAINER_KEY] = build()
  }
  return scope[CONTAINER_KEY]
}
