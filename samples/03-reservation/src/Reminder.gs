/**
 * 前日のリマインド：毎日決まった時刻に、翌日の予約のお客さんへメールし、お店に明日の予約の一覧を送る
 */

/** 毎日の時刻トリガーから呼ばれる */
function dailyReminder(e) {
  if (!isFromOwnTrigger_(e)) assertOwner_();
  try {
    runReminder_();
  } catch (err) {
    log_('エラー', 'リマインドの送信に失敗しました：' + (err && err.stack ? err.stack : err));
  }
}

/** このスクリプトに登録されているトリガーからの実行か（予約画面からは呼ばせない） */
function isFromOwnTrigger_(e) {
  if (!e || !e.triggerUid) return false;
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === String(e.triggerUid); });
}

/** メニューから手動で実行 */
function remindNow() {
  assertOwner_();
  var r = runReminder_();
  SpreadsheetApp.getUi().alert(formatDateJa(r.date) + ' のご予約は ' + r.count + ' 件です。' +
    (r.sent ? '\nお客さま ' + r.sent + ' 人にリマインドを送りました。' : '\nリマインドを送る相手はいませんでした（送信済みを含む）。'));
}

/** 明日の予約にリマインドを送る。送ったら「リマインド送信」に日時を書くので、2回は送らない */
function runReminder_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var settings = readSettings_();
    var shopName = settings['店名'] || 'サンプル店';
    var tomorrow = addDaysYmd(nowYmdHm_().slice(0, 10), 1);
    var list = readBookings_().filter(function (b) { return b.status === STATUS_BOOKED && b.date === tomorrow; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var sent = 0;
    // 1人に送れなくても、ほかの人には送る。送れた人だけ「送信済み」にする
    list.forEach(function (b) {
      if (b.reminded) return;
      if (trySend_(settings, b.email, buildReminderMail(b, shopName), true, b.bookingNo + ' のリマインド')) {
        setBookingCell_(b.row, 'リマインド送信', nowYmdHm_());
        sent++;
      }
    });
    if (list.length) {
      trySend_(settings, shopEmail_(settings), buildTomorrowList_(tomorrow, list), false, '明日の予約の一覧');
    }
    log_('リマインド', tomorrow + ' の予約 ' + list.length + '件、リマインド ' + sent + '件');
    return { date: tomorrow, count: list.length, sent: sent };
  } finally {
    lock.releaseLock();
  }
}

function buildTomorrowList_(date, list) {
  return {
    subject: '【明日の予約】' + formatDateJa(date) + '　' + list.length + '件',
    body: formatDateJa(date) + ' のご予約です。\n\n' + list.map(function (b) {
      return '・' + b.start + '〜' + b.end + '　' + b.name + ' 様（' + b.menuName + '）' + (b.note ? '\n　ご要望：' + b.note : '');
    }).join('\n') + '\n\nお客さまには前日のお知らせメールを送りました。'
  };
}
