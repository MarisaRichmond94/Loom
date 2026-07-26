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

export type AppToast = {
  id: number
  kind: 'error' | 'warn'
  message: string
}

type Snapshot = {
  notifications: AppNotification[]
  // True while a background job (canon save) runs; the bell pulses.
  busy: boolean
  unread: number
  toasts: AppToast[]
  // True during any save (including silent autosaves); drives the Saving… toast.
  saving: boolean
}

let notifications: AppNotification[] = []
let toasts: AppToast[] = []
let busy = false
let saving = false
let nextId = 1
let snapshot: Snapshot = { notifications, busy, unread: 0, toasts, saving }
const listeners = new Set<() => void>()

function emit() {
  snapshot = {
    notifications,
    busy,
    unread: notifications.filter(n => !n.read).length,
    toasts,
    saving,
  }
  listeners.forEach(l => l())
}

export function setNotificationSaving(value: boolean) {
  if (saving === value) return
  saving = value
  emit()
}

export function dismissToast(id: number) {
  toasts = toasts.filter(t => t.id !== id)
  emit()
}

export function notify(kind: AppNotification['kind'], message: string) {
  const id = nextId++
  notifications = [{ id, kind, message, at: Date.now(), read: false }, ...notifications].slice(0, 50)
  // Warnings toast alongside errors: the only thing raising one is losing the
  // writer's unsaved edits to a replace from another tab, which they have to
  // see now, not next time they open the bell. AppToast has always typed
  // 'warn' — this just wires it up.
  if (kind === 'error' || kind === 'warn') {
    toasts = [...toasts, { id, kind, message }]
    setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit() }, 5000)
  }
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
