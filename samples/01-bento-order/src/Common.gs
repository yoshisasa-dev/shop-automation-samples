/**
 * 共通部品（どのサンプルでも使い回す）
 * 設定シート・ログ・シート準備・デモモード付きメール送信
 */

var SHEET_SETTINGS = '設定';
var SHEET_LOG = 'ログ';
var TZ = 'Asia/Tokyo';

function getSs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'));
}

/** シートが無ければ作り、1行目に見出しを入れる */
function ensureSheet_(name, headers) {
  var ss = getSs_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (headers && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#fff3e0');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 設定シートに足りない項目を追加する（入力済みの値は上書きしない）
 * @param {Array} defaults [[項目, 値, 説明], ...]
 */
function ensureSettings_(defaults) {
  var sheet = ensureSheet_(SHEET_SETTINGS, ['項目', '値', '説明']);
  // 「15:00」などが時刻に変換されないよう、値の列は文字列として扱う
  sheet.getRange('B:B').setNumberFormat('@');
  var existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  defaults.forEach(function (row) {
    if (existing.indexOf(row[0]) === -1) sheet.appendRow([row[0], String(row[1]), row[2]]);
  });
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(3, 420);
}

/** 設定シートを {項目: 値} で読む */
function readSettings_() {
  var sheet = getSs_().getSheetByName(SHEET_SETTINGS);
  var settings = {};
  if (!sheet || sheet.getLastRow() < 2) return settings;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var value = r[1];
    if (value instanceof Date) value = Utilities.formatDate(value, TZ, 'HH:mm');
    settings[String(r[0]).trim()] = String(value).trim();
  });
  return settings;
}

/** 設定から数値を読む（空や数字でなければ既定値） */
function settingNumber_(settings, key, fallback) {
  var n = Number(settings[key]);
  return settings[key] === undefined || settings[key] === '' || isNaN(n) ? fallback : n;
}

/** はっきり「OFF」と書いてあるときだけ本番。消したり打ち間違えたりしてもデモのまま */
function isDemoMode_(settings) {
  return String(settings['デモモード'] || '').trim().toUpperCase() !== 'OFF';
}

// お店宛て（新着・製造数・エラー）のために残しておく1日の送信数
var MAIL_RESERVE_FOR_SHOP = 10;

/** お店の通知先（未入力なら設置したアカウント） */
function shopEmail_(settings) {
  return settings['通知先メール'] || Session.getEffectiveUser().getEmail();
}

/** ログシートに1行追加する */
function log_(level, message) {
  try {
    ensureSheet_(SHEET_LOG, ['日時', '種類', '内容'])
      .appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), level, message]);
  } catch (err) {
    console.error(level + ': ' + message + ' / ログ書き込み失敗: ' + err);
  }
}

/**
 * メールを送る。デモモードのときはお客さん宛てもお店の通知先に届ける
 * @param {boolean} toCustomer お客さん宛てか
 * @return {boolean} 送れたら true（送信数が足りない・宛先が空で送らなかったら false）
 */
function sendMail_(settings, to, mail, toCustomer) {
  var subject = mail.subject;
  var body = mail.body;
  if (toCustomer && MailApp.getRemainingDailyQuota() <= MAIL_RESERVE_FOR_SHOP) {
    log_('注意', '今日のメール送信数が残り少ないため、お客さん宛てを送りませんでした：' + subject);
    return false;
  }
  if (toCustomer && isDemoMode_(settings)) {
    body = '（デモモード：本来の宛先は ' + (to || '未入力') + ' です）\n\n' + body;
    subject = '【デモ】' + subject;
    to = shopEmail_(settings);
  }
  if (!to) {
    log_('注意', 'メールの宛先が空のため送信しませんでした：' + subject);
    return false;
  }
  MailApp.sendEmail({ to: to, subject: subject, body: body, name: settings['店名'] || 'サンプル店' });
  return true;
}

function formatNow_(date, pattern) {
  return Utilities.formatDate(date || new Date(), TZ, pattern);
}
