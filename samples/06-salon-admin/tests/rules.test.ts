// Firestore のセキュリティルールのテスト（エミュレーターで動かす：npm run test:emu）
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-salon-kotori-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(() => env.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'members/staff1'), { name: '店長' })
    await setDoc(doc(ctx.firestore(), 'customers/c1'), { name: '山田 花子' })
  })
})

describe('店の人（members にいる人）', () => {
  it('お客さんを読める・予約を書ける', async () => {
    const db = env.authenticatedContext('staff1').firestore()
    await assertSucceeds(getDoc(doc(db, 'customers/c1')))
    await assertSucceeds(setDoc(doc(db, 'reservations/r1'), { date: '2026-11-05' }))
  })
  it('自分の members は読めるが、書きかえられない', async () => {
    const db = env.authenticatedContext('staff1').firestore()
    await assertSucceeds(getDoc(doc(db, 'members/staff1')))
    await assertFails(setDoc(doc(db, 'members/staff1'), { name: 'x' }))
  })
})

describe('ログインしているが members にいない人', () => {
  it('読めない・書けない・自分を members に入れられない', async () => {
    const db = env.authenticatedContext('stranger').firestore()
    await assertFails(getDoc(doc(db, 'customers/c1')))
    await assertFails(setDoc(doc(db, 'reservations/r1'), { date: '2026-11-05' }))
    await assertFails(setDoc(doc(db, 'members/stranger'), { name: 'x' }))
  })
})

describe('ログインしていない人', () => {
  it('読めない', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'customers/c1')))
  })
})
