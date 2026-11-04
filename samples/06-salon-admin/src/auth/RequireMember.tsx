import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function RequireMember({ children }: { children: ReactNode }) {
  const { isMember, loading } = useAuth()
  if (loading) return <p className="loading">読み込み中…</p>
  if (!isMember) return <Navigate to="/login" replace />
  return children
}
