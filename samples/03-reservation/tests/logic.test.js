// Logic.gs の単体テスト
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./loadGas');

const g = loadGas(['Logic.gs']);
const plain = (v) => JSON.parse(JSON.stringify(v));

const RULES = {
  openMin: 600, closeMin: 1140, stepMin: 30, bufferMin: 10, breakRange: [780, 840],
  closedDays: ['水'], maxDaysAhead: 30, leadMin: 180, cancelDaysBefore: 1, cancelMin: 1080
};

test('時刻と範囲の読み書き', () => {
  assert.equal(g.parseHmToMin('10:30'), 630);
  assert.equal(g.parseHmToMin('ab'), null);
  assert.equal(g.minToHm(630), '10:30');
  assert.deepEqual(plain(g.parseRange('13:00-14:00')), [780, 840]);
  assert.deepEqual(plain(g.parseRange('13:00〜14:00')), [780, 840]);
  assert.equal(g.parseRange(''), null);
  assert.equal(g.parseRange('14:00-13:00'), null);
  assert.equal(g.formatDateJa('2026-10-30'), '10月30日（金）');
});

test('空きの時間：休憩をよけ、閉店までに終わるものだけ', () => {
  const slots = g.slotsFor('2026-10-30', 60, RULES, [], '2026-10-29 09:00');
  assert.equal(slots[0], '10:00');
  assert.ok(!slots.includes('12:30'));
  assert.ok(!slots.includes('13:00'));
  assert.ok(slots.includes('14:00'));
  assert.equal(slots[slots.length - 1], '18:00');
});

test('ほかの予約の前後に準備時間をとる', () => {
  // 11:00〜12:00 がふさがっている。60分のメニュー・準備10分
  const slots = g.slotsFor('2026-10-30', 60, RULES, [[660, 720]], '2026-10-29 09:00');
  assert.ok(!slots.includes('10:00'));
  assert.ok(!slots.includes('11:00'));
  assert.ok(!slots.includes('11:30'));
  assert.ok(!slots.includes('12:00'));
  assert.ok(slots.includes('14:00'));
  // 30分メニューなら 10:00〜10:30 は入る（10:40 までに準備が終わる）
  assert.ok(g.slotsFor('2026-10-30', 30, RULES, [[660, 720]], '2026-10-29 09:00').includes('10:00'));
});

test('定休日・過去・何日先までを超える日は空きなし', () => {
  assert.deepEqual(plain(g.slotsFor('2026-11-04', 60, RULES, [], '2026-10-29 09:00')), []);
  assert.deepEqual(plain(g.slotsFor('2026-10-28', 60, RULES, [], '2026-10-29 09:00')), []);
  assert.deepEqual(plain(g.slotsFor('2026-11-29', 60, RULES, [], '2026-10-29 09:00')), []);
  assert.ok(g.slotsFor('2026-11-28', 60, RULES, [], '2026-10-29 09:00').length > 0);
});

test('当日は、今から3時間後より先だけ', () => {
  const slots = g.slotsFor('2026-10-30', 60, RULES, [], '2026-10-30 11:10');
  assert.equal(slots[0], '14:30');
});

test('予約画面に出す日にち', () => {
  const dates = g.bookableDates('2026-10-29 09:00', { ...RULES, maxDaysAhead: 7 });
  assert.equal(dates.length, 8);
  assert.deepEqual(plain(dates[0]), { date: '2026-10-29', label: '10月29日（木）', closed: false });
  assert.equal(dates.find((d) => d.date === '2026-11-04').closed, true);
});

test('キャンセルの締め切りは前日18:00', () => {
  assert.equal(g.cancelDeadline('2026-10-31', RULES), '2026-10-30 18:00');
  assert.equal(g.canCancel('2026-10-31', '2026-10-30 18:00', RULES), true);
  assert.equal(g.canCancel('2026-10-31', '2026-10-30 18:01', RULES), false);
});

test('入力のチェック', () => {
  const ok = g.validateCustomer({ name: ' 山田 花子 ', phone: '090-0000-0000', email: 'hanako@example.com', note: '' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, '山田 花子');
  const ng = g.validateCustomer({ name: '', phone: '123', email: 'x', note: 'あ'.repeat(301) });
  assert.equal(ng.ok, false);
  assert.equal(ng.errors.length, 4);
});

test('予約番号とメール', () => {
  assert.equal(g.makeBookingNo('2026-10-29', 3), 'R20261029-003');
  const b = { bookingNo: 'R20261029-003', date: '2026-10-31', start: '14:00', end: '15:00', menuName: 'しっかり整体コース',
    minutes: 60, price: 6600, name: '山田 花子', phone: '090-0000-0000', email: 'hanako@example.com', note: '' };
  const m = g.buildConfirmMail(b, '整体サロン ゆるり（サンプル店）', 'https://example.com/exec?cancel=abc', '10月30日（金） 18:00');
  assert.match(m.subject, /ご予約を承りました（10月31日（土） 14:00）/);
  assert.match(m.body, /しっかり整体コース（60分・6,600円）/);
  assert.match(m.body, /cancel=abc/);
  assert.match(g.buildReminderMail(b, 'ゆるり').subject, /明日のご予約/);
  assert.match(g.buildShopNotice(b).body, /090-0000-0000/);
  assert.match(g.buildShopCancelNotice(b).subject, /【キャンセル】/);
});
