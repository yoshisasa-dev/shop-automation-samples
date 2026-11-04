import { describe, expect, it } from 'vitest'
import type { Reservation } from '../types'
import { findConflict, isClosedDay, timeSlots } from './reservations'

const r = (o: Partial<Reservation> = {}): Reservation => ({
  id: 'a', date: '2026-11-05', start: '10:00', end: '11:00', customerId: 'c1', customerName: '山田 花子',
  staffId: 's1', menuId: 'm1', menuName: 'カット', status: 'booked', memo: '', ...o,
})

describe('findConflict', () => {
  it('同じスタッフで時間が重なると、その予約を返す', () => {
    expect(findConflict([r()], { id: 'b', date: '2026-11-05', start: '10:30', end: '11:30', staffId: 's1' })?.id).toBe('a')
  })
  it('終わりと始まりがくっついているだけなら重ならない', () => {
    expect(findConflict([r()], { id: 'b', date: '2026-11-05', start: '11:00', end: '12:00', staffId: 's1' })).toBeNull()
  })
  it('取り消した予約は数えない', () => {
    expect(findConflict([r({ status: 'cancelled' })], { id: 'b', date: '2026-11-05', start: '10:00', end: '11:00', staffId: 's1' })).toBeNull()
  })
  it('別のスタッフ・別の日なら重ならない', () => {
    expect(findConflict([r()], { id: 'b', date: '2026-11-05', start: '10:00', end: '11:00', staffId: 's2' })).toBeNull()
    expect(findConflict([r()], { id: 'b', date: '2026-11-06', start: '10:00', end: '11:00', staffId: 's1' })).toBeNull()
  })
  it('自分自身を変更するときは、自分とは重ならない', () => {
    expect(findConflict([r()], { id: 'a', date: '2026-11-05', start: '10:30', end: '11:30', staffId: 's1' })).toBeNull()
  })
})

describe('営業日と時間の枠', () => {
  it('10:00から18:30まで30分ごと', () => {
    const s = timeSlots()
    expect(s[0]).toBe('10:00')
    expect(s.at(-1)).toBe('18:30')
    expect(s).toHaveLength(18)
  })
  it('火曜は定休日', () => {
    expect(isClosedDay('2026-11-03')).toBe(true)
    expect(isClosedDay('2026-11-04')).toBe(false)
  })
})
