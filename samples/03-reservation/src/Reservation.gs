/**
 * 予約：予約一覧シート・Googleカレンダー・予約画面から呼ばれるサーバーの処理
 */

var SHEET_BOOKINGS = '予約一覧';
var SHEET_MENU = 'メニュー';
var BOOKING_HEADERS = ['予約番号', '受付日時', '状態', '日付', '開始', '終了', 'メニュー', '時間（分）', '料金（円）',
  'お名前', '電話', 'メール', 'ご要望', 'リマインド送信', 'イベントID', 'キャンセル用キー'];
var BOOKING_NUMBER_COLUMNS = ['時間（分）', '料金（円）'];
var MENU_HEADERS = ['メニュー名', '時間（分）', '料金（円）', '説明', '公開'];
var EVENT_TAG = '予約番号：';

function nowYmdHm_() {
  return formatNow_(new Date(), 'yyyy-MM-dd HH:mm');
}

/** 設定シートから予約のルールを読む */
function rulesFrom_(settings) {
  var hours = parseRange(settings['営業時間']) || [600, 1140];
  var cancelMin = parseHmToMin(settings['キャンセル締切_時刻']);
  return {
    openMin: hours[0],
    closeMin: hours[1],
    breakRange: parseRange(settings['休憩時間']),
    closedDays: parseList(settings['定休日']),
    stepMin: Math.max(5, Math.floor(settingNumber_(settings, '予約の区切り（分）', 30))),
    bufferMin: Math.max(0, Math.floor(settingNumber_(settings, '準備時間（分）', 10))),
    maxDaysAhead: Math.max(0, settingNumber_(settings, '何日先まで受け付けるか', 30)),
    leadMin: Math.max(0, settingNumber_(settings, '当日は何時間前まで', 3)) * 60,
    cancelDaysBefore: Math.max(0, settingNumber_(settings, 'キャンセル締切_何日前', 1)),
    cancelMin: cancelMin === null ? 18 * 60 : cancelMin,
    perEmailLimit: Math.max(1, settingNumber_(settings, '同じメールで入れられる予約の数', 3)),
    dailyWebLimit: Math.max(1, settingNumber_(settings, '予約画面から1日に受ける予約の数', 20))
  };
}

/** メニューシート（公開中のものだけ） → [{name, minutes, price, description}] */
function readMenu_() {
  var sheet = getSs_().getSheetByName(SHEET_MENU);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, MENU_HEADERS.length).getValues()
    .filter(function (r) { return String(r[0]).trim() !== '' && Number(r[1]) > 0 && r[4] === true; })
    .map(function (r) {
      return { name: String(r[0]).trim(), minutes: Number(r[1]), price: Number(r[2]) || 0, description: String(r[3] || '').trim() };
    });
}

/** 予約一覧 → [{row, bookingNo, status, date, start, ...}] */
function readBookings_() {
  var sheet = ensureSheet_(SHEET_BOOKINGS, BOOKING_HEADERS);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, BOOKING_HEADERS.length).getValues().map(function (r, i) {
    var b = { row: i + 2 };
    BOOKING_HEADERS.forEach(function (h, c) {
      var v = r[c];
      if (v instanceof Date) v = formatNow_(v, h === '日付' ? 'yyyy-MM-dd' : h === '開始' || h === '終了' ? 'HH:mm' : 'yyyy-MM-dd HH:mm');
      // 書くときに式よけで付けた先頭の ' は、読むときに外す
      if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
      b[h] = v;
    });
    return {
      row: b.row, bookingNo: String(b['予約番号']), createdAt: String(b['受付日時']), status: String(b['状態']), date: String(b['日付']),
      start: String(b['開始']), end: String(b['終了']), menuName: String(b['メニュー']), minutes: Number(b['時間（分）']) || 0,
      price: Number(b['料金（円）']) || 0, name: String(b['お名前']), phone: String(b['電話']), email: String(b['メール']),
      note: String(b['ご要望']), reminded: String(b['リマインド送信']), eventId: String(b['イベントID']),
      token: String(b['キャンセル用キー'])
    };
  }).filter(function (b) { return b.bookingNo !== ''; });
}

/** 1件ぶんを予約一覧の最後に書く */
function appendBooking_(b) {
  var sheet = ensureSheet_(SHEET_BOOKINGS, BOOKING_HEADERS);
  var row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 200);
  writeBookingRow_(sheet, row, b);
}

