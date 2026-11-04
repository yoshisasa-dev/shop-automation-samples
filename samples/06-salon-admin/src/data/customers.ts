import { addDoc, collection, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { todayInTokyo } from '../lib/time'
import type { Customer } from '../types'
import { converter } from './convert'

export const customersRef = collection(db, 'customers').withConverter(converter<Customer>())

export function subscribeCustomers(cb: (list: Customer[]) => void): () => void {
  return onSnapshot(customersRef, (snap) => cb(snap.docs.map((d) => d.data())))
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const snap = await getDoc(doc(customersRef, id))
  return snap.exists() ? snap.data() : null
}

export function subscribeCustomer(id: string, cb: (c: Customer | null) => void): () => void {
  return onSnapshot(doc(customersRef, id), (snap) => cb(snap.exists() ? snap.data() : null))
}

type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'lastVisit'> & { id?: string }

export async function saveCustomer({ id, ...fields }: CustomerInput): Promise<string> {
  if (id) {
    await updateDoc(doc(db, 'customers', id), fields)
    return id
  }
  const ref = await addDoc(collection(db, 'customers'), { ...fields, lastVisit: null, createdAt: todayInTokyo() })
  return ref.id
}
