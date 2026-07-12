import { readdir } from 'fs/promises'
import path from 'path'

// File-existence-as-source-of-truth checks (avatars, album art) used to run
// a synchronous existsSync per row inside request handlers — sync fs blocks
// the event loop and the cost scales with cast/soundtrack size. Instead,
// list the /public subdirectory once per request and do Set lookups.
// A missing directory just means "no assets yet".
export async function publicDirFilenames(subdir: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(path.join(process.cwd(), 'public', subdir)))
  } catch {
    return new Set()
  }
}
