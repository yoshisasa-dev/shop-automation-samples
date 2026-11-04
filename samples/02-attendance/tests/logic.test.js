// Logic.gs の単体テスト
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./loadGas');

const g = loadGas(['Logic.gs']);

const RULES = { dailyLimitMin: 480, nightStartMin: 22 * 60, nightEndMin: 5 * 60, roundUnitMin: 1 };

function p(at, type, staffId = 'S01', name = '青木 ひなた') {
  return { staffId, name, at, type };
}

// vm の中で作られた配列は deepEqual で比べにくいので、ふつうの値に直す
const plain = (v) => JSON.parse(JSON.stringify(v));

test('normalizeDateTime はいろいろな書き方を YYYY-MM-DD HH:mm にそろえる', () => {
  assert.equal(g.normalizeDateTime('2026/10/5 9:03'), '2026-10-05 09:03');
  assert.equal(g.normalizeDateTime('2026-10-05 09:03:59'), '2026-10-05 09:03');
  assert.equal(g.normalizeDateTime('2026-02-30 09:00'), null);
  assert.equal(g.normalizeDateTime('9:00'), null);
  assert.equal(g.normalizeDateTime(''), null);
});

test('parseHmToMin と formatDuration', () => {
  assert.equal(g.parseHmToMin('22:00'), 1320);
  assert.equal(g.parseHmToMin('5:00'), 300);
  assert.equal(g.parseHmToMin('25:00'), null);
  assert.equal(g.formatDuration(465), '7:45');
  assert.equal(g.formatDuration(0), '0:00');
  assert.equal(g.formatDuration(null), '');
});

test('ふつうの勤務：休憩を引いて、所定を超えた分が残業', () => {
  const shifts = g.buildShifts([
    p('2026-10-05 09:00', '出勤'), p('2026-10-05 12:00', '休憩'),
    p('2026-10-05 13:00', '戻り'), p('2026-10-05 18:30', '退勤')
  ], '2026-10-29 09:00');
  assert.equal(shifts.length, 1);
  assert.deepEqual(plain(shifts[0].issues), []);
  assert.deepEqual(plain(g.calcShift(shifts[0], RULES)), { workMin: 510, breakMin: 60, overtimeMin: 30, nightMin: 0 });
});

test('夜をまたぐ勤務は出勤した日として数え、深夜の休憩は深夜から引く', () => {
  const shifts = g.buildShifts([
    p('2026-10-05 18:00', '出勤'), p('2026-10-05 23:00', '休憩'),
    p('2026-10-05 23:30', '戻り'), p('2026-10-06 02:00', '退勤')
  ], '2026-10-29 09:00');
  assert.equal(shifts[0].date, '2026-10-05');
  const c = g.calcShift(shifts[0], RULES);
  assert.equal(c.workMin, 450);
  assert.equal(c.nightMin, 240 - 30);
});

test('朝5時までも深夜に入る', () => {
  assert.equal(g.nightOverlap('2026-10-06 04:00', '2026-10-06 08:00', 1320, 300), 60);
  assert.equal(g.nightOverlap('2026-10-06 09:00', '2026-10-06 17:00', 1320, 300), 0);
  assert.equal(g.nightOverlap('2026-10-06 09:00', '2026-10-06 17:00', 600, 600), 0);
});

test('端数処理（15分）は切り捨て', () => {
  const shifts = g.buildShifts([p('2026-10-05 09:00', '出勤'), p('2026-10-05 15:14', '退勤')], '2026-10-29 09:00');
  assert.equal(g.calcShift(shifts[0], { ...RULES, roundUnitMin: 15 }).workMin, 360);
  assert.equal(g.calcShift(shifts[0], RULES).workMin, 374);
});

test('退勤を忘れたまま次の日に出勤すると、前の日は「退勤の打刻なし」', () => {
  const shifts = g.buildShifts([
    p('2026-10-05 09:00', '出勤'), p('2026-10-06 09:00', '出勤'), p('2026-10-06 17:00', '退勤')
  ], '2026-10-29 09:00');
  assert.deepEqual(plain(shifts[0].issues), ['退勤の打刻なし']);
  assert.equal(shifts[0].state, '要確認');
  assert.equal(g.calcShift(shifts[0], RULES), null);
  assert.deepEqual(plain(shifts[1].issues), []);
});

test('退勤前で出勤から20時間以内なら「勤務中」、過ぎたら打刻忘れ', () => {
  const punches = [p('2026-10-29 07:00', '出勤'), p('2026-10-29 10:00', '休憩')];
  const working = g.buildShifts(punches, '2026-10-29 10:30');
  assert.equal(working[0].state, '勤務中');
  assert.deepEqual(plain(g.allowedActions(working[0])), ['戻り']);
  const later = g.buildShifts(punches, '2026-10-30 04:00');
  assert.deepEqual(plain(later[0].issues), ['退勤の打刻なし']);
  assert.deepEqual(plain(g.allowedActions(later[0])), ['出勤']);
});

