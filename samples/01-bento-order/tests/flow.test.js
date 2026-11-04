// 初期設定 → 注文 → 集計 の流れを、GAS のにせもので通しで確かめる
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, createFakeGas, ALL_FILES } = require('./loadGas');

function setupEnv() {
  const fake = createFakeGas();
  const g = loadGas(ALL_FILES, fake.globals);
  g.setup();
  return { fake, g, sheet: (name) => fake.ss.getSheetByName(name) };
}

function order(overrides = {}) {
  return {
    timestamp: new Date('2026-10-28T10:00:00+09:00'),
    name: '見本 太郎',
    company: '',
    email: 'taro@example.com',
    phone: '090-0000-0000',
    method: '店頭受け取り',
    date: '2026-10-30',
    time: '12:00',
    note: '',
    quantities: { 唐揚げ弁当: 2, 'お茶（500ml）': 1 },
    ...overrides
  };
}

function rowsAsObjects(sheet) {
  const [header, ...rows] = sheet.data;
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

test('初期設定でシート・設定・メニュー・フォーム・トリガーができる', () => {
  const { fake, sheet } = setupEnv();
  assert.deepEqual(fake.sheets.map((s) => s.name), ['注文一覧', '製造数', 'メニュー', '設定', 'ログ']);
  assert.equal(sheet('設定').data[1][0], '店名');
  assert.equal(sheet('メニュー').data.length, 6);
  assert.equal(sheet('注文一覧').data[0][0], '注文番号');
  assert.ok(sheet('注文一覧').data[0].includes('唐揚げ弁当'));

  const titles = fake.formItems.map((rec) => (rec.find((c) => c[0] === 'setTitle') || [])[1]);
  assert.ok(titles.includes('お名前'));
  assert.ok(titles.includes('唐揚げ弁当（650円）'));
  assert.ok(titles.includes('お茶（500ml）（150円）'));
  assert.deepEqual(fake.triggers.map((t) => t.getHandlerFunction()).sort(), ['dailyProduction', 'onOrderSubmit']);
});

test('初期設定を2回実行しても、フォームの質問やトリガーが増えない', () => {
  const { fake, g, sheet } = setupEnv();
  const items = fake.formItems.length;
  g.setup();
  assert.equal(fake.formItems.length, items);
  assert.equal(fake.triggers.length, 2);
  assert.equal(sheet('メニュー').data.length, 6);
});

test('受付できる注文：記録され、デモモードでは2通ともお店に届く', () => {
  const { fake, g, sheet } = setupEnv();
  const r = g.processOrder_(order(), { sendMail: true });
  assert.equal(r.orderNo, '20261028-001');
  assert.equal(r.result.status, '受付済み');

  const [row] = rowsAsObjects(sheet('注文一覧'));
  assert.equal(row['ステータス'], '受付済み');
  assert.equal(row['受付日時'], '2026-10-28 10:00');
  assert.equal(row['受け取り日'], '2026-10-30');
  assert.equal(row['唐揚げ弁当'], 2);
  assert.equal(row['合計個数'], 3);
  assert.equal(row['合計金額'], 1450);

  assert.equal(fake.sent.length, 2);
  assert.ok(fake.sent.every((m) => m.to === 'shop@example.com'));
  assert.match(fake.sent[0].subject, /^【デモ】.*ご注文を承りました/);
  assert.match(fake.sent[0].body, /本来の宛先は taro@example.com/);
  assert.match(fake.sent[1].subject, /新着注文・受付済み/);
});

test('デモモードOFFならお客さんに直接届く', () => {
  const { fake, g, sheet } = setupEnv();
  const settings = sheet('設定').data;
  settings.find((r) => r[0] === 'デモモード')[1] = 'OFF';
  g.processOrder_(order(), { sendMail: true });
  assert.equal(fake.sent[0].to, 'taro@example.com');
  assert.doesNotMatch(fake.sent[0].subject, /デモ/);
});

test('締め切り後・定休日・上限超過は受付不可になり、番号は続き番号', () => {
  const { g, sheet } = setupEnv();
  sheet('設定').data.find((r) => r[0] === '1日の上限食数')[1] = '5';
  g.processOrder_(order(), { sendMail: false });
  const late = g.processOrder_(order({ date: '2026-10-29', timestamp: new Date('2026-10-28T15:30:00+09:00') }), { sendMail: false });
  const sunday = g.processOrder_(order({ date: '2026-11-01' }), { sendMail: false });
  const full = g.processOrder_(order({ quantities: { 鮭弁当: 3 } }), { sendMail: false });
  const fits = g.processOrder_(order({ quantities: { 鮭弁当: 2 } }), { sendMail: false });

  assert.equal(late.result.status, '受付不可');
  assert.match(late.result.reason, /締め切りました/);
  assert.match(sunday.result.reason, /定休日/);
  assert.match(full.result.reason, /あと 2 個まで/);
  assert.equal(fits.result.status, '受付済み');
  assert.deepEqual(rowsAsObjects(sheet('注文一覧')).map((r) => r['注文番号']),
    ['20261028-001', '20261028-002', '20261028-003', '20261028-004', '20261028-005']);
});

test('メニューに商品を足すと、注文一覧に列が増えて記録される', () => {
  const { g, sheet } = setupEnv();
  g.processOrder_(order(), { sendMail: false });
  sheet('メニュー').data.push(['のり弁当', 500, true]);
  g.processOrder_(order({ quantities: { のり弁当: 4 } }), { sendMail: false });
  const rows = rowsAsObjects(sheet('注文一覧'));
  assert.equal(rows[0]['のり弁当'], '');
  assert.equal(rows[1]['のり弁当'], 4);
  assert.equal(rows[1]['合計金額'], 2000);
  const header = sheet('注文一覧').data[0];
  assert.equal(header.indexOf('のり弁当') + 1, header.indexOf('合計個数'));
});

test('フォームの回答から注文データを作れる', () => {
  const { g } = setupEnv();
  const answers = [
    ['お名前', '見本 花子'], ['メールアドレス', 'hanako@example.com'], ['受け取り日', '2026-10-30'],
    ['受け取り時間', '11:30'], ['唐揚げ弁当（650円）', '3'], ['お茶（500ml）（150円）', '0']
  ];
  const response = {
    getTimestamp: () => new Date('2026-10-28T10:00:00+09:00'),
    getItemResponses: () => answers.map(([t, v]) => ({ getItem: () => ({ getTitle: () => t }), getResponse: () => v }))
  };
  const o = g.orderFromResponse_(response);
  assert.equal(o.name, '見本 花子');
  assert.equal(o.time, '11:30');
  assert.equal(o.company, '');
  assert.equal(o.quantities['唐揚げ弁当'], 3);
  assert.equal(o.quantities['お茶（500ml）'], 0);
});

test('製造数の集計：シートに書き、お店にメールする', () => {
  const { fake, g, sheet } = setupEnv();
  g.processOrder_(order({ note: 'えびアレルギー' }), { sendMail: false });
  g.processOrder_(order({ time: '11:00', quantities: { 鮭弁当: 4 } }), { sendMail: false });
  const agg = g.runProduction_('2026-10-30', true);
  assert.equal(agg.totalQty, 7);
  const cells = sheet('製造数').data.flat();
  assert.ok(cells.includes('2026-10-30（金） の製造数'));
  assert.ok(cells.includes('えびアレルギー'));
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].subject, /【製造数】2026-10-30（金）　合計7個/);
});

