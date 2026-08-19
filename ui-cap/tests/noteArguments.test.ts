import { describe, expect, it } from 'vitest'

import type { McpTool } from '../core/domain/flots'
import { buildNoteArguments, voiceNoteTitle } from '../core/usecases/voice/noteArguments'

function tool(properties: Record<string, unknown>): McpTool {
  return {
    name: 'create_note',
    inputSchema: { type: 'object', properties },
  }
}

const NOTE = { title: 'Note vocale', content: 'Acheter du pain' }

describe('buildNoteArguments', () => {
  it('uses the property names the tool advertises', () => {
    const args = buildNoteArguments(
      tool({ title: { type: 'string' }, content: { type: 'string' } }),
      NOTE,
    )

    expect(args).toEqual({ title: 'Note vocale', content: 'Acheter du pain' })
  })

  it('follows a renamed body field', () => {
    // The robot discovers its tools at runtime; a server that calls the field
    // "body" must keep working without a client release.
    const args = buildNoteArguments(
      tool({ title: { type: 'string' }, body: { type: 'string' } }),
      NOTE,
    )

    expect(args).toEqual({ title: 'Note vocale', body: 'Acheter du pain' })
  })

  it('falls back to the conventional shape when the schema is empty', () => {
    expect(buildNoteArguments(tool({}), NOTE)).toEqual(NOTE)
    expect(buildNoteArguments(undefined, NOTE)).toEqual(NOTE)
  })

  it('falls back when nothing in the schema is recognisable', () => {
    expect(buildNoteArguments(tool({ payload: { type: 'string' } }), NOTE)).toEqual(NOTE)
  })

  it('never drops the dictation when there is nowhere to put a body', () => {
    // Losing what the user just said would be the worst possible outcome, so
    // the transcript takes the only field available.
    const args = buildNoteArguments(tool({ title: { type: 'string' } }), NOTE)

    expect(args).toEqual({ title: 'Acheter du pain' })
  })

  it('omits fields it has no value for rather than inventing one', () => {
    const args = buildNoteArguments(
      tool({ content: { type: 'string' }, folderId: { type: 'string' } }),
      NOTE,
    )

    expect(args).toEqual({ content: 'Acheter du pain' })
    expect(args).not.toHaveProperty('folderId')
  })
})

describe('voiceNoteTitle', () => {
  it('names the note after when it was dictated', () => {
    const title = voiceNoteTitle(new Date('2026-08-19T13:40:00Z'), 'fr', 'Europe/Paris')

    expect(title).toBe('Note vocale du 19 août à 15:40')
  })
})
