/**
 * Port for durable state (alarms, the day cache, the Flots token).
 *
 * The robot keeps a handful of small documents, so the implementation is a
 * JSON file per store rather than a database — nothing here needs queries, and
 * a database is one more thing to break on an unplugged Pi.
 */
export interface StorePort<T> {
  /** Read the document, returning the defaults when it does not exist yet. */
  read(): Promise<T>

  /** Replace the document atomically. */
  write(value: T): Promise<T>

  /**
   * Read-modify-write under a lock.
   *
   * Concurrent callers are serialised, so two requests updating the same
   * document cannot lose each other's changes.
   */
  update(mutate: (current: T) => T | Promise<T>): Promise<T>

  /** Remove the document entirely. */
  clear(): Promise<void>
}

/** Port for "what time is it", so schedules can be tested deterministically. */
export interface ClockPort {
  now(): Date
}

/** The real clock. */
export const systemClock: ClockPort = {
  now: () => new Date(),
}
