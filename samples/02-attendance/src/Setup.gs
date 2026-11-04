/**
 * 初期設定：シート・トリガーを用意する
 */

var DEFAULT_SETTINGS = [
  ['店名', 'カフェ ひだまり（サンプル店）', '打刻画面・メールに出るお店の名前'],
  ['通知先メール', '', '打刻忘れのお知らせを受け取るアドレス。空なら設置したアカウントに届く'],
  ['締め日', '末', '「末」または 1〜28 の数字（例：20 なら20日締め）'],
  ['1日の所定時間', '8', 'これを超えた時間を「残業」として数える（時間）'],
  ['深夜_開始', '22:00', '深夜の時間帯の始まり'],
  ['深夜_終了', '05:00', '深夜の時間帯の終わり（翌朝）'],
  ['割増率_残業（%）', '25', 'お給料の目安に足す、残業の割増'],
  ['割増率_深夜（%）', '25', 'お給料の目安に足す、深夜の割増'],
  ['端数処理（分）', '1', '勤務時間を何分単位で切り捨てるか。1なら切り捨てなし（1分単位が基本です）'],
  ['打刻忘れチェックの時刻', '9', '毎日この時（0〜23）に過去7日の打刻忘れを確認してメール。変えたら「初期設定」をもう一度']
];

// 架空のスタッフ（暗証番号も見本用）
var DEFAULT_STAFF = [
  ['S01', '青木 ひなた', 1200, '1234', true],
  ['S02', '井上 蓮', 1150, '2345', true],
  ['S03', '上田 さくら', 1100, '3456', true],
  ['S04', '江口 大和', 1100, '4567', true],
  ['S05', '岡本 ゆい', 1050, '5678', true],
  ['S06', '加藤 陽太', 1050, '6789', true]
];

var SHEET_ORDER = [SHEET_MONTHLY, SHEET_DAILY, SHEET_PUNCHES, SHEET_STAFF, SHEET_SETTINGS, SHEET_LOG];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('⏰ サンプル店')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('打刻画面のURLを表示', 'showPunchUrl')
    .addSeparator()
    .addItem('今月の集計を作る', 'summarizeThisMonth')
    .addItem('先月の集計を作る', 'summarizeLastMonth')
    .addItem('打刻忘れを今すぐチェック', 'checkNow')
    .addSeparator()
    .addItem('サンプルの打刻を入れる', 'insertSamplePunches')
    .addItem('打刻をリセット', 'resetPunches')
    .addToUi();
}

/**
 * メニューから動かす操作を、打刻画面（だれでも開ける）から呼べないようにする
 * 打刻画面の関数は google.script.run でどれでも呼べてしまうため、操作の入口で確かめる
 */
function assertOwner_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('この操作はお店の管理者だけが実行できます。');
  }
}

/** 初期設定。何度実行しても入力済みの設定・スタッフ・打刻は消えない */
function setup() {
  assertOwner_();
  var ss = getSs_();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  // 手で入力された日時を読むときにずれないよう、スプシのタイムゾーンを日本にそろえる
  ss.setSpreadsheetTimeZone(TZ);

  ensureSettings_(DEFAULT_SETTINGS);
  ensureStaffSheet_();
  var punches = ensureSheet_(SHEET_PUNCHES, PUNCH_HEADERS);
  [150, 90, 120, 70, 240].forEach(function (w, i) { punches.setColumnWidth(i + 1, w); });
  ensureSheet_(SHEET_DAILY);
  ensureSheet_(SHEET_MONTHLY);
  ensureSheet_(SHEET_LOG, ['日時', '種類', '内容']);

  var settings = readSettings_();
  refreshAttendance_();
  arrangeSheets_(ss);
  installTriggers_(checkHour_(settings));
  ss.rename((settings['店名'] || 'サンプル店') + ' 勤怠管理');

  log_('設定', '初期設定を実行しました');
  var url = punchUrl_();
  SpreadsheetApp.getUi().alert('初期設定が終わりました 🎉\n\n' +
    (url ? '打刻画面：\n' + url : '打刻画面はまだ公開されていません。設置手順書の「打刻画面を公開する」を見てください。') +
    '\n\n「スタッフ」シートで名前・時給・暗証番号を、「設定」シートで締め日などを変えられます。');
}

function ensureStaffSheet_() {
  var sheet = ensureSheet_(SHEET_STAFF, STAFF_HEADERS);
  // 暗証番号の 0 が消えないよう、文字として扱う
  sheet.getRange('D:D').setNumberFormat('@');
  if (sheet.getLastRow() === 1) {
    sheet.getRange(2, 1, DEFAULT_STAFF.length, STAFF_HEADERS.length).setValues(DEFAULT_STAFF);
  }
  var rows = Math.min(sheet.getLastRow() - 1 + 20, sheet.getMaxRows() - 1);
  sheet.getRange(2, 5, rows, 1).insertCheckboxes();
  sheet.getRange(2, 3, rows, 1).setNumberFormat('#,##0');
  [90, 140, 100, 150, 70].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

/** シートの並び順をそろえ、最初からある空のシートを消す */
function arrangeSheets_(ss) {
  SHEET_ORDER.forEach(function (name, i) {
    ss.setActiveSheet(ss.getSheetByName(name));
    ss.moveActiveSheet(i + 1);
  });
  ss.getSheets().forEach(function (sheet) {
    if (SHEET_ORDER.indexOf(sheet.getName()) === -1 && sheet.getLastRow() === 0) ss.deleteSheet(sheet);
  });
  ss.setActiveSheet(ss.getSheetByName(SHEET_MONTHLY));
}

/** 打刻忘れチェックの時刻（0〜23の整数でなければ9時） */
function checkHour_(settings) {
  var hour = settingNumber_(settings, '打刻忘れチェックの時刻', 9);
  return hour === Math.floor(hour) && hour >= 0 && hour <= 23 ? hour : 9;
}

/** 毎日のチェックのトリガーを登録し直す */
function installTriggers_(hour) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(hour).inTimezone(TZ).create();
}