test('注文0件の日は集計メールを送らない', () => {
  const { fake, g } = setupEnv();
  g.runProduction_('2026-10-30', true);
  assert.equal(fake.sent.length, 0);
});

test('サンプル注文：24件は受付済み、締め切り後の2件は受付不可、メールは送らない', () => {
  const { fake, g, sheet } = setupEnv();
  assert.equal(g.insertSampleOrders_(), 26);
  const rows = rowsAsObjects(sheet('注文一覧'));
  assert.equal(rows.length, 26);
  assert.equal(rows.filter((r) => r['ステータス'] === '受付済み').length, 24);
  assert.equal(rows.filter((r) => r['ステータス'] === '受付不可').length, 2);
  assert.ok(rows.every((r) => String(r['メールアドレス']).endsWith('@example.com')));
  assert.equal(new Set(rows.map((r) => r['注文番号'])).size, 26);
  assert.equal(fake.sent.length, 0);
});

test('フォームに式を入れられても、文字として記録される', () => {
  const { g, sheet } = setupEnv();
  g.processOrder_(order({ name: '=HYPERLINK("https://example.com")', note: '=IMPORTDATA("https://example.com")' }), { sendMail: false });
  const [row] = rowsAsObjects(sheet('注文一覧'));
  assert.equal(row['お名前'], '\'=HYPERLINK("https://example.com")');
  assert.equal(row['アレルギー・ご要望'], '\'=IMPORTDATA("https://example.com")');
  assert.equal(row['合計金額'], 1450);
});

