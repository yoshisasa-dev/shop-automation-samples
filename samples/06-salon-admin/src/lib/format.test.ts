import { describe, expect, it } from 'vitest'
import { dateJa, yen } from './format'

describe('format', () => {
  it('日付を「11月2日（月）」の形にする', () => {
    expect(dateJa('2026-11-02')).toBe('11月2日（月）')
    expect(dateJa('2026-12-01')).toBe('12月1日（火）')
  })
  it('金額を「4,950円」の形にする', () => {
    expect(yen(4950)).toBe('4,950円')
    expect(yen(0)).toBe('0円')
  })
})