test('押せるボタン', () => {
  assert.deepEqual(plain(g.allowedActions(undefined)), ['出勤']);
  const working = g.buildShifts([p('2026-10-29 07:00', '出勤')], '2026-10-29 08:00')[0];
  assert.deepEqual(plain(g.allowedActions(working)), ['休憩', '退勤']);
  const done = g.buildShifts([p('2026-10-29 07:00', '出勤'), p('2026-10-29 15:00', '退勤')], '2026-10-29 16:00')[0];
  assert.deepEqual(plain(g.allowedActions(done)), ['出勤']);
});

test('出勤なしの退勤・戻りなしの退勤・順番ちがい', () => {
  const shifts = g.buildShifts([
    p('2026-10-05 17:00', '退勤'),
    p('2026-10-06 09:00', '出勤'), p('2026-10-06 12:00', '休憩'), p('2026-10-06 18:00', '退勤'),
    p('2026-10-07 09:00', '出勤'), p('2026-10-07 10:00', '戻り'), p('2026-10-07 17:00', '退勤')
  ], '2026-10-29 09:00');
  assert.deepEqual(plain(shifts.map((s) => s.issues)), [['出勤の打刻なし'], ['戻りの打刻なし'], ['打刻の順番がおかしい']]);
});

test('スタッフごとに分かれ、順番がばらばらでもまとまる', () => {
  const shifts = g.buildShifts([
    p('2026-10-05 15:00', '退勤', 'S02', '井上 蓮'),
    p('2026-10-05 09:00', '出勤', 'S01'),
    p('2026-10-05 07:00', '出勤', 'S02', '井上 蓮'),
    p('2026-10-05 17:00', '退勤', 'S01')
  ], '2026-10-29 09:00');
  assert.deepEqual(plain(shifts.map((s) => [s.staffId, s.in, s.out])), [
    ['S01', '2026-10-05 09:00', '2026-10-05 17:00'],
    ['S02', '2026-10-05 07:00', '2026-10-05 15:00']
  ]);
});

test('periodFor：月末締めと20日締め', () => {
  assert.deepEqual(plain(g.periodFor('2026-10-29', '末')), { start: '2026-10-01', end: '2026-10-31', label: '2026年10月分' });
  assert.deepEqual(plain(g.periodFor('2026-02-10', '末')), { start: '2026-02-01', end: '2026-02-28', label: '2026年2月分' });
  assert.deepEqual(plain(g.periodFor('2026-10-20', '20')), { start: '2026-09-21', end: '2026-10-20', label: '2026年10月分' });
  assert.deepEqual(plain(g.periodFor('2026-10-21', '20')), { start: '2026-10-21', end: '2026-11-20', label: '2026年11月分' });
  assert.deepEqual(plain(g.periodFor('2026-12-25', '20')), { start: '2026-12-21', end: '2027-01-20', label: '2027年1月分' });
  assert.deepEqual(plain(g.periodFor('2026-10-29', 'あ')), { start: '2026-10-01', end: '2026-10-31', label: '2026年10月分' });
  assert.deepEqual(plain(g.previousPeriod(g.periodFor('2026-01-15', '末'), '末')), { start: '2025-12-01', end: '2025-12-31', label: '2025年12月分' });
});

test('summarizePeriod：期間内だけ集計し、割増を入れたお給料の目安を出す', () => {
  const shifts = g.buildShifts([
    p('2026-09-30 09:00', '出勤'), p('2026-09-30 17:00', '退勤'),
    p('2026-10-05 09:00', '出勤'), p('2026-10-05 18:00', '退勤'),
    p('2026-10-06 15:00', '出勤'), p('2026-10-06 23:00', '退勤'),
    p('2026-10-07 09:00', '出勤')
  ], '2026-10-29 09:00');
  shifts.forEach((s) => { s.calc = g.calcShift(s, RULES); });
  const staff = [
    { id: 'S01', name: '青木 ひなた', wage: 1200, active: true },
    { id: 'S09', name: '退職した人', wage: 1000, active: false }
  ];
  const { rows, total } = g.summarizePeriod(shifts, staff, g.periodFor('2026-10-10', '末'), { premiumOvertime: 0.25, premiumNight: 0.25 });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.days, 2);
  assert.equal(r.workMin, 540 + 480);
  assert.equal(r.overtimeMin, 60);
  assert.equal(r.nightMin, 60);
  assert.equal(r.issues, 1);
  assert.equal(r.pay, Math.round(1200 * (1020 + 15 + 15) / 60));
  assert.equal(total.pay, r.pay);
});

test('buildMissingMail', () => {
  const shifts = g.buildShifts([p('2026-10-26 10:00', '出勤')], '2026-10-29 09:00');
  const mail = g.buildMissingMail('カフェ ひだまり（サンプル店）', shifts);
  assert.match(mail.subject, /1件/);
  assert.match(mail.body, /2026-10-26（月） 青木 ひなた（出勤 10:00）：退勤の打刻なし/);
});

test('sanitizeCell', () => {
  assert.equal(g.sanitizeCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(g.sanitizeCell('青木'), '青木');
});
