import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { SHOP } from '../types'

export function LoginPage() {
  const { isMember, loading, error, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && isMember) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await signIn(email, password)
    setBusy(false)
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>{SHOP.name}</h1>
        <p className="sub">予約・顧客管理</p>
        <label>
          メールアドレス
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          パスワード
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'ログイン中…' : 'ログイン'}</button>
        <p className="note">※架空のサンプル店の見本です</p>
      </form>
    </main>
  )
}
