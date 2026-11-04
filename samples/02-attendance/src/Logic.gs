/**
 * 勤怠の計算（GASの機能を使わないので、パソコン上でテストできる）
 * 日付は 'YYYY-MM-DD'、日時は 'YYYY-MM-DD HH:mm' の文字列で受け渡す。
 */

var PUNCH_IN = '出勤';
var PUNCH_BREAK = '休憩';
var PUNCH_BACK = '戻り';
var PUNCH_OUT = '退勤';
var PUNCH_TYPES = [PUNCH_IN, PUNCH_BREAK, PUNCH_BACK, PUNCH_OUT];

var ISSUE_NO_IN = '出勤の打刻なし';
var ISSUE_NO_OUT = '退勤の打刻なし';
var ISSUE_NO_BACK = '戻りの打刻なし';
var ISSUE_ORDER = '打刻の順番がおかしい';
var STATE_WORKING = '勤務中';
var STATE_CHECK = '要確認';

// 出勤からこの時間たっても退勤が無ければ「打刻忘れ」とみなす
var OPEN_SHIFT_LIMIT_MIN = 20 * 60;

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

/** '22:00' → 1320（分）。読めなければ null */
function parseHmToMin(hm) {
  var m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** '2026/10/5 9:03' や '2026-10-05 09:03:12' → '2026-10-05 09:03'。読めなければ null */
function normalizeDateTime(text) {
  var m = String(text || '').trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  if (h > 23 || mi > 59) return null;
  var check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return y + '-' + pad2(mo) + '-' + pad2(d) + ' ' + pad2(h) + ':' + pad2(mi);
}

/** 'YYYY-MM-DD HH:mm' → 分（差を取るためだけに使う） */
function toEpochMin(ymdHm) {
  var p = ymdHm.split(/[- :]/).map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]) / 60000;
}

function minutesBetween(from, to) {
  return toEpochMin(to) - toEpochMin(from);
}

/** 分 → '7:05' */
function formatDuration(min) {
  if (min === null || min === undefined) return '';
  var sign = min < 0 ? '-' : '';
  var abs = Math.abs(Math.round(min));
  return sign + Math.floor(abs / 60) + ':' + pad2(abs % 60);
}

