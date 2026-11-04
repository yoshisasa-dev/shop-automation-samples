import type { Visit } from '../types'

// ym は YYYY-MM。新規 = その月に来店があり、最初の来店日もその月の人
export function monthlyStats(visits: Visit[], ym: string): { visitCount: number; sales: number; newCustomers: number } {
  const inMonth = visits.filter((v) => v.date.startsWith(ym))
  const firstVisit = new Map<string, string>()
  for (const v of visits) {
    const prev = firstVisit.get(v.customerId)
    if (!prev || v.date < prev) firstVisit.set(v.customerId, v.date)
  }
  const newCustomers = new Set(inMonth.map((v) => v.customerId).filter((id) => firstVisit.get(id)?.startsWith(ym)))
  return {
    visitCount: inMonth.length,
    sales: inMonth.reduce((sum, v) => sum + v.price, 0),
    newCustomers: newCustomers.size,
  }
}
