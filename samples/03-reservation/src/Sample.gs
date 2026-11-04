/**
 * 見本用のデータ：これから2週間の架空の予約と、店長の私用の予定を入れる（毎回同じ内容）
 */

var SAMPLE_DAYS = 14;
var SAMPLE_TAG = '（サンプル）';

var SAMPLE_CUSTOMERS = [
  ['佐藤 美咲', '090-0000-1001'], ['鈴木 健太', '090-0000-1002'], ['高橋 さくら', '090-0000-1003'],
  ['田中 翔', '090-0000-1004'], ['伊藤 由美', '090-0000-1005'], ['渡辺 大輔', '090-0000-1006'],
  ['山本 彩', '090-0000-1007'], ['中村 拓也', '090-0000-1008'], ['小林 愛', '090-0000-1009'], ['加藤 誠', '090-0000-1010']
];
var SAMPLE_NOTES = ['', '', '腰が重いです', '', '初めてです', '', '肩こりがひどいです', ''];

function insertSampleBookings() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('サンプル予約を入れます',
    '今の予約一覧と、カレンダーの予約の予定を消して、これから' + SAMPLE_DAYS + '日ぶんの架空の予約を入れます。\n' +
    '店長の私用の予定も1つ入れます。メールは送りません。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    clearAll_();
    var count = writeSampleBookings_(nowYmdHm_());
    log_('設定', 'サンプル予約を ' + count + ' 件入れました');
    ui.alert('サンプル予約を ' + count + ' 件入れました（うち1件はキャンセル済み）。\n' +
      'Googleカレンダーにも予定が入っています。');
  } finally {
    lock.releaseLock();
  }
}

/** 見本の予約を作って、カレンダーと予約一覧に書く */
function writeSampleBookings_(now) {
  var rules = rulesFrom_(readSettings_());
  var menus = readMenu_();
  if (!menus.length) return 0;
  var cal = getCalendar_();
  var today = now.slice(0, 10);
  var rand = seededRandom_(20261029);

  // 店長の私用の予定（この時間は予約画面に出なくなる）
  var privateDay = addDaysYmd(today, 2);
  while (rules.closedDays.indexOf(weekdayOf(privateDay)) !== -1) privateDay = addDaysYmd(privateDay, 1);
  cal.createEvent('私用（歯医者）' + SAMPLE_TAG, new Date(dateAt_(privateDay, 15 * 60)), new Date(dateAt_(privateDay, 17 * 60)),
    { description: SAMPLE_TAG });

  var rows = [];
  var seq = 0;
  for (var i = 1; i <= SAMPLE_DAYS; i++) {
    var date = addDaysYmd(today, i);
    // 1日1〜3件。予約画面で空きがちゃんと見えるくらいにする
    var wanted = 1 + Math.floor(rand() * 3);
    for (var k = 0; k < wanted; k++) {
      var menu = menus[Math.floor(rand() * menus.length)];
      var slots = slotsFor(date, menu.minutes, rules, busyFor_(cal, date, []), now);
      if (!slots.length) break;
      // ちょうどの時刻（10:00 など）を選んで、空きが細切れにならないようにする
      var onTheHour = slots.filter(function (t) { return /:00$/.test(t); });
      var pool = onTheHour.length ? onTheHour : slots;
      var start = pool[Math.floor(rand() * pool.length)];
      var customer = SAMPLE_CUSTOMERS[seq % SAMPLE_CUSTOMERS.length];
      seq++;
      var b = {
        bookingNo: makeBookingNo(addDaysYmd(today, -1), seq),
        createdAt: addDaysYmd(today, -1) + ' ' + minToHm(9 * 60 + seq * 7),
        status: STATUS_BOOKED, date: date, start: start, end: minToHm(parseHmToMin(start) + menu.minutes),
        menuName: menu.name, minutes: menu.minutes, price: menu.price,
        name: customer[0], phone: customer[1], email: 'sample' + ('0' + (seq % 99)).slice(-2) + '@example.com',
        note: SAMPLE_NOTES[seq % SAMPLE_NOTES.length], token: Utilities.getUuid()
      };
      b.eventId = createEvent_(cal, b);
      rows.push(b);
    }
  }
  // キャンセル済みの予約も1件まぜる（カレンダーからは消す）
  if (rows.length > 3) {
    deleteEvent_(cal, rows[3].eventId);
    rows[3].status = STATUS_CANCELED;
    rows[3].eventId = '';
  }
  var sheet = ensureSheet_(SHEET_BOOKINGS, BOOKING_HEADERS);
  rows.forEach(function (b, i) {
    if (i + 2 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    writeBookingRow_(sheet, i + 2, b);
  });
  return rows.length;
}

/** 毎回同じ並びになる乱数（何度入れ直しても同じ見本データになる） */
function seededRandom_(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resetBookings() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('予約をリセットします',
    '「予約一覧」の予約と、予約用カレンダーの予約・サンプルの予定をすべて消します。元に戻せません。よろしいですか？',
    ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  clearAll_();
  log_('設定', '予約をリセットしました');
}

/** 予約一覧と、このシステムが入れたカレンダーの予定（予約・サンプル）を消す */
function clearAll_() {
  var cal = getCalendar_();
  var today = nowYmdHm_().slice(0, 10);
  var from = new Date(dateAt_(addDaysYmd(today, -60), 0));
  var to = new Date(dateAt_(addDaysYmd(today, 120), 0));
  cal.getEvents(from, to).forEach(function (ev) {
    var desc = String(ev.getDescription() || '');
    if (desc.indexOf(EVENT_TAG) !== -1 || desc.indexOf(SAMPLE_TAG) !== -1) ev.deleteEvent();
  });
  var sheet = ensureSheet_(SHEET_BOOKINGS, BOOKING_HEADERS);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, BOOKING_HEADERS.length).clearContent().setBackground(null);
  }
}
