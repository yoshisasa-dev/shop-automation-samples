/**
 * 見本用のデータ：架空のスタッフの、過去5週間ぶんの打刻を入れる（毎回同じ内容）
 */

var SAMPLE_DAYS = 35;

// スタッフごとの出勤する曜日と、シフト（出勤・退勤の時刻）
var SAMPLE_PATTERNS = {
  S01: { days: ['月', '火', '水', '木', '金'], shifts: [['07:00', '15:00']] },
  S02: { days: ['月', '水', '金', '土'], shifts: [['15:00', '23:00']] },
  S03: { days: ['火', '木', '土', '日'], shifts: [['10:00', '16:00']] },
  S04: { days: ['水', '木', '金', '土', '日'], shifts: [['07:00', '16:30'], ['10:00', '16:00']] },
  S05: { days: ['火', '土', '日'], shifts: [['11:00', '17:00']] },
  S06: { days: ['火', '木', '金', '日'], shifts: [['17:00', '22:30']] }
};

// 打刻忘れを見せるため、この人たちの「いちばん最近の勤務」の退勤を消す
var SAMPLE_FORGET_OUT = ['S03', 'S05'];

function insertSamplePunches() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('サンプルの打刻を入れます',
    '今の打刻ログを消して、架空のスタッフ6人の過去' + SAMPLE_DAYS + '日ぶんの打刻を入れます。\n' +
    '打刻忘れも2件まぜます。メールは送りません。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    clearPunches_();
    var count = writeSamplePunches_(nowYmdHm_());
    var r = refreshAttendance_();
    log_('設定', 'サンプルの打刻を ' + count + ' 件入れました');
    ui.alert('サンプルの打刻を ' + count + ' 件入れました。\n「月の集計」と「勤怠（日別）」ができています。' + issueNote_(r));
  } finally {
    lock.releaseLock();
  }
}

/** 見本の打刻を作って書き込む。今の時刻より後の打刻は入れない */
function writeSamplePunches_(now) {
  var punches = samplePunches_(now);
  var staff = {};
  DEFAULT_STAFF.forEach(function (s) { staff[s[0]] = s[1]; });
  var rows = punches.map(function (p) { return [p.at, p.staffId, staff[p.staffId], p.type, '']; });
  if (!rows.length) return 0;
  var sheet = ensureSheet_(SHEET_PUNCHES, PUNCH_HEADERS);
  if (rows.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  sheet.getRange(2, 1, rows.length, PUNCH_HEADERS.length).setNumberFormat('@').setValues(rows);
  return rows.length;
}

function samplePunches_(now) {
  var today = now.slice(0, 10);
  var rand = seededRandom_(20261029);
  var punches = [];
  for (var d = addDaysYmd(today, -SAMPLE_DAYS); d <= today; d = addDaysYmd(d, 1)) {
    Object.keys(SAMPLE_PATTERNS).forEach(function (id) {
      var pattern = SAMPLE_PATTERNS[id];
      var shift = pattern.shifts[Math.floor(rand() * pattern.shifts.length)];
      var jitterIn = Math.floor(rand() * 10) - 8;
      var jitterOut = Math.floor(rand() * 20) + (rand() < 0.15 ? 40 : 0);
      if (pattern.days.indexOf(weekdayOf(d)) === -1) return;
      var inAt = shiftTime_(d, shift[0], jitterIn);
      var outAt = shiftTime_(d, shift[1], jitterOut);
      var length = minutesBetween(inAt, outAt);
      var shiftPunches = [{ staffId: id, at: inAt, type: PUNCH_IN }];
      if (length > 6 * 60) {
        var breakAt = shiftTime_(d, shift[0], Math.floor(length / 2 / 15) * 15 - 30 + Math.floor(rand() * 10));
        shiftPunches.push({ staffId: id, at: breakAt, type: PUNCH_BREAK });
        shiftPunches.push({ staffId: id, at: shiftTime_(breakAt.slice(0, 10), breakAt.slice(11), 60), type: PUNCH_BACK });
      }
      shiftPunches.push({ staffId: id, at: outAt, type: PUNCH_OUT });
      shiftPunches.forEach(function (p) { if (p.at <= now) punches.push(p); });
    });
  }

  // 打刻忘れ：今日より前の、いちばん最近の勤務の退勤を消す
  SAMPLE_FORGET_OUT.forEach(function (id) {
    for (var i = punches.length - 1; i >= 0; i--) {
      var p = punches[i];
      if (p.staffId === id && p.type === PUNCH_OUT && p.at.slice(0, 10) < today) {
        punches.splice(i, 1);
        return;
      }
    }
  });
  return punches.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
}

/** その日の時刻 hm から minutes 分ずらした 'YYYY-MM-DD HH:mm' */
function shiftTime_(ymd, hm, minutes) {
  var total = parseHmToMin(hm) + minutes;
  var day = addDaysYmd(ymd, Math.floor(total / 1440));
  var m = ((total % 1440) + 1440) % 1440;
  return day + ' ' + pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
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

function resetPunches() {
  assertOwner_();
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('打刻をリセットします',
    '「打刻ログ」の打刻と、「勤怠（日別）」「月の集計」をすべて消します。元に戻せません。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  clearPunches_();
  ensureSheet_(SHEET_DAILY).clear();
  ensureSheet_(SHEET_MONTHLY).clear();
  log_('設定', '打刻をリセットしました');
}

function clearPunches_() {
  var sheet = ensureSheet_(SHEET_PUNCHES, PUNCH_HEADERS);
  // 行を消すと「固定されていない行をすべて削除」で失敗することがあるので、中身だけ消す
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, PUNCH_HEADERS.length).clearContent();
  }
}
