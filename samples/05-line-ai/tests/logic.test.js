const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./loadGas');

const g = loadGas(['Logic.gs']);
// GAS の環境で作ったものは見た目が同じでも別物あつかいになるので、ふつうの値に直して比べる
const plain = (x) => JSON.parse(JSON.stringify(x));
const settings = { 営業開始: '10:00', 営業終了: '19:00', 定休日: '火' };
const at = (iso) => new Date(iso + '+09:00');

test('AIへの決まりに、お店の名前とよくある質問が入り、JSONで返すよう頼んでいる', () => {
  const p = g.buildSystemPrompt('ヘアサロン ことり', [{ category: '料金', question: 'カットはいくら？', answer: '4,950円です' }]);
  assert.match(p, /ヘアサロン ことり/);
  assert.match(p, /カットはいくら？/);
  assert.match(p, /4,950円です/);
  assert.match(p, /"handoff"/);
  assert.match(p, /よくある質問にないこと/);
});

test('AIの返事：JSONだけでも、前後に文章やコードの囲みがあっても読める', () => {
  assert.deepEqual(plain(g.parseAiReply('{"answer":"10時からです","handoff":false,"reason":""}')),
    { answer: '10時からです', handoff: false, reason: '' });
  const wrapped = 'はい。\n```json\n{"answer":"","handoff":true,"reason":"割引の質問"}\n```';
  assert.deepEqual(plain(g.parseAiReply(wrapped)), { answer: '', handoff: true, reason: '割引の質問' });
});

test('AIの返事が崩れていたら、引きつぎにする', () => {
  const broken = { answer: '', handoff: true, reason: 'AIの返事を読めませんでした' };
  assert.deepEqual(plain(g.parseAiReply('すみません、わかりません')), broken);
  assert.deepEqual(plain(g.parseAiReply('')), broken);
  assert.deepEqual(plain(g.parseAiReply('{"answer":"はい","handoff":"false"}')), broken); // 文字列の "false"
  assert.deepEqual(plain(g.parseAiReply('{"answer":"","handoff":false}')), broken); // 答えが空なのに引きつがない
});

test('営業時間の判定：19:00ちょうどと火曜は時間外', () => {
  assert.equal(g.isOpenNow(at('2026-11-02T10:00:00'), settings), true);
  assert.equal(g.isOpenNow(at('2026-11-02T18:59:00'), settings), true);
  assert.equal(g.isOpenNow(at('2026-11-02T19:00:00'), settings), false);
  assert.equal(g.isOpenNow(at('2026-11-02T09:59:00'), settings), false);
  assert.equal(g.isOpenNow(at('2026-11-03T12:00:00'), settings), false); // 火曜
  assert.equal(g.isOpenNow(at('2026-11-04T00:00:00'), settings), false);
});

test('連投の判定：10分に5通まで。古いものは数えない', () => {
  const now = 1_000_000_000;
  const min = 60_000;
  const recent = [now - 1 * min, now - 2 * min, now - 3 * min, now - 4 * min];
  assert.deepEqual(plain(g.checkRate(recent, now, 5, 10)), { ok: true, kept: [...recent, now] });
  const full = [...recent, now - 5 * min];
  assert.equal(g.checkRate(full, now, 5, 10).ok, false);
  const old = [now - 11 * min, now - 12 * min, now - 13 * min, now - 14 * min, now - 15 * min];
  assert.deepEqual(plain(g.checkRate(old, now, 5, 10)), { ok: true, kept: [now] });
});

test('返事の文面：引きつぎは定型文、時間外なら一言を添える。予約の話にはURLを案内', () => {
  assert.equal(g.buildReplyText({ answer: '', handoff: true }, { open: true }), g.HANDOFF_TEXT);
  assert.match(g.buildReplyText({ answer: '', handoff: true }, { open: false }), /次の営業時間/);
  assert.equal(g.buildReplyText({ answer: '10時からです', handoff: false }, { open: false }), '10時からです');
  const r = g.buildReplyText({ answer: 'ご予約はWebからどうぞ', handoff: false }, { open: true, reservationUrl: 'https://example.com/r' });
  assert.match(r, /https:\/\/example\.com\/r/);
  assert.equal(g.buildReplyText({ answer: 'ご予約はWebからどうぞ', handoff: false }, { open: true, reservationUrl: '' }), 'ご予約はWebからどうぞ');
});

test('ウェブアプリのURL：公開用の /exec だけを受け付け、前後の空白や ?以降は落とす', () => {
  const id = 'TEST_DEPLOY_ID_abc-123';
  const ok = `https://script.google.com/macros/s/${id}/exec`;
  assert.equal(g.normalizeWebAppUrl(ok), ok);
  assert.equal(g.normalizeWebAppUrl(`  ${ok}?k=old \n`), ok);
  const ws = `https://script.google.com/a/macros/example.co.jp/s/${id}/exec`;
  assert.equal(g.normalizeWebAppUrl(ws), ws);
  assert.equal(g.normalizeWebAppUrl(`https://script.google.com/macros/s/${id}/dev`), '');
  assert.equal(g.normalizeWebAppUrl(`https://example.com/macros/s/${id}/exec`), '');
  assert.equal(g.normalizeWebAppUrl(''), '');
});