function writeBookingRow_(sheet, row, b) {
  var values = [b.bookingNo, b.createdAt, b.status, b.date, b.start, b.end, b.menuName, b.minutes, b.price,
    b.name, b.phone, b.email, b.note, b.reminded || '', b.eventId || '', b.token || ''];
  // 日付や時刻が勝手に変わらないよう、数字の列以外は文字として書く
  sheet.getRange(row, 1, 1, values.length).setNumberFormat('@');
  sheet.getRange(row, BOOKING_HEADERS.indexOf('時間（分）') + 1, 1, 2).setNumberFormat('0');
  sheet.getRange(row, 1, 1, values.length).setValues([values.map(function (v, i) {
    return BOOKING_NUMBER_COLUMNS.indexOf(BOOKING_HEADERS[i]) === -1 ? sanitizeCell(String(v)) : v;
  })]);
  sheet.getRange(row, 1, 1, values.length).setBackground(b.status === STATUS_CANCELED ? '#eeeeee' : null);
}

function setBookingCell_(row, header, value) {
  var sheet = ensureSheet_(SHEET_BOOKINGS, BOOKING_HEADERS);
  sheet.getRange(row, BOOKING_HEADERS.indexOf(header) + 1).setNumberFormat('@').setValue(value);
}

// ---- Googleカレンダー ----

/**
 * 予約用のカレンダー。作るのは初期設定のときだけ（予約画面からは作らない）
 * @param {boolean} allowCreate 無ければ作るか
 */
function getCalendar_(allowCreate) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CALENDAR_ID');
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal && allowCreate) {
    var settings = readSettings_();
    cal = CalendarApp.createCalendar((settings['店名'] || 'サンプル店') + ' 予約');
    // 終日の予定などが日本時間でずれないよう、カレンダーのタイムゾーンもそろえる
    cal.setTimeZone(TZ);
    props.setProperty('CALENDAR_ID', cal.getId());
    log_('設定', '予約用のカレンダーを作りました：' + cal.getName());
  }
  if (!cal) {
    log_('エラー', '予約用のカレンダーが見つかりません。「初期設定」をもう一度実行してください。');
    throw userError_('ただいま予約を受け付けられません。お電話でお問い合わせください。');
  }
  return cal;
}

function dateAt_(ymd, minutes) {
  return new Date(ymd + 'T00:00:00+09:00').getTime() + minutes * 60000;
}

/**
 * その日のふさがっている時間 [[開始分, 終了分], ...]
 * カレンダーの予定（予約も、店長が入れた予定も）に、予約一覧の予約済みも足す（カレンダーの予定を消されても重ならないように）
 */
function busyFor_(cal, ymd, bookings) {
  var dayStart = dateAt_(ymd, 0);
  var busy = cal.getEvents(new Date(dayStart), new Date(dayStart + 1440 * 60000)).map(function (ev) {
    if (ev.isAllDayEvent()) return [0, 1440];
    var s = Math.max(0, Math.round((ev.getStartTime().getTime() - dayStart) / 60000));
    var e = Math.min(1440, Math.round((ev.getEndTime().getTime() - dayStart) / 60000));
    return [s, e];
  });
  (bookings || readBookings_()).forEach(function (b) {
    if (b.status === STATUS_BOOKED && b.date === ymd) busy.push([parseHmToMin(b.start), parseHmToMin(b.end)]);
  });
  return busy.filter(function (b) { return b[0] !== null && b[1] !== null && b[1] > b[0]; });
}

function createEvent_(cal, b) {
  var ev = cal.createEvent(b.name + ' 様（' + b.menuName + '）',
    new Date(dateAt_(b.date, parseHmToMin(b.start))), new Date(dateAt_(b.date, parseHmToMin(b.end))),
    { description: EVENT_TAG + b.bookingNo + '\n電話：' + b.phone + '\nメール：' + b.email + '\nご要望：' + (b.note || 'なし') });
  return ev.getId();
}

function deleteEvent_(cal, eventId) {
  try {
    var ev = eventId ? cal.getEventById(eventId) : null;
    if (ev) ev.deleteEvent();
  } catch (err) {
    log_('注意', 'カレンダーの予定を消せませんでした（もう消えているかもしれません）：' + err);
  }
}

// ---- 予約画面 ----

function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

