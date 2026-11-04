// データの読み書きのテスト（エミュレーターで動かす：npm run test:emu）
import { deleteApp, getApps } from 'firebase-admin/app'
import { initializeApp as initAdmin } from 'firebase-admin/app'
import { getFirestore as getAdminDb } from 'firebase-admin/firestore'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getCustomer, saveCustomer } from '../src/data/customers'
import { addVisit } from '../src/data/visits'
import { cancelReservation, saveReservation } from '../src/data/reservations'
import { auth } from '../src/firebase'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = getAdminDb(initAdmin({ projectId: 'demo-salon-kotori' }, 'test-admin'))

const base = { customerId: 'c1', customerName: '山田 花子', menuId: 'm1', menuName: 'カット', memo: '' }

beforeAll(async () => {
  const cred = await createUserWithEmailAndPassword(auth, `t${Date.now()}@example.com`, 'test-password-1')
  await admin.doc(`members/${cred.user.uid}`).set({ name: 'テスト' })
  for (const d of (await admin.collection('reservations').get()).docs) await d.ref.delete()
})
afterAll(async () => {
  await Promise.all(getApps().map((a) => deleteApp(a)))
})

describe('saveReservation', () => {
  it('重なる予約は保存せず、重なった相手を返す。取り消すと入れられる', async () => {
    const a = await saveReservation({ ...base, date: '2026-11-05', start: '10:00', end: '11:00', staffId: 's1' })
    expect(a.ok).toBe(true)
    const b = await saveReservation({ ...base, date: '2026-11-05', start: '10:30', end: '11:30', staffId: 's1' })
    expect(b).toMatchObject({ ok: false, conflict: { start: '10:00', end: '11:00' } })
    if (!a.ok) throw new Error('unreachable')
    await cancelReservation(a.id)
    const c = await saveReservation({ ...base, date: '2026-11-05', start: '10:30', end: '11:30', staffId: 's1' })
    expect(c.ok).toBe(true)
  })

  it('自分の予約の時間を少しずらす変更はできる', async () => {
    const a = await saveReservation({ ...base, date: '2026-11-06', start: '10:00', end: '11:00', staffId: 's2' })
    if (!a.ok) throw new Error('保存できなかった')
    const moved = await saveReservation({ ...base, id: a.id, date: '2026-11-06', start: '10:30', end: '11:30', staffId: 's2' })
    expect(moved).toEqual({ ok: true, id: a.id })
  })
})

describe('addVisit', () => {
  it('最終来店日は新しい方に更新され、古い日を足しても戻らない', async () => {
    const id = await saveCustomer({ name: '山田 花子', kana: 'やまだ はなこ', phone: '090-0000-0001', email: 'sample@example.com', memo: '' })
    await addVisit({ customerId: id, date: '2026-11-01', menuId: 'm1', menuName: 'カット', staffId: 's1', price: 4950, memo: '' })
    await addVisit({ customerId: id, date: '2026-10-01', menuId: 'm1', menuName: 'カット', staffId: 's1', price: 4950, memo: '' })
    expect((await getCustomer(id))?.lastVisit).toBe('2026-11-01')
  })

  it('未来の日付の来店は記録できず、最終来店日も変わらない', async () => {
    const id = await saveCustomer({ name: '未来 太郎', kana: 'みらい たろう', phone: '', email: '', memo: '' })
    await expect(addVisit({ customerId: id, date: '2099-01-01', menuId: 'm1', menuName: 'カット', staffId: 's1', price: 4950, memo: '' })).rejects.toThrow('未来の日付')
    expect((await getCustomer(id))?.lastVisit).toBeNull()
  })
})
