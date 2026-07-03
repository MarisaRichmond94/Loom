import { readFile } from 'fs/promises'
import path from 'path'

// Shared bits of the per-book front-matter store (see the front-matter API
// route for the write side). Kept out of the route file because Next.js
// route modules may only export HTTP handlers.

export type FrontMatterMeta = { originalName: string; uploadedAt: string }

export const FRONT_MATTER_DIR = path.join(process.cwd(), 'data', 'front-matter')

export function frontMatterDocxPath(bookId: string): string {
  return path.join(FRONT_MATTER_DIR, `${bookId}.docx`)
}

export function frontMatterMetaPath(bookId: string): string {
  return path.join(FRONT_MATTER_DIR, `${bookId}.json`)
}

export async function readFrontMatterMeta(bookId: string): Promise<FrontMatterMeta | null> {
  try {
    return JSON.parse(await readFile(frontMatterMetaPath(bookId), 'utf-8'))
  } catch {
    return null
  }
}

export async function readFrontMatterDocx(bookId: string): Promise<Buffer | null> {
  try {
    return await readFile(frontMatterDocxPath(bookId))
  } catch {
    return null
  }
}
