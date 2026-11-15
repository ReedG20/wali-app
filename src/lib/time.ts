// Date formatting. Hermes builds a new native date formatter on every toLocale*String() call
// (about 1 ms each on a phone), and list screens format a time per row on every render. That was
// a large share of the background CPU that got wali killed on 2026-11-14, so formatters are
// created once and reused.
const formatters = new Map<string, Intl.DateTimeFormat>()

export function formatDate(ms: number | Date, opts: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(opts)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, opts)
    formatters.set(key, f)
  }
  return f.format(typeof ms === "number" ? new Date(ms) : ms)
}

export const clockTime = (ms: number) => formatDate(ms, { hour: "numeric", minute: "2-digit" })

export function timeLabel(ms: number) {
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const t = clockTime(ms)
  if (sameDay) return t
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${t}`
  return `${formatDate(d, { month: "short", day: "numeric" })}, ${t}`
}

export function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.round(h / 24)} d ago`
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m} min ${s % 60 ? `${s % 60}s` : ""}`.trim()
}
