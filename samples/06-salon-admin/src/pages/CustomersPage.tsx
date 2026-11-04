import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { saveCustomer, subscribeCustomers } from '../data/customers'
import { dateJa } from '../lib/format'
import { searchCustomers } from '../lib/customers'
import type { Customer } from '../types'

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  useEffect(() => subscribeCustomers(setCustomers), [])
  const list = useMemo(() => searchCustomers(customers, q), [customers, q])

  return (
    <section>
      <div className="page-head">
        <h1>お客さん <small>{customers.length}人</small></h1>
        <button className="primary" onClick={() => setAdding(true)}>＋ お客さんを追加</button>
      </div>
      <input className="search" type="search" placeholder="名前・ふりがな・電話番号でさがす" value={q} onChange={(e) => setQ(e.target.value)} />
      {adding && <NewCustomer onClose={() => setAdding(false)} />}
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr><th>お名前</th><th>電話</th><th>最後の来店</th><th className="hide-sm">メモ</th></tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/customers/${c.id}`}><strong>{c.name}</strong><br /><small>{c.kana}</small></Link></td>
                <td>{c.phone}</td>
                <td>{c.lastVisit ? dateJa(c.lastVisit) : '—'}</td>
                <td className="hide-sm memo">{c.memo}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="empty">見つかりませんでした</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function NewCustomer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', kana: '', phone: '', email: '', memo: '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const id = await saveCustomer(form)
    navigate(`/customers/${id}`)
  }
  return (
    <form className="card form" onSubmit={onSubmit}>
      <h2>お客さんを追加</h2>
      <div className="form-grid">
        <label>お名前<input value={form.name} onChange={set('name')} required /></label>
        <label>ふりがな<input value={form.kana} onChange={set('kana')} required /></label>
        <label>電話番号<input value={form.phone} onChange={set('phone')} inputMode="tel" /></label>
        <label>メール<input type="email" value={form.email} onChange={set('email')} /></label>
        <label className="wide">メモ<textarea value={form.memo} onChange={set('memo')} rows={2} /></label>
      </div>
      <div className="actions">
        <button type="button" onClick={onClose}>やめる</button>
        <button className="primary">追加する</button>
      </div>
    </form>
  )
}
