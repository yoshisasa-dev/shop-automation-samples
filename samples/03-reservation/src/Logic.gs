/**
 * 予約の計算・判定（GASの機能を使わないので、パソコン上でテストできる）
 * 日付は 'YYYY-MM-DD'、時刻は 'HH:mm'、日時は 'YYYY-MM-DD HH:mm' の文字列で受け渡す。
 * 1日の中の時刻は「0時からの分」で計算する。
 */

var STATUS_BOOKED = '予約済み';
var STATUS_CANCELED = 'キャンセル';
var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 'YYYY-MM-DD' を n 日ずらす */
function addDaysYmd(ymd, n) {
  var p = ymd.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** 'YYYY-MM-DD' の曜日（'日'〜'土'） */
function weekdayOf(ymd) {
  var p = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
}

/** '10月30日（金）' */
function formatDateJa(ymd) {
  var p = ymd.split('-').map(Number);
  return p[1] + '月' + p[2] + '日（' + weekdayOf(ymd) + '）';
}

/** '日, 土、月' → ['日', '土', '月'] */
function parseList(text) {
  return String(text || '').split(/[,、，]/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

/** 1234567 → '1,234,567' */
function formatYen(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** セルに書く文字が式として動かないよう、先頭に ' を付ける */
function sanitizeCell(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** '10:30' → 630（分）。読めなければ null */
function parseHmToMin(hm) {
  var m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[2]) > 59) return null;
  var min = Number(m[1]) * 60 + Number(m[2]);
  return min > 1440 ? null : min;
}

/** 630 → '10:30' */
function minToHm(min) {
  return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
}

/** '13:00-14:00' → [780, 840]。空や読めなければ null */
function parseRange(text) {
  var parts = String(text || '').split(/[-〜~ー－]/);
  if (parts.length !== 2) return null;
  var s = parseHmToMin(parts[0]);
  var e = parseHmToMin(parts[1]);
  return s === null || e === null || s >= e ? null : [s, e];
}

/**
 * その日の、予約できる開始時刻
 * @param {number} menuMin メニューの所要時間（分）
 * @param {Object} rules {openMin, closeMin, stepMin, bufferMin, breakRange, closedDays, maxDaysAhead, leadMin}
 * @param {Array} busy その日のふさがっている時間 [[開始分, 終了分], ...]（予約・私用の予定）
 * @return {Array} ['10:00', '10:30', ...]
 */
function slotsFor(dateYmd, menuMin, rules, busy, nowYmdHm) {
  var today = nowYmdHm.slice(0, 10);
  if (dateYmd < today || dateYmd > addDaysYmd(today, rules.maxDaysAhead)) return [];
  if (rules.closedDays.indexOf(weekdayOf(dateYmd)) !== -1) return [];
  var earliest = dateYmd === today ? parseHmToMin(nowYmdHm.slice(11)) + rules.leadMin : 0;
  var slots = [];
  for (var t = rules.openMin; t + menuMin <= rules.closeMin; t += rules.stepMin) {
    if (t < earliest) continue;
    var end = t + menuMin;
    if (rules.breakRange && t < rules.breakRange[1] && end > rules.breakRange[0]) continue;
    // 前後に準備時間をとって、ほかの予定と重ならないか
    var clash = busy.some(function (b) { return t < b[1] + rules.bufferMin && end + rules.bufferMin > b[0]; });
    if (!clash) slots.push(minToHm(t));
  }
  return slots;
}

/** 予約画面に出す日にち [{date, label, closed}] */
function bookableDates(nowYmdHm, rules) {
  var today = nowYmdHm.slice(0, 10);
  var dates = [];
  for (var i = 0; i <= rules.maxDaysAhead; i++) {
    var d = addDaysYmd(today, i);
    dates.push({ date: d, label: formatDateJa(d), closed: rules.closedDays.indexOf(weekdayOf(d)) !== -1 });
  }
  return dates;
}

/** キャンセルの締め切り 'YYYY-MM-DD HH:mm' */
function cancelDeadline(dateYmd, rules) {
  return addDaysYmd(dateYmd, -rules.cancelDaysBefore) + ' ' + minToHm(rules.cancelMin);
}

function canCancel(dateYmd, nowYmdHm, rules) {
  return nowYmdHm <= cancelDeadline(dateYmd, rules);
}

/**
 * 予約画面の入力を確かめて、そろえた値を返す
 * @return {Object} {ok, errors: [...], value: {name, phone, email, note}}
 */
function validateCustomer(input) {
  var v = {
    name: String(input.name || '').trim(),
    phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim(),
    note: String(input.note || '').trim()
  };
  var errors = [];
  if (!v.name) errors.push('お名前を入力してください。');
  if (v.name.length > 40) errors.push('お名前は40文字までにしてください。');
  // 090-0000-0000 も +81 90-0000-0000 も受ける
  var digits = phoneDigits(v.phone);
  if (digits.length < 10 || digits.length > 13) errors.push('電話番号を正しく入力してください。');
  // カンマ区切りで何人にも送られたりしないよう、ふつうのメールアドレスの形だけ受ける
  if (!/^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v.email) || v.email.length > 100) {
    errors.push('メールアドレスを正しく入力してください。');
  }
  if (v.note.length > 300) errors.push('ご要望は300文字までにしてください。');
  return { ok: errors.length === 0, errors: errors, value: v };
}

/** 実在する日付の 'YYYY-MM-DD' か（2026-10-32 などは false） */
function isValidYmd(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) && addDaysYmd(String(ymd), 0) === String(ymd);
}

/** 電話番号の数字だけ（全角も半角に） */
function phoneDigits(phone) {
  return String(phone || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[^0-9]/g, '');
}

/** 'R20261029-003' */
function makeBookingNo(nowYmd, seq) {
  return 'R' + nowYmd.replace(/-/g, '') + '-' + ('00' + seq).slice(-3);
}

function bookingSummary_(b) {
  return '■ 予約番号：' + b.bookingNo + '\n' +
    '■ 日時：' + formatDateJa(b.date) + ' ' + b.start + '〜' + b.end + '\n' +
    '■ メニュー：' + b.menuName + '（' + b.minutes + '分・' + formatYen(b.price) + '円）\n' +
    '■ ご要望：' + (b.note || 'なし');
}

var SAMPLE_FOOTER = '\n\n※このメールは架空のサンプル店から送られています。実際の予約・お支払いは発生しません。';

function buildConfirmMail(b, shopName, cancelUrl, deadlineText) {
  return {
    subject: '【' + shopName + '】ご予約を承りました（' + formatDateJa(b.date) + ' ' + b.start + '）',
    body: b.name + ' 様\n\n' + shopName + 'です。ご予約ありがとうございます。\n以下の内容で承りました。\n\n' +
      bookingSummary_(b) + '\n\n' +
      'キャンセルは ' + deadlineText + ' まで、こちらからできます：\n' + cancelUrl +
      '\n\n前日に、ご予約のお知らせをお送りします。' + SAMPLE_FOOTER
  };
}

function buildShopNotice(b) {
  return {
    subject: '【新着予約】' + formatDateJa(b.date) + ' ' + b.start + '　' + b.name + ' 様（' + b.menuName + '）',
    body: '新しいご予約が入りました。カレンダーにも登録済みです。\n\n' + bookingSummary_(b) +
      '\n■ お名前：' + b.name + ' 様\n■ 電話：' + b.phone + '\n■ メール：' + b.email
  };
}

function buildReminderMail(b, shopName) {
  return {
    subject: '【' + shopName + '】明日のご予約のお知らせ（' + b.start + '〜）',
    body: b.name + ' 様\n\n' + shopName + 'です。明日のご予約のお知らせです。\n\n' + bookingSummary_(b) +
      '\n\nお気をつけてお越しください。' + SAMPLE_FOOTER
  };
}

function buildCancelMail(b, shopName) {
  return {
    subject: '【' + shopName + '】ご予約をキャンセルしました（' + formatDateJa(b.date) + ' ' + b.start + '）',
    body: b.name + ' 様\n\n以下のご予約をキャンセルしました。またのご予約をお待ちしています。\n\n' +
      bookingSummary_(b) + SAMPLE_FOOTER
  };
}

function buildShopCancelNotice(b) {
  return {
    subject: '【キャンセル】' + formatDateJa(b.date) + ' ' + b.start + '　' + b.name + ' 様',
    body: 'ご予約がキャンセルされました。カレンダーからも削除済みです。\n\n' + bookingSummary_(b)
  };
}
