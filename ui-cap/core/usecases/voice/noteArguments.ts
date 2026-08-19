/**
 * Building the arguments for the Flots `create_note` tool.
 *
 * The robot discovers its tools at runtime rather than hardcoding a contract,
 * so the property names are read from the advertised JSON schema. A server
 * that renames `content` to `body` keeps working; only a schema with no
 * recognisable field falls back to the conventional names.
 */

import type { McpTool } from '../../domain/flots'

/** Candidate property names, most likely first. */
const TITLE_KEYS = ['title', 'name', 'subject']
const CONTENT_KEYS = ['content', 'body', 'text', 'description']

export interface NoteInput {
  title: string
  content: string
}

function propertiesOf(tool: McpTool | undefined): Record<string, unknown> {
  const properties = tool?.inputSchema?.properties
  return typeof properties === 'object' && properties !== null
    ? (properties as Record<string, unknown>)
    : {}
}

function pick(properties: Record<string, unknown>, candidates: string[]): string | null {
  return candidates.find((key) => key in properties) ?? null
}

/**
 * Map a note onto the tool's own parameter names.
 *
 * Required properties the robot has no value for are left out entirely rather
 * than filled with a placeholder: an empty string in a required field reads as
 * deliberate data, and the server's own error is more useful than an invented
 * value.
 */
export function buildNoteArguments(
  tool: McpTool | undefined,
  note: NoteInput,
): Record<string, unknown> {
  const properties = propertiesOf(tool)

  if (Object.keys(properties).length === 0) {
    return { title: note.title, content: note.content }
  }

  const args: Record<string, unknown> = {}
  const titleKey = pick(properties, TITLE_KEYS)
  const contentKey = pick(properties, CONTENT_KEYS)

  if (titleKey) {
    args[titleKey] = note.title
  }
  if (contentKey) {
    args[contentKey] = note.content
  }

  // Nothing recognisable: send the conventional shape and let the server say
  // what it actually wanted.
  if (Object.keys(args).length === 0) {
    return { title: note.title, content: note.content }
  }

  // A note with nowhere to put its body would silently lose the recording.
  if (!contentKey && titleKey) {
    args[titleKey] = note.content
  }

  return args
}

/** Title for a dictated note, e.g. "Note vocale du 19 août à 15:40". */
export function voiceNoteTitle(now: Date, locale = 'fr', timeZone = 'Europe/Paris'): string {
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(now)
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(now)
  return `Note vocale du ${date} à ${time}`
}
