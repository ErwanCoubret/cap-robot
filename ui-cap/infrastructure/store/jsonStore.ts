/**
 * A single JSON document on disk, written atomically and updated under a lock.
 *
 * The robot is unplugged casually, so a half-written file is a realistic
 * failure: every write goes to a temporary file and is renamed into place,
 * which the filesystem guarantees is all-or-nothing.
 */

import { constants } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { StorePort } from '../../core/ports/store'

export interface JsonStoreOptions {
  /** File mode, e.g. 0o600 for anything holding a credential. */
  mode?: number
}

export class JsonStore<T> implements StorePort<T> {
  /** Serialises update() calls so concurrent requests cannot clobber. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly defaults: T,
    private readonly options: JsonStoreOptions = {},
  ) {}

  async read(): Promise<T> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as T
      // Missing keys fall back to the defaults so a document written by an
      // older version keeps working after an upgrade.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(this.defaults as object), ...(parsed as object) } as T
      }
      return parsed
    } catch (error) {
      if (isMissing(error)) {
        return structuredClone(this.defaults)
      }
      console.warn(`unreadable store at ${this.path}, using defaults`, error)
      return structuredClone(this.defaults)
    }
  }

  async write(value: T): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    if (this.options.mode !== undefined) {
      await chmod(temporary, this.options.mode)
    }
    await rename(temporary, this.path)
    return value
  }

  async update(mutate: (current: T) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const current = await this.read()
      return this.write(await mutate(current))
    })
    // Keep the chain alive even when this update rejects, otherwise one
    // failure would deadlock every later write.
    this.queue = run.catch(() => undefined)
    return run
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

/** Mode for documents holding credentials: readable by the robot user only. */
export const PRIVATE_FILE_MODE = constants.S_IRUSR | constants.S_IWUSR
