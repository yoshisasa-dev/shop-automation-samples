import { weekdayOf } from './time'

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

export function dateJa(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}月${d}日（${WEEK[weekdayOf(ymd)]}）`
}

export function yen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`
}
