import { describe, expect, it } from 'vitest'
import { findConflict, isClosedDay } from './reservations'
import { buildSeed, seeded } from './seed'

describe('buildSeed', () => {
  const s = buildSeed('2026-11-02', seeded(1))

  it('架空のお客さん30人（メールは example.com）', () => {
    expect(s.customers).toHaveLength(30)
    expect(s.customers.every((c) => c.email.endsWith('@example.com'))).toBe(true)
    expect(new Set(s.customers.map((c) => c.id)).size).toBe(30)
  })

  it('来店記録は過去の営業日だけ。最終来店日はその人のいちばん新しい来店', () => {
    expect(s.visits.length).toBeGreaterThanOrEqual(60)
    expect(s.visits.every((v) => !isClosedDay(v.date) && v.date < '2026-11-02')).toBe(true)
    for (const c of s.customers) {
      const dates = s.visits.filter((v) => v.customerId === c.id).map((v) => v.date).sort()
      expect(c.lastVisit).toBe(dates.at(-1) ?? null)
    }
  })

  it('予約は今日から14日先までの営業日で、同じスタッフで重ならない', () => {
    expect(s.reservations.every((r) => !isClosedDay(r.date) && r.date >= '2026-11-02' && r.date <= '2026-11-16')).toBe(true)
    for (const r of s.reservations) expect(findConflict(s.reservations.filter((x) => x !== r), r)).toBeNull()
    expect(s.reservations.every((r) => r.end <= '19:00')).toBe(true)
  })

  it('今日（営業日）の予約は4件以上', () => {
    expect(s.reservations.filter((r) => r.date === '2026-11-02').length).toBeGreaterThanOrEqual(4)
  })

  it('同じ種なら同じ結果', () => {
    expect(buildSeed('2026-11-02', seeded(1))).toEqual(s)
  })
})
