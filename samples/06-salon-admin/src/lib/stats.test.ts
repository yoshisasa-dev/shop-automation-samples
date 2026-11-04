import { describe, expect, it } from 'vitest'
import type { Visit } from '../types'
import { monthlyStats } from './stats'

const v = (o: Partial<Visit> = {}): Visit => ({
  id: 'v', customerId: 'c1', date: '2026-11-10', menuId: 'm1', menuName: 'カット', staffId: 's1', price: 4950, memo: '', ...o,
})

describe('monthlyStats', () => {
  it('その月の来店数・売上・新規の人数（月の境目を含む）', () => {
    const visits = [
      v({ id: '1', customerId: 'c1', date: '2026-10-31' }),
      v({ id: '2', customerId: 'c1', date: '2026-11-01' }),
      v({ id: '3', customerId: 'c2', date: '2026-11-30', price: 11000 }),
      v({ id: '4', customerId: 'c3', date: '2026-12-01' }),
    ]
    expect(monthlyStats(visits, '2026-11')).toEqual({ visitCount: 2, sales: 15950, newCustomers: 1 })
  })
  it('同じ人が同じ月に2回来ても、新規は1人', () => {
    const visits = [v({ id: '1', date: '2026-11-02' }), v({ id: '2', date: '2026-11-20' })]
    expect(monthlyStats(visits, '2026-11').newCustomers).toBe(1)
  })
  it('来店がない月は0', () => {
    expect(monthlyStats([], '2026-11')).toEqual({ visitCount: 0, sales: 0, newCustomers: 0 })
  })
})
