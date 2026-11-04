/**
 * メニュー・初期設定・キーの設定・お試し
 */

var SHEET_TRY = 'お試し';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('💬 サンプル店')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('🔑 キーを設定（Claude・LINE）', 'setKeys')
    .addItem('お試しで質問する（LINEなし）', 'tryQuestion')
    .addSeparator()
    .addItem('サンプルの「よくある質問」を入れる', 'insertSampleFaqs')
    .addItem('LINEに貼るWebhook URLを表示', 'showWebhookUrl')
    .addToUi();
}

/** メニューの操作は、設置したアカウントで開いたときだけ */
function assertOwner_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('この操作はお店の管理者だけが実行できます。');
  }
}

/** 初期設定。何度実行しても入力済みの設定・よくある質問・ログは消えない */
function setup() {
  assertOwner_();
  var ss = getSs_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SS_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);
  ensureSettings_(DEFAULT_SETTINGS);
  var faq = ensureSheet_(SHEET_FAQ, FAQ_HEADERS);
  faq.getRange(2, 4, 199, 1).insertCheckboxes();
  faq.setColumnWidth(1, 110);
  faq.setColumnWidth(2, 260);
  faq.setColumnWidth(3, 480);
  ensureSheet_(SHEET_CHAT_LOG, CHAT_LOG_HEADERS);
  ensureSheet_(SHEET_TRY, ['日時', '質問', 'LINEに返す文', '引きつぎ', '理由']);
  ensureSheet_(SHEET_LOG, ['日時', '種類', '内容']);
  if (!props.getProperty('WEBHOOK_KEY')) {
    props.setProperty('WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  }
  log_('情報', '初期設定をしました');
  SpreadsheetApp.getUi().alert('初期設定が終わりました。\n次に「🔑 キーを設定」で Claude と LINE のキーを入れてください。');
}

/** Claude の APIキーと LINE のトークンを入力欄から保存する（空欄なら今のまま） */
function setKeys() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var items = [
    ['CLAUDE_API_KEY', 'Claude の APIキー（sk-ant- で始まる文字）'],
    ['LINE_TOKEN', 'LINE のチャネルアクセストークン（長期）']
  ];
  var saved = [];
  items.forEach(function (item) {
    var res = ui.prompt('🔑 キーを設定', item[1] + 'を貼り付けてください。\n変えないときは空のままOK。', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    var value = String(res.getResponseText() || '').trim();
    if (!value) return;
    props.setProperty(item[0], value);
    saved.push(item[1].split('（')[0] + '：…' + value.slice(-4));
  });
  ui.alert(saved.length ? '保存しました（最後の4文字だけ表示）\n' + saved.join('\n') : '変更はありません');
}

/** LINE を使わずに、AIの答えを確かめる */
function tryQuestion() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('お試しで質問する', 'お客さんになったつもりで、質問を入れてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var question = String(res.getResponseText() || '').trim();
  if (!question) return;
  var settings = readSettings_();
  var result = answerQuestion_(question, settings, PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY'));
  var text = buildReplyText(result, { open: isOpenNow(new Date(), settings), reservationUrl: settings['予約ページURL'] });
  ensureSheet_(SHEET_TRY, ['日時', '質問', 'LINEに返す文', '引きつぎ', '理由'])
    .appendRow([formatNow_(new Date(), 'yyyy-MM-dd HH:mm:ss'), question, text, result.handoff ? '要対応' : '', result.reason]);
  ui.alert('LINEに返す文：\n\n' + text + (result.handoff ? '\n\n（スタッフに引きつぎ：' + result.reason + '）' : ''));
}

/** LINE Developers の「Webhook URL」に貼るURL */
/**
 * LINE に貼る URL を作る。ScriptApp.getService().getUrl() はテスト用の URL を返すことがあり、
 * LINE から呼べないので、「デプロイを管理」に出ている公開用の URL を貼ってもらう（前回の分は覚えておく）
 */
function showWebhookUrl() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('WEBAPP_URL') || '';
  var res = ui.prompt('LINEに貼るWebhook URL',
    '「デプロイ」→「デプロイを管理」の「ウェブアプリ」のURL（/exec で終わるもの）を貼ってください。' +
    (saved ? '\n前回と同じなら空のままOK。' : ''), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var text = String(res.getResponseText() || '').trim();
  if (!text && !saved) {
    ui.alert('ウェブアプリのURLが入っていません。\n「デプロイ」→「デプロイを管理」で、ウェブアプリのURLをコピーしてから、もう一度実行してください。');
    return;
  }
  var url = text ? normalizeWebAppUrl(text) : saved;
  if (!url) {
    ui.alert('URLの形がちがいます。\n「https://script.google.com/macros/s/…/exec」の形のURLを貼ってください（/dev で終わるテスト用のURLは、LINEから使えません）。');
    return;
  }
  props.setProperty('WEBAPP_URL', url);
  ui.alert('LINE Developers の「Webhook URL」に、次のURLを貼ってください：\n\n' + url + '?k=' + props.getProperty('WEBHOOK_KEY') + '\n\n※このURLは他の人に教えないでください');
}
