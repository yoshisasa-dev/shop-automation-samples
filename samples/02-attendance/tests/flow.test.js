// 初期設定 → 打刻 → 集計 → 打刻忘れチェック の流れを、GAS のにせもので通しで確かめる
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, createFakeGas, ALL_FILES } = require('./loadGas');

function setupEnv(now = '2026-10-29 10:00') {
  const fake = createFakeGas();
  const g = loadGas(ALL_FILES, fake.globals);
  g.nowYmdHm_ = () => env.now;
  const env = { fake, g, now, sheet: (name) => fake.ss.getSheetByName(name) };
  g.setup();
  return env;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

function rowsAsObjects(sheet, headerRow = 0) {
  const header = sheet.data[headerRow];
  return sheet.data.slice(headerRow + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

test('初期設定でシート・スタッフ・設定・トリガーができる', () => {
  const { fake, sheet } = setupEnv();
  assert.deepEqual(fake.sheets.map((s) => s.name), ['月の集計', '勤怠（日別）', '打刻ログ', 'スタッフ', '設定', 'ログ']);
  assert.equal(sheet('スタッフ').data.length, 7);
  assert.equal(sheet('スタッフ').data[1][3], '1234');
  assert.equal(sheet('設定').data[1][1], 'カフェ ひだまり（サンプル店）');
  assert.deepEqual(fake.triggers.map((t) => t.getHandlerFunction()), ['dailyCheck']);
  assert.equal(fake.ss.name, 'カフェ ひだまり（サンプル店） 勤怠管理');
});

test('初期設定を2回しても、スタッフやトリガーが増えない', () => {
  const { fake, g, sheet } = setupEnv();
  g.setup();
  assert.equal(sheet('スタッフ').data.length, 7);
  assert.equal(fake.triggers.length, 1);
});

test('打刻画面には在籍中のスタッフだけが出る', () => {
  const { fake, g, sheet } = setupEnv();
  sheet('スタッフ').data[6][4] = false;
  g.doGet();
  assert.equal(fake.html.template.shopName, 'カフェ ひだまり（サンプル店）');
  assert.equal(fake.html.template.staff.length, 5);
  assert.equal(fake.html.title, 'カフェ ひだまり（サンプル店） 打刻');
});

test('暗証番号がちがうと打刻できない。合っていれば押せるボタンが返る', () => {
  const { g } = setupEnv();
  const ng = g.apiStatus('S01', '9999');
  assert.equal(ng.ok, false);
  assert.match(ng.message, /暗証番号がちがいます/);
  const ok = g.apiStatus('S01', '1234');
  assert.equal(ok.ok, true);
  assert.deepEqual(plain(ok.next), ['出勤']);
  assert.equal(g.apiStatus('S99', '1234').ok, false);
});

test('出勤 → 休憩 → 戻り → 退勤。順番ちがいのボタンは押せない', () => {
  const env = setupEnv('2026-10-29 09:00');
  const { g, sheet } = env;
  let r = g.apiPunch('S01', '1234', '出勤');
  assert.equal(r.ok, true);
  assert.match(r.message, /出勤を記録しました（09:00）/);
  assert.deepEqual(plain(r.next), ['休憩', '退勤']);

  const again = g.apiPunch('S01', '1234', '出勤');
  assert.equal(again.ok, false);
  assert.match(again.message, /今は「出勤」は押せません/);

  env.now = '2026-10-29 12:00';
  assert.deepEqual(plain(g.apiPunch('S01', '1234', '休憩').next), ['戻り']);
  env.now = '2026-10-29 13:00';
  assert.deepEqual(plain(g.apiPunch('S01', '1234', '戻り').next), ['休憩', '退勤']);
  env.now = '2026-10-29 17:30';
  r = g.apiPunch('S01', '1234', '退勤');
  assert.deepEqual(plain(r.next), ['出勤']);
  assert.deepEqual(plain(r.last), { type: '退勤', at: '2026-10-29 17:30' });

  const log = rowsAsObjects(sheet('打刻ログ'));
  assert.deepEqual(log.map((x) => [x['日時'], x['種類']]), [
    ['2026-10-29 09:00', '出勤'], ['2026-10-29 12:00', '休憩'], ['2026-10-29 13:00', '戻り'], ['2026-10-29 17:30', '退勤']
  ]);

  g.refreshAttendance_();
  const daily = rowsAsObjects(sheet('勤怠（日別）'));
  assert.equal(daily[0]['勤務時間'], '7:30');
  assert.equal(daily[0]['休憩'], '1:00');
  const monthly = sheet('月の集計');
  assert.match(monthly.data[0][0], /2026年10月分の勤怠（2026-10-01〜2026-10-31）/);
  const aoki = rowsAsObjects(monthly, 3).find((x) => x['名前'] === '青木 ひなた');
  assert.equal(aoki['勤務時間'], '7:30');
  assert.equal(aoki['お給料の目安（円）'], 9000);
});

test('暗証番号を5回まちがえると、合っていても10分間ロックし、お店に知らせる', () => {
  const { g, fake } = setupEnv();
  for (let i = 0; i < 5; i++) g.apiStatus('S02', '0000');
  const locked = g.apiPunch('S02', '2345', '出勤');
  assert.equal(locked.ok, false);
  assert.match(locked.message, /10分間/);
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].subject, /井上 蓮さんの打刻を10分間止めました/);
  // 10分たてば、また打刻できる
  const state = JSON.parse(fake.props.PINFAIL_S02);
  state.since -= 11 * 60000;
  fake.props.PINFAIL_S02 = JSON.stringify(state);
  assert.equal(g.apiPunch('S02', '2345', '出勤').ok, true);
  assert.equal(fake.props.PINFAIL_S02, undefined);
});

test('4回まちがえても、合っていれば失敗の回数は消える', () => {
  const { g, fake } = setupEnv();
  for (let i = 0; i < 4; i++) g.apiStatus('S02', '0000');
  assert.equal(g.apiStatus('S02', '2345').ok, true);
  assert.equal(fake.props.PINFAIL_S02, undefined);
  assert.equal(fake.sent.length, 0);
});

test('打刻画面から（管理者でない人が）メニューの操作を呼んでも動かない', () => {
  const { g, fake, sheet } = setupEnv();
  fake.activeUser = '';
  for (const fn of ['setup', 'showPunchUrl', 'summarizeThisMonth', 'summarizeLastMonth', 'checkNow', 'insertSamplePunches', 'resetPunches']) {
    assert.throws(() => g[fn](), /管理者だけ/, fn);
  }
  assert.throws(() => g.dailyCheck({ triggerUid: 'にせもの' }), /管理者だけ/);
  assert.throws(() => g.dailyCheck(), /管理者だけ/);
  assert.equal(sheet('打刻ログ').data.length, 1);
  // 打刻は管理者でなくてもできる
  assert.equal(g.apiPunch('S01', '1234', '出勤').ok, true);
});

test('毎朝のチェック：登録したトリガーからなら動き、同じ打刻忘れは2回知らせない', () => {
  const { g, fake } = setupEnv('2026-10-29 10:00');
  g.insertSamplePunches();
  fake.activeUser = '';
  const uid = fake.triggers[0].getUniqueId();
  g.dailyCheck({ triggerUid: uid });
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].subject, /2件/);
  g.dailyCheck({ triggerUid: uid });
  assert.equal(fake.sent.length, 1);
});

