import { mkdir, writeFile, readdir, stat, unlink, copyFile, rm } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { readBackupSettings } from '@/lib/backupSettings'

function sanitize(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim()
}

function buildBookPayload(
  series: {
    title: string; description: string | null
    variables: unknown[]
    characters: { id: string; name: string; age: number | null }[]
  },
  book: {
    title: string; synopsis: string | null; coverPath: string | null; order: number
    chapters: {
      id: string; title: string; order: number; pov: string | null; date: string | null
      condition: string | null; numbered: boolean
      blocks: {
        order: number; type: string; content: string | null; prompt: string | null
        displayType: string | null
        condition: string | null
        pinStart: number | null
        pinEnd: number | null
        choices: { label: string; setsVariables: string; targetChapterId: string | null; endingMessage: string | null }[]
        overrides: { order: number; condition: string; content: string }[]
      }[]
    }[]
  },
) {
  return {
    loomVersion: '2',
    exportedAt: new Date().toISOString(),
    series: {
      title: series.title,
      description: series.description,
      variables: (series.variables as { name: string; type: string; defaultValue: string }[]).map(v => ({
        name: v.name, type: v.type, defaultValue: v.defaultValue,
      })),
      characters: series.characters.map(c => ({
        _ref: c.id,
        name: c.name,
        age: c.age,
      })),
      books: [{
        title: book.title,
        synopsis: book.synopsis,
        coverPath: book.coverPath,
        order: book.order,
        chapters: book.chapters.map(chapter => ({
          _ref: chapter.id,
          title: chapter.title,
          order: chapter.order,
          pov: chapter.pov,
          date: chapter.date,
          condition: chapter.condition,
          numbered: chapter.numbered,
          blocks: chapter.blocks.map(block => ({
            order: block.order,
            type: block.type,
            content: block.content,
            prompt: block.prompt,
            displayType: block.displayType,
            condition: block.condition,
            pinStart: block.pinStart,
            pinEnd: block.pinEnd,
            choices: block.choices.map(c => ({
              label: c.label,
              setsVariables: c.setsVariables,
              targetChapterRef: c.targetChapterId,
              endingMessage: c.endingMessage,
            })),
            overrides: block.overrides.map(o => ({
              order: o.order, condition: o.condition, content: o.content,
            })),
          })),
        })),
      }],
    },
  }
}

async function deleteOldBackups(folder: string, retentionDays: number) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  async function sweep(dir: string) {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry)
      const s = await stat(full).catch(() => null)
      if (!s) continue
      if (s.isDirectory()) {
        await sweep(full)
      } else if (entry.endsWith('.loom.json') && s.mtimeMs < cutoff) {
        await unlink(full).catch(() => null)
        const assetDir = path.join(dir, entry.slice(0, -'.loom.json'.length))
        await rm(assetDir, { recursive: true, force: true }).catch(() => null)
      }
    }
  }
  await sweep(folder)
}

export async function runBackup(): Promise<{ ok: boolean; message: string }> {
  const settings = await readBackupSettings()
  if (!settings.enabled || !settings.folder) {
    return { ok: false, message: 'Backup not configured or disabled.' }
  }

  const allSeries = await prisma.series.findMany({
    include: {
      variables: true,
      characters: true,
      books: {
        orderBy: { order: 'asc' },
        include: {
          chapters: {
            orderBy: { order: 'asc' },
            include: {
              blocks: {
                orderBy: { order: 'asc' },
                include: {
                  choices: true,
                  overrides: { orderBy: { order: 'asc' } },
                },
              },
            },
          },
        },
      },
    },
  })

  const dateStamp = new Date().toISOString().slice(0, 10)
  const publicDir = path.join(process.cwd(), 'public')

  async function copyAsset(publicRelPath: string, destDir: string) {
    // publicRelPath is like "/covers/foo.jpg"; copy into destDir mirroring that subpath
    const src = path.join(publicDir, publicRelPath)
    const dest = path.join(destDir, publicRelPath)
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(src, dest).catch(() => null)
  }

  for (const series of allSeries) {
    const seriesDir = path.join(settings.folder, sanitize(series.title))
    for (const book of series.books) {
      const bookDir = path.join(seriesDir, sanitize(book.title))
      await mkdir(bookDir, { recursive: true })
      const baseName = `${sanitize(book.title)}_${dateStamp}`
      const payload = buildBookPayload(series, book)
      await writeFile(path.join(bookDir, `${baseName}.loom.json`), JSON.stringify(payload, null, 2), 'utf-8')

      const assetDir = path.join(bookDir, baseName)
      if (book.coverPath) await copyAsset(book.coverPath, assetDir)
      for (const character of series.characters) {
        await copyAsset(`/characters/${character.id}.jpg`, assetDir)
      }
      for (const chapter of book.chapters) {
        for (const block of chapter.blocks) {
          if (block.content?.startsWith('/music/')) {
            await copyAsset(block.content, assetDir)
          }
        }
      }
    }
  }

  await deleteOldBackups(settings.folder, settings.retentionDays)

  return { ok: true, message: `Backup completed at ${new Date().toLocaleTimeString()}` }
}
