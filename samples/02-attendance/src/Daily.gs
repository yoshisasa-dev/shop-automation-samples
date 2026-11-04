/**
 * 打刻忘れのチェック：毎朝、過去7日の打刻の足りない日をお店に知らせる
 */

var CHECK_DAYS = 7;

/** 毎日の時刻トリガーから呼ばれる。前に知らせた打刻忘れは、もう一度は送らない */
function dailyCheck(e) {
  if (!isFromOwnTrigger_(e)) assertOwner_();
  try {
    runCheck_(true, true);
  } catch (err) {
    log_('エラー', '打刻忘れのチェックに失敗しました：' + (err && err.stack ? err.stack : err));
  }
}

/** このスクリプトに登録されているトリガーからの実行か（打刻画面からは呼ばせない） */
function isFromOwnTrigger_(e) {
  if (!e || !e.triggerUid) return false;
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === String(e.triggerUid); });
}

/** メニューから手動で実行。見つかった分をすべて知らせる */
function checkNow() {
  assertOwner_();
  var found = runCheck_(true, false);
  SpreadsheetApp.getUi().alert(found.length
    ? '打刻の確認が必要な日が ' + found.length + ' 件ありました。通知先にメールを送りました。'
    : '過去' + CHECK_DAYS + '日に、打刻の足りない日はありませんでした。');
}

/**
 * @param {boolean} onlyNew true なら、前に知らせていない打刻忘れだけメールする
 */
function runCheck_(sendMail, onlyNew) {
  var settings = readSettings_();
  var r = refreshAttendance_();
  var today = nowYmdHm_().slice(0, 10);
  var since = addDaysYmd(today, -CHECK_DAYS);
  var found = r.shifts.filter(function (s) { return s.issues.length && s.date >= since && s.date < today; });

  var props = PropertiesService.getScriptProperties();
  var notified = JSON.parse(props.getProperty('NOTIFIED_SHIFTS') || '[]');
  var toSend = onlyNew ? found.filter(function (s) { return notified.indexOf(shiftKey_(s)) === -1; }) : found;
  if (sendMail && toSend.length) {
    sendMail_(settings, shopEmail_(settings), buildMissingMail(settings['店名'] || 'サンプル店', toSend), false);
  }
  // 7日を過ぎたものは自然に消えるよう、今見つかった分だけを覚えておく
  props.setProperty('NOTIFIED_SHIFTS', JSON.stringify(found.map(shiftKey_)));
  log_('チェック', '打刻の確認が必要な日：' + found.length + '件（メール ' + (sendMail ? toSend.length : 0) + '件）');
  return found;
}

function shiftKey_(shift) {
  return shift.staffId + '|' + (shift.in || shift.out || shift.date);
}
