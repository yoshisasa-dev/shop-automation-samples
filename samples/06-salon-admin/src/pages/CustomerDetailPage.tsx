import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { saveCustomer, subscribeCustomer } from '../data/customers'
import { useMaster } from '../data/master'
import { addVisit, subscribeVisits } from '../data/visits'
import { dateJa, yen } from '../lib/format'
import { todayInTokyo } from '../lib/time'
import type { Customer, Menu, Staff, Visit } from '../types'

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const { staff, menus } = useMaster()
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined)
  const [visits, setVisits] = useState<Visit[]>([])
  const [editing, setEditing] = useState(false)
  const [recording, setRecording] = useState(false)

  useEffect(() => subscribeCustomer(id, setCustomer), [id])
  useEffect(() => subscribeVisits(id, setVisits), [id])

  if (customer === undefined) return <p className="loading">読み込み中…</p>
  if (customer === null) return <p className="card empty">お客さんが見つかりません。<Link to="/customers">一覧へ</Link></p>

  const total = visits.reduce((s, v) => s + v.price, 0)
  const staffName = (sid: string) => staff.find((s) => s.id === sid)?.name ?? ''

  return (
    <section>
      <p><Link to="/customers">← お客さん一覧</Link></p>
      <div className="page-head">
        <h1>{customer.name} 様 <small>{customer.kana}</small></h1>
        <button onClick={() => setEditing(!editing)}>{editing ? 'やめる' : '編集'}</button>
      </div>
      {editing ? (
        <EditCustomer customer={customer} onDone={() => setEditing(false)} />
      ) : (
        <div className="card info-grid">
          <div><span>電話</span>{customer.phone || '—'}</div>
          <div><span>メール</span>{customer.email || '—'}</div>
          <div><span>最後の来店</span>{customer.lastVisit ? dateJa(customer.lastVisit) : '—'}</div>
          <div><span>来店回数・合計</span>{visits.length}回・{yen(total)}</div>
          <div className="wide"><span>メモ</span>{customer.memo || '—'}</div>
        </div>
      )}

      <div className="page-head">
        <h2>来店の記録</h2>
        <button className="primary" onClick={() => setRecording(true)}>＋ 来店を記録</button>
      </div>
      {recording && <VisitForm customerId={id} onDone={() => setRecording(false)} staff={staff} menus={menus} />}
      <div className="card">
        {visits.length === 0 && <p className="empty">まだ来店の記録はありません</p>}
        <ul className="timeline">
          {visits.map((v) => (
            <li key={v.id}>
              <span className="date">{dateJa(v.date)}</span>
              <span className="menu">{v.menuName}</span>
              <span className="staff">{staffName(v.staffId)}</span>
              <span className="price">{yen(v.price)}</span>
              {v.memo && <span className="memo">{v.memo}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function EditCustomer({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const [form, setForm] = useState({ name: customer.name, kana: customer.kana, phone: customer.phone, email: customer.email, memo: customer.memo })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await saveCustomer({ id: customer.id, ...form })
    onDone()
  }
  return (
    <form className="card form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>お名前<input value={form.name} onChange={set('name')} required /></label>
        <label>ふりがな<input value={form.kana} onChange={set('kana')} required /></label>
        <label>電話番号<input value={form.phone} onChange={set('phone')} /></label>
        <label>メール<input type="email" value={form.email} onChange={set('email')} /></label>
        <label className="wide">メモ<textarea value={form.memo} onChange={set('memo')} rows={2} /></label>
      </div>
      <div className="actions"><button className="primary">保存する</button></div>
    </form>
  )
}

function VisitForm({ customerId, onDone, staff, menus }: { customerId: string; onDone: () => void; staff: Staff[]; menus: Menu[] }) {
  const [date, setDate] = useState(todayInTokyo())
  const [menuId, setMenuId] = useState(menus[0].id)
  const [staffId, setStaffId] = useState(staff[0].id)
  const [memo, setMemo] = useState('')
  const [price, setPrice] = useState(menus[0].price)
  const menu = menus.find((m) => m.id === menuId)!

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await addVisit({ customerId, date, menuId, menuName: menu.name, staffId, price, memo })
    onDone()
  }
  return (
    <form className="card form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>日付<input type="date" value={date} max={todayInTokyo()} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>メニュー
          <select value={menuId} onChange={(e) => { setMenuId(e.target.value); setPrice(menus.find((m) => m.id === e.target.value)!.price) }}>
            {menus.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>担当
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>金額（円）<input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
        <label className="wide">メモ<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
      </div>
      <div className="actions">
        <button type="button" onClick={onDone}>やめる</button>
        <button className="primary">記録する</button>
      </div>
    </form>
  )
}
