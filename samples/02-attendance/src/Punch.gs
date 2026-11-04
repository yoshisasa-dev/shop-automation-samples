/**
 * 打刻画面（Webアプリ）と、画面から呼ばれるサーバーの処理
 */

var PIN_MAX_FAILS = 5;
var PIN_LOCK_MINUTES = 10;

function doGet() {
  var settings = readSettings_();
  var shopName = settings['店名'] || 'サンプル店';
  var template = HtmlService.createTemplateFromFile('Index');
  template.shopName = shopName;
  template.staff = readStaff_().filter(function (s) { return s.active; })
    .map(function (s) { return { id: s.id, name: s.name }; });
  return template.evaluate()
    .setTitle(shopName + ' 打刻')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 画面に返すエラー（ほかのエラーは中身を見せずにログに残す） */
function userError_(message) {
  var err = new Error(message);
  err.userFacing = true;
  return err;
}

function errorResult_(err) {
  if (err && err.userFacing) return { ok: false, message: err.message };
  log_('エラー', '打刻画面の処理に失敗しました：' + (err && err.stack ? err.stack : err));
  return { ok: false, message: 'うまく記録できませんでした。もう一度押すか、店長に伝えてください。' };
}

/**
 * スタッフと暗証番号を確かめる。10分のあいだに5回まちがえたら、その10分が終わるまでロック
 * 同時にたくさん試されても回数がずれないよう、必ずスクリプトのロックの中で呼ぶ
 */
function checkPin_(staffId, pin) {
  var staff = readStaff_().filter(function (s) { return s.active && s.id === String(staffId); })[0];
  if (!staff) throw userError_('スタッフが見つかりません。画面を開き直してください。');
  if (!/^\d{4}$/.test(staff.pin)) throw userError_('暗証番号がまだ登録されていません。店長に確認してください。');
  var props = PropertiesService.getScriptProperties();
  var key = 'PINFAIL_' + staff.id;
  var nowMs = Date.now();
  var state = JSON.parse(props.getProperty(key) || '{"count":0,"since":0}');
  if (nowMs - state.since > PIN_LOCK_MINUTES * 60000) state = { count: 0, since: nowMs };
  if (state.count >= PIN_MAX_FAILS) {
    throw userError_('暗証番号を何度もまちがえたため、' + PIN_LOCK_MINUTES + '分間お休みしています。');
  }
  if (String(pin) !== staff.pin) {
    state.count++;
    props.setProperty(key, JSON.stringify(state));
    if (state.count === PIN_MAX_FAILS) notifyPinLock_(staff);
    throw userError_('暗証番号がちがいます。');
  }
  props.deleteProperty(key);
  return staff;
}

/** だれかが暗証番号を試し続けているかもしれないので、お店に知らせる */
function notifyPinLock_(staff) {
  try {
    var settings = readSettings_();
    sendMail_(settings, shopEmail_(settings), {
      subject: '【注意】' + staff.name + 'さんの打刻を' + PIN_LOCK_MINUTES + '分間止めました',
      body: '打刻画面で、' + staff.name + 'さんの暗証番号が' + PIN_MAX_FAILS + '回まちがえて入力されました。\n' +
        'ご本人でなければ、打刻画面のURLが外に広まっていないか、暗証番号を変えるかをご確認ください。'
    }, false);
    log_('注意', staff.name + ' の暗証番号を' + PIN_MAX_FAILS + '回まちがえたためロックしました');
  } catch (err) {
    log_('エラー', 'ロックのお知らせに失敗しました：' + err);
  }
}

/** スタッフの最後の打刻と、今押せるボタン */
function statusFor_(staff, now) {
  var mine = readPunches_().punches.filter(function (p) { return p.staffId === staff.id; });
  var shifts = buildShifts(mine, now);
  var last = mine.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; })[mine.length - 1];
  return {
    ok: true,
    name: staff.name,
    last: last ? { type: last.type, at: last.at } : null,
    next: allowedActions(shifts[shifts.length - 1])
  };
}

/** 画面から：暗証番号を確かめて、今の状態を返す */
function apiStatus(staffId, pin) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var status = statusFor_(checkPin_(staffId, pin), nowYmdHm_());
    status.message = status.name + 'さん、おつかれさまです。';
    return status;
  } catch (err) {
    return errorResult_(err);
  } finally {
    lock.releaseLock();
  }
}

/** 画面から：打刻する。時刻はサーバーの時計で記録する */
function apiPunch(staffId, pin, type) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var staff = checkPin_(staffId, pin);
    if (PUNCH_TYPES.indexOf(type) === -1) throw userError_('ボタンの種類が正しくありません。');
    var now = nowYmdHm_();
    var before = statusFor_(staff, now);
    if (before.next.indexOf(type) === -1) {
      throw userError_('今は「' + type + '」は押せません（押せるのは「' + before.next.join('」「') + '」）。');
    }
    appendPunch_(now, staff, type);
    log_('打刻', staff.name + ' ' + type + ' ' + now);
    var after = statusFor_(staff, now);
    after.message = staff.name + 'さん、' + type + 'を記録しました（' + now.slice(11) + '）';
    return after;
  } catch (err) {
    return errorResult_(err);
  } finally {
    lock.releaseLock();
  }
}

function appendPunch_(at, staff, type, memo) {
  var sheet = ensureSheet_(SHEET_PUNCHES, PUNCH_HEADERS);
  var row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 200);
  // 日時が自動で日付に変わらないよう、文字として書く
  sheet.getRange(row, 1, 1, PUNCH_HEADERS.length).setNumberFormat('@')
    .setValues([[at, staff.id, sanitizeCell(staff.name), type, memo || '']]);
}

/** 公開済みの打刻画面のURL（まだ公開していなければ空） */
function punchUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

function showPunchUrl() {
  assertOwner_();
  var url = punchUrl_();
  SpreadsheetApp.getUi().alert(url
    ? '打刻画面のURL：\n' + url + '\n\nスタッフのスマホのホーム画面に追加しておくと便利です。'
    : '打刻画面はまだ公開されていません。設置手順書の「打刻画面を公開する」を見てください。');
}
