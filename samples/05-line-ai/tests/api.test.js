const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, createFakeGas } = require('./loadGas');

function setup() {
  const fake = createFakeGas();
  const g = loadGas(['Logic.gs', 'Common.gs', 'Api.gs'], fake.globals);
  return { fake, g };
}

test('Claudeに聞く：決まった宛先・ヘッダー・モデルで送り、答えの文字を返す', () => {
  const { fake, g } = setup();
  fake.fetchHandler = () => ({ code: 200, body: { content: [{ type: 'text', text: '{"answer":"はい","handoff":false}' }] } });
  const r = g.askClaude_('決まり', '駐車場はありますか', 'sk-test', 'claude-haiku-5-5');
  assert.equal(r.ok, true);
  assert.equal(r.text, '{"answer":"はい","handoff":false}');
  const req = fake.fetches[0];
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.opts.headers['x-api-key'], 'sk-test');
  assert.equal(req.opts.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.opts.muteHttpExceptions, true);
  assert.equal(req.body.model, 'claude-haiku-5-5');
  assert.equal(req.body.system, '決まり');
  assert.equal(req.body.messages[0].content, '駐車場はありますか');
});

test('Claudeに聞く：エラーや通信失敗でも止まらず ok:false を返す', () => {
  const { fake, g } = setup();
  fake.fetchHandler = () => ({ code: 529, body: { error: { message: 'overloaded' } } });
  assert.equal(g.askClaude_('決まり', 'こんにちは', 'k', 'm').ok, false);
  fake.fetchHandler = () => { throw new Error('通信できません'); };
  const r = g.askClaude_('決まり', 'こんにちは', 'k', 'm');
  assert.equal(r.ok, false);
  assert.match(r.error, /通信できません/);
});

test('LINEに返信する：返信用の宛先とトークンで送る', () => {
  const { fake, g } = setup();
  fake.fetchHandler = () => ({ code: 200, body: {} });
  assert.equal(g.lineReply_('rt-1', 'こんにちは', 'line-token'), true);
  const req = fake.fetches[0];
  assert.equal(req.url, 'https://api.line.me/v2/bot/message/reply');
  assert.equal(req.opts.headers.Authorization, 'Bearer line-token');
  assert.equal(req.body.replyToken, 'rt-1');
  assert.equal(req.body.messages[0].text, 'こんにちは');
  fake.fetchHandler = () => ({ code: 400, body: { message: 'Invalid reply token' } });
  assert.equal(g.lineReply_('rt-2', 'こんにちは', 'line-token'), false);
});

test('LINEの表示名：取れなければ「LINEのお客さま」', () => {
  const { fake, g } = setup();
  fake.fetchHandler = () => ({ code: 200, body: { displayName: 'はなこ' } });
  assert.equal(g.lineDisplayName_('U123', 't'), 'はなこ');
  fake.fetchHandler = () => ({ code: 404, body: {} });
  assert.equal(g.lineDisplayName_('U123', 't'), 'LINEのお客さま');
});