test('シートの行が足りなくなっても、行を足して記録を続ける', () => {
  const { g, sheet } = setupEnv();
  sheet('注文一覧').maxRows = 3;
  for (let i = 0; i < 4; i++) g.processOrder_(order(), { sendMail: false });
  assert.equal(rowsAsObjects(sheet('注文一覧')).length, 4);
});

test('販売中をオフにした商品も、入っている注文の分は製造数に数える', () => {
  const { g, sheet } = setupEnv();
  g.processOrder_(order({ quantities: { 鮭弁当: 4 } }), { sendMail: false });
  sheet('メニュー').data.find((r) => r[0] === '鮭弁当')[2] = false;
  const agg = g.runProduction_('2026-10-30', false);
  assert.equal(agg.totalQty, 4);
  assert.equal(agg.byProduct.find((p) => p.name === '鮭弁当').qty, 4);
});

test('メニューに無い商品が送られてきても、記録する個数と合計がそろう', () => {
  const { g, sheet } = setupEnv();
  g.processOrder_(order({ quantities: { 唐揚げ弁当: 1, 鮭弁当: 2 } }), { sendMail: false });
  sheet('メニュー').data.find((r) => r[0] === '鮭弁当')[2] = false;
  g.processOrder_(order({ quantities: { 唐揚げ弁当: 1, 鮭弁当: 2 } }), { sendMail: false });
  const rows = rowsAsObjects(sheet('注文一覧'));
  assert.equal(rows[1]['鮭弁当'], '');
  assert.equal(rows[1]['合計個数'], 1);
});

test('デモモードの行を消したり打ち間違えたりしても、デモのまま', () => {
  for (const value of ['', 'on', 'オフ', 'OF']) {
    const { fake, g, sheet } = setupEnv();
    sheet('設定').data.find((r) => r[0] === 'デモモード')[1] = value;
    g.processOrder_(order(), { sendMail: true });
    assert.equal(fake.sent[0].to, 'shop@example.com', `デモモード「${value}」`);
  }
});

test('メールの残りが少ないときは、お客さん宛てを送らずお店宛ては送る', () => {
  const { fake, g, sheet } = setupEnv();
  fake.quota = 10;
  g.processOrder_(order(), { sendMail: true });
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].subject, /新着注文/);
  assert.ok(sheet('ログ').data.flat().some((v) => String(v).includes('残り少ない')));
});

test('フォームが消えていて作り直したときも、送信のトリガーが付く', () => {
  const { fake, g } = setupEnv();
  fake.triggers.splice(0);
  fake.globals.FormApp.openById = () => { throw new Error('見つかりません'); };
  g.updateForm();
  assert.ok(fake.triggers.some((t) => t.getHandlerFunction() === 'onOrderSubmit'));
});

test('集計時刻がおかしな値なら16時にする', () => {
  const { g } = setupEnv();
  assert.equal(g.productionHour_({ '製造数の集計時刻': '16.5' }), 16);
  assert.equal(g.productionHour_({ '製造数の集計時刻': '24' }), 16);
  assert.equal(g.productionHour_({ '製造数の集計時刻': '7' }), 7);
});

test('注文一覧のリセット', () => {
  const { g, sheet } = setupEnv();
  g.processOrder_(order(), { sendMail: false });
  g.resetOrders();
  assert.equal(sheet('注文一覧').getLastRow(), 1);
});
