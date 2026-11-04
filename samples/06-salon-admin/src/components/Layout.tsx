import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { SHOP } from '../types'

const NAV = [
  { to: '/', label: '今日', icon: '☀︎' },
  { to: '/calendar', label: '予約', icon: '▦' },
  { to: '/customers', label: 'お客さん', icon: '☺︎' },
]

export function Layout() {
  const { user, signOut } = useAuth()
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{SHOP.name}</span>
        <span className="who">
          {user?.displayName ?? user?.email}
          <button className="link" onClick={signOut}>ログアウト</button>
        </span>
      </header>
      <nav className="sidenav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <span className="icon" aria-hidden>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
        <p className="note footer-note">※架空のサンプル店の見本です。表示されているお客さんはすべて架空です。</p>
      </main>
    </div>
  )
}
