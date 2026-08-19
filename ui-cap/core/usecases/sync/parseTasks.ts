/**
 * Reading tasks out of whatever `list_tasks` returned.
 *
 * The robot discovers its tools at runtime and never sees their source, so the
 * payload is treated as untrusted shape: any recognisable date field is
 * accepted, anything unreadable is skipped rather than shown as a task with
 * missing pieces.
 */

import type { Task } from '../../domain/flots'

type Raw = Record<string, unknown>

/** Fields that have meant "when is this due" in one payload or another. */
const DATE_KEYS = ['endDate', 'dueDate', 'due_date', 'date', 'startDate', 'start_date']

const TITLE_KEYS = ['title', 'name', 'label']

function asRecord(value: unknown): Raw | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : null
}

function firstString(source: Raw, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return null
}

function toRecords(values: unknown[]): Raw[] {
  const records: Raw[] = []
  for (const value of values) {
    const record = asRecord(value)
    if (record) {
      records.push(record)
    }
  }
  return records
}

/** Find the task array wherever the payload put it. */
export function extractTaskList(data: unknown): Raw[] {
  if (Array.isArray(data)) {
    return toRecords(data)
  }

  const record = asRecord(data)
  if (!record) {
    return []
  }

  for (const key of ['tasks', 'items', 'results', 'data']) {
    const candidate = record[key]
    if (Array.isArray(candidate)) {
      return toRecords(candidate)
    }
  }
  return []
}

/** Normalise a payload into the tasks the robot displays. */
export function parseTasks(data: unknown): Task[] {
  return extractTaskList(data).flatMap((raw) => {
    const title = firstString(raw, TITLE_KEYS)
    if (!title) {
      // A task with no title has nothing to show and nothing to say aloud.
      return []
    }

    const id = firstString(raw, ['id', 'uuid', 'taskId']) ?? title
    const due = firstString(raw, DATE_KEYS)
    const category = asRecord(raw.category)

    return [
      {
        id,
        title,
        startDate: firstString(raw, ['startDate', 'start_date']),
        endDate: due,
        completed:
          raw.completed === true ||
          raw.isCompleted === true ||
          raw.status === 'completed' ||
          raw.status === 'done',
        categoryName:
          (category ? firstString(category, ['name', 'title']) : null) ??
          firstString(raw, ['categoryName', 'category_name']),
      },
    ]
  })
}

/** Local calendar day of an ISO timestamp, as `YYYY-MM-DD`. */
export function localDay(iso: string, timeZone: string): string | null {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) {
    return null
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(parsed))
}

export interface SplitTasks {
  today: Task[]
  overdue: Task[]
}

/**
 * Split tasks into today's and the ones already late.
 *
 * A task with no date at all is left out: the day view is about what is
 * happening today, and an undated backlog would bury it.
 */
export function splitByDay(tasks: Task[], now: Date, timeZone: string): SplitTasks {
  const today = localDay(now.toISOString(), timeZone)
  const result: SplitTasks = { today: [], overdue: [] }

  for (const task of tasks) {
    if (task.completed) {
      continue
    }
    const due = task.endDate ? localDay(task.endDate, timeZone) : null
    if (!due || !today) {
      continue
    }
    if (due === today) {
      result.today.push(task)
    } else if (due < today) {
      result.overdue.push(task)
    }
  }

  // Earliest first, so the next thing to do is at the top.
  const byTime = (left: Task, right: Task) =>
    (left.endDate ?? '').localeCompare(right.endDate ?? '')
  result.today.sort(byTime)
  result.overdue.sort(byTime)
  return result
}
