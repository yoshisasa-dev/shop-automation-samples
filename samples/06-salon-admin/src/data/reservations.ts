import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import { findConflict } from '../lib/reservations'
import type { Reservation } from '../types'
import { converter } from './convert'

const reservationsRef = collection(db, 'reservations').withConverter(converter<Reservation>())

export function subscribeReservations(from: string, to: string, cb: (list: Reservation[]) => void): () => void {
  const q = query(reservationsRef, where('date', '>=', from), where('date', '<=', to))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data())))
}

type ReservationInput = Omit<Reservation, 'id' | 'status'> & { id?: string }
export type SaveResult = { ok: true; id: string } | { ok: false; conflict: Reservation }

// 保存の直前に、同じ日の予約を読み直して重なりを確かめる
export async function saveReservation({ id, ...fields }: ReservationInput): Promise<SaveResult> {
  const sameDay = await getDocs(query(reservationsRef, where('date', '==', fields.date)))
  const conflict = findConflict(sameDay.docs.map((d) => d.data()), { id: id ?? '', ...fields })
  if (conflict) return { ok: false, conflict }
  if (id) {
    await updateDoc(doc(db, 'reservations', id), { ...fields, status: 'booked' })
    return { ok: true, id }
  }
  const ref = await addDoc(collection(db, 'reservations'), { ...fields, status: 'booked' })
  return { ok: true, id: ref.id }
}

// 取り消しは消さずに印を付ける（あとから見返せるように）
export async function cancelReservation(id: string): Promise<void> {
  await updateDoc(doc(db, 'reservations', id), { status: 'cancelled' })
}
