/**
 * 注文の受付：フォーム送信 → 判定 → 注文一覧に記録 → メール
 */

var SHEET_ORDERS = '注文一覧';
var SHEET_MENU = 'メニュー';

/** フォームの質問の見出し */
var FIELD = {
  name: 'お名前',
  company: '会社名・団体名',
  email: 'メールアドレス',
  phone: '電話番号',
  method: '受け取り方法',
  date: '受け取り日',
  time: '受け取り時間',
  note: 'アレルギー・ご要望'
};

var ORDER_HEADERS_BEFORE = ['注文番号', '受付日時', 'ステータス', '受付不可の理由', FIELD.date, FIELD.time,
  FIELD.method, FIELD.name, FIELD.company, FIELD.email, FIELD.phone];
var ORDER_HEADERS_AFTER = ['合計個数', '合計金額', FIELD.note];
// 数値として書く列（商品の個数の列もこれに含める）。それ以外は日付や式に化けないよう文字列で書く
var ORDER_NUMBER_COLUMNS = ['合計個数', '合計金額'];

/** フォーム送信時に呼ばれる（初期設定でトリガーを登録） */
function onOrderSubmit(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    processOrder_(orderFromResponse_(e.response), { sendMail: true });
  } catch (err) {
    log_('エラー', '注文の処理に失敗しました：' + (err && err.stack ? err.stack : err));
    try {
      var settings = readSettings_();
      MailApp.sendEmail(shopEmail_(settings), '【要確認】注文の処理に失敗しました',
        'フォームの回答を確認してください。\n\n' + err);
    } catch (ignore) {
      // 通知にも失敗した場合はログだけ残す
    }
  } finally {
    lock.releaseLock();
  }
}

/** フォームの回答を注文データにする */
function orderFromResponse_(response) {
  var answers = {};
  var quantities = {};
  response.getItemResponses().forEach(function (ir) {
    var title = ir.getItem().getTitle();
    var name = nameFromQuantityTitle(title);
    if (name) {
      quantities[name] = Number(ir.getResponse()) || 0;
    } else {
      answers[title] = String(ir.getResponse());
    }
  });
  return {
    timestamp: response.getTimestamp(),
    name: answers[FIELD.name] || '',
    company: answers[FIELD.company] || '',
    email: answers[FIELD.email] || '',
    phone: answers[FIELD.phone] || '',
    method: answers[FIELD.method] || '',
    date: answers[FIELD.date] || '',
    time: answers[FIELD.time] || '',
    note: answers[FIELD.note] || '',
    quantities: quantities
  };
}

/**
 * 注文を判定して記録し、メールを送る
 * @param {Object} order orderFromResponse_ の形
 * @param {Object} opts {sendMail: boolean}
 */
function processOrder_(order, opts) {
  var settings = readSettings_();
  var menu = readMenu_();
  var sheet = ensureSheet_(SHEET_ORDERS);
  var header = syncOrderHeaders_(sheet, menu.map(function (m) { return m.name; }));
  var orders = readOrders_(sheet, header);

  var calc = calcOrder(order.quantities, menu);
  var nowYmd = formatNow_(order.timestamp, 'yyyy-MM-dd');
  var bookedQty = orders.filter(function (o) { return o.status === STATUS_OK && o.date === order.date; })
    .reduce(function (sum, o) { return sum + o.totalQty; }, 0);

  var result = /^\d{4}-\d{2}-\d{2}$/.test(order.date)
    ? checkOrder(order.date, calc.totalQty, {
      nowYmdHm: formatNow_(order.timestamp, 'yyyy-MM-dd HH:mm'),
      daysBefore: settingNumber_(settings, '締切_何日前', 1),
      deadlineHm: settings['締切_時刻'] || '15:00',
      closedDays: parseList(settings['定休日']),
      capacity: settingNumber_(settings, '1日の上限食数', 100),
      bookedQty: bookedQty,
      maxQtyPerOrder: settingNumber_(settings, '1回の上限個数', 30),
      maxDaysAhead: settingNumber_(settings, '何日先まで受け付けるか', 30)
    })
    : { status: STATUS_NG, reason: '受け取り日が読み取れませんでした。' };

  order.orderNo = makeOrderNo(nowYmd, nextSeq_(orders, nowYmd));

  var fields = {};
  fields['注文番号'] = order.orderNo;
  fields['受付日時'] = formatNow_(order.timestamp, 'yyyy-MM-dd HH:mm');
  fields['ステータス'] = result.status;
  fields['受付不可の理由'] = result.reason;
  fields[FIELD.date] = order.date;
  fields[FIELD.time] = order.time;
  fields[FIELD.method] = order.method;
  fields[FIELD.name] = order.name;
  fields[FIELD.company] = order.company;
  fields[FIELD.email] = order.email;
  fields[FIELD.phone] = order.phone;
  fields['合計個数'] = calc.totalQty;
  fields['合計金額'] = calc.totalPrice;
  fields[FIELD.note] = order.note;
  // 記録する個数は、合計の計算に使ったもの（メニューに無い商品は入れない）と同じにする
  var counted = {};
  calc.lines.forEach(function (l) { counted[l.name] = l.qty; });
  writeOrderRow_(sheet, header, fields, counted, result.status);

  if (opts.sendMail) {
    var shopName = settings['店名'] || 'サンプル店';
    try {
      sendMail_(settings, order.email, buildCustomerMail(order, calc, result, shopName), true);
      sendMail_(settings, shopEmail_(settings), buildShopNotice(order, calc, result), false);
    } catch (err) {
      log_('エラー', order.orderNo + ' のメール送信に失敗しました：' + err);
    }
  }
  log_('注文', order.orderNo + ' ' + result.status + ' ' + order.date + ' ' + order.name + '（' + calc.totalQty + '個）');
  return { orderNo: order.orderNo, result: result, calc: calc };
}

