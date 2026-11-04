import type { Customer } from '../types'

// 検索のための形にそろえる：全角英数→半角、カタカナ→ひらがな、空白・ハイフンを消す、小文字
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/(?<=\d)[ー−–—―‐](?=\d)/g, '') // 日本語入力で打つと数字のあいだのハイフンが「ー」などになる
    .replace(/[\s\-‐−–—―－]/g, '') // ふりがなの長音「ー」は残す
    .toLowerCase()
}

export function searchCustomers(list: Customer[], query: string): Customer[] {
  const q = normalizeForSearch(query)
  const sorted = [...list].sort((a, b) => a.kana.localeCompare(b.kana, 'ja'))
  if (!q) return sorted
  return sorted.filter((c) => [c.name, c.kana, c.phone].some((field) => normalizeForSearch(field).includes(q)))
}
