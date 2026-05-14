import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { mkdir, readdir, unlink } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ blockId: string }> }

function runYtDlp(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args)
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(stderr))))
    proc.on('error', reject)
  })
}

export async function POST(req: Request, { params }: Params) {
  const { blockId } = await params
  const { url } = await req.json()
  if (!url?.trim()) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  const dir = path.join(process.cwd(), 'public', 'music')
  await mkdir(dir, { recursive: true })

  // Remove any existing audio for this block before downloading
  const existing = await readdir(dir).catch(() => [] as string[])
  for (const f of existing) {
    if (f.startsWith(`${blockId}.`)) await unlink(path.join(dir, f)).catch(() => null)
  }

  try {
    await runYtDlp([
      '--extract-audio',
      '--no-playlist',
      '-o', path.join(dir, `${blockId}.%(ext)s`),
      url,
    ])
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'yt-dlp is not installed. Run: brew install yt-dlp' },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { error: (e as Error).message ?? 'Download failed' },
      { status: 500 },
    )
  }

  const after = await readdir(dir)
  const audioFile = after.find(
    f => f.startsWith(`${blockId}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'),
  )
  if (!audioFile) {
    return NextResponse.json({ error: 'Download produced no audio file' }, { status: 500 })
  }

  const audioPath = `/music/${audioFile}`
  await prisma.contentBlock.update({ where: { id: blockId }, data: { content: audioPath } })
  return NextResponse.json({ audioPath })
}
