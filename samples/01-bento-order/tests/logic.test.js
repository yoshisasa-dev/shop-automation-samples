// Logic.gs の単体テスト（node --test tests/*.test.js で実行）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./loadGas');

const g = loadGas(['Logic.gs']);

const MENU = [
  { name: '唐揚げ弁当', price: 650 },
  { name: '鮭弁当', price: 700 },
  { name: 'お茶（500ml）', price: 150 }
];

test('addDaysYmd は月末・年末・うるう年をまたげる', () => {
  assert.equal(g.addDaysYmd('2026-10-31', 1), '2026-11-01');
  assert.equal(g.addDaysYmd('2026-01-01', -1), '2025-12-31');
  assert.equal(g.addDaysYmd('2028-02-28', 1), '2028-02-29');
});

test('weekdayOf', () => {
  assert.equal(g.weekdayOf('2026-10-28'), '水');
  assert.equal(g.weekdayOf('2026-11-01'), '日');
});

test('normalizeHm と parseList', () => {
  assert.equal(g.normalizeHm('9:00'), '09:00');
  assert.equal(g.normalizeHm(' 15:5 '), '15:05');
  assert.deepEqual(Array.from(g.parseList('土, 日、祝')), ['土', '日', '祝']);
  assert.deepEqual(Array.from(g.parseList('')), []);
});

test('formatYen', () => {
  assert.equal(g.formatYen(650), '650');
  assert.equal(g.formatYen(1234567), '1,234,567');
});

test('個数欄の見出しと商品名の変換', () => {
  assert.equal(g.quantityTitle('幕の内弁当', 1200), '幕の内弁当（1,200円）');
  assert.equal(g.nameFromQuantityTitle('幕の内弁当（1,200円）'), '幕の内弁当');
  assert.equal(g.nameFromQuantityTitle('お茶（500ml）（150円）'), 'お茶（500ml）');
  assert.equal(g.nameFromQuantityTitle('お名前'), null);
});

test('isPastDeadline は前日15:00ちょうどまで受け付ける', () => {
  assert.equal(g.isPastDeadline('2026-10-30', '2026-10-29 15:00', 1, '15:00'), false);
  assert.equal(g.isPastDeadline('2026-10-30', '2026-10-29 15:01', 1, '15:00'), true);
  assert.equal(g.isPastDeadline('2026-11-01', '2026-10-31 09:00', 1, '9:00'), false);
  assert.equal(g.isPastDeadline('2026-10-30', '2026-10-30 08:00', 0, '9:00'), false);
});

test('calcOrder は0個や未知の商品を数えない', () => {
  const r = g.calcOrder({ 唐揚げ弁当: 3, 鮭弁当: 0, 謎の弁当: 5, 'お茶（500ml）': '2' }, MENU);
  assert.equal(r.totalQty, 5);
  assert.equal(r.totalPrice, 650 * 3 + 150 * 2);
  assert.equal(r.lines.length, 2);
});

const CTX = {
  nowYmdHm: '2026-10-28 10:00',
  daysBefore: 1,
  deadlineHm: '15:00',
  closedDays: ['日'],
  capacity: 100,
  bookedQty: 0
};

test('checkOrder：受付できる注文', () => {
  assert.deepEqual({ ...g.checkOrder('2026-10-30', 3, CTX) }, { status: g.STATUS_OK, reason: '' });
});

test('checkOrder：商品なし・定休日・締切後・上限超過', () => {
  assert.match(g.checkOrder('2026-10-30', 0, CTX).reason, /商品が選ばれていません/);
  assert.match(g.checkOrder('2026-11-01', 3, CTX).reason, /日曜日は定休日/);
  const late = g.checkOrder('2026-10-29', 3, { ...CTX, nowYmdHm: '2026-10-28 15:30' });
  assert.equal(late.status, g.STATUS_NG);
  assert.match(late.reason, /2026-10-28 15:00 で締め切りました/);
  const full = g.checkOrder('2026-10-30', 10, { ...CTX, bookedQty: 95 });
  assert.equal(full.status, g.STATUS_NG);
  assert.match(full.reason, /あと 5 個まで/);
  assert.equal(g.checkOrder('2026-10-30', 5, { ...CTX, bookedQty: 95 }).status, g.STATUS_OK);
});

