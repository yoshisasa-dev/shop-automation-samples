// データの形と、お店の決まり（架空の「ヘアサロン ことり」）

export type Staff = { id: string; name: string; color: string }
export type Menu = { id: string; name: string; minutes: number; price: number }

export type Customer = {
  id: string
  name: string
  kana: string
  phone: string
  email: string
  memo: string
  lastVisit: string | null // YYYY-MM-DD
  createdAt: string
}

export type Visit = {
  id: string
  customerId: string
  date: string // YYYY-MM-DD
  menuId: string
  menuName: string
  staffId: string
  price: number
  memo: string
}

export type Reservation = {
  id: string
  date: string // YYYY-MM-DD
  start: string // HH:MM
  end: string // HH:MM
  customerId: string
  customerName: string
  staffId: string
  menuId: string
  menuName: string
  status: 'booked' | 'cancelled'
  memo: string
}

export const STAFF: Staff[] = [
  { id: 's1', name: '店長 小鳥遊 ひかり', color: '#4f9d8a' },
  { id: 's2', name: '佐伯 みなと', color: '#d08a5a' },
  { id: 's3', name: '野村 あおい', color: '#7a87c9' },
]

export const MENUS: Menu[] = [
  { id: 'm1', name: 'カット', minutes: 60, price: 4950 },
  { id: 'm2', name: 'カット＋カラー', minutes: 120, price: 11000 },
  { id: 'm3', name: 'パーマ', minutes: 120, price: 12100 },
  { id: 'm4', name: 'ヘッドスパ', minutes: 30, price: 3300 },
  { id: 'm5', name: '前髪カット', minutes: 30, price: 1100 },
]

export const SHOP = {
  name: 'ヘアサロン ことり（サンプル店）',
  open: '10:00',
  close: '19:00',
  closedWeekdays: [2], // 火曜
  slotMinutes: 30,
  staff: STAFF,
  menus: MENUS,
} as const
