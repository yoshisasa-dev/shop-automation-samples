const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, createFakeGas } = require('./loadGas');

const KEY = 'secret-key-123';

function setup({ claude } = {}) {
  const fake = createFakeGas();
  fake.globals.ContentService = { createTextOutput: (s) => ({ text: s }) };
  const g = loadGas(['Logic.gs', 'Common.gs', 'Api.gs', 'Line.gs'], fake.globals);
  g.ensureSettings_(g.DEFAULT_SETTINGS);
  const faq = g.ensureSheet_(g.SHEET_FAQ, g.FAQ_HEADERS);
  faq.appendRow(['駐車場', '駐車場はありますか？', 'お店の裏に2台分あります。', true]);
  faq.appendRow(['料金', 'カットはいくら？', '4,950円です。', true]);
  faq.appendRow(['非公開', '秘密の質問', '秘密の答え', false]);
  Object.assign(fake.props, { WEBHOOK_KEY: KEY, CLAUDE_API_KEY: 'sk-test', LINE_TOKEN: 'line-token' });
  fake.replies = [];
  fake.fetchHandler = (url, opts) => {
    if (url.includes('anthropic')) return claude ? claude(JSON.parse(opts.payload)) : { code: 200, body: { content: [{ type: 'text', text: '{"answer":"お店の裏に2台分あります。","handoff":false,"reason":""}' }] } };
    if (url.endsWith('/message/reply')) { fake.replies.push(JSON.parse(opts.payload).messages[0].text); return { code: 200, body: {} }; }
    if (url.includes('/profile/')) return { code: 200, body: { displayName: 'はなこ' } };
    return { code: 404, body: {} };
  };
  return { fake, g };
}

const post = (events, k = KEY) => ({ parameter: k === null ? {} : { k }, postData: { contents: JSON.stringify({ events }) } });
const textEvent = (text, userId = 'U1', replyToken = 'rt') => ({ type: 'message', replyToken, source: { userId }, message: { type: 'text', text } });
const aiCalls = (fake) => fake.fetches.filter((f) => f.url.includes('anthropic')).length;
const logRows = (fake) => fake.ss.getSheetByName('会話ログ').data.slice(1);

test('秘密の文字列がない・違うリクエストは、何もしない', () => {
  const { fake, g } = setup();
  g.doPost(post([textEvent('こんにちは')], null));
  g.doPost(post([textEvent('こんにちは')], 'wrong'));
  assert.equal(fake.fetches.length, 0);
});

test('質問にAIが答え、LINEに返信し、会話ログに1行残る。AIには公開中のよくある質問だけを渡す', () => {
  const { fake, g } = setup();
  g.doPost(post([textEvent('駐車場ある？')]));
  assert.deepEqual(fake.replies, ['お店の裏に2台分あります。']);
  const sys = fake.fetches.find((f) => f.url.includes('anthropic')).body.system;
  assert.match(sys, /駐車場はありますか？/);
  assert.doesNotMatch(sys, /秘密の質問/);
  const rows = logRows(fake);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], 'はなこ');
  assert.equal(rows[0][2], '駐車場ある？');
  assert.equal(rows[0][4], '');
  assert.equal(fake.sent.length, 0);
});

test('AIが引きつぎと判断したら、定型文で返し、お店にメールで知らせる', () => {
  const { fake, g } = setup({ claude: () => ({ code: 200, body: { content: [{ type: 'text', text: '{"answer":"","handoff":true,"reason":"割引のお願い"}' }] } }) });
  g.doPost(post([textEvent('安くしてもらえますか')]));
  assert.ok(fake.replies[0].startsWith(g.HANDOFF_TEXT));
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].subject, /スタッフの対応/);
  assert.match(fake.sent[0].body, /安くしてもらえますか/);
  assert.match(fake.sent[0].body, /割引のお願い/);
  assert.equal(logRows(fake)[0][4], '要対応');
});

test('AIが失敗しても、お客さんには定型文で返し、お店に知らせる', () => {
  const { fake, g } = setup({ claude: () => ({ code: 500, body: {} }) });
  g.doPost(post([textEvent('カットはいくら')]));
  assert.ok(fake.replies[0].startsWith(g.HANDOFF_TEXT));
  assert.equal(fake.sent.length, 1);
});

test('スタンプや画像は、AIを呼ばずに「文字でお送りください」', () => {
  const { fake, g } = setup();
  g.doPost(post([{ type: 'message', replyToken: 'rt', source: { userId: 'U1' }, message: { type: 'sticker' } }]));
  assert.deepEqual(fake.replies, [g.NON_TEXT_REPLY]);
  assert.equal(aiCalls(fake), 0);
});

