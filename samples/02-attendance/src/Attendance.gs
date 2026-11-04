/**
 * 勤怠のシート：打刻ログを読み、日別の勤怠と月の集計を作る
 */

var SHEET_PUNCHES = '打刻ログ';
var SHEET_DAILY = '勤怠（日別）';
var SHEET_MONTHLY = '月の集計';
var SHEET_STAFF = 'スタッフ';
var PUNCH_HEADERS = ['日時', 'スタッフID', '名前', '種類', 'メモ'];
var STAFF_HEADERS = ['スタッフID', '名前', '時給（円）', '暗証番号（4けた）', '在籍'];
var DAILY_HEADERS = ['日付', '曜日', 'スタッフID', '名前', '出勤', '退勤', '休憩', '勤務時間', '残業', '深夜', '確認'];
var COLOR_CHECK = '#fde7e9';
var COLOR_WORKING = '#fff8e1';

/** スタッフシート → [{id, name, wage, pin, active}] */
function readStaff_() {
  var sheet = getSs_().getSheetByName(SHEET_STAFF);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, STAFF_HEADERS.length).getValues()
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      var pin = String(r[3]).trim();
      // 書式なしテキストでないセルに 0123 と入れると 123 になるので、4けたにそろえる
      if (/^\d{1,3}$/.test(pin)) pin = ('0000' + pin).slice(-4);
      return { id: String(r[0]).trim(), name: String(r[1]).trim(), wage: Number(r[2]) || 0, pin: pin, active: r[4] === true };
    });
}

/** 打刻ログ → {punches: [{staffId, name, at, type}], invalid: 読めなかった行数} */
function readPunches_() {
  var sheet = getSs_().getSheetByName(SHEET_PUNCHES);
  var result = { punches: [], invalid: 0 };
  if (!sheet || sheet.getLastRow() < 2) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().forEach(function (r, i) {
    if (r.every(function (v) { return String(v).trim() === ''; })) return;
    var at = r[0] instanceof Date ? formatNow_(r[0], 'yyyy-MM-dd HH:mm') : normalizeDateTime(r[0]);
    var type = String(r[3]).trim();
    if (!at || PUNCH_TYPES.indexOf(type) === -1 || String(r[1]).trim() === '') {
      result.invalid++;
      return;
    }
    result.punches.push({ staffId: String(r[1]).trim(), name: String(r[2]).trim(), at: at, type: type, row: i + 2 });
  });
  return result;
}

/** 設定シートから計算のルールを読む */
function rulesFrom_(settings) {
  var nightStart = parseHmToMin(settings['深夜_開始']);
  var nightEnd = parseHmToMin(settings['深夜_終了']);
  return {
    dailyLimitMin: settingNumber_(settings, '1日の所定時間', 8) * 60,
    nightStartMin: nightStart === null ? 22 * 60 : nightStart,
    nightEndMin: nightEnd === null ? 5 * 60 : nightEnd,
    roundUnitMin: Math.max(1, settingNumber_(settings, '端数処理（分）', 1)),
    premiumOvertime: settingNumber_(settings, '割増率_残業（%）', 25) / 100,
    premiumNight: settingNumber_(settings, '割増率_深夜（%）', 25) / 100
  };
}

function nowYmdHm_() {
  return formatNow_(new Date(), 'yyyy-MM-dd HH:mm');
}

/**
 * 打刻ログから日別の勤怠と、指定の期間の月の集計を作り直す
 * @param {Object} period periodFor の結果。省略すると今の期間
 */
function refreshAttendance_(period) {
  var settings = readSettings_();
  var rules = rulesFrom_(settings);
  var now = nowYmdHm_();
  var read = readPunches_();
  var shifts = buildShifts(read.punches, now);
  shifts.forEach(function (s) { s.calc = calcShift(s, rules); });
  if (read.invalid) log_('注意', '打刻ログに読めない行が ' + read.invalid + ' 行ありました（日時・種類・スタッフIDを確認してください）');

  var target = period || periodFor(now.slice(0, 10), settings['締め日']);
  var summary = summarizePeriod(shifts, readStaff_(), target, rules);
  writeDaily_(shifts);
  writeMonthly_(summary, target, rules);
  return { shifts: shifts, summary: summary, period: target, invalid: read.invalid };
}

/** 'YYYY-MM-DD HH:mm' を、勤務の日付から見た時刻にする（日をまたいだら「翌」） */
function timeOnDay_(ymdHm, date) {
  if (!ymdHm) return '';
  return (ymdHm.slice(0, 10) === date ? '' : '翌') + ymdHm.slice(11);
}

