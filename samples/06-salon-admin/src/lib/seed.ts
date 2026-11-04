// 見本用の架空データ（お客さん30人・過去の来店記録・2週間分の予約）
import { MENUS, STAFF, type Customer, type Reservation, type Visit } from '../types'
import { findConflict, isClosedDay, timeSlots } from './reservations'
import { addDays, addMinutes, toMinutes } from './time'

// 種つきの簡単な乱数（同じ種なら毎回同じ並び）
export function seeded(n: number): () => number {
  let s = n >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const NAMES: [string, string][] = [
  ['佐藤 美咲', 'さとう みさき'], ['鈴木 陽菜', 'すずき ひな'], ['高橋 結衣', 'たかはし ゆい'], ['田中 さくら', 'たなか さくら'],
  ['伊藤 葵', 'いとう あおい'], ['渡辺 美月', 'わたなべ みづき'], ['山本 彩', 'やまもと あや'], ['中村 優奈', 'なかむら ゆうな'],
  ['小林 真央', 'こばやし まお'], ['加藤 莉子', 'かとう りこ'], ['吉田 花音', 'よしだ かのん'], ['山田 花子', 'やまだ はなこ'],
  ['佐々木 楓', 'ささき かえで'], ['山口 杏', 'やまぐち あん'], ['松本 七海', 'まつもと ななみ'], ['井上 心春', 'いのうえ こはる'],
  ['木村 遥', 'きむら はるか'], ['林 明日香', 'はやし あすか'], ['斎藤 菜々子', 'さいとう ななこ'], ['清水 千尋', 'しみず ちひろ'],
  ['山崎 健太', 'やまざき けんた'], ['森 大輔', 'もり だいすけ'], ['池田 翔', 'いけだ しょう'], ['橋本 蓮', 'はしもと れん'],
  ['阿部 拓海', 'あべ たくみ'], ['石川 悠真', 'いしかわ ゆうま'], ['前田 湊', 'まえだ みなと'], ['藤田 智子', 'ふじた ともこ'],
  ['小川 恵', 'おがわ めぐみ'], ['岡田 由美', 'おかだ ゆみ'],
]
const MEMOS = ['', '', '', 'くせ毛。ストレート希望', 'カラーは明るめ希望', '肩こりがひどいのでスパ好き', '前回より短めに', '敏感肌。薬剤に注意', '子ども連れで来店することあり']
const VISIT_MEMOS = ['', '', '', 'いつも通り', '少し短めに', '次回カラー予定', 'トリートメントも提案']

export function buildSeed(today: string, rand: () => number = seeded(1)): { customers: Customer[]; visits: Visit[]; reservations: Reservation[] } {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]

  const customers: Customer[] = NAMES.map(([name, kana], i) => {
    const no = String(i + 1).padStart(2, '0')
    return {
      id: `c${no}`, name, kana,
      phone: `090-0000-${String(i + 1).padStart(4, '0')}`,
      email: `sample${no}@example.com`,
      memo: pick(MEMOS),
      lastVisit: null,
      createdAt: addDays(today, -200 + i),
    }
  })

  // 過去120日の来店記録（営業日のみ・1日0〜2件）
  const visits: Visit[] = []
  for (let d = -120; d < 0; d++) {
    const date = addDays(today, d)
    if (isClosedDay(date)) continue
    const count = Math.floor(rand() * 3)
    for (let k = 0; k < count; k++) {
      const menu = pick(MENUS)
      const customer = pick(customers)
      visits.push({
        id: `v${String(visits.length + 1).padStart(3, '0')}`,
        customerId: customer.id, date, menuId: menu.id, menuName: menu.name,
        staffId: pick(STAFF).id, price: menu.price, memo: pick(VISIT_MEMOS),
      })
    }
  }
  for (const c of customers) {
    const dates = visits.filter((v) => v.customerId === c.id).map((v) => v.date).sort()
    c.lastVisit = dates.at(-1) ?? null
  }

  // 今日から14日先までの予約（スタッフごとに0〜4件。今日は4件以上）
  const reservations: Reservation[] = []
  const slots = timeSlots()
  for (let d = 0; d <= 14; d++) {
    const date = addDays(today, d)
    if (isClosedDay(date)) continue
    for (const staff of STAFF) {
      const want = d === 0 ? 2 : Math.floor(rand() * 5)
      for (let tries = 0, made = 0; made < want && tries < 30; tries++) {
        const menu = pick(MENUS)
        const start = pick(slots)
        const end = addMinutes(start, menu.minutes)
        if (toMinutes(end) > toMinutes('19:00')) continue
        const id = `r${String(reservations.length + 1).padStart(3, '0')}`
        if (findConflict(reservations, { id, date, start, end, staffId: staff.id })) continue
        const customer = pick(customers)
        reservations.push({
          id, date, start, end, customerId: customer.id, customerName: customer.name,
          staffId: staff.id, menuId: menu.id, menuName: menu.name, status: 'booked', memo: '',
        })
        made++
      }
    }
  }
  return { customers, visits, reservations }
}