test('同じ分の「退勤」と「出勤」は、書かれた順にまとめる', () => {
  const env = setupEnv('2026-10-29 09:00');
  const { g } = env;
  g.apiPunch('S01', '1234', '出勤');
  env.now = '2026-10-29 17:00';
  g.apiPunch('S01', '1234', '退勤');
  g.apiPunch('S01', '1234', '出勤');
  const shifts = g.buildShifts(g.readPunches_().punches, '2026-10-29 17:05');
  assert.deepEqual(plain(shifts.map((s) => [s.in, s.out, s.state])), [
    ['2026-10-29 09:00', '2026-10-29 17:00', ''],
    ['2026-10-29 17:00', null, '勤務中']
  ]);
});

test('スタッフシートに無いIDの打刻も、月の集計に「スタッフ未登録」として出る', () => {
  const { g, sheet } = setupEnv('2026-10-29 10:00');
  sheet('打刻ログ').data.push(['2026-10-05 09:00', 'S77', '昔の人', '出勤', ''], ['2026-10-05 17:00', 'S77', '昔の人', '退勤', '']);
  g.summarizeThisMonth();
  const rows = rowsAsObjects(sheet('月の集計'), 3);
  const r = rows.find((x) => x['スタッフID'] === 'S77');
  assert.equal(r['名前'], '昔の人（スタッフ未登録）');
  assert.equal(r['勤務時間'], '8:00');
});

test('初期設定でスプシのタイムゾーンを日本にそろえる', () => {
  const { fake } = setupEnv();
  assert.equal(fake.ss.timeZone, 'Asia/Tokyo');
});

