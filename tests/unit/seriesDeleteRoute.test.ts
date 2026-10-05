/**
 * DELETE /api/series/[seriesId] must also forget the series in author-state.
 *
 * A bare /author visit (and the WriteAI jump-in) resumes the last-active
 * series. Delete that series without clearing it and both land on a 404.
 * The state file is mocked: the real one is the live app's data/ folder.
 */

const deleted: string[] = []
const forgotten: string[] = []

jest.mock('@/lib/prisma', () => ({
  prisma: {
    series: {
      delete: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'missing') {
          const { Prisma } = jest.requireMock('@/generated/prisma/client')
          throw new Prisma.PrismaClientKnownRequestError('P2025')
        }
        deleted.push(where.id)
        return { id: where.id }
      },
    },
  },
}))
// The real generated client can't load under Jest (import.meta); the route
// only needs the error class for its 404 branch.
jest.mock('@/generated/prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    constructor(public code: string) { super(code) }
  }
  return { Prisma: { PrismaClientKnownRequestError } }
})
jest.mock('@/lib/authorState', () => ({
  forgetSeries: async (id: string) => { forgotten.push(id) },
}))

import { DELETE } from '@/app/api/series/[seriesId]/route'

const call = (seriesId: string) => DELETE(new Request('http://localhost/x'), { params: Promise.resolve({ seriesId }) })

beforeEach(() => { deleted.length = 0; forgotten.length = 0 })

it('deletes the series and forgets it as the resume target', async () => {
  const res = await call('series-alt')
  expect(res.status).toBe(204)
  expect(deleted).toEqual(['series-alt'])
  expect(forgotten).toEqual(['series-alt'])
})

it('forgets nothing when the series did not exist', async () => {
  const res = await call('missing')
  expect(res.status).toBe(404)
  expect(forgotten).toEqual([])
})
