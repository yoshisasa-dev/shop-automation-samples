import { collection, doc, onSnapshot, orderBy, query, runTransaction, where } from 'firebase/firestore'
import { db } from '../firebase'
import { todayInTokyo } from '../lib/time'
import type { Visit } from '../types'
import { converter } from './convert'

const visitsRef = collection(db, 'visits').withConverter(converter<Visit>())

export function subscribeVisits(customerId: string, cb: (list: Visit[]) => void): () => void {
  const q = query(visitsRef, where('customerId', '==', customerId))
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data()).sort((a, b) => b.date.localeCompare(a.date))))
}

// 集計用。新規の人数には「その人の最初の来店日」が要るので、全件を読む
export function subscribeAllVisits(cb: (list: Visit[]) => void): () => void {
  return onSnapshot(query(visitsRef, orderBy('date')), (snap) => cb(snap.docs.map((d) => d.data())))
}

// 来店を記録し、その人の最終来店日を新しい方に更新する
export async function addVisit(v: Omit<Visit, 'id'>): Promise<void> {
  // 打ちまちがいの未来の日付で、最終来店日がずっと戻らなくなるのを防ぐ
  if (v.date > todayInTokyo()) throw new Error('未来の日付の来店は記録できません')
  const customerRef = doc(db, 'customers', v.customerId)
  await runTransaction(db, async (tx) => {
    const customer = await tx.get(customerRef)
    const last = customer.data()?.lastVisit as string | null | undefined
    tx.set(doc(collection(db, 'visits')), v)
    if (!last || v.date > last) tx.update(customerRef, { lastVisit: v.date })
  })
}
