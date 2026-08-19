/** Aggregated health of everything the interface depends on. */

import { getContainer } from '../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const { capd, config } = getContainer()
  const hardware = await capd.health()

  return Response.json({
    hardware,
    flots: { baseUrl: config.flotsBaseUrl },
    locale: config.locale,
    timezone: config.timezone,
  })
}
