import { MENUS, STAFF, type Menu, type Staff } from '../types'

// スタッフとメニュー（見本では画面から変えないので、決まった値を使う）
export function useMaster(): { staff: Staff[]; menus: Menu[] } {
  return { staff: STAFF, menus: MENUS }
}