function writeDaily_(shifts) {
  var sheet = ensureSheet_(SHEET_DAILY);
  sheet.clear();
  var rows = shifts.slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0;
  }).map(function (s) {
    var c = s.calc;
    var note = s.issues.length ? s.issues.join('、') : s.state;
    return [s.date, weekdayOf(s.date), s.staffId, sanitizeCell(s.name), timeOnDay_(s.in, s.date), timeOnDay_(s.out, s.date),
      c ? formatDuration(c.breakMin) : '', c ? formatDuration(c.workMin) : '', c ? formatDuration(c.overtimeMin) : '',
      c ? formatDuration(c.nightMin) : '', note];
  });
  var all = [DAILY_HEADERS].concat(rows);
  if (all.length > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), all.length - sheet.getMaxRows());
  var range = sheet.getRange(1, 1, all.length, DAILY_HEADERS.length);
  range.setNumberFormat('@').setValues(all);
  sheet.getRange(1, 1, 1, DAILY_HEADERS.length).setFontWeight('bold').setBackground('#e8f3ec');
  sheet.setFrozenRows(1);
  rows.forEach(function (r, i) {
    var color = r[10] === STATE_WORKING ? COLOR_WORKING : r[10] ? COLOR_CHECK : null;
    if (color) sheet.getRange(i + 2, 1, 1, DAILY_HEADERS.length).setBackground(color);
  });
  [95, 40, 75, 105, 60, 60, 55, 70, 55, 55, 140].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

function writeMonthly_(summary, period, rules) {
  var sheet = ensureSheet_(SHEET_MONTHLY);
  sheet.clear();
  var header = ['スタッフID', '名前', '出勤日数', '勤務時間', '残業', '深夜', '要確認', '時給（円）', 'お給料の目安（円）'];
  var rows = summary.rows.map(function (r) {
    return [r.staffId, sanitizeCell(r.name), r.days, formatDuration(r.workMin), formatDuration(r.overtimeMin),
      formatDuration(r.nightMin), r.issues || '', r.wage, r.pay];
  });
  var t = summary.total;
  rows.push(['', '合計', t.days, formatDuration(t.workMin), formatDuration(t.overtimeMin), formatDuration(t.nightMin),
    t.issues || '', '', t.pay]);

  sheet.getRange(1, 1).setValue(period.label + 'の勤怠（' + period.start + '〜' + period.end + '）')
    .setFontWeight('bold').setFontSize(14);
  sheet.getRange(2, 1).setValue('集計：' + nowYmdHm_());
  sheet.getRange(4, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e8f3ec');
  var body = sheet.getRange(5, 1, rows.length, header.length);
  body.setNumberFormat('@');
  sheet.getRange(5, 3, rows.length, 1).setNumberFormat('0');
  sheet.getRange(5, 7, rows.length, 3).setNumberFormat('#,##0');
  body.setValues(rows);
  sheet.getRange(4 + rows.length, 1, 1, header.length).setFontWeight('bold').setBackground('#f5f5f5');
  summary.rows.forEach(function (r, i) {
    if (r.issues) sheet.getRange(5 + i, 7).setBackground(COLOR_CHECK);
  });
  var noteRow = 6 + rows.length;
  sheet.getRange(noteRow, 1).setValue('※お給料の目安は、時給×勤務時間に、残業' + Math.round(rules.premiumOvertime * 100) +
    '%・深夜' + Math.round(rules.premiumNight * 100) + '%の割増を足したものです。交通費・控除などは入っていません。');
  sheet.getRange(noteRow + 1, 1).setValue('※「要確認」のある日は打刻が足りないため、時間に入っていません。「勤怠（日別）」で確認して「打刻ログ」を直してください。');
  [75, 110, 70, 80, 65, 65, 60, 80, 130].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

/** メニュー：今の期間の集計 */
function summarizeThisMonth() {
  assertOwner_();
  var r = refreshAttendance_();
  SpreadsheetApp.getUi().alert(r.period.label + 'の集計を作りました。' + issueNote_(r));
}

/** メニュー：ひとつ前の期間の集計 */
function summarizeLastMonth() {
  assertOwner_();
  var settings = readSettings_();
  var current = periodFor(nowYmdHm_().slice(0, 10), settings['締め日']);
  var r = refreshAttendance_(previousPeriod(current, settings['締め日']));
  SpreadsheetApp.getUi().alert(r.period.label + 'の集計を作りました。' + issueNote_(r));
}

function issueNote_(r) {
  var notes = [];
  if (r.summary.total.issues) notes.push('打刻の確認が必要な日が ' + r.summary.total.issues + ' 件あります（ピンクの行）。');
  if (r.invalid) notes.push('打刻ログに読めない行が ' + r.invalid + ' 行あります。');
  return notes.length ? '\n\n' + notes.join('\n') : '';
}

/** 打刻ログを手で直したら「ログ」シートに残す（シンプルトリガー） */
function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== SHEET_PUNCHES || e.range.getRow() < 2) return;
  var before = e.oldValue === undefined ? '（空 または 複数のセル）' : e.oldValue;
  var after = e.value === undefined ? '（空 または 複数のセル）' : e.value;
  log_('修正', '打刻ログ ' + e.range.getA1Notation() + '：「' + before + '」→「' + after + '」');
}
