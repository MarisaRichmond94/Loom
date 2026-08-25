import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs'
import path from 'path'

import { GET } from '@/app/api/media/[...path]/route'

// The media route serves user uploads (covers, portraits, avatars, album art,
// audio) straight from public/ with `Cache-Control: max-age=0,
// must-revalidate`. It shipped without ETag or Last-Modified, so there was
// nothing for that revalidation to compare against and every single request
// re-sent the whole body — the series page re-downloaded and re-decoded ~1.8MB
// of book covers on every visit.
//
// Adding validators fixes that, but it introduces the one failure mode this
// route must never have: serving a stale copy of a file the writer just
// replaced in place. `must-revalidate` + a cache-buster query was the old
// guarantee; these tests are the new one.

const PUBLIC_DIR = path.join(process.cwd(), 'public')
const FIXTURE_DIR = path.join(PUBLIC_DIR, '__media-test__')
const FIXTURE = path.join(FIXTURE_DIR, 'fixture.jpg')
const SEGMENTS = ['__media-test__', 'fixture.jpg']

// The route reads `params` as a promise (Next 16 async params).
const ctx = (segments = SEGMENTS) => ({ params: Promise.resolve({ path: segments }) })
const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/covers/fixture.jpg', { headers })

function write(body: string, mtimeSec: number) {
  writeFileSync(FIXTURE, body)
  // Pin mtime explicitly: the validator is (size, mtime), and two writes in
  // the same millisecond would otherwise be indistinguishable.
  utimesSync(FIXTURE, mtimeSec, mtimeSec)
}

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('media route conditional GET', () => {
  it('emits an ETag and Last-Modified so revalidation has something to match', async () => {
    write('original', 1_700_000_000)
    const res = await GET(req(), ctx())

    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
    expect(res.headers.get('last-modified')).toBe(
      new Date(1_700_000_000 * 1000).toUTCString(),
    )
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
  })

  it('answers a matching If-None-Match with a bodyless 304', async () => {
    write('original', 1_700_000_000)
    const etag = (await GET(req(), ctx())).headers.get('etag')!

    const res = await GET(req({ 'if-none-match': etag }), ctx())
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    // The validators must repeat on the 304, or the client has nothing to
    // revalidate with next time.
    expect(res.headers.get('etag')).toBe(etag)
  })

  it('accepts a weak tag and a list, per RFC 9110', async () => {
    write('original', 1_700_000_000)
    const etag = (await GET(req(), ctx())).headers.get('etag')!

    expect((await GET(req({ 'if-none-match': `W/${etag}` }), ctx())).status).toBe(304)
    expect((await GET(req({ 'if-none-match': `"other", ${etag}` }), ctx())).status).toBe(304)
    expect((await GET(req({ 'if-none-match': '*' }), ctx())).status).toBe(304)
  })

  it('honours If-Modified-Since at one-second resolution', async () => {
    write('original', 1_700_000_000)
    const lastModified = (await GET(req(), ctx())).headers.get('last-modified')!

    expect((await GET(req({ 'if-modified-since': lastModified }), ctx())).status).toBe(304)

    const stale = new Date((1_700_000_000 - 60) * 1000).toUTCString()
    expect((await GET(req({ 'if-modified-since': stale }), ctx())).status).toBe(200)
  })

  it('prefers If-None-Match over If-Modified-Since when both are sent', async () => {
    write('original', 1_700_000_000)
    const fresh = new Date(1_700_000_000 * 1000).toUTCString()

    // The date says "unchanged", the tag says otherwise. The tag wins, so this
    // is a 200 — the case that keeps a replaced file from being missed.
    const res = await GET(
      req({ 'if-none-match': '"stale-tag"', 'if-modified-since': fresh }),
      ctx(),
    )
    expect(res.status).toBe(200)
  })

  describe('a file replaced in place is never served stale', () => {
    it('changes the ETag when the content changes', async () => {
      write('original', 1_700_000_000)
      const before = (await GET(req(), ctx())).headers.get('etag')!

      // Same byte length, new mtime — the case a size-only validator misses.
      write('replaced', 1_700_000_600)
      const after = (await GET(req(), ctx())).headers.get('etag')!

      expect(after).not.toBe(before)
      const res = await GET(req({ 'if-none-match': before }), ctx())
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('replaced')
    })

    it('changes the ETag when only the size changes', async () => {
      write('original', 1_700_000_000)
      const before = (await GET(req(), ctx())).headers.get('etag')!

      // Same mtime, different length — the case an mtime-only validator misses.
      write('a much longer replacement body', 1_700_000_000)
      expect((await GET(req(), ctx())).headers.get('etag')).not.toBe(before)
    })
  })

  it('never short-circuits a Range request into a 304', async () => {
    // Audio seeking sends Range on a resource the browser already has cached.
    // Answering that with an empty 304 breaks playback, so the conditional
    // branch has to stay out of the way of ranged reads.
    write('0123456789', 1_700_000_000)
    const etag = (await GET(req(), ctx())).headers.get('etag')!

    const res = await GET(req({ range: 'bytes=0-3', 'if-none-match': etag }), ctx())
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('0123')
  })

  it('still refuses to escape public/', async () => {
    const res = await GET(req(), ctx(['..', '..', 'etc', 'passwd']))
    expect(res.status).toBe(400)
  })
})
