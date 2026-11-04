import { SHOP, type Reservation } from '../types'
import { fromMinutes, toMinutes, weekdayOf } from './time'

type Slot = Pick<Reservation, 'id' | 'date' | 'start' | 'end' | 'staffId'>

// 同じ日・同じスタッフで時間が重なる予約を返す（取り消し済みと自分自身は除く）
export function findConflict(existing: Reservation[], candidate: Slot): Reservation | null {
  const start = toMinutes(candidate.start)
  const end = toMinutes(candidate.end)
  return (
    existing.find(
      (r) =>
        r.status === 'booked' &&
        r.id !== candidate.id &&
        r.date === candidate.date &&
        r.staffId === candidate.staffId &&
        toMinutes(r.start) < end &&
        start < toMinutes(r.end),
    ) ?? null
  )
}

// 予約を始められる時刻（閉店の30分前まで）
export function timeSlots(): string[] {
  const slots: string[] = []
  for (let m = toMinutes(SHOP.open); m < toMinutes(SHOP.close); m += SHOP.slotMinutes) slots.push(fromMinutes(m))
  return slots
}

export function isClosedDay(ymd: string): boolean {
  return (SHOP.closedWeekdays as readonly number[]).includes(weekdayOf(ymd))
}