test('同じ人の6通目（10分以内）は、AIを呼ばずに止める', () => {
  const { fake, g } = setup();
  for (let i = 0; i < 6; i++) g.doPost(post([textEvent('質問' + i)]));
  assert.equal(aiCalls(fake), 5);
  assert.equal(fake.replies[5], g.RATE_LIMIT_REPLY);
  // 別の人は止まらない
  g.doPost(post([textEvent('こんにちは', 'U2')]));
  assert.equal(aiCalls(fake), 6);
});

test('1日のAIの上限をこえたら、AIを呼ばずに引きつぐ', () => {
  const { fake, g } = setup();
  const sheet = fake.ss.getSheetByName('設定');
  const row = sheet.data.findIndex((r) => r[0] === '1日のAI上限');
  sheet.data[row][1] = '1';
  g.doPost(post([textEvent('一つ目', 'U1')]));
  g.doPost(post([textEvent('二つ目', 'U2')]));
  assert.equal(aiCalls(fake), 1);
  assert.ok(fake.replies[1].startsWith(g.HANDOFF_TEXT));
});

test('友だち追加には、あいさつを返す', () => {
  const { fake, g } = setup();
  g.doPost(post([{ type: 'follow', replyToken: 'rt', source: { userId: 'U1' } }]));
  assert.deepEqual(fake.replies, [g.GREETING]);
});

test('APIキーが未設定でも落ちず、引きつぎになる', () => {
  const { fake, g } = setup();
  delete fake.props.CLAUDE_API_KEY;
  g.doPost(post([textEvent('こんにちは')]));
  assert.equal(aiCalls(fake), 0);
  assert.ok(fake.replies[0].startsWith(g.HANDOFF_TEXT));
});

test('「=」で始まるメッセージや名前は、数式にならないよう文字として残す', () => {
  const { fake, g } = setup();
  fake.fetchHandler = ((orig) => (url, opts) => (url.includes('/profile/') ? { code: 200, body: { displayName: '=1+1' } } : orig(url, opts)))(fake.fetchHandler);
  g.doPost(post([textEvent('=HYPERLINK("https://evil.example","返信はこちら")')]));
  const row = logRows(fake)[0];
  assert.ok(String(row[1]).startsWith("'"));
  assert.ok(String(row[2]).startsWith("'="));
});

test('LINEの再送（isRedelivery）や、同じイベントIDの2回目は処理しない', () => {
  const { fake, g } = setup();
  g.doPost(post([{ ...textEvent('再送です'), deliveryContext: { isRedelivery: true } }]));
  assert.equal(aiCalls(fake), 0);
  const ev = { ...textEvent('一度だけ'), webhookEventId: 'evt-1' };
  g.doPost(post([ev]));
  g.doPost(post([ev]));
  assert.equal(aiCalls(fake), 1);
  assert.equal(fake.replies.length, 1);
});

test('1人あたりの1日のAI上限をこえたら、その人だけAIを使わない', () => {
  const { fake, g } = setup();
  const sheet = fake.ss.getSheetByName('設定');
  sheet.data[sheet.data.findIndex((r) => r[0] === '1人あたりの1日のAI上限')][1] = '2';
  for (let i = 0; i < 3; i++) g.doPost(post([textEvent('質問' + i, 'U1')]));
  assert.equal(aiCalls(fake), 2);
  g.doPost(post([textEvent('こんにちは', 'U2')]));
  assert.equal(aiCalls(fake), 3);
});

test('同じ人の引きつぎメールは1時間に1通まで', () => {
  const { fake, g } = setup({ claude: () => ({ code: 200, body: { content: [{ type: 'text', text: '{"answer":"","handoff":true,"reason":"割引"}' }] } }) });
  g.doPost(post([textEvent('安くして')]));
  g.doPost(post([textEvent('もっと安くして')]));
  assert.equal(fake.sent.length, 1);
  assert.equal(logRows(fake).length, 2);
});

test('思わぬエラーが起きても、お客さんには定型文を返す', () => {
  const { fake, g } = setup();
  g.readFaqs_ = () => { throw new Error('シートが読めません'); };
  g.doPost(post([textEvent('こんにちは')]));
  assert.equal(fake.replies.length, 1);
  assert.ok(fake.replies[0].startsWith(g.HANDOFF_TEXT));
});

test('グループやトークルームでは答えない（1対1のトークだけ）', () => {
  const { fake, g } = setup();
  g.doPost(post([{ ...textEvent('みなさんこんにちは'), source: { type: 'group', groupId: 'G1', userId: 'U1' } }]));
  assert.equal(aiCalls(fake), 0);
  assert.equal(fake.replies.length, 0);
});
