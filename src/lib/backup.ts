import { mkdir, writeFile, readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { readBackupSettings } from '@/lib/backupSettings'

function sanitize(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim()
}

function buildBookPayload(series: { title: string; description: string | null; variables: unknown[] }, book: {
  title: string; synopsis: string | null; order: number
  chapters: {
    id: string; title: string; order: number; pov: string | null; date: string | null
    blocks: {
      order: number; type: string; content: string | null; prompt: string | null
      displayType: string | null
      choices: { label: string; setsVariables: string; targetChapterId: string | null }[]
      overrides: { order: number; condition: string; content: string }[]
    }[]
  }[]
}) {
  return {
    loomVersion: '1',
    exportedAt: new Date().toISOString(),
    series: {
      title: series.title,
      description: series.description,
      variables: (series.variables as { name: string; type: string; defaultValue: string }[]).map(v => ({
        name: v.name, type: v.type, defaultValue: v.defaultValue,
      })),
      books: [{
        title: book.title,
        synopsis: book.synopsis,
        order: book.order,
        chapters: book.chapters.map(chapter => ({
          _ref: chapter.id,
          title: chapter.title,
          order: chapter.order,
          pov: chapter.pov,
          date: chapter.date,
          blocks: chapter.blocks.map(block => ({
            order: block.order,
            type: block.type,
            content: block.content,
            prompt: block.prompt,
            displayType: block.displayType,
            choices: block.choices.map(c => ({
              label: c.label,
              setsVariables: c.setsVariables,
              targetChapterRef: c.targetChapterId,
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

  for (const series of allSeries) {
    const seriesDir = path.join(settings.folder, sanitize(series.title))
    for (const book of series.books) {
      const bookDir = path.join(seriesDir, sanitize(book.title))
      await mkdir(bookDir, { recursive: true })
      const payload = buildBookPayload(series, book)
      const filename = `${sanitize(book.title)}_${dateStamp}.loom.json`
      await writeFile(path.join(bookDir, filename), JSON.stringify(payload, null, 2), 'utf-8')
    }
  }

  await deleteOldBackups(settings.folder, settings.retentionDays)

  return { ok: true, message: `Backup completed at ${new Date().toLocaleTimeString()}` }
}
