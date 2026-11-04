import { describe, expect, it } from 'vitest'
import { addDays, addMinutes, fromMinutes, toMinutes, todayInTokyo, weekDays, weekdayOf } from './time'

describe('time', () => {
  it('時刻と分を行き来できる', () => {
    expect(toMinutes('10:30')).toBe(630)
    expect(fromMinutes(630)).toBe('10:30')
    expect(addMinutes('10:30', 90)).toBe('12:00')
  })

  it('今日の日付は東京の時刻で決まる', () => {
    expect(todayInTokyo(new Date('2026-11-01T16:30:00Z'))).toBe('2026-11-02')
    expect(todayInTokyo(new Date('2026-11-01T14:59:00Z'))).toBe('2026-11-01')
  })

  it('月末をまたいで日を足せる', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('曜日と、月曜はじまりの1週間', () => {
    expect(weekdayOf('2026-11-03')).toBe(2)
    expect(weekDays('2026-12-02')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'])
    expect(weekDays('2026-11-08')[0]).toBe('2026-11-02') // 日曜はその週の最後
  })
})
