/** The user's day: the cached snapshot, and a way to refresh it. */

import { getContainer } from '../../../infrastructure/container'

export const dynamic = 'force-dynamic'

/** Read the snapshot without touching Flots. */
export async function GET(): Promise<Response> {
  const { day } = getContainer()
  const summary = await day.read()
  return Response.json({ ...summary, stale: day.isStale(summary) })
}

/** Force a refresh from Flots. */
export async function POST(): Promise<Response> {
  const { day } = getContainer()
  try {
    const summary = await day.sync()
    return Response.json({ ...summary, stale: false })
  } catch (error) {
    const cached = await day.read()
    return Response.json(
      {
        ...cached,
        stale: true,
        error: error instanceof Error ? error.message : 'synchronisation impossible',
      },
      { status: 503 },
    )
  }
}
