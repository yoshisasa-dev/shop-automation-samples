/**
 * 製造数の集計：翌日分を「製造数」シートにまとめ、お店にメールする
 */

/** 毎日の時刻トリガーから呼ばれる */
function dailyProduction() {
  try {
    var tomorrow = addDaysYmd(formatNow_(new Date(), 'yyyy-MM-dd'), 1);
    runProduction_(tomorrow, true);
  } catch (err) {
    log_('エラー', '製造数の集計に失敗しました：' + (err && err.stack ? err.stack : err));
  }
}

/** メニューから手動で実行 */
function productionNow() {
  var tomorrow = addDaysYmd(formatNow_(new Date(), 'yyyy-MM-dd'), 1);
  var agg = runProduction_(tomorrow, true);
  SpreadsheetApp.getUi().alert(formatPickupDate(agg.date) + ' の製造数を集計しました。\n注文 ' +
    agg.orderCount + '件　合計 ' + agg.totalQty + '個' + (agg.orderCount ? '\n通知先にメールを送りました。' : ''));
}

function runProduction_(targetYmd, sendMail) {
  var settings = readSettings_();
  var menuNames = readMenu_().map(function (m) { return m.name; });
  var sheet = ensureSheet_(SHEET_ORDERS);
  var header = syncOrderHeaders_(sheet, menuNames);
  // 販売中をオフにした商品も、すでに入っている注文の分は数える
  var productNames = menuNames.concat(productColumns_(header).filter(function (h) {
    return menuNames.indexOf(h) === -1;
  }));
  var agg = aggregateProduction(readOrders_(sheet, header), targetYmd, productNames,
    parseList(settings['受け取り時間']));
  agg.byProduct = agg.byProduct.filter(function (p) { return menuNames.indexOf(p.name) !== -1 || p.qty > 0; });

  writeProductionSheet_(agg);
  if (sendMail && agg.orderCount > 0) {
    sendMail_(settings, shopEmail_(settings), buildProductionMail(agg, settings['店名'] || 'サンプル店'), false);
  }
  log_('集計', agg.date + ' 注文' + agg.orderCount + '件 合計' + agg.totalQty + '個');
  return agg;
}

function writeProductionSheet_(agg) {
  var sheet = ensureSheet_(SHEET_PRODUCTION);
  sheet.clear();
  var row = 1;

  sheet.getRange(row, 1).setValue(formatPickupDate(agg.date) + ' の製造数').setFontSize(14).setFontWeight('bold');
  sheet.getRange(row + 1, 1).setValue('集計：' + formatNow_(new Date(), 'yyyy-MM-dd HH:mm') +
    '　注文 ' + agg.orderCount + '件　合計 ' + agg.totalQty + '個');
  row += 3;

  row = writeBlock_(sheet, row, '■ 商品別', ['商品名', '個数'],
    agg.byProduct.map(function (p) { return [p.name, p.qty]; }), false);

  var names = agg.byProduct.map(function (p) { return p.name; });
  row = writeBlock_(sheet, row, '■ 受け取り時間別', ['受け取り時間'].concat(names, ['合計']),
    agg.bySlot.map(function (s) {
      return [s.slot].concat(names.map(function (n) { return s.counts[n]; }), [s.total]);
    }), false);

  writeBlock_(sheet, row, '■ アレルギー・ご要望', ['受け取り時間', '注文番号', 'お名前', '内容'],
    agg.notes.length
      ? agg.notes.map(function (n) { return [n.time, n.orderNo, sanitizeCell(n.name + ' 様'), sanitizeCell(n.note)]; })
      : [['なし', '', '', '']], true);

  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(4, 160);
}

/**
 * 見出し付きの表を書き、次に書ける行を返す
 * 1列目（時刻など）は文字列のまま残す。allText なら全列を文字列にする
 */
function writeBlock_(sheet, row, title, headers, rows, allText) {
  sheet.getRange(row, 1).setValue(title).setFontWeight('bold');
  sheet.getRange(row + 1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#fff3e0');
  if (rows.length) {
    sheet.getRange(row + 2, 1, rows.length, allText ? headers.length : 1).setNumberFormat('@');
    sheet.getRange(row + 2, 1, rows.length, headers.length).setValues(rows);
  }
  return row + 2 + rows.length + 1;
}
