/**
 * DELETE /api/blocks/[blockId]/audio must not delete a music file another
 * block still plays.
 *
 * Importing a series's export makes a copy whose soundtrack blocks point at
 * the ORIGINAL's files (/music/<originalBlockId>.mp3). Removing audio in the
 * copy used to unlink that shared file and silence the original.
 */

const unlinked: string[] = []
const updated: string[] = []
let blocks: { id: string; content: string | null }[] = []

jest.mock('fs/promises', () => ({
  unlink: async (p: string) => { unlinked.push(p) },
  writeFile: async () => {},
  mkdir: async () => {},
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    contentBlock: {
      findUnique: async ({ where }: { where: { id: string } }) => blocks.find(b => b.id === where.id) ?? null,
      count: async ({ where }: { where: { content: string; id: { not: string } } }) =>
        blocks.filter(b => b.content === where.content && b.id !== where.id.not).length,
      update: async ({ where }: { where: { id: string } }) => { updated.push(where.id); return {} },
    },
  },
}))

import path from 'path'
import { DELETE } from '@/app/api/blocks/[blockId]/audio/route'

const removeAudio = (blockId: string) =>
  DELETE(new Request('http://localhost/x'), { params: Promise.resolve({ blockId }) })
const musicFile = (p: string) => path.join(process.cwd(), 'public', p)

beforeEach(() => { unlinked.length = 0; updated.length = 0 })

it('keeps a file the original still plays when the copy removes its audio', async () => {
  blocks = [
    { id: 'orig', content: '/music/orig.mp3' },
    { id: 'copy', content: '/music/orig.mp3' },
  ]
  await removeAudio('copy')

  expect(unlinked).not.toContain(musicFile('/music/orig.mp3'))
  expect(updated).toEqual(['copy']) // the copy's own block is still cleared
})

it('deletes the file once no other block uses it', async () => {
  blocks = [{ id: 'solo', content: '/music/solo.mp3' }]
  await removeAudio('solo')

  expect(unlinked).toContain(musicFile('/music/solo.mp3'))
  expect(updated).toEqual(['solo'])
})
