/**
 * LINE の Webhook の受け口（doPost）と、会話ログ・お店への知らせ
 */

var SHEET_FAQ = 'よくある質問';
var SHEET_CHAT_LOG = '会話ログ';
var FAQ_HEADERS = ['カテゴリ', '質問', '答え', '公開'];
var CHAT_LOG_HEADERS = ['日時', 'お客さん', '質問', '答え', '引きつぎ', '理由'];

var DEFAULT_SETTINGS = [
  ['店名', 'ヘアサロン ことり（サンプル店）', 'LINEの返事やメールに出るお店の名前'],
  ['通知先メール', '', 'スタッフの対応が必要なときに知らせるアドレス。空なら設置したアカウントに届く'],
  ['営業開始', '10:00', '営業時間外は「次の営業時間にお返事します」を添える'],
  ['営業終了', '19:00', ''],
  ['定休日', '火', '複数ならカンマ区切り（例：火,水）'],
  ['予約ページURL', '', '予約の話のときに案内するURL（空なら案内しない）'],
  ['連投の上限（10分あたり）', '5', '同じ人がこれより多く送ったら、AIを使わずにスタッフへ'],
  ['1日のAI上限', '200', '1日にAIを使う回数の上限（使いすぎ防止）'],
  ['1人あたりの1日のAI上限', '20', '同じ人が1日にAIを使える回数（1人で上限を使い切らないように）'],
  ['AIモデル', 'claude-haiku-5-5', 'Claude のモデル名（ふつうは変えない）']
];

/** LINE からの通知を受ける。URL の秘密の文字列が合わないものは無視する */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('WEBHOOK_KEY');
  var given = e && e.parameter ? e.parameter.k : '';
  if (!key || given !== key) return ContentService.createTextOutput('ok');

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('ok');
  }
  var ctx = {
    settings: readSettings_(),
    lineToken: props.getProperty('LINE_TOKEN'),
    apiKey: props.getProperty('CLAUDE_API_KEY')
  };
  (body.events || []).forEach(function (event) {
    try {
      handleEvent_(event, ctx);
    } catch (err) {
      log_('エラー', 'LINEの処理に失敗しました：' + err);
    }
  });
  return ContentService.createTextOutput('ok');
}

function handleEvent_(event, ctx) {
  // LINE の再送や、同じイベントの2回目は処理しない（二重の返事・二重のAI利用を防ぐ）
  if (event.deliveryContext && event.deliveryContext.isRedelivery) return;
  if (event.webhookEventId && !markEventOnce_(event.webhookEventId)) return;
  // グループ・トークルームでは答えない（1対1のトークだけ）
  if (event.source && event.source.type && event.source.type !== 'user') return;

  if (event.type === 'follow') {
    lineReply_(event.replyToken, GREETING, ctx.lineToken);
    return;
  }
  if (event.type !== 'message') return;
  if (!event.message || event.message.type !== 'text') {
    lineReply_(event.replyToken, NON_TEXT_REPLY, ctx.lineToken);
    return;
  }

  var replied = false;
  try {
    var userId = (event.source && event.source.userId) || 'unknown';
    var question = String(event.message.text || '').slice(0, 500);
    var name = lineDisplayName_(userId, ctx.lineToken);

    if (!allowByRate_(userId, ctx.settings)) {
      replied = lineReply_(event.replyToken, RATE_LIMIT_REPLY, ctx.lineToken) || true;
      writeChatLog_(name, question, RATE_LIMIT_REPLY, true, '連投の上限');
      return;
    }

    var result;
    if (!takeUserQuota_(userId, ctx.settings)) {
      result = { answer: '', handoff: true, reason: '1人あたりの1日のAI上限に達しました' };
    } else if (!takeDailyQuota_(ctx.settings)) {
      result = { answer: '', handoff: true, reason: '1日のAI上限に達しました' };
    } else {
      result = answerQuestion_(question, ctx.settings, ctx.apiKey);
    }

    var text = buildReplyText(result, { open: isOpenNow(new Date(), ctx.settings), reservationUrl: ctx.settings['予約ページURL'] });
    if (!lineReply_(event.replyToken, text, ctx.lineToken)) log_('注意', 'LINEへの返信に失敗しました（トークンの期限切れなど）');
    replied = true;
    writeChatLog_(name, question, text, result.handoff, result.reason);
    if (result.handoff) notifyShop_(ctx.settings, userId, name, question, result.reason);
  } catch (err) {
    // 思わぬエラーでも、お客さんを無視しない
    log_('エラー', 'LINEの処理に失敗しました：' + err);
    if (!replied) lineReply_(event.replyToken, HANDOFF_TEXT, ctx.lineToken);
  }
}

