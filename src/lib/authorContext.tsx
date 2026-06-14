'use client'

import { createContext, useContext } from 'react'

type Chapter = { id: string; title: string; order: number; pov?: string | null }
type Book = { id: string; title: string; order: number; published: boolean; inProgress: boolean; chapters: Chapter[] }
type Variable = { id: string; name: string; type: string; defaultValue: string }
export type AuthorSeries = {
  id: string
  title: string
  description?: string
  // Stored on the server as JSON strings; the layout parses them once when
  // fetching the series so consumers get plain arrays. Empty arrays are
  // the unset sentinel.
  genres?: string[]
  keywords?: string[]
  books: Book[]
  variables: Variable[]
}

export type AuthorContextValue = {
  series: AuthorSeries
  loadSeries: () => Promise<void>
  loadChoices: () => Promise<void>
  lightMode: boolean
  // Distinct string values written to each variable by any choice in
  // the series. Drives the condition-row datalist autocomplete so a
  // writer typing a string condition value sees the exact strings
  // that exist elsewhere. Empty map until the layout's fetch resolves.
  knownStringValues: Record<string, string[]>
}

const AuthorContext = createContext<AuthorContextValue | null>(null)

export const AuthorProvider = AuthorContext.Provider

export function useAuthor(): AuthorContextValue {
  const value = useContext(AuthorContext)
  if (!value) throw new Error('useAuthor must be used inside the author layout')
  return value
}