/** その日の次の連番（行を消しても番号が重ならないよう最大値+1） */
function nextSeq_(orders, nowYmd) {
  var prefix = nowYmd.replace(/-/g, '') + '-';
  var max = 0;
  orders.forEach(function (o) {
    var no = String(o.orderNo);
    if (no.indexOf(prefix) === 0) max = Math.max(max, Number(no.slice(prefix.length)) || 0);
  });
  return max + 1;
}

/** メニューシート（販売中のものだけ） → [{name, price}] */
function readMenu_() {
  var sheet = getSs_().getSheetByName(SHEET_MENU);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues()
    .filter(function (r) { return String(r[0]).trim() !== '' && r[2] === true; })
    .map(function (r) { return { name: String(r[0]).trim(), price: Number(r[1]) || 0 }; });
}

/**
 * 注文一覧の見出しを用意する。メニューに新しい商品が増えたら「合計個数」の前に列を足す
 * @return {Array} 見出しの配列
 */
function syncOrderHeaders_(sheet, productNames) {
  if (sheet.getLastRow() === 0) {
    var headers = ORDER_HEADERS_BEFORE.concat(productNames, ORDER_HEADERS_AFTER);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#fff3e0');
    sheet.setFrozenRows(1);
    return headers;
  }
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  productNames.forEach(function (name) {
    if (header.indexOf(name) !== -1) return;
    var col = header.indexOf('合計個数') + 1;
    sheet.insertColumnBefore(col);
    sheet.getRange(1, col).setValue(name).setFontWeight('bold').setBackground('#fff3e0');
    header.splice(col - 1, 0, name);
  });
  return header;
}

/** 注文一覧の列幅（文字が途中で切れない幅。ここに無い列は商品の個数の列） */
var ORDER_COLUMN_WIDTHS = {
  '注文番号': 120, '受付日時': 130, 'ステータス': 80, '受付不可の理由': 280,
  '受け取り日': 100, '受け取り時間': 100, '受け取り方法': 130, 'お名前': 100,
  '会社名・団体名': 180, 'メールアドレス': 210, '電話番号': 120,
  '合計個数': 80, '合計金額': 90, 'アレルギー・ご要望': 240
};

function setOrderColumnWidths_(sheet, header) {
  header.forEach(function (h, i) {
    sheet.setColumnWidth(i + 1, ORDER_COLUMN_WIDTHS[h] || 110);
  });
}

/** 見出しのうち、商品の個数の列 */
function productColumns_(header) {
  return header.filter(function (h) {
    return h !== '' && ORDER_HEADERS_BEFORE.indexOf(h) === -1 && ORDER_HEADERS_AFTER.indexOf(h) === -1;
  });
}

/**
 * 見出しに合わせて1行書き込む
 * フォームの入力はそのまま書くと式として動くことがあるので、文字の列は書式なしテキスト＋先頭の ' で守る
 */
function writeOrderRow_(sheet, header, fields, quantities, status) {
  var numberCols = ORDER_NUMBER_COLUMNS.concat(productColumns_(header));
  var row = header.map(function (h) {
    if (quantities.hasOwnProperty(h)) return Number(quantities[h]) || '';
    if (numberCols.indexOf(h) !== -1) return fields.hasOwnProperty(h) ? fields[h] : '';
    return fields.hasOwnProperty(h) ? sanitizeCell(String(fields[h])) : '';
  });
  var rowIndex = sheet.getLastRow() + 1;
  if (rowIndex > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  header.forEach(function (h, i) {
    if (numberCols.indexOf(h) === -1) sheet.getRange(rowIndex, i + 1).setNumberFormat('@');
  });
  var range = sheet.getRange(rowIndex, 1, 1, header.length);
  range.setValues([row]);
  range.setBackground(status === STATUS_OK ? null : '#fde7e9');
}

/** 注文一覧を読む */
function readOrders_(sheet, header) {
  if (sheet.getLastRow() < 2) return [];
  var col = {};
  header.forEach(function (h, i) { col[h] = i; });
  var productCols = productColumns_(header);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues().map(function (r) {
    var quantities = {};
    productCols.forEach(function (name) { quantities[name] = Number(r[col[name]]) || 0; });
    return {
      orderNo: String(r[col['注文番号']]),
      status: String(r[col['ステータス']]),
      date: cellToYmd_(r[col[FIELD.date]]),
      time: cellToHm_(r[col[FIELD.time]]),
      name: String(r[col[FIELD.name]]),
      company: String(r[col[FIELD.company]]),
      note: String(r[col[FIELD.note]] || ''),
      totalQty: Number(r[col['合計個数']]) || 0,
      quantities: quantities
    };
  });
}

/** 手で入力されて日付に変わったセルも 'YYYY-MM-DD' にそろえる */
function cellToYmd_(v) {
  return v instanceof Date ? formatNow_(v, 'yyyy-MM-dd') : String(v).trim();
}

function cellToHm_(v) {
  return v instanceof Date ? formatNow_(v, 'HH:mm') : String(v).trim();
}
