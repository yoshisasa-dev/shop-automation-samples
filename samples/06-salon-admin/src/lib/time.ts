// 日付は YYYY-MM-DD、時刻は HH:MM の文字列で扱う（時差でずれないように Date は計算の中だけで使う）

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function addMinutes(hhmm: string, min: number): string {
  return fromMinutes(toMinutes(hhmm) + min)
}

const tokyoDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })

export function todayInTokyo(now: Date = new Date()): string {
  return tokyoDate.format(now)
}

// YYYY-MM-DD を UTC の正午として扱うと、足し引きしても日付がずれない
function toNoonUtc(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`)
}

export function addDays(ymd: string, days: number): string {
  const d = toNoonUtc(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weekdayOf(ymd: string): number {
  return toNoonUtc(ymd).getUTCDay()
}

export function weekDays(ymd: string): string[] {
  const monday = addDays(ymd, -((weekdayOf(ymd) + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}