test('checkOrder：1回の上限個数と、何日先まで', () => {
  const ctx = { ...CTX, maxQtyPerOrder: 30, maxDaysAhead: 30 };
  assert.match(g.checkOrder('2026-10-30', 31, ctx).reason, /1回のご注文は 30 個まで/);
  assert.equal(g.checkOrder('2026-10-30', 30, ctx).status, g.STATUS_OK);
  assert.equal(g.checkOrder('2026-11-27', 3, ctx).status, g.STATUS_OK);
  assert.match(g.checkOrder('2026-11-28', 3, ctx).reason, /30 日先の分まで/);
});

test('sanitizeCell は式になりうる文字の先頭に \' を付ける', () => {
  assert.equal(g.sanitizeCell('=IMPORTDATA("https://example.com")'), '\'=IMPORTDATA("https://example.com")');
  assert.equal(g.sanitizeCell('+81-90-0000-0000'), "'+81-90-0000-0000");
  assert.equal(g.sanitizeCell('-'), "'-");
  assert.equal(g.sanitizeCell('@foo'), "'@foo");
  assert.equal(g.sanitizeCell('えびアレルギー'), 'えびアレルギー');
  assert.equal(g.sanitizeCell(12), 12);
});

test('makeOrderNo', () => {
  assert.equal(g.makeOrderNo('2026-10-28', 7), '20261028-007');
  assert.equal(g.makeOrderNo('2026-10-28', 1234), '20261028-1234');
});

test('buildCustomerMail：受付済みと受付不可で文面が変わる', () => {
  const order = { orderNo: '20261028-001', name: '佐藤 美咲', date: '2026-10-30', time: '12:00', method: '店頭受け取り', note: '' };
  const calc = g.calcOrder({ 唐揚げ弁当: 2 }, MENU);
  const ok = g.buildCustomerMail(order, calc, { status: g.STATUS_OK, reason: '' }, 'まるっと弁当（サンプル店）');
  assert.match(ok.subject, /ご注文を承りました/);
  assert.match(ok.body, /2026-10-30（金） 12:00/);
  assert.match(ok.body, /唐揚げ弁当　650円 × 2 ＝ 1,300円/);
  assert.match(ok.body, /アレルギー・ご要望：なし/);
  assert.match(ok.body, /架空のサンプル店/);
  const ng = g.buildCustomerMail(order, calc, { status: g.STATUS_NG, reason: '日曜日は定休日のため、お受けできませんでした。' }, 'まるっと弁当（サンプル店）');
  assert.match(ng.subject, /お受けできませんでした/);
  assert.match(ng.body, /定休日/);
});

test('aggregateProduction：受付済みの対象日だけを集計する', () => {
  const orders = [
    { orderNo: '1', status: g.STATUS_OK, date: '2026-10-30', time: '12:00', name: 'A', note: 'えびアレルギー', quantities: { 唐揚げ弁当: 2, 鮭弁当: 1 } },
    { orderNo: '2', status: g.STATUS_OK, date: '2026-10-30', time: '11:00', name: 'B', note: '', quantities: { 唐揚げ弁当: 3 } },
    { orderNo: '3', status: g.STATUS_NG, date: '2026-10-30', time: '12:00', name: 'C', note: '', quantities: { 唐揚げ弁当: 9 } },
    { orderNo: '4', status: g.STATUS_OK, date: '2026-10-31', time: '12:00', name: 'D', note: '', quantities: { 鮭弁当: 9 } },
    { orderNo: '5', status: g.STATUS_OK, date: '2026-10-30', time: '13:15', name: 'E', note: '', quantities: { 鮭弁当: 1 } }
  ];
  const agg = g.aggregateProduction(orders, '2026-10-30', ['唐揚げ弁当', '鮭弁当'], ['11:00', '12:00']);
  assert.equal(agg.orderCount, 3);
  assert.equal(agg.totalQty, 7);
  assert.deepEqual(agg.byProduct.map(p => p.qty), [5, 2]);
  assert.deepEqual(agg.bySlot.map(s => s.slot), ['11:00', '12:00', '13:15']);
  assert.deepEqual(agg.bySlot.map(s => s.total), [3, 3, 1]);
  assert.equal(agg.notes.length, 1);

  const mail = g.buildProductionMail(agg, 'まるっと弁当（サンプル店）');
  assert.match(mail.subject, /2026-10-30（金）　合計7個/);
  assert.match(mail.body, /12:00（3個）：唐揚げ弁当 2、鮭弁当 1/);
  assert.match(mail.body, /えびアレルギー/);
});
