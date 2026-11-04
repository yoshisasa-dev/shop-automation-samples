/**
 * 外のサービス（Claude・LINE）を呼ぶ部品。失敗しても止まらず、結果で知らせる
 */

var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
var LINE_API = 'https://api.line.me/v2/bot';

/** Claude に聞く。{ok:true, text} か {ok:false, error} を返す */
function askClaude_(systemPrompt, userText, apiKey, model) {
  try {
    var res = UrlFetchApp.fetch(CLAUDE_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: model,
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }]
      }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) return { ok: false, error: 'Claude のエラー（' + code + '）' };
    var body = JSON.parse(res.getContentText());
    var text = (body.content || []).filter(function (c) { return c.type === 'text'; })
      .map(function (c) { return c.text; }).join('');
    return { ok: true, text: text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function lineHeaders_(token) {
  return { Authorization: 'Bearer ' + token };
}

/** LINE に返信する（返信用トークンは1回だけ使える）。送れたら true */
function lineReply_(replyToken, text, token) {
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: lineHeaders_(token),
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    return res.getResponseCode() === 200;
  } catch (err) {
    return false;
  }
}

/** LINE の表示名（取れなければ「LINEのお客さま」） */
function lineDisplayName_(userId, token) {
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/profile/' + encodeURIComponent(userId), {
      headers: lineHeaders_(token),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return 'LINEのお客さま';
    return JSON.parse(res.getContentText()).displayName || 'LINEのお客さま';
  } catch (err) {
    return 'LINEのお客さま';
  }
}
