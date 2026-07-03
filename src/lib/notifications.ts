'use client'

import { useSyncExternalStore } from 'react'

// Tiny module-level notification store feeding the header bell. Lives
// outside React so any page under the author layout can push to it (the
// canon save does) without threading context through the tree. State is
// per page load — notifications aren't persisted, they're session chatter.

export type AppNotification = {
  id: number
  kind: 'ok' | 'warn' | 'error'
  message: string
  at: number
  read: boolean
}

type Snapshot = {
  notifications: AppNotification[]
  // True while a background job (canon save) runs; the bell pulses.
  busy: boolean
  unread: number
}

let notifications: AppNotification[] = []
let busy = false
let nextId = 1
let snapshot: Snapshot = { notifications, busy, unread: 0 }
const listeners = new Set<() => void>()

function emit() {
  snapshot = {
    notifications,
    busy,
    unread: notifications.filter(n => !n.read).length,
  }
  listeners.forEach(l => l())
}

export function notify(kind: AppNotification['kind'], message: string) {
  notifications = [{ id: nextId++, kind, message, at: Date.now(), read: false }, ...notifications].slice(0, 50)
  emit()
}

export function setNotificationBusy(value: boolean) {
  if (busy === value) return
  busy = value
  emit()
}

export function markAllNotificationsRead() {
  if (notifications.every(n => n.read)) return
  notifications = notifications.map(n => n.read ? n : { ...n, read: true })
  emit()
}

export function clearNotifications() {
  if (notifications.length === 0) return
  notifications = []
  emit()
}

export function useNotifications(): Snapshot {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => snapshot,
    () => snapshot,
  )
}
