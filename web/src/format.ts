// shared formatting helpers for the kiosk display — pure, no vue imports

import type { TokenCounts } from '../../shared/types'

export function totalTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheCreation + t.cacheRead
}

export function fmtAge(iso: string | null): string {
  if (!iso) return 'never'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// "resets in 2h 14m", or null when there's no resetsAt to show
export function fmtResetsIn(iso: string | null): string | null {
  if (!iso) return null
  const sec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (sec <= 0) return 'resetting'
  if (sec < 3600) return `resets in ${Math.ceil(sec / 60)}m`
  const totalMin = Math.round(sec / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `resets in ${h}h ${m}m`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m tok`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`
  return `${Math.round(n)} tok`
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`
}
