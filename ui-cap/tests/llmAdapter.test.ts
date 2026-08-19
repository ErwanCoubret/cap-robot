import { describe, expect, it } from 'vitest'

import { parseArguments, readReply } from '../infrastructure/ai/llmAdapter'
import { readTranscript } from '../infrastructure/ai/sttAdapter'

describe('readReply', () => {
  it('reads a plain answer', () => {
    const reply = readReply({
      choices: [{ message: { role: 'assistant', content: 'Il est huit heures.' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    })

    expect(reply.text).toBe('Il est huit heures.')
    expect(reply.toolCalls).toEqual([])
    expect(reply.usage).toEqual({ promptTokens: 12, completionTokens: 5 })
  })

  it('reads tool calls with their arguments', () => {
    const reply = readReply({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'create_task',
                  arguments: '{"title":"Acheter du pain"}',
                },
              },
            ],
          },
        },
      ],
    })

    expect(reply.toolCalls).toEqual([
      { id: 'call_1', name: 'create_task', arguments: { title: 'Acheter du pain' } },
    ])
  })

  it('reads content sent as parts rather than a string', () => {
    const reply = readReply({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'Bonjour' },
              { type: 'text', text: ' Cap' },
            ],
          },
        },
      ],
    })

    expect(reply.text).toBe('Bonjour Cap')
  })

  it('substitutes an id when the model omits one', () => {
    const reply = readReply({
      choices: [
        {
          message: {
            tool_calls: [{ function: { name: 'get_current_datetime', arguments: '{}' } }],
          },
        },
      ],
    })

    expect(reply.toolCalls[0].id).toBe('call_0')
  })

  it('skips a tool call with no name instead of failing the turn', () => {
    const reply = readReply({
      choices: [{ message: { tool_calls: [{ id: 'x', function: { arguments: '{}' } }] } }],
    })

    expect(reply.toolCalls).toEqual([])
  })

  it('survives an empty or malformed completion', () => {
    expect(readReply({}).text).toBe('')
    expect(readReply(null).toolCalls).toEqual([])
  })
})

describe('parseArguments', () => {
  it('parses a JSON string', () => {
    expect(parseArguments('{"title":"Note"}')).toEqual({ title: 'Note' })
  })

  it('accepts an object sent as-is', () => {
    expect(parseArguments({ title: 'Note' })).toEqual({ title: 'Note' })
  })

  it('unwraps a fenced code block', () => {
    // Small local models do this often enough to be worth handling.
    expect(parseArguments('```json\n{"time":"08:00"}\n```')).toEqual({ time: '08:00' })
  })

  it('falls back to no arguments rather than throwing', () => {
    expect(parseArguments('not json at all')).toEqual({})
    expect(parseArguments('')).toEqual({})
    expect(parseArguments(undefined)).toEqual({})
    // An array is not a valid argument object.
    expect(parseArguments('[1,2]')).toEqual({})
  })
})

describe('readTranscript', () => {
  it('reads the documented object shape', () => {
    expect(readTranscript({ text: '  Bonjour Cap  ' })).toBe('Bonjour Cap')
  })

  it('reads a bare string', () => {
    expect(readTranscript('Bonjour Cap')).toBe('Bonjour Cap')
  })

  it('reads a JSON string', () => {
    expect(readTranscript('{"text":"Bonjour Cap"}')).toBe('Bonjour Cap')
  })

  it('returns nothing rather than failing on an unexpected shape', () => {
    expect(readTranscript({})).toBe('')
    expect(readTranscript(null)).toBe('')
  })
})
