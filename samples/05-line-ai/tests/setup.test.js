const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, createFakeGas, ALL_FILES } = require('./loadGas');

function setup() {
  const fake = createFakeGas();
  fake.globals.ContentService = { createTextOutput: (s) => ({ text: s }) };
  const g = loadGas(ALL_FILES, fake.globals);
  return { fake, g };
}
const allCells = (fake) => fake.sheets.flatMap((s) => s.data.flat().map(String)).join('\n');

test('初期設定は2回しても重複せず、秘密の文字列は1回目だけ作る', () => {
  const { fake, g } = setup();
  g.setup();
  const key = fake.props.WEBHOOK_KEY;
  assert.ok(key && key.length >= 20);
  g.setup();
  assert.equal(fake.props.WEBHOOK_KEY, key);
  const settings = fake.ss.getSheetByName('設定').data.slice(1).map((r) => r[0]);
  assert.equal(settings.length, new Set(settings).size);
  assert.ok(fake.ss.getSheetByName('よくある質問'));
  assert.ok(fake.ss.getSheetByName('会話ログ'));
});

test('キーの設定：入力したキーはプロパティに入り、シートには出ない。空欄なら今のまま', () => {
  const { fake, g } = setup();
  g.setup();
  const answers = ['test-claude-key-1234', 'line-token-5678'];
  fake.ui.prompt = () => { const t = answers.shift(); return { getSelectedButton: () => 'OK', getResponseText: () => t }; };
  g.setKeys();
  assert.equal(fake.props.CLAUDE_API_KEY, 'test-claude-key-1234');
  assert.equal(fake.props.LINE_TOKEN, 'line-token-5678');
  assert.doesNotMatch(allCells(fake), /test-claude-key|line-token-5678/);
  fake.ui.prompt = () => ({ getSelectedButton: () => 'OK', getResponseText: () => '  ' });
  g.setKeys();
  assert.equal(fake.props.CLAUDE_API_KEY, 'test-claude-key-1234');
});

test('管理者以外はメニューの操作ができない', () => {
  const { fake, g } = setup();
  fake.activeUser = 'other@example.com';
  assert.throws(() => g.setup(), /管理者/);
  assert.throws(() => g.setKeys(), /管理者/);
});

test('サンプルの「よくある質問」を入れ直せる（2回でも重複しない）', () => {
  const { fake, g } = setup();
  g.setup();
  g.insertSampleFaqs();
  g.insertSampleFaqs();
  const rows = fake.ss.getSheetByName('よくある質問').data.slice(1).filter((r) => r[1]);
  assert.ok(rows.length >= 10);
  assert.equal(rows.length, new Set(rows.map((r) => r[1])).size);
});

test('お試しで質問すると、LINEなしでAIの答えが「お試し」シートに残る', () => {
  const { fake, g } = setup();
  g.setup();
  g.insertSampleFaqs();
  fake.props.CLAUDE_API_KEY = 'sk-test';
  fake.fetchHandler = () => ({ code: 200, body: { content: [{ type: 'text', text: '{"answer":"火曜日がお休みです。","handoff":false,"reason":""}' }] } });
  fake.ui.prompt = () => ({ getSelectedButton: () => 'OK', getResponseText: () => '定休日はいつ？' });
  g.tryQuestion();
  const rows = fake.ss.getSheetByName('お試し').data.slice(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], '定休日はいつ？');
  assert.equal(rows[0][2], '火曜日がお休みです。');
});

test('Webhook URL：貼った公開用URLに合言葉をつけて表示し、次からは空欄でも前回のURLを使う', () => {
  const { fake, g } = setup();
  g.setup();
  const key = fake.props.WEBHOOK_KEY;
  const url = 'https://script.google.com/macros/s/TEST-DEPLOY-ID-PUBLIC/exec';
  const alerts = [];
  fake.ui.alert = (msg) => { alerts.push(String(msg)); return 'OK'; };
  fake.ui.prompt = () => ({ getSelectedButton: () => 'OK', getResponseText: () => url });
  g.showWebhookUrl();
  assert.equal(fake.props.WEBAPP_URL, url);
  assert.ok(alerts.pop().includes(url + '?k=' + key));
  fake.ui.prompt = () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' });
  g.showWebhookUrl();
  assert.ok(alerts.pop().includes(url + '?k=' + key));
});

test('Webhook URL：形のちがうURL（テスト用の /dev など）は保存せず、知らせて止める', () => {
  const { fake, g } = setup();
  g.setup();
  const alerts = [];
  fake.ui.alert = (msg) => { alerts.push(String(msg)); return 'OK'; };
  fake.ui.prompt = () => ({ getSelectedButton: () => 'OK', getResponseText: () => 'https://script.google.com/macros/s/TEST-DEPLOY-ID-HEAD/dev' });
  g.showWebhookUrl();
  assert.equal(fake.props.WEBAPP_URL, undefined);
  assert.match(alerts.pop(), /形がちがいます/);
  assert.doesNotMatch(alerts.join('\n'), /\?k=/);
  fake.ui.prompt = () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' });
  g.showWebhookUrl();
  assert.match(alerts.pop(), /デプロイを管理/);
});
