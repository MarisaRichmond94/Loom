import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const series = await prisma.series.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(series)
}

export async function POST(req: Request) {
  const { title, description = '' } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const series = await prisma.series.create({ data: { title: title.trim(), description } })
  return NextResponse.json(series, { status: 201 })
}
