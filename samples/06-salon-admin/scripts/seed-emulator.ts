// エミュレーターに、見本用のログインユーザーとサンプルデータを入れる（npm run emulators を動かしてから npm run seed）
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { buildSeed } from '../src/lib/seed'
import { todayInTokyo } from '../src/lib/time'
import { MENUS, STAFF } from '../src/types'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'

const demo = JSON.parse(readFileSync(new URL('./demo-user.json', import.meta.url), 'utf8'))
initializeApp({ projectId: 'demo-salon-kotori' })
const auth = getAuth()
const db = getFirestore()

async function clear(name: string) {
  const snap = await db.collection(name).get()
  const batch = db.batch()
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
}

async function main() {
  const user = await auth.getUserByEmail(demo.email).catch(() =>
    auth.createUser({ email: demo.email, password: demo.password, displayName: demo.displayName }),
  )
  await db.doc(`members/${user.uid}`).set({ name: demo.displayName })

  const { customers, visits, reservations } = buildSeed(todayInTokyo())
  for (const name of ['customers', 'visits', 'reservations', 'staff', 'menus']) await clear(name)

  const batch = db.batch()
  const put = (col: string, items: { id: string }[]) =>
    items.forEach(({ id, ...data }) => batch.set(db.doc(`${col}/${id}`), data))
  put('staff', STAFF)
  put('menus', MENUS)
  put('customers', customers)
  put('visits', visits)
  put('reservations', reservations)
  await batch.commit()
  console.log(`入れました：お客さん${customers.length}人・来店${visits.length}件・予約${reservations.length}件・スタッフ${STAFF.length}人`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
