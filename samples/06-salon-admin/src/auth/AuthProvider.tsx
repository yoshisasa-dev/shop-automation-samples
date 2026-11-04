import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, db } from '../firebase'

type AuthState = {
  user: User | null
  isMember: boolean
  loading: boolean
  error: string
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isMember, setIsMember] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setLoading(true)
        if (!u) {
          setUser(null)
          setIsMember(false)
          setLoading(false)
          return
        }
        // 店の人として登録されているか（members/{uid}）を確かめる
        const member = await getDoc(doc(db, 'members', u.uid)).catch(() => null)
        if (member?.exists()) {
          setUser(u)
          setIsMember(true)
        } else {
          setError('このアカウントには権限がありません')
          await fbSignOut(auth)
        }
        setLoading(false)
      }),
    [],
  )

  async function signIn(email: string, password: string) {
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch {
      setError('メールアドレスかパスワードがちがいます')
    }
  }

  const value: AuthState = { user, isMember, loading, error, signIn, signOut: () => fbSignOut(auth) }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider の中で使ってください')
  return ctx
}