function doGet(e) {
  var settings = readSettings_();
  var shopName = settings['店名'] || 'サンプル店';
  var token = e && e.parameter && e.parameter.cancel ? String(e.parameter.cancel) : '';
  var template;
  if (token) {
    template = HtmlService.createTemplateFromFile('Cancel');
    template.data = JSON.stringify(cancelInfo_(token, settings));
  } else {
    var rules = rulesFrom_(settings);
    template = HtmlService.createTemplateFromFile('Index');
    template.data = JSON.stringify({
      shopName: shopName,
      hours: minToHm(rules.openMin) + '〜' + minToHm(rules.closeMin),
      closedDays: rules.closedDays.join('・'),
      menus: readMenu_(),
      dates: bookableDates(nowYmdHm_(), rules)
    });
  }
  template.shopName = shopName;
  template.token = token;
  return template.evaluate()
    .setTitle(shopName + (token ? ' ご予約のキャンセル' : ' ご予約'))
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
  log_('エラー', '予約画面の処理に失敗しました：' + (err && err.stack ? err.stack : err));
  return { ok: false, message: 'うまく処理できませんでした。時間をおいてもう一度お試しください。' };
}

function findMenu_(name) {
  var menu = readMenu_().filter(function (m) { return m.name === String(name); })[0];
  if (!menu) throw userError_('メニューが見つかりません。画面を開き直してください。');
  return menu;
}

function checkDate_(ymd) {
  if (!isValidYmd(ymd)) throw userError_('日にちが正しくありません。');
  return String(ymd);
}

/** 画面から：その日の空いている時間 */
function apiSlots(menuName, dateYmd) {
  try {
    var menu = findMenu_(menuName);
    var date = checkDate_(dateYmd);
    var rules = rulesFrom_(readSettings_());
    return { ok: true, slots: slotsFor(date, menu.minutes, rules, busyFor_(getCalendar_(), date), nowYmdHm_()) };
  } catch (err) {
    return errorResult_(err);
  }
}

/** 画面から：予約する */
function apiBook(input) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    input = input || {};
    var settings = readSettings_();
    var rules = rulesFrom_(settings);
    var menu = findMenu_(input.menu);
    var date = checkDate_(input.date);
    var checked = validateCustomer(input);
    if (!checked.ok) throw userError_(checked.errors.join('\n'));
    var now = nowYmdHm_();
    var today = now.slice(0, 10);
    var cal = getCalendar_();
    var bookings = readBookings_();
    // 予約画面を開いているあいだに埋まっていないか、もう一度確かめる
    if (slotsFor(date, menu.minutes, rules, busyFor_(cal, date, bookings), now).indexOf(String(input.time)) === -1) {
      throw userError_('その時間はたった今うまってしまいました。ほかの時間をお選びください。');
    }
    // いたずら対策：同じメール・同じ電話番号のこれからの予約の数と、今日受けた予約の数
    var email = checked.value.email.toLowerCase();
    var phone = phoneDigits(checked.value.phone);
    var upcoming = bookings.filter(function (b) { return b.status === STATUS_BOOKED && b.date >= today; });
    if (upcoming.filter(function (b) { return b.email.toLowerCase() === email; }).length >= rules.perEmailLimit ||
      upcoming.filter(function (b) { return phoneDigits(b.phone) === phone; }).length >= rules.perEmailLimit) {
      throw userError_('同じメールアドレス・電話番号でのご予約は ' + rules.perEmailLimit + ' 件までです。お電話でご相談ください。');
    }
    if (bookings.filter(function (b) { return b.createdAt.slice(0, 10) === today; }).length >= rules.dailyWebLimit) {
      log_('注意', '予約画面からの今日の予約が上限（' + rules.dailyWebLimit + '件）に達しました');
      throw userError_('ただいま予約画面での受付が混み合っています。お電話でお問い合わせください。');
    }

    var startMin = parseHmToMin(input.time);
    var b = {
      bookingNo: makeBookingNo(now.slice(0, 10), nextSeq_(bookings, now.slice(0, 10))),
      createdAt: now, status: STATUS_BOOKED, date: date, start: minToHm(startMin), end: minToHm(startMin + menu.minutes),
      menuName: menu.name, minutes: menu.minutes, price: menu.price,
      name: checked.value.name, phone: checked.value.phone, email: checked.value.email, note: checked.value.note,
      token: Utilities.getUuid()
    };
    b.eventId = createEvent_(cal, b);
    try {
      appendBooking_(b);
    } catch (err) {
      // 一覧に書けなかったら、カレンダーの予定も消して空きに戻す
      deleteEvent_(cal, b.eventId);
      throw err;
    }
    log_('予約', b.bookingNo + ' ' + b.date + ' ' + b.start + ' ' + b.name + '（' + b.menuName + '）');

    var shopName = settings['店名'] || 'サンプル店';
    var deadline = cancelDeadline(b.date, rules);
    // お客さま宛てが失敗しても、お店には必ず知らせる
    trySend_(settings, b.email, buildConfirmMail(b, shopName, webAppUrl_() + '?cancel=' + encodeURIComponent(b.token),
      formatDateJa(deadline.slice(0, 10)) + ' ' + deadline.slice(11)), true, b.bookingNo + ' の確認メール');
    trySend_(settings, shopEmail_(settings), buildShopNotice(b), false, b.bookingNo + ' のお店への通知');
    return {
      ok: true, bookingNo: b.bookingNo, date: formatDateJa(b.date), start: b.start, end: b.end, menu: b.menuName,
      message: 'ご予約を承りました。確認メールをお送りしました。'
    };
  } catch (err) {
    return errorResult_(err);
  } finally {
    lock.releaseLock();
  }
}

