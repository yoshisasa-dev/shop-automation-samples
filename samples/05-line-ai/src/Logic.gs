/**
 * 判定と文面づくり（GAS の機能を使わないので、node でテストできる）
 */

var HANDOFF_TEXT = 'お問い合わせありがとうございます。\nこちらの内容は、スタッフから改めてご連絡いたします。少しお待ちください。';
var AFTER_HOURS_NOTE = '\n※ただいま営業時間外のため、次の営業時間にお返事します。';
var NON_TEXT_REPLY = 'お手数ですが、ご質問は文字でお送りください。';
var RATE_LIMIT_REPLY = 'たくさんのメッセージをありがとうございます。続きはスタッフから改めてご連絡いたします。';
var GREETING = '友だち追加ありがとうございます！\n営業時間・料金・ご予約などのご質問に、自動でお答えします。お気軽にメッセージをお送りください。';

var WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** AIへの決まり（お店の「よくある質問」だけを根拠にさせる） */
function buildSystemPrompt(shopName, faqs) {
  var list = faqs.map(function (f, i) {
    return (i + 1) + '. [' + f.category + '] Q: ' + f.question + '\n   A: ' + f.answer;
  }).join('\n');
  return [
    'あなたは「' + shopName + '」のLINE窓口です。お客さまの質問に、やさしい日本語で短く（3文以内）答えます。',
    '答えの根拠にしてよいのは、下の「よくある質問」に書いてあることだけです。',
    '',
    '次のときは答えずに、スタッフに引きつぎます（handoff を true にする）：',
    '- よくある質問にないこと、書いてあるか自信がないこと',
    '- 割引・値引き・特別な対応のお願い',
    '- 体や肌の症状・薬など、医療に関わること',
    '- 予約の空き状況や、予約の変更・取り消し',
    '- 苦情・クレーム、個人的な事情の相談',
    '',
    '返事は、次の形のJSONだけにしてください（前後に文章を書かない）：',
    '{"answer": "お客さまへの答え（引きつぐときは空）", "handoff": true または false, "reason": "引きつぐ理由（引きつがないときは空）"}',
    '',
    '【よくある質問】',
    list || '（まだ登録されていません）'
  ].join('\n');
}

/** AIの返事からJSONを取り出す。崩れていたら引きつぎにする */
function parseAiReply(text) {
  var broken = { answer: '', handoff: true, reason: 'AIの返事を読めませんでした' };
  var s = String(text || '');
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return broken;
  var obj;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return broken;
  }
  if (typeof obj.handoff !== 'boolean') return broken;
  var answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  if (!obj.handoff && !answer) return broken;
  return { answer: obj.handoff ? '' : answer, handoff: obj.handoff, reason: typeof obj.reason === 'string' ? obj.reason : '' };
}

function toMinutes_(hhmm) {
  var p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

/** 東京の時刻で、営業時間内か（終了時刻ちょうどは時間外） */
function isOpenNow(date, settings) {
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
  var weekIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  var closed = String(settings['定休日'] || '').split(/[,、\s]+/).filter(Boolean);
  if (closed.indexOf(WEEK_JA[weekIndex]) !== -1) return false;
  var now = Number(parts.hour) * 60 + Number(parts.minute);
  return now >= toMinutes_(settings['営業開始'] || '10:00') && now < toMinutes_(settings['営業終了'] || '19:00');
}

/** 連投の判定。windowMinutes 以内の送信が limit 未満なら ok（今回の分を足して返す） */
function checkRate(timestamps, now, limit, windowMinutes) {
  var since = now - windowMinutes * 60000;
  var kept = (timestamps || []).filter(function (t) { return t > since; });
  if (kept.length >= limit) return { ok: false, kept: kept };
  return { ok: true, kept: kept.concat([now]) };
}

/** シートに書くとき、「=」などで始まる文字が数式にならないようにする */
function asPlainText(s) {
  var t = String(s == null ? '' : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

/** 公開用のウェブアプリURL（…/exec）なら整えて返し、ちがえば空文字（テスト用の /dev は使えない） */
function normalizeWebAppUrl(s) {
  var t = String(s == null ? '' : s).trim().split(/[?#]/)[0];
  return /^https:\/\/script\.google\.com\/(a\/macros\/[^\/\s]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(t) ? t : '';
}

/** LINEに返す文面 */
function buildReplyText(result, opts) {
  if (result.handoff) return HANDOFF_TEXT + (opts.open ? '' : AFTER_HOURS_NOTE);
  var text = result.answer;
  if (opts.reservationUrl && text.indexOf('予約') !== -1 && text.indexOf(opts.reservationUrl) === -1) {
    text += '\n\nご予約はこちらから：\n' + opts.reservationUrl;
  }
  return text;
}
