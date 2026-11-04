import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { subscribeCustomers } from '../data/customers'
import { useMaster } from '../data/master'
import { cancelReservation, saveReservation } from '../data/reservations'
import { searchCustomers } from '../lib/customers'
import { dateJa } from '../lib/format'
import { isClosedDay, timeSlots } from '../lib/reservations'
import { addMinutes, toMinutes } from '../lib/time'
import { SHOP, type Customer, type Reservation } from '../types'

type Props = {
  initial: Partial<Reservation> & { date: string }
  onClose: () => void
}

export function ReservationForm({ initial, onClose }: Props) {
  const { staff, menus } = useMaster()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [q, setQ] = useState(initial.customerName ?? '')
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    initial.customerId ? { id: initial.customerId, name: initial.customerName ?? '' } : null,
  )
  const [date, setDate] = useState(initial.date)
  const [start, setStart] = useState(initial.start ?? '10:00')
  const [staffId, setStaffId] = useState(initial.staffId ?? staff[0].id)
  const [menuId, setMenuId] = useState(initial.menuId ?? menus[0].id)
  const [memo, setMemo] = useState(initial.memo ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeCustomers(setCustomers), [])
  const candidates = useMemo(() => (customer ? [] : searchCustomers(customers, q).slice(0, 6)), [customers, q, customer])
  const menu = menus.find((m) => m.id === menuId)!
  const end = addMinutes(start, menu.minutes)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!customer) return setError('お客さんを選んでください')
    if (isClosedDay(date)) return setError('定休日には予約を入れられません')
    if (toMinutes(end) > toMinutes(SHOP.close)) return setError(`閉店（${SHOP.close}）をこえてしまいます`)
    setBusy(true)
    const result = await saveReservation({
      id: initial.id, date, start, end, staffId, menuId, menuName: menu.name,
      customerId: customer.id, customerName: customer.name, memo,
    })
    setBusy(false)
    if (!result.ok) {
      const c = result.conflict
      return setError(`${c.customerName}さんの予約（${c.start}〜${c.end}）と重なっています`)
    }
    onClose()
  }

  async function onCancel() {
    if (!initial.id) return
    if (!window.confirm('この予約を取り消しますか？')) return
    await cancelReservation(initial.id)
    onClose()
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="card form modal" onSubmit={onSubmit} onClick={(e) => e.stopPropagation()}>
        <h2>{initial.id ? '予約を変更' : '予約を追加'}</h2>
        <label>お客さん
          {customer ? (
            <div className="chosen">
              <strong>{customer.name} 様</strong>
              <button type="button" className="link" onClick={() => setCustomer(null)}>変える</button>
            </div>
          ) : (
            <>
              <input placeholder="名前・ふりがな・電話でさがす" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="candidates">
                {candidates.map((c) => (
                  <button type="button" key={c.id} onClick={() => setCustomer({ id: c.id, name: c.name })}>
                    {c.name}<small>{c.phone}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </label>
        <div className="form-grid">
          <label>日付<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>開始
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              {timeSlots().map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>メニュー
            <select value={menuId} onChange={(e) => setMenuId(e.target.value)}>
              {menus.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.minutes}分）</option>)}
            </select>
          </label>
          <label>担当
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="wide">メモ<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        </div>
        <p className="summary">{dateJa(date)} {start}〜{end}（{menu.name}）</p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          {initial.id && <button type="button" className="danger" onClick={onCancel}>予約を取り消す</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>やめる</button>
          <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存する'}</button>
        </div>
      </form>
    </div>
  )
}
