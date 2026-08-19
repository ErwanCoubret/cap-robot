import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { JsonStore } from '../infrastructure/store/jsonStore'

interface Doc {
  count: number
  label: string
}

const DEFAULTS: Doc = { count: 0, label: 'none' }

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cap-store-'))
})

function store(name = 'doc.json'): JsonStore<Doc> {
  return new JsonStore<Doc>(join(directory, name), DEFAULTS)
}

describe('JsonStore', () => {
  it('returns the defaults when the file does not exist', async () => {
    expect(await store().read()).toEqual(DEFAULTS)
  })

  it('does not hand out the defaults object itself', async () => {
    const first = await store().read()
    first.count = 99

    expect(await store().read()).toEqual(DEFAULTS)
  })

  it('persists what it writes', async () => {
    const subject = store()
    await subject.write({ count: 3, label: 'three' })

    expect(await subject.read()).toEqual({ count: 3, label: 'three' })
  })

  it('creates missing parent directories', async () => {
    const nested = new JsonStore<Doc>(join(directory, 'a', 'b', 'doc.json'), DEFAULTS)

    await nested.write({ count: 1, label: 'one' })

    expect(await nested.read()).toEqual({ count: 1, label: 'one' })
  })

  it('leaves no temporary file behind', async () => {
    await store().write({ count: 1, label: 'one' })

    expect(await readdir(directory)).toEqual(['doc.json'])
  })

  it('fills in keys missing from an older document', async () => {
    await writeFile(join(directory, 'doc.json'), '{"count": 7}', 'utf8')

    expect(await store().read()).toEqual({ count: 7, label: 'none' })
  })

  it('falls back to the defaults when the file is corrupted', async () => {
    await writeFile(join(directory, 'doc.json'), '{ not json', 'utf8')

    expect(await store().read()).toEqual(DEFAULTS)
  })

  it('serialises concurrent updates', async () => {
    const subject = store()

    await Promise.all(
      Array.from({ length: 20 }, () =>
        subject.update((current) => ({ ...current, count: current.count + 1 })),
      ),
    )

    // Without the lock, read-modify-write races would lose increments.
    expect((await subject.read()).count).toBe(20)
  })

  it('keeps accepting updates after one of them fails', async () => {
    const subject = store()

    await expect(
      subject.update(() => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')

    await subject.update((current) => ({ ...current, count: current.count + 5 }))

    expect((await subject.read()).count).toBe(5)
  })

  it('writes readable JSON', async () => {
    await store().write({ count: 2, label: 'two' })

    expect(await readFile(join(directory, 'doc.json'), 'utf8')).toContain('\n  "count": 2')
  })

  it('clears the document', async () => {
    const subject = store()
    await subject.write({ count: 4, label: 'four' })

    await subject.clear()

    expect(await subject.read()).toEqual(DEFAULTS)
  })
})