/** 同じイベントIDを10分間おぼえ、2回目なら false */
function markEventOnce_(eventId) {
  var cache = CacheService.getScriptCache();
  var key = 'evt_' + eventId;
  if (cache.get(key)) return false;
  cache.put(key, '1', 600);
  return true;
}

/** 同じ人が今日AIを使った回数を1つ使う。上限をこえていたら false（CacheService に6時間おぼえる） */
function takeUserQuota_(userId, settings) {
  var cache = CacheService.getScriptCache();
  var key = 'uq_' + formatNow_(new Date(), 'yyyyMMdd') + '_' + userId;
  var used = Number(cache.get(key) || 0);
  if (used >= settingNumber_(settings, '1人あたりの1日のAI上限', 20)) return false;
  cache.put(key, String(used + 1), 21600);
  return true;
}

/** よくある質問をもとに AI に答えてもらう（お試しメニューと共通）。失敗しても引きつぎにする */
function answerQuestion_(question, settings, apiKey) {
  if (!apiKey) return { answer: '', handoff: true, reason: 'ClaudeのAPIキーが設定されていません' };
  var prompt = buildSystemPrompt(settings['店名'] || 'サンプル店', readFaqs_());
  var res = askClaude_(prompt, question, apiKey, settings['AIモデル'] || 'claude-haiku-5-5');
  if (!res.ok) {
    log_('エラー', 'AIに聞けませんでした：' + res.error);
    return { answer: '', handoff: true, reason: 'AIに聞けませんでした（' + res.error + '）' };
  }
  return parseAiReply(res.text);
}

/** 公開中のよくある質問 */
function readFaqs_() {
  var sheet = getSs_().getSheetByName(SHEET_FAQ);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[1] && r[2] && (r[3] === true || String(r[3]).toUpperCase() === 'TRUE'); })
    .map(function (r) { return { category: String(r[0]), question: String(r[1]), answer: String(r[2]) }; });
}

/** 同じ人の連投を数える（10分間、CacheService に送った時刻を残す） */
function allowByRate_(userId, settings) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rate_' + userId;
  var list = [];
  try {
    list = JSON.parse(cache.get(cacheKey) || '[]');
  } catch (err) {
    list = [];
  }
  var r = checkRate(list, Date.now(), settingNumber_(settings, '連投の上限（10分あたり）', 5), 10);
  cache.put(cacheKey, JSON.stringify(r.kept), 600);
  return r.ok;
}

/** 1日のAIの回数を1つ使う。上限をこえていたら false */
function takeDailyQuota_(settings) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'AI_COUNT_' + formatNow_(new Date(), 'yyyy-MM-dd');
    var used = Number(props.getProperty(key) || 0);
    if (used >= settingNumber_(settings, '1日のAI上限', 200)) return false;
    props.setProperty(key, String(used + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function writeChatLog_(name, question, answer, handoff, reason) {
  ensureSheet_(SHEET_CHAT_LOG, CHAT_LOG_HEADERS)
    .appendRow([formatNow_(new Date(), 'yyyy-MM-dd HH:mm:ss'), asPlainText(name), asPlainText(question),
      asPlainText(answer), handoff ? '要対応' : '', asPlainText(reason || '')]);
}

/** お店に知らせる。同じ人については1時間に1通まで（メールの送信数を使い切らないように） */
function notifyShop_(settings, userId, name, question, reason) {
  var cache = CacheService.getScriptCache();
  var key = 'mail_' + userId;
  if (cache.get(key)) return;
  cache.put(key, '1', 3600);
  sendMail_(settings, shopEmail_(settings), {
    subject: '【LINE】スタッフの対応が必要です：' + name + ' さま',
    body: [
      'LINEで、AIが答えられない（または答えない方がよい）お問い合わせがありました。',
      'LINE公式アカウントの管理画面から、お客さまにお返事してください。',
      '',
      'お客さま：' + name,
      '内容：' + question,
      '理由：' + (reason || '—'),
      '',
      '※架空のサンプル店の見本です'
    ].join('\n')
  }, false);
}