test('おかしな種類のボタンや、予想外のエラーは中身を見せない', () => {
  const { g, sheet } = setupEnv();
  assert.match(g.apiPunch('S01', '1234', '早退').message, /ボタンの種類/);
  const original = g.readPunches_;
  g.readPunches_ = () => { throw new Error('内部の詳しいエラー'); };
  const r = g.apiStatus('S01', '1234');
  g.readPunches_ = original;
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /内部/);
  assert.ok(sheet('ログ').data.some((row) => String(row[2]).includes('内部の詳しいエラー')));
});

test('式として動く名前は、打刻ログに文字として書く', () => {
  const { g, sheet } = setupEnv();
  sheet('スタッフ').data[1][1] = '=IMPORTDATA("https://example.com")';
  g.apiPunch('S01', '1234', '出勤');
  assert.equal(sheet('打刻ログ').data[1][2], '\'=IMPORTDATA("https://example.com")');
});

test('サンプルの打刻：日別・月の集計ができ、打刻忘れ2件と勤務中が見える', () => {
  const env = setupEnv('2026-10-29 10:00');
  const { g, sheet, fake } = env;
  g.insertSamplePunches();
  const daily = rowsAsObjects(sheet('勤怠（日別）'));
  assert.equal(daily.filter((x) => x['確認'] === '退勤の打刻なし').length, 2);
  assert.ok(daily.some((x) => x['確認'] === '勤務中' && x['名前'] === '青木 ひなた'));
  assert.ok(daily.every((x) => x['日付'] <= '2026-10-29'));
  const monthly = rowsAsObjects(sheet('月の集計'), 3).filter((x) => /^S0/.test(x['スタッフID']));
  assert.equal(monthly.length, 6);
  assert.ok(monthly.every((x) => x['出勤日数'] > 0 && x['お給料の目安（円）'] > 0));
  assert.ok(monthly.some((x) => x['深夜'] !== '0:00'));
  assert.equal(fake.sent.length, 0);

  // 2回入れても同じ内容（毎回同じ見本になる）
  const first = JSON.stringify(sheet('打刻ログ').data);
  g.insertSamplePunches();
  assert.equal(JSON.stringify(sheet('打刻ログ').data), first);
});

test('打刻忘れチェック：過去7日の分をメールで知らせる', () => {
  const { g, fake } = setupEnv('2026-10-29 10:00');
  g.insertSamplePunches();
  g.checkNow();
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].subject, /【打刻の確認】2件/);
  assert.match(fake.sent[0].body, /退勤の打刻なし/);
  assert.equal(fake.sent[0].to, 'shop@example.com');
});

test('打刻忘れが無ければメールは送らない', () => {
  const { g, fake } = setupEnv();
  g.dailyCheck();
  assert.equal(fake.sent.length, 0);
});

test('先月の集計', () => {
  const { g, sheet } = setupEnv('2026-10-29 10:00');
  g.insertSamplePunches();
  g.summarizeLastMonth();
  assert.match(sheet('月の集計').data[0][0], /2026年9月分の勤怠（2026-09-01〜2026-09-30）/);
});

test('20日締めにすると期間が変わる', () => {
  const { g, sheet } = setupEnv('2026-10-29 10:00');
  const settings = sheet('設定').data;
  settings.find((r) => r[0] === '締め日')[1] = '20';
  g.summarizeThisMonth();
  assert.match(sheet('月の集計').data[0][0], /2026年11月分の勤怠（2026-10-21〜2026-11-20）/);
});

test('打刻ログを手で直すと、ログに残る', () => {
  const { g, sheet } = setupEnv();
  const range = { getSheet: () => ({ getName: () => '打刻ログ' }), getRow: () => 3, getA1Notation: () => 'A3' };
  g.onEdit({ range, oldValue: '2026-10-28 17:00', value: '2026-10-28 18:00' });
  assert.ok(sheet('ログ').data.some((row) => row[1] === '修正' && String(row[2]).includes('A3：「2026-10-28 17:00」→「2026-10-28 18:00」')));
});

test('打刻ログの読めない行は飛ばして数える', () => {
  const { g, sheet } = setupEnv();
  g.apiPunch('S01', '1234', '出勤');
  sheet('打刻ログ').data.push(['きのう', 'S01', '青木 ひなた', '出勤', '']);
  const r = g.readPunches_();
  assert.equal(r.punches.length, 1);
  assert.equal(r.invalid, 1);
});