/** メールを送り、失敗してもほかの処理を止めずにログに残す。送れたら true */
function trySend_(settings, to, mail, toCustomer, what) {
  try {
    return sendMail_(settings, to, mail, toCustomer);
  } catch (err) {
    log_('エラー', what + 'を送れませんでした：' + err);
    return false;
  }
}

/** その日の次の連番（行を消しても番号が重ならないよう最大値+1） */
function nextSeq_(bookings, nowYmd) {
  var prefix = 'R' + nowYmd.replace(/-/g, '') + '-';
  var max = 0;
  bookings.forEach(function (b) {
    if (b.bookingNo.indexOf(prefix) === 0) max = Math.max(max, Number(b.bookingNo.slice(prefix.length)) || 0);
  });
  return max + 1;
}

function findByToken_(token) {
  if (!token || String(token).length < 20) return null;
  return readBookings_().filter(function (b) { return b.token === String(token); })[0] || null;
}

/** キャンセル画面に出す内容（お名前は一部だけ） */
function cancelInfo_(token, settings) {
  var b = findByToken_(token);
  if (!b) return { found: false, message: 'ご予約が見つかりませんでした。メールのリンクをもう一度お確かめください。' };
  var rules = rulesFrom_(settings);
  var deadline = cancelDeadline(b.date, rules);
  var info = {
    found: true, date: formatDateJa(b.date), start: b.start, end: b.end, menu: b.menuName,
    name: b.name.slice(0, 1) + '〇〇 様', deadline: formatDateJa(deadline.slice(0, 10)) + ' ' + deadline.slice(11)
  };
  if (b.status !== STATUS_BOOKED) {
    info.canCancel = false;
    info.message = 'このご予約は、すでにキャンセルされています。';
  } else if (!canCancel(b.date, nowYmdHm_(), rules)) {
    info.canCancel = false;
    info.message = 'キャンセルの受付は ' + info.deadline + ' までです。お手数ですが、お電話でご連絡ください。';
  } else {
    info.canCancel = true;
  }
  return info;
}

/** 画面から：キャンセルする */
function apiCancel(token) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var settings = readSettings_();
    var info = cancelInfo_(token, settings);
    if (!info.found || !info.canCancel) throw userError_(info.message);
    var b = findByToken_(token);
    deleteEvent_(getCalendar_(), b.eventId);
    setBookingCell_(b.row, '状態', STATUS_CANCELED);
    ensureSheet_(SHEET_BOOKINGS).getRange(b.row, 1, 1, BOOKING_HEADERS.length).setBackground('#eeeeee');
    log_('キャンセル', b.bookingNo + ' ' + b.date + ' ' + b.start + ' ' + b.name);
    var shopName = settings['店名'] || 'サンプル店';
    trySend_(settings, b.email, buildCancelMail(b, shopName), true, b.bookingNo + ' のキャンセルのメール');
    trySend_(settings, shopEmail_(settings), buildShopCancelNotice(b), false, b.bookingNo + ' のキャンセルのお知らせ');
    return { ok: true, message: 'ご予約をキャンセルしました。またのご予約をお待ちしています。' };
  } catch (err) {
    return errorResult_(err);
  } finally {
    lock.releaseLock();
  }
}

function showBookingUrl() {
  assertOwner_();
  var url = webAppUrl_();
  SpreadsheetApp.getUi().alert(url
    ? '予約画面のURL：\n' + url + '\n\nホームページやSNSのプロフィールに貼って使います。'
    : '予約画面はまだ公開されていません。設置手順書の「予約画面を公開する」を見てください。');
}

function showCalendarName() {
  assertOwner_();
  SpreadsheetApp.getUi().alert('予約は Googleカレンダーの「' + getCalendar_().getName() + '」に入ります。\n' +
    'このカレンダーに私用の予定を入れると、その時間は予約画面に出なくなります。');
}
