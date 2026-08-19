/**
 * Server-side configuration, read from the environment once per process.
 *
 * Defaults are chosen so `pnpm dev` works with nothing set: the daemon on its
 * usual local port, state under `.data/`, and Flots pointing at staging.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface AppConfig {
  /** Base URL of the hardware daemon. */
  capdUrl: string
  /** Directory holding alarms, caches and the Flots token. */
  dataDir: string
  /** Base URL of the Flots API exposing the MCP server. */
  flotsBaseUrl: string
  /** Public origin of this interface, used as the OAuth redirect target. */
  publicUrl: string
  /** Interface language, used for spoken and written copy. */
  locale: 'fr' | 'en'
  /** IANA timezone used for the clock, the day view and alarms. */
  timezone: string
  /** Local time Cap reads the day out loud, `HH:MM`. */
  briefingTime: string
}

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback
}

export function loadConfig(): AppConfig {
  const defaultDataDir =
    process.env.NODE_ENV === 'production'
      ? join(homedir(), '.cap')
      : resolve(process.cwd(), '.data')

  return {
    capdUrl: env('CAPD_URL', 'http://127.0.0.1:8790'),
    dataDir: resolve(env('CAP_DATA_DIR', defaultDataDir)),
    flotsBaseUrl: env('FLOTS_MCP_BASE', 'https://api-staging.flots.app').replace(/\/$/, ''),
    publicUrl: env('CAP_PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),
    locale: env('CAP_LOCALE', 'fr') === 'en' ? 'en' : 'fr',
    timezone: env('CAP_TIMEZONE', 'Europe/Paris'),
    briefingTime: env('CAP_BRIEFING_TIME', '08:00'),
  }
}
