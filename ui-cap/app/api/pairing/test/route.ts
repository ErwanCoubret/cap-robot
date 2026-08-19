/** Round-trip check of the Flots connection. */

import { getContainer } from '../../../../infrastructure/container'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  const { flots } = getContainer()
  return Response.json(await flots.test())
}
