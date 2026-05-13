import { PrismaClient } from '@/generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db'
const dbPath = dbUrl.startsWith('file:')
  ? path.resolve(process.cwd(), dbUrl.slice('file:'.length))
  : dbUrl

const adapter = new PrismaBetterSqlite3({ url: dbPath })

export const prisma = new PrismaClient({ adapter })
