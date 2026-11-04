import { describe, expect, it } from 'vitest'
import type { Customer } from '../types'
import { normalizeForSearch, searchCustomers } from './customers'

const c = (o: Partial<Customer> = {}): Customer => ({
  id: 'c1', name: '山田 花子', kana: 'やまだ はなこ', phone: '090-0000-0001', email: '', memo: '',
  lastVisit: null, createdAt: '', ...o,
})

describe('searchCustomers', () => {
  it('カタカナで入れても、ひらがなのふりがなに当たる', () => {
    expect(searchCustomers([c()], 'ヤマダ')).toHaveLength(1)
  })
  it('電話番号はハイフンなし・全角でも当たる', () => {
    expect(searchCustomers([c()], '09000000001')).toHaveLength(1)
    expect(searchCustomers([c()], '０００１')).toHaveLength(1)
  })
  it('日本語入力で打ったハイフン（ー・−・–）でも電話番号に当たる', () => {
    expect(searchCustomers([c()], '０９０ー００００')).toHaveLength(1)
    expect(searchCustomers([c()], '090−0000−0001')).toHaveLength(1)
    expect(searchCustomers([c()], '090–0000')).toHaveLength(1)
  })
  it('ふりがなの長音「ー」は消さない', () => {
    expect(normalizeForSearch('ユーマ')).toBe('ゆーま')
  })
  it('名前の漢字でも当たり、関係ない語では当たらない', () => {
    expect(searchCustomers([c()], '花子')).toHaveLength(1)
    expect(searchCustomers([c()], '佐藤')).toHaveLength(0)
  })
  it('空の検索語なら全員を、ふりがな順に返す', () => {
    const list = [c({ id: 'b', kana: 'わたなべ' }), c({ id: 'a', kana: 'あべ' })]
    expect(searchCustomers(list, '  ').map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('正規化：カタカナ→ひらがな、空白とハイフンを消す', () => {
    expect(normalizeForSearch('ヤマダ ハナコ 090-1')).toBe('やまだはなこ0901')
  })
})
