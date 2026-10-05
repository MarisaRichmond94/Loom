/**
 * Pins how /api/import assigns character IDs.
 *
 * Restoring a backup into a database that no longer has the series must keep
 * every character's original ID (avatar files are named <charId>.jpg). But
 * importing a series's export into the SAME database — which is how a copy of
 * a series gets made — finds those IDs still owned by the original. Reusing
 * them failed the import on a unique constraint, after the series had already
 * been created, leaving a same-named empty series beside the original.
 *
 * The worse failure is the quiet one: the second pass (firstBookId, overrides)
 * must update the COPY's characters. Pointed at the original IDs, it would
 * re-aim the original's characters at the copy's books and report success.
 */

const existingCharacterIds = new Set<string>()
const createdCharacters: { id: string; seriesId: string }[] = []
const characterUpdates: { id: string; data: Record<string, unknown> }[] = []
const overrideRows: { characterId: string; bookId: string }[] = []
let seq = 0
const nextId = (p: string) => `${p}-new-${++seq}`

jest.mock('@/lib/wordCounts', () => ({ refreshBlockWordCounts: jest.fn(async () => {}) }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    series: { create: async () => ({ id: 'series-copy' }) },
    storyVariable: { createMany: async () => ({}) },
    character: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter(id => existingCharacterIds.has(id)).map(id => ({ id })),
      create: async ({ data }: { data: { id?: string; seriesId: string } }) => {
        const id = data.id ?? nextId('char')
        if (existingCharacterIds.has(id)) throw new Error(`Unique constraint failed on the fields: (\`id\`) — ${id}`)
        existingCharacterIds.add(id)
        createdCharacters.push({ id, seriesId: data.seriesId })
        return { id }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        characterUpdates.push({ id: where.id, data })
        return { id: where.id }
      },
    },
    book: { create: async () => ({ id: nextId('book') }) },
    chapter: { create: async () => ({ id: nextId('chapter') }) },
    contentBlock: { create: async () => ({ id: nextId('block') }), findMany: async () => [] },
    conditionalOverride: { createMany: async () => ({}) },
    choice: { createMany: async () => ({}) },
    characterBookOverride: {
      createMany: async ({ data }: { data: { characterId: string; bookId: string }[] }) => { overrideRows.push(...data) },
    },
  },
}))

import { POST } from '@/app/api/import/route'

const payload = {
  loomVersion: '2',
  series: {
    title: 'The Dark Horse Series',
    variables: [],
    characters: [
      { _ref: 'char-emma', name: 'Emma', age: 17, firstBookRef: 'book-1', starred: true, overrides: [{ bookRef: 'book-1', age: 18 }] },
    ],
    books: [{ _ref: 'book-1', title: "Nobody's Hero", order: 1, chapters: [] }],
  },
}

const runImport = () => POST({ json: async () => structuredClone(payload) } as never)

beforeEach(() => {
  existingCharacterIds.clear()
  createdCharacters.length = 0
  characterUpdates.length = 0
  overrideRows.length = 0
})

it('keeps original character IDs when they are free (restoring a backup)', async () => {
  const res = await runImport()

  expect(res.status).toBe(200)
  expect(createdCharacters.map(c => c.id)).toEqual(['char-emma'])
  expect(characterUpdates.map(u => u.id)).toEqual(['char-emma'])
  expect(overrideRows.map(o => o.characterId)).toEqual(['char-emma'])
})

it('mints fresh IDs when the original still owns them (copying a series)', async () => {
  existingCharacterIds.add('char-emma') // the original series' character

  const res = await runImport()

  expect(res.status).toBe(200)
  const [copy] = createdCharacters
  expect(copy.id).not.toBe('char-emma')
  expect(copy.seriesId).toBe('series-copy')
  // The second pass lands on the copy — never on the original's character.
  expect(characterUpdates.map(u => u.id)).toEqual([copy.id])
  expect(overrideRows.map(o => o.characterId)).toEqual([copy.id])
})
