// 初期設定 → 予約 → キャンセル → 前日のリマインド の流れを、GAS のにせもので通しで確かめる
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, createFakeGas, ALL_FILES } = require('./loadGas');

function setupEnv(now = '2026-10-29 10:00') {
  const fake = createFakeGas();
  const g = loadGas(ALL_FILES, fake.globals);
  const env = { fake, g, now, sheet: (name) => fake.ss.getSheetByName(name) };
  g.nowYmdHm_ = () => env.now;
  g.setup();
  env.cal = Object.values(fake.calendars)[0];
  return env;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

function rows(sheet) {
  const [header, ...rest] = sheet.data;
  return rest.filter((r) => r.some((v) => v !== '' && v !== undefined)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function input(overrides = {}) {
  return {
    menu: 'しっかり整体コース', date: '2026-10-31', time: '14:00',
    name: '山田 花子', phone: '090-0000-0000', email: 'hanako@example.com', note: '腰が重いです', ...overrides
  };
}

test('初期設定でシート・メニュー・予約用カレンダー・トリガーができる', () => {
  const { fake, sheet, cal } = setupEnv();
  assert.deepEqual(fake.sheets.map((s) => s.name), ['予約一覧', 'メニュー', '設定', 'ログ']);
  assert.equal(sheet('メニュー').data.length, 4);
  assert.equal(cal.getName(), '整体サロン ゆるり（サンプル店） 予約');
  assert.deepEqual(fake.triggers.map((t) => t.getHandlerFunction()), ['dailyReminder']);
  assert.equal(fake.ss.timeZone, 'Asia/Tokyo');
});

test('初期設定を2回しても、カレンダーやトリガーが増えない', () => {
  const { fake, g } = setupEnv();
  g.setup();
  assert.equal(Object.keys(fake.calendars).length, 1);
  assert.equal(fake.triggers.length, 1);
});

test('予約画面に、公開中のメニューと日にちが出る', () => {
  const { fake, g, sheet } = setupEnv();
  sheet('メニュー').data[1][4] = false;
  g.doGet({ parameter: {} });
  const data = JSON.parse(fake.html.template.data);
  assert.equal(fake.html.template.name, 'Index');
  assert.deepEqual(data.menus.map((m) => m.name), ['しっかり整体コース', 'じっくり全身コース']);
  assert.equal(data.dates.length, 31);
  assert.equal(data.hours, '10:00〜19:00');
  assert.equal(data.closedDays, '水');
});

test('予約すると、カレンダーに入り、確認メールとお店への通知が届き、その時間は空きから消える', () => {
  const { fake, g, sheet, cal } = setupEnv();
  assert.ok(g.apiSlots('しっかり整体コース', '2026-10-31').slots.includes('14:00'));
  const r = g.apiBook(input());
  assert.equal(r.ok, true, r.message);
  assert.equal(r.bookingNo, 'R20261029-001');

  const b = rows(sheet('予約一覧'))[0];
  assert.equal(b['状態'], '予約済み');
  assert.equal(b['開始'], '14:00');
  assert.equal(b['終了'], '15:00');
  assert.equal(b['料金（円）'], 6600);
  assert.equal(cal.events.length, 1);
  assert.equal(cal.events[0].getTitle(), '山田 花子 様（しっかり整体コース）');
  assert.equal(b['イベントID'], cal.events[0].getId());

  assert.equal(fake.sent.length, 2);
  assert.match(fake.sent[0].subject, /^【デモ】【整体サロン ゆるり（サンプル店）】ご予約を承りました/);
  assert.equal(fake.sent[0].to, 'shop@example.com');
  assert.match(fake.sent[0].body, /本来の宛先は hanako@example.com/);
  assert.match(fake.sent[0].body, /https:\/\/example.com\/exec\?cancel=uuid-/);
  assert.match(fake.sent[0].body, /10月30日（金） 18:00 まで/);
  assert.match(fake.sent[1].subject, /【新着予約】10月31日（土） 14:00/);

  const after = g.apiSlots('しっかり整体コース', '2026-10-31').slots;
  assert.ok(!after.includes('14:00'));
  assert.ok(!after.includes('13:30'));
  assert.ok(!after.includes('15:00'));
  assert.ok(after.includes('15:30'));
});

test('同じ時間は2回予約できない', () => {
  const { g } = setupEnv();
  assert.equal(g.apiBook(input()).ok, true);
  const again = g.apiBook(input({ email: 'other@example.com' }));
  assert.equal(again.ok, false);
  assert.match(again.message, /うまってしまいました/);
});

test('入力がおかしいと予約できない', () => {
  const { g, cal } = setupEnv();
  const r = g.apiBook(input({ name: '', email: 'x' }));
  assert.equal(r.ok, false);
  assert.match(r.message, /お名前/);
  assert.match(r.message, /メールアドレス/);
  assert.equal(g.apiBook(input({ menu: 'ない' })).ok, false);
  assert.equal(g.apiBook(input({ date: '2026/10/31' })).ok, false);
  assert.equal(g.apiBook(input({ date: '2026-11-04' })).ok, false, '定休日');
  assert.equal(cal.events.length, 0);
});

test('同じメールアドレスの予約は3件まで', () => {
  const { g } = setupEnv();
  ['10:00', '11:30', '15:00'].forEach((time) => assert.equal(g.apiBook(input({ time })).ok, true));
  const r = g.apiBook(input({ time: '17:00', email: 'HANAKO@example.com' }));
  assert.equal(r.ok, false);
  assert.match(r.message, /3 件まで/);
  // メールを変えても、同じ電話番号なら止まる
  const samePhone = g.apiBook(input({ time: '17:00', email: 'another@example.com', phone: '０９０００００００００' }));
  assert.equal(samePhone.ok, false);
});

test('メールアドレスはふつうの形だけ（カンマで何人にも送れない）', () => {
  const { g } = setupEnv();
  for (const email of ['a@example.com,b@example.com', '+a@example.com', 'a b@example.com', 'a@example', '<a@example.com>']) {
    assert.equal(g.apiBook(input({ email })).ok, false, email);
  }
  assert.equal(g.apiBook(input({ email: 'taro.yamada+salon@example.co.jp' })).ok, true);
});

test('予約画面から1日に受ける予約の数を超えたら、電話をお願いする', () => {
  const { g, sheet } = setupEnv();
  sheet('設定').data.find((r) => r[0] === '予約画面から1日に受ける予約の数')[1] = '2';
  assert.equal(g.apiBook(input({ time: '10:00', email: 'a@example.com', phone: '090-0000-0001' })).ok, true);
  assert.equal(g.apiBook(input({ time: '15:00', email: 'b@example.com', phone: '090-0000-0002' })).ok, true);
  const r = g.apiBook(input({ time: '17:00', email: 'c@example.com', phone: '090-0000-0003' }));
  assert.equal(r.ok, false);
  assert.match(r.message, /お電話で/);
});

test('ありえない日付はエラーにする（ログにも長いエラーを残さない）', () => {
  const { g, sheet } = setupEnv();
  const r = g.apiSlots('しっかり整体コース', '2026-10-32');
  assert.equal(r.ok, false);
  assert.match(r.message, /日にちが正しくありません/);
  assert.ok(!sheet('ログ').data.some((row) => row[1] === 'エラー'));
});

test('カレンダーの予定が消されても、予約一覧の予約済みとは重ならない', () => {
  const { g, cal } = setupEnv();
  g.apiBook(input());
  cal.events.length = 0;
  assert.ok(!g.apiSlots('しっかり整体コース', '2026-10-31').slots.includes('14:00'));
});

test('1人にメールが送れなくても、ほかの人のリマインドとお店への一覧は送り、送れなかった人はあとで送り直せる', () => {
  const env = setupEnv('2026-10-29 10:00');
  const { fake, g, sheet } = env;
  g.apiBook(input({ date: '2026-10-30', time: '11:00', name: '送れない 人', email: 'bad@example.com', phone: '090-0000-0001' }));
  g.apiBook(input({ date: '2026-10-30', time: '15:00', name: '送れる 人', email: 'ok@example.com', phone: '090-0000-0002' }));
  fake.sent.length = 0;
  fake.failTo = /本来の宛先は bad@example.com/;
  env.now = '2026-10-29 18:00';
  g.remindNow();
  assert.ok(fake.sent.some((m) => /送れる 人/.test(m.body) && /明日のご予約のお知らせ/.test(m.subject)));
  assert.ok(fake.sent.some((m) => /【明日の予約】/.test(m.subject)));
  const list = rows(sheet('予約一覧'));
  assert.equal(list.find((b) => b['お名前'] === '送れない 人')['リマインド送信'], '');
  assert.notEqual(list.find((b) => b['お名前'] === '送れる 人')['リマインド送信'], '');
  assert.ok(sheet('ログ').data.some((row) => row[1] === 'エラー' && String(row[2]).includes('リマインドを送れませんでした')));
});

test('確認メールが送れなくても、予約は入りお店には知らせる', () => {
  const { fake, g, sheet } = setupEnv();
  fake.failTo = /本来の宛先は/;
  const r = g.apiBook(input());
  assert.equal(r.ok, true);
  assert.equal(rows(sheet('予約一覧')).length, 1);
  assert.ok(fake.sent.some((m) => /【新着予約】/.test(m.subject)));
});

test('カレンダーのタイムゾーンを日本にそろえる', () => {
  const { cal } = setupEnv();
  assert.equal(cal.timeZone, 'Asia/Tokyo');
});

test('式よけの \' は、読むときに外れる（電話番号の + など）', () => {
  const { g } = setupEnv();
  g.apiBook(input({ phone: '+81 90-0000-0000' }));
  assert.equal(g.readBookings_()[0].phone, '+81 90-0000-0000');
});

test('店長がカレンダーに入れた予定の時間は、予約画面に出ない', () => {
  const { g, cal } = setupEnv();
  cal.createEvent('私用', new Date('2026-10-31T15:00:00+09:00'), new Date('2026-10-31T17:00:00+09:00'), {});
  const slots = g.apiSlots('しっかり整体コース', '2026-10-31').slots;
  assert.ok(!slots.includes('15:00'));
  assert.ok(!slots.includes('16:30'));
  assert.ok(slots.includes('17:30'));
});

test('キャンセル：リンクの画面 → キャンセルでカレンダーから消え、メールが届く', () => {
  const { fake, g, sheet, cal } = setupEnv();
  g.apiBook(input());
  const token = rows(sheet('予約一覧'))[0]['キャンセル用キー'];
  g.doGet({ parameter: { cancel: token } });
  assert.equal(fake.html.template.name, 'Cancel');
  const info = JSON.parse(fake.html.template.data);
  assert.equal(info.canCancel, true);
  assert.equal(info.name, '山〇〇 様');

  const r = g.apiCancel(token);
  assert.equal(r.ok, true);
  assert.equal(rows(sheet('予約一覧'))[0]['状態'], 'キャンセル');
  assert.equal(cal.events.length, 0);
  assert.match(fake.sent[2].subject, /ご予約をキャンセルしました/);
  assert.match(fake.sent[3].subject, /【キャンセル】/);
  assert.ok(g.apiSlots('しっかり整体コース', '2026-10-31').slots.includes('14:00'));

  const again = g.apiCancel(token);
  assert.equal(again.ok, false);
  assert.match(again.message, /すでにキャンセル/);
});

test('締め切りを過ぎたキャンセルや、まちがったキーは受け付けない', () => {
  const env = setupEnv();
  const { g, sheet } = env;
  g.apiBook(input());
  const token = rows(sheet('予約一覧'))[0]['キャンセル用キー'];
  env.now = '2026-10-30 18:01';
  const late = g.apiCancel(token);
  assert.equal(late.ok, false);
  assert.match(late.message, /10月30日（金） 18:00 まで/);
  assert.equal(g.apiCancel('でたらめ').ok, false);
  assert.equal(g.apiCancel('').ok, false);
});

test('前日のリマインド：明日の予約のお客さまとお店に送り、2回目はお客さまに送らない', () => {
  const env = setupEnv('2026-10-29 10:00');
  const { fake, g, sheet } = env;
  g.apiBook(input({ date: '2026-10-30', time: '15:00' }));
  g.apiBook(input({ date: '2026-10-31', time: '15:00', email: 'b@example.com' }));
  fake.sent.length = 0;
  fake.activeUser = '';
  const uid = fake.triggers[0].getUniqueId();
  env.now = '2026-10-29 18:00';
  g.dailyReminder({ triggerUid: uid });
  assert.equal(fake.sent.length, 2);
  assert.match(fake.sent[0].subject, /明日のご予約のお知らせ（15:00〜）/);
  assert.match(fake.sent[1].subject, /【明日の予約】10月30日（金）　1件/);
  assert.notEqual(rows(sheet('予約一覧'))[0]['リマインド送信'], '');

  g.dailyReminder({ triggerUid: uid });
  assert.equal(fake.sent.filter((m) => /明日のご予約のお知らせ/.test(m.subject)).length, 1);
});

test('予約画面から（管理者でない人が）メニューの操作を呼んでも動かない', () => {
  const { fake, g, sheet } = setupEnv();
  fake.activeUser = '';
  for (const fn of ['setup', 'showBookingUrl', 'showCalendarName', 'remindNow', 'insertSampleBookings', 'resetBookings']) {
    assert.throws(() => g[fn](), /管理者だけ/, fn);
  }
  assert.throws(() => g.dailyReminder({ triggerUid: 'にせもの' }), /管理者だけ/);
  assert.equal(rows(sheet('予約一覧')).length, 0);
  assert.equal(g.apiBook(input()).ok, true);
});

test('サンプル予約：カレンダーと予約一覧に入り、私用の予定と重ならず、毎回同じ内容', () => {
  const { fake, g, sheet, cal } = setupEnv();
  g.insertSampleBookings();
  const list = rows(sheet('予約一覧'));
  assert.ok(list.length >= 14);
  assert.equal(list.filter((b) => b['状態'] === 'キャンセル').length, 1);
  const booked = list.filter((b) => b['状態'] === '予約済み');
  assert.equal(cal.events.length, booked.length + 1);
  assert.ok(list.every((b) => b['日付'] > '2026-10-29' && b['日付'] <= '2026-11-12'));
  assert.ok(list.every((b) => g.weekdayOf(b['日付']) !== '水'));
  const priv = cal.events.find((e) => e.getTitle().startsWith('私用'));
  const sameDay = booked.filter((b) => b['日付'] === g.formatNow_(priv.getStartTime(), 'yyyy-MM-dd'));
  assert.ok(sameDay.every((b) => b['終了'] <= '14:50' || b['開始'] >= '17:10'));
  assert.equal(fake.sent.length, 0);

  const first = JSON.stringify(list.map((b) => [b['日付'], b['開始'], b['メニュー'], b['お名前']]));
  g.insertSampleBookings();
  const second = JSON.stringify(rows(sheet('予約一覧')).map((b) => [b['日付'], b['開始'], b['メニュー'], b['お名前']]));
  assert.equal(second, first);
  assert.equal(cal.events.length, booked.length + 1);
});

test('式として動く名前は、文字として書く', () => {
  const { g, sheet } = setupEnv();
  g.apiBook(input({ name: '=IMPORTDATA("https://example.com")' }));
  assert.equal(rows(sheet('予約一覧'))[0]['お名前'], '\'=IMPORTDATA("https://example.com")');
});

test('予想外のエラーは中身を見せずにログに残す', () => {
  const { g, sheet } = setupEnv();
  const original = g.getCalendar_;
  g.getCalendar_ = () => { throw new Error('内部の詳しいエラー'); };
  const r = g.apiSlots('しっかり整体コース', '2026-10-31');
  g.getCalendar_ = original;
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /内部/);
  assert.ok(sheet('ログ').data.some((row) => String(row[2]).includes('内部の詳しいエラー')));
});
