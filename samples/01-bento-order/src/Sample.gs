/**
 * 見本用のデータ：架空のお客さんの注文を入れる（メールは送らない）
 */

var SAMPLE_CUSTOMERS = [
  ['佐藤 美咲', '株式会社サンプル商事'],
  ['鈴木 健太', 'みどり建設（架空）'],
  ['高橋 さくら', ''],
  ['田中 翔', 'あおぞら不動産（架空）'],
  ['伊藤 由美', 'ひまわり保育園（架空）'],
  ['渡辺 大輔', '株式会社サンプル商事'],
  ['山本 彩', ''],
  ['中村 拓也', 'サンプル工業株式会社'],
  ['小林 愛', 'こもれび歯科（架空）'],
  ['加藤 誠', '']
];

var SAMPLE_NOTES = ['', '', 'えびアレルギーがあります', '', '温めてお渡しをお願いします', '',
  '領収書をお願いします', '箸は人数分お願いします', '', 'ごはん少なめを2つ'];

var SAMPLE_ORDERS_PER_DAY = 12;

function createSampleOrders() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('サンプル注文を入れます',
    '次の営業日2日分に架空の注文を' + (SAMPLE_ORDERS_PER_DAY * 2) + '件、締め切り後の注文を2件入れます。\n' +
    'メールは送りません。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var count = insertSampleOrders_();
    ui.alert('サンプル注文を' + count + '件入れました。\n「明日の製造数を今すぐ集計」も試してみてください。');
  } finally {
    lock.releaseLock();
  }
}

function insertSampleOrders_() {
  var settings = readSettings_();
  var menu = readMenu_();
  var closed = parseList(settings['定休日']);
  var times = parseList(settings['受け取り時間']);
  var methods = parseList(settings['受け取り方法']);
  var today = formatNow_(new Date(), 'yyyy-MM-dd');
  var rand = seededRandom_(20261028);

  var dates = [];
  var d = today;
  while (dates.length < 2) {
    d = addDaysYmd(d, 1);
    if (closed.indexOf(weekdayOf(d)) === -1) dates.push(d);
  }

  // 受付日時は昨日の朝から少しずつずらす（どの受け取り日も締め切り前になる）
  var start = new Date(addDaysYmd(today, -1) + 'T09:00:00+09:00').getTime();
  var count = 0;
  dates.forEach(function (date, di) {
    for (var i = 0; i < SAMPLE_ORDERS_PER_DAY; i++) {
      var n = di * SAMPLE_ORDERS_PER_DAY + i;
      processOrder_(sampleOrder_(n, date, times, methods, menu, rand, new Date(start + n * 10 * 60000)),
        { sendMail: false });
      count++;
    }
  });

  // 締め切り後の注文（今日受け取り）を2件まぜて「受付不可」を見せる
  for (var j = 0; j < 2; j++) {
    processOrder_(sampleOrder_(100 + j, today, times, methods, menu, rand, new Date()), { sendMail: false });
    count++;
  }
  return count;
}

function sampleOrder_(n, date, times, methods, menu, rand, timestamp) {
  var customer = SAMPLE_CUSTOMERS[n % SAMPLE_CUSTOMERS.length];
  var quantities = {};
  // お弁当を1〜2種類、ときどきお茶
  var bentos = menu.filter(function (m) { return m.name.indexOf('弁当') !== -1; });
  var kinds = 1 + Math.floor(rand() * 2);
  for (var k = 0; k < kinds && bentos.length; k++) {
    var item = bentos[Math.floor(rand() * bentos.length)];
    quantities[item.name] = (quantities[item.name] || 0) + 1 + Math.floor(rand() * 4);
  }
  menu.forEach(function (m) {
    if (m.name.indexOf('弁当') === -1 && rand() < 0.4) quantities[m.name] = 1 + Math.floor(rand() * 3);
  });
  var no = ('0' + ((n % 99) + 1)).slice(-2);
  return {
    timestamp: timestamp,
    name: customer[0],
    company: customer[1],
    email: 'sample' + no + '@example.com',
    phone: '090-0000-00' + no,
    method: methods[n % methods.length] || '店頭受け取り',
    date: date,
    time: times[Math.floor(rand() * times.length)] || '12:00',
    note: SAMPLE_NOTES[n % SAMPLE_NOTES.length],
    quantities: quantities
  };
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

function resetOrders() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('注文一覧をリセットします',
    '「注文一覧」の注文と「製造数」をすべて消します。元に戻せません。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  var sheet = ensureSheet_(SHEET_ORDERS);
  // 行を消すと「固定されていない行をすべて削除」で失敗することがあるので、中身だけ消す
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent().setBackground(null);
  }
  ensureSheet_(SHEET_PRODUCTION).clear();
  log_('設定', '注文一覧をリセットしました');
}