/** 1234567 → '1,234,567' */
function formatYen(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** セルに書く文字が式として動かないよう、先頭に ' を付ける */
function sanitizeCell(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

/**
 * 打刻を、スタッフごとの「1回の勤務」にまとめる
 * @param {Array} punches [{staffId, name, at, type, row}]（順番はばらばらでよい。row はシートの行で、同じ時刻の順番に使う）
 * @param {string} nowYmdHm 今の日時（退勤前の人を「勤務中」と「打刻忘れ」に分けるため）
 * @return {Array} [{staffId, name, date, in, out, breaks:[{start, end}], onBreak, issues:[], state}]
 */
function buildShifts(punches, nowYmdHm) {
  var sorted = punches.slice().sort(function (a, b) {
    if (a.staffId !== b.staffId) return a.staffId < b.staffId ? -1 : 1;
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    // 同じ分の打刻は、書かれた順（退勤してすぐ出勤を押した、など）。行が分からなければ種類の順
    if (a.row !== undefined && b.row !== undefined && a.row !== b.row) return a.row - b.row;
    return PUNCH_TYPES.indexOf(a.type) - PUNCH_TYPES.indexOf(b.type);
  });

  var shifts = [];
  var open = null;

  function start(p, at) {
    var shift = {
      staffId: p.staffId, name: p.name, date: p.at.slice(0, 10), in: at, out: null,
      breaks: [], onBreak: false, breakStart: null, issues: [], state: ''
    };
    if (!at) addIssue(shift, ISSUE_NO_IN);
    shifts.push(shift);
    return shift;
  }

  // 退勤の無いまま終わった勤務：最後の勤務で、出勤からまだ時間がたっていなければ「勤務中」
  function finish(shift, isLatest) {
    if (!shift || shift.out) return;
    var stillWorking = isLatest && shift.in && nowYmdHm &&
      minutesBetween(shift.in, nowYmdHm) >= 0 && minutesBetween(shift.in, nowYmdHm) < OPEN_SHIFT_LIMIT_MIN;
    if (stillWorking) {
      shift.state = STATE_WORKING;
    } else if (shift.in) {
      addIssue(shift, ISSUE_NO_OUT);
    }
  }

  sorted.forEach(function (p) {
    if (open && open.staffId !== p.staffId) {
      finish(open, true);
      open = null;
    }
    if (p.type === PUNCH_IN) {
      finish(open, false);
      open = start(p, p.at);
    } else if (p.type === PUNCH_BREAK) {
      if (!open) open = start(p, null);
      if (open.onBreak) {
        addIssue(open, ISSUE_ORDER);
      } else {
        open.onBreak = true;
        open.breakStart = p.at;
      }
    } else if (p.type === PUNCH_BACK) {
      if (!open) open = start(p, null);
      if (!open.onBreak) {
        addIssue(open, ISSUE_ORDER);
      } else {
        open.breaks.push({ start: open.breakStart, end: p.at });
        open.onBreak = false;
        open.breakStart = null;
      }
    } else if (p.type === PUNCH_OUT) {
      if (!open) open = start(p, null);
      if (open.onBreak) {
        open.breaks.push({ start: open.breakStart, end: p.at });
        open.onBreak = false;
        open.breakStart = null;
        addIssue(open, ISSUE_NO_BACK);
      }
      open.out = p.at;
      open = null;
    }
  });
  finish(open, true);

  shifts.forEach(function (s) {
    delete s.breakStart;
    if (s.issues.length) s.state = STATE_CHECK;
  });
  return shifts;
}

function addIssue(shift, issue) {
  if (shift.issues.indexOf(issue) === -1) shift.issues.push(issue);
}

/** 夜の時間帯（例 22:00〜翌5:00）と、from〜to が重なる分数 */
function nightOverlap(from, to, nightStartMin, nightEndMin) {
  if (nightStartMin === nightEndMin) return 0;
  var s = toEpochMin(from);
  var e = toEpochMin(to);
  var total = 0;
  for (var d = addDaysYmd(from.slice(0, 10), -1); d <= to.slice(0, 10); d = addDaysYmd(d, 1)) {
    var base = toEpochMin(d + ' 00:00');
    var wStart = base + nightStartMin;
    var wEnd = nightStartMin < nightEndMin ? base + nightEndMin : base + 1440 + nightEndMin;
    total += Math.max(0, Math.min(e, wEnd) - Math.max(s, wStart));
  }
  return total;
}

/**
 * 1回の勤務の時間を計算する。打刻が足りない勤務は計算できないので null
 * @param {Object} rules {dailyLimitMin, nightStartMin, nightEndMin, roundUnitMin}
 */
function calcShift(shift, rules) {
  if (!shift.in || !shift.out || shift.issues.length) return null;
  var span = minutesBetween(shift.in, shift.out);
  var breakMin = 0;
  var breakNight = 0;
  shift.breaks.forEach(function (b) {
    breakMin += minutesBetween(b.start, b.end);
    breakNight += nightOverlap(b.start, b.end, rules.nightStartMin, rules.nightEndMin);
  });
  var unit = Math.max(1, Math.floor(rules.roundUnitMin || 1));
  var workMin = Math.floor(Math.max(0, span - breakMin) / unit) * unit;
  return {
    workMin: workMin,
    breakMin: breakMin,
    overtimeMin: Math.max(0, workMin - rules.dailyLimitMin),
    nightMin: Math.max(0, nightOverlap(shift.in, shift.out, rules.nightStartMin, rules.nightEndMin) - breakNight)
  };
}

/** 最後の勤務の状態から、今押せるボタン */
function allowedActions(lastShift) {
  if (!lastShift || lastShift.out || lastShift.state !== STATE_WORKING) return [PUNCH_IN];
  return lastShift.onBreak ? [PUNCH_BACK] : [PUNCH_BREAK, PUNCH_OUT];
}

/**
 * 締め日から、ymd が入る集計期間を出す
 * @param {string} closing '末' または 1〜28
 * @return {Object} {start, end, label}
 */
function periodFor(ymd, closing) {
  var p = ymd.split('-').map(Number);
  var n = Number(String(closing).trim());
  if (!(n >= 1 && n <= 28) || Math.floor(n) !== n) {
    var last = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    return {
      start: p[0] + '-' + pad2(p[1]) + '-01',
      end: p[0] + '-' + pad2(p[1]) + '-' + pad2(last),
      label: p[0] + '年' + p[1] + '月分'
    };
  }
  var end = new Date(Date.UTC(p[0], p[1] - 1 + (p[2] > n ? 1 : 0), n));
  var start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, n + 1));
  function ymdOf(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  return { start: ymdOf(start), end: ymdOf(end), label: end.getUTCFullYear() + '年' + (end.getUTCMonth() + 1) + '月分' };
}

/** ひとつ前の集計期間 */
function previousPeriod(period, closing) {
  return periodFor(addDaysYmd(period.start, -1), closing);
}

/**
 * 集計期間のスタッフ別の合計
 * @param {Array} shifts calc（calcShift の結果）を付けた勤務
 * @param {Array} staffList [{id, name, wage, active}]
 * @param {Object} rules {premiumOvertime, premiumNight}（0.25 = 25%）
 * @return {Object} {rows: [...], total: {...}}
 */
function summarizePeriod(shifts, staffList, period, rules) {
  var inPeriod = shifts.filter(function (s) { return s.date >= period.start && s.date <= period.end; });
  var rows = [];
  staffList.forEach(function (staff) {
    var mine = inPeriod.filter(function (s) { return s.staffId === staff.id; });
    if (!staff.active && !mine.length) return;
    rows.push(summarizeStaff(staff, mine, rules));
  });
  // スタッフシートに無いIDの打刻も、合計から漏れないように出す
  var known = staffList.map(function (s) { return s.id; });
  var unknown = {};
  inPeriod.forEach(function (s) {
    if (known.indexOf(s.staffId) === -1 && !unknown[s.staffId]) unknown[s.staffId] = s.name;
  });
  Object.keys(unknown).sort().forEach(function (id) {
    var staff = { id: id, name: unknown[id] + '（スタッフ未登録）', wage: 0 };
    rows.push(summarizeStaff(staff, inPeriod.filter(function (s) { return s.staffId === id; }), rules));
  });
  var total = { days: 0, workMin: 0, breakMin: 0, overtimeMin: 0, nightMin: 0, issues: 0, pay: 0 };
  rows.forEach(function (r) {
    Object.keys(total).forEach(function (k) { total[k] += r[k]; });
  });
  return { rows: rows, total: total };
}

/** ひとりぶんの合計 */
function summarizeStaff(staff, mine, rules) {
  var row = {
    staffId: staff.id, name: staff.name, wage: staff.wage,
    days: 0, workMin: 0, breakMin: 0, overtimeMin: 0, nightMin: 0, issues: 0, pay: 0
  };
  var dates = {};
  mine.forEach(function (s) {
    if (s.issues.length) row.issues++;
    if (!s.calc) return;
    dates[s.date] = true;
    row.workMin += s.calc.workMin;
    row.breakMin += s.calc.breakMin;
    row.overtimeMin += s.calc.overtimeMin;
    row.nightMin += s.calc.nightMin;
  });
  row.days = Object.keys(dates).length;
  row.pay = Math.round(staff.wage * (row.workMin + row.overtimeMin * rules.premiumOvertime +
    row.nightMin * rules.premiumNight) / 60);
  return row;
}

/** 打刻忘れのお知らせメール */
function buildMissingMail(shopName, shifts) {
  var lines = shifts.map(function (s) {
    return '・' + s.date + '（' + weekdayOf(s.date) + '） ' + s.name + '（出勤 ' + (s.in ? s.in.slice(11) : 'なし') +
      '）：' + s.issues.join('、');
  });
  return {
    subject: '【打刻の確認】' + shifts.length + '件あります',
    body: '【' + shopName + '】打刻の確認をお願いします。\n\n' + lines.join('\n') +
      '\n\n「打刻ログ」シートで時刻を直すと、次の集計から反映されます。\n' +
      '※このメールは架空のサンプル店から送られています。'
  };
}
