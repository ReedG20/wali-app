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

/** "9 sec", "2 min 22 sec", "1 hr 4 min": one format everywhere a length of time is shown. */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} sec`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} min ${s % 60} sec` : `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`
}

/** Megabytes as a person reads them: 121893 -> "119 GB", 512 -> "512 MB". */
export function storage(mb: number) {
  if (!Number.isFinite(mb) || mb < 0) return "–"
  if (mb < 1024) return `${Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`
}

/**
 * Memory items arrive as "[2026-11-15] They plan to…". Split the stamp off so it can be shown as
 * a date instead of raw brackets. The date is a calendar day, so it's built in local time.
 */
export function splitDatePrefix(text: string): { text: string; date: Date | null } {
  const m = /^\s*\[(\d{4})-(\d{2})-(\d{2})(?:[T ][^\]]*)?\]\s*/.exec(text)
  if (!m) return { text, date: null }
  return { text: text.slice(m[0].length), date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) }
}

/** "Today", "Yesterday", "Nov 12". */
export function dayLabel(d: Date | number) {
  const date = typeof d === "number" ? new Date(d) : d
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === y.toDateString()) return "Yesterday"
  return formatDate(date, { month: "short", day: "numeric" })
}
