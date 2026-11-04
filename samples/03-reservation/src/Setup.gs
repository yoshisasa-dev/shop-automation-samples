/**
 * 初期設定：シート・カレンダー・トリガーを用意する
 */

var DEFAULT_SETTINGS = [
  ['店名', '整体サロン ゆるり（サンプル店）', '予約画面・メールに出るお店の名前'],
  ['通知先メール', '', '新着予約やキャンセルを受け取るアドレス。空なら設置したアカウントに届く'],
  ['営業時間', '10:00-19:00', '予約を受ける時間（最後のメニューがこの時刻までに終わるように）'],
  ['休憩時間', '13:00-14:00', '予約を受けない時間。なければ空に'],
  ['定休日', '水', '予約を受けない曜日。複数ならカンマ区切り（例：水,日）'],
  ['予約の区切り（分）', '30', '予約画面に出す時刻の間隔'],
  ['準備時間（分）', '10', '予約と予約のあいだにあける時間'],
  ['何日先まで受け付けるか', '30', '今日から何日先までの予約を受けるか'],
  ['当日は何時間前まで', '3', '今日の予約は、今から何時間後より先だけ受ける'],
  ['キャンセル締切_何日前', '1', 'キャンセルできるのは、予約日の何日前まで'],
  ['キャンセル締切_時刻', '18:00', 'その日の何時まで'],
  ['リマインドの時刻', '18', '毎日この時（0〜23）に、翌日の予約のお客さまへメール。変えたら「初期設定」をもう一度'],
  ['同じメールで入れられる予約の数', '3', 'いたずら対策。同じメールアドレス・電話番号で入れられる、これからの予約の数'],
  ['予約画面から1日に受ける予約の数', '20', 'いたずら対策。1日にこれを超えたら、予約画面では受けずに電話をお願いする'],
  ['デモモード', 'ON', 'OFF以外のあいだは、お客さま宛てのメールも通知先に届く。本番で使うときだけOFF']
];

var DEFAULT_MENU = [
  ['お試し整体（初回限定）', 30, 3300, 'はじめての方に。肩・首まわりを中心に整えます', true],
  ['しっかり整体コース', 60, 6600, '全身のゆがみを整える、いちばん人気のコース', true],
  ['じっくり全身コース', 90, 9900, '全身の整体に、足のケアをプラスしたゆったりコース', true]
];

var SHEET_ORDER = [SHEET_BOOKINGS, SHEET_MENU, SHEET_SETTINGS, SHEET_LOG];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📅 サンプル店')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('予約画面のURLを表示', 'showBookingUrl')
    .addItem('予約のカレンダーを確認', 'showCalendarName')
    .addSeparator()
    .addItem('明日のリマインドを今すぐ送る', 'remindNow')
    .addSeparator()
    .addItem('サンプル予約を入れる', 'insertSampleBookings')
    .addItem('予約をリセット', 'resetBookings')
    .addToUi();
}

/**
 * メニューから動かす操作を、予約画面（だれでも開ける）から呼べないようにする
 * 予約画面の関数は google.script.run でどれでも呼べてしまうため、操作の入口で確かめる
 */
function assertOwner_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('この操作はお店の管理者だけが実行できます。');
  }
}

/** 初期設定。何度実行しても入力済みの設定・メニュー・予約は消えない */
function setup() {
  assertOwner_();
  var ss = getSs_();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);

  ensureSettings_(DEFAULT_SETTINGS);
  ensureMenuSheet_();
  var bookings = ensureSheet_(SHEET_BOOKINGS, BOOKING_HEADERS);
  [120, 120, 70, 95, 50, 50, 170, 60, 70, 100, 115, 190, 200, 120, 80, 80].forEach(function (w, i) {
    bookings.setColumnWidth(i + 1, w);
  });
  ensureSheet_(SHEET_LOG, ['日時', '種類', '内容']);

  var settings = readSettings_();
  var cal = getCalendar_(true);
  arrangeSheets_(ss);
  installTriggers_(reminderHour_(settings));
  ss.rename((settings['店名'] || 'サンプル店') + ' 予約管理');

  log_('設定', '初期設定を実行しました');
  var url = webAppUrl_();
  SpreadsheetApp.getUi().alert('初期設定が終わりました 🎉\n\n' +
    (url ? '予約画面：\n' + url : '予約画面はまだ公開されていません。設置手順書の「予約画面を公開する」を見てください。') +
    '\n\n予約は Googleカレンダーの「' + cal.getName() + '」に入ります。\n「設定」シートで営業時間や定休日を、「メニュー」シートでメニューを変えられます。');
}

function ensureMenuSheet_() {
  var sheet = ensureSheet_(SHEET_MENU, MENU_HEADERS);
  if (sheet.getLastRow() === 1) {
    sheet.getRange(2, 1, DEFAULT_MENU.length, MENU_HEADERS.length).setValues(DEFAULT_MENU);
  }
  var rows = Math.min(sheet.getLastRow() - 1 + 10, sheet.getMaxRows() - 1);
  sheet.getRange(2, 5, rows, 1).insertCheckboxes();
  sheet.getRange(2, 3, rows, 1).setNumberFormat('#,##0"円"');
  [220, 80, 90, 380, 60].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
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
  ss.setActiveSheet(ss.getSheetByName(SHEET_BOOKINGS));
}

/** リマインドの時刻（0〜23の整数でなければ18時） */
function reminderHour_(settings) {
  var hour = settingNumber_(settings, 'リマインドの時刻', 18);
  return hour === Math.floor(hour) && hour >= 0 && hour <= 23 ? hour : 18;
}

/** 毎日のリマインドのトリガーを登録し直す */
function installTriggers_(hour) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(hour).inTimezone(TZ).create();
}
