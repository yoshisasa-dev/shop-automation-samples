import { useEffect, useState } from 'react'
import { ReservationForm } from '../components/ReservationForm'
import { useMaster } from '../data/master'
import { subscribeReservations } from '../data/reservations'
import { dateJa } from '../lib/format'
import { isClosedDay, timeSlots } from '../lib/reservations'
import { addDays, toMinutes, todayInTokyo, weekDays } from '../lib/time'
import { SHOP, type Reservation } from '../types'

type FormState = (Partial<Reservation> & { date: string }) | null

export function CalendarPage() {
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [date, setDate] = useState(todayInTokyo())
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [form, setForm] = useState<FormState>(null)
  const days = mode === 'day' ? [date] : weekDays(date)

  useEffect(() => subscribeReservations(days[0], days.at(-1)!, setReservations), [days[0], days.at(-1)])
  const booked = reservations.filter((r) => r.status === 'booked')
  const step = mode === 'day' ? 1 : 7

  return (
    <section>
      <div className="page-head">
        <h1>予約</h1>
        <div className="toggle">
          <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>日</button>
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>週</button>
        </div>
      </div>
      <div className="date-nav">
        <button onClick={() => setDate(addDays(date, -step))}>◀</button>
        <strong>{mode === 'day' ? dateJa(date) : `${dateJa(days[0])} 〜 ${dateJa(days[6])}`}</strong>
        <button onClick={() => setDate(addDays(date, step))}>▶</button>
        <button onClick={() => setDate(todayInTokyo())}>今日</button>
      </div>
      {mode === 'day' ? (
        <DayView date={date} reservations={booked} onOpen={setForm} />
      ) : (
        <WeekView days={days} reservations={booked} onOpen={setForm} onPickDay={(d) => { setDate(d); setMode('day') }} />
      )}
      {form && <ReservationForm initial={form} onClose={() => setForm(null)} />}
    </section>
  )
}

function DayView({ date, reservations, onOpen }: { date: string; reservations: Reservation[]; onOpen: (f: FormState) => void }) {
  const { staff } = useMaster()
  const slots = timeSlots()
  if (isClosedDay(date)) return <p className="card empty closed">定休日です（火曜）</p>
  const row = (hhmm: string) => (toMinutes(hhmm) - toMinutes(SHOP.open)) / SHOP.slotMinutes + 2
  return (
    <div className="card day-wrap">
      <div className="day-grid" style={{ gridTemplateColumns: `56px repeat(${staff.length}, minmax(110px, 1fr))` }}>
        <div className="corner" />
        {staff.map((s, i) => (
          <div key={s.id} className="col-head" style={{ gridColumn: i + 2 }}>
            <span className="dot" style={{ background: s.color }} />{s.name}
          </div>
        ))}
        {slots.map((t) => (
          <div key={t} className="time-label" style={{ gridRow: row(t) }}>{t.endsWith(':00') ? t : ''}</div>
        ))}
        {staff.map((s, i) =>
          slots.map((t) => (
            <button
              key={`${s.id}-${t}`}
              className="cell"
              style={{ gridColumn: i + 2, gridRow: row(t) }}
              aria-label={`${s.name} ${t} に予約を追加`}
              onClick={() => onOpen({ date, start: t, staffId: s.id })}
            />
          )),
        )}
        {reservations.filter((r) => r.date === date).map((r) => {
          const col = staff.findIndex((s) => s.id === r.staffId) + 2
          const color = staff.find((s) => s.id === r.staffId)?.color
          const short = toMinutes(r.end) - toMinutes(r.start) <= SHOP.slotMinutes
          return (
            <button
              key={r.id}
              className={`block${short ? ' short' : ''}`}
              style={{ gridColumn: col, gridRow: `${row(r.start)} / ${row(r.end)}`, background: color }}
              onClick={() => onOpen(r)}
            >
              {short ? (
                <span><b>{r.start}</b> {r.customerName} 様・{r.menuName}</span>
              ) : (
                <>
                  <span>{r.start}〜{r.end}</span>
                  <strong>{r.customerName} 様</strong>
                  <span>{r.menuName}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ days, reservations, onOpen, onPickDay }: { days: string[]; reservations: Reservation[]; onOpen: (f: FormState) => void; onPickDay: (d: string) => void }) {
  const { staff } = useMaster()
  const today = todayInTokyo()
  return (
    <div className="week-grid">
      {days.map((d) => {
        const list = reservations.filter((r) => r.date === d).sort((a, b) => a.start.localeCompare(b.start))
        const closed = isClosedDay(d)
        return (
          <div key={d} className={`card week-day${closed ? ' closed' : ''}${d === today ? ' today' : ''}`}>
            <button className="week-head link" onClick={() => onPickDay(d)}>{dateJa(d)}</button>
            {closed ? <p className="empty">定休日</p> : (
              <>
                {list.map((r) => (
                  <button key={r.id} className="chip" style={{ borderLeftColor: staff.find((s) => s.id === r.staffId)?.color }} onClick={() => onOpen(r)}>
                    <span>{r.start}</span> {r.customerName}
                  </button>
                ))}
                {list.length === 0 && <p className="empty">予約なし</p>}
                <button className="add link" onClick={() => onOpen({ date: d })}>＋ 追加</button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
