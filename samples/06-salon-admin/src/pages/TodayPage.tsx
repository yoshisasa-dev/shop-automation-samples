import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMaster } from '../data/master'
import { subscribeReservations } from '../data/reservations'
import { subscribeAllVisits } from '../data/visits'
import { dateJa, yen } from '../lib/format'
import { isClosedDay } from '../lib/reservations'
import { monthlyStats } from '../lib/stats'
import { addDays, todayInTokyo } from '../lib/time'
import type { Reservation, Visit } from '../types'

export function TodayPage() {
  const today = todayInTokyo()
  const { staff } = useMaster()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [visits, setVisits] = useState<Visit[]>([])

  useEffect(() => subscribeReservations(today, today, setReservations), [today])
  useEffect(() => subscribeAllVisits(setVisits), [])

  const stats = useMemo(() => monthlyStats(visits, today.slice(0, 7)), [visits, today])
  const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const prev = useMemo(() => monthlyStats(visits, prevMonth), [visits, prevMonth])
  const booked = reservations.filter((r) => r.status === 'booked').sort((a, b) => a.start.localeCompare(b.start))

  return (
    <section>
      <h1>今日の予約 <small>{dateJa(today)}</small></h1>
      <div className="stats">
        <div className="card stat"><span>今月の来店</span><strong>{stats.visitCount}<small>件</small></strong><em>先月 {prev.visitCount}件</em></div>
        <div className="card stat"><span>今月の売上</span><strong>{yen(stats.sales)}</strong><em>先月 {yen(prev.sales)}</em></div>
        <div className="card stat"><span>今月の新規</span><strong>{stats.newCustomers}<small>人</small></strong><em>先月 {prev.newCustomers}人</em></div>
      </div>
      {isClosedDay(today) ? (
        <p className="card empty">今日は定休日です</p>
      ) : (
        <div className="today-grid">
          {staff.map((s) => {
            const mine = booked.filter((r) => r.staffId === s.id)
            return (
              <div key={s.id} className="card staff-col">
                <h2><span className="dot" style={{ background: s.color }} />{s.name}</h2>
                {mine.length === 0 && <p className="empty">予約はありません</p>}
                {mine.map((r) => (
                  <Link key={r.id} to={`/customers/${r.customerId}`} className="booking" style={{ borderColor: s.color }}>
                    <span className="time">{r.start}〜{r.end}</span>
                    <span className="name">{r.customerName} 様</span>
                    <span className="menu">{r.menuName}</span>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
