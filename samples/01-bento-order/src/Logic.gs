/**
 * 計算・判定のロジック（GASの機能を使わないので、パソコン上でテストできる）
 * 日付は 'YYYY-MM-DD'、日時は 'YYYY-MM-DD HH:mm' の文字列で受け渡す。
 */

var STATUS_OK = '受付済み';
var STATUS_NG = '受付不可';
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

/** '9:00' → '09:00' */
function normalizeHm(hm) {
  var p = String(hm).trim().split(':');
  return pad2(Number(p[0])) + ':' + pad2(Number(p[1] || 0));
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

/**
 * フォームの入力をセルに書く前の処理。'=' などで始まる文字が式として動かないよう先頭に ' を付ける
 */
function sanitizeCell(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** フォームの個数欄の見出し '唐揚げ弁当（650円）' */
function quantityTitle(name, price) {
  return name + '（' + formatYen(price) + '円）';
}

/** 個数欄の見出しから商品名を取り出す。個数欄でなければ null */
function nameFromQuantityTitle(title) {
  var m = String(title).match(/^(.+)（[\d,]+円）$/);
  return m ? m[1] : null;
}

/** 受け取り日の daysBefore 日前の deadlineHm を過ぎているか */
function isPastDeadline(pickupYmd, nowYmdHm, daysBefore, deadlineHm) {
  var deadline = addDaysYmd(pickupYmd, -daysBefore) + ' ' + normalizeHm(deadlineHm);
  return nowYmdHm > deadline;
}

/**
 * 注文内容を計算する
 * @param {Object} quantities 商品名 → 個数
 * @param {Array} menu [{name, price}]
 */
function calcOrder(quantities, menu) {
  var lines = [];
  var totalQty = 0;
  var totalPrice = 0;
  menu.forEach(function (item) {
    var qty = Number(quantities[item.name]) || 0;
    if (qty <= 0) return;
    var subtotal = item.price * qty;
    lines.push({ name: item.name, price: item.price, qty: qty, subtotal: subtotal });
    totalQty += qty;
    totalPrice += subtotal;
  });
  return { lines: lines, totalQty: totalQty, totalPrice: totalPrice };
}

/**
 * 受け付けられる注文か判定する
 * @param {Object} ctx {nowYmdHm, daysBefore, deadlineHm, closedDays, capacity, bookedQty,
 *   maxQtyPerOrder（省略可）, maxDaysAhead（省略可）}
 * @return {{status: string, reason: string}}
 */
function checkOrder(pickupYmd, totalQty, ctx) {
  if (totalQty <= 0) {
    return { status: STATUS_NG, reason: '商品が選ばれていませんでした。' };
  }
  if (ctx.maxQtyPerOrder && totalQty > ctx.maxQtyPerOrder) {
    return { status: STATUS_NG, reason: '1回のご注文は ' + ctx.maxQtyPerOrder + ' 個までです。それより多い場合はご相談ください。' };
  }
  if (ctx.maxDaysAhead && pickupYmd > addDaysYmd(ctx.nowYmdHm.slice(0, 10), ctx.maxDaysAhead)) {
    return { status: STATUS_NG, reason: 'ご注文は ' + ctx.maxDaysAhead + ' 日先の分まで受け付けています。' };
  }
  var weekday = weekdayOf(pickupYmd);
  if (ctx.closedDays.indexOf(weekday) !== -1) {
    return { status: STATUS_NG, reason: weekday + '曜日は定休日のため、お受けできませんでした。' };
  }
  if (isPastDeadline(pickupYmd, ctx.nowYmdHm, ctx.daysBefore, ctx.deadlineHm)) {
    return {
      status: STATUS_NG,
      reason: 'この受け取り日のご注文は ' + addDaysYmd(pickupYmd, -ctx.daysBefore) + ' ' +
        normalizeHm(ctx.deadlineHm) + ' で締め切りました。'
    };
  }
  if (ctx.bookedQty + totalQty > ctx.capacity) {
    var left = Math.max(0, ctx.capacity - ctx.bookedQty);
    return { status: STATUS_NG, reason: 'この日はご注文が上限に近く、あと ' + left + ' 個までしかお受けできません。' };
  }
  return { status: STATUS_OK, reason: '' };
}

/** 注文番号 '20261028-001' */
function makeOrderNo(nowYmd, seq) {
  var s = String(seq);
  while (s.length < 3) s = '0' + s;
  return nowYmd.replace(/-/g, '') + '-' + s;
}

/** 'YYYY-MM-DD' → '2026-10-30（金）' */
function formatPickupDate(ymd) {
  return ymd + '（' + weekdayOf(ymd) + '）';
}

/**
 * お客さん宛てのメール文面
 * @param {Object} order {orderNo, name, date, time, method, note}
 */
function buildCustomerMail(order, calc, result, shopName) {
  var head = order.name + ' 様\n\n' + shopName + 'です。\n';
  var detail = [
    '■ 注文番号：' + order.orderNo,
    '■ 受け取り：' + formatPickupDate(order.date) + ' ' + order.time + '　' + order.method,
    '■ ご注文内容'
  ];
  calc.lines.forEach(function (l) {
    detail.push('　' + l.name + '　' + formatYen(l.price) + '円 × ' + l.qty + ' ＝ ' + formatYen(l.subtotal) + '円');
  });
  detail.push('■ 合計：' + calc.totalQty + '個　' + formatYen(calc.totalPrice) + '円（税込）');
  detail.push('■ アレルギー・ご要望：' + (order.note || 'なし'));

  var foot = '\n\n※このメールは架空のサンプル店から送られています。実際の注文・お支払いは発生しません。';

  if (result.status === STATUS_OK) {
    return {
      subject: '【' + shopName + '】ご注文を承りました（' + order.orderNo + '）',
      body: head + 'ご注文ありがとうございます。以下の内容で承りました。\n\n' + detail.join('\n') + foot
    };
  }
  return {
    subject: '【' + shopName + '】ご注文をお受けできませんでした（' + order.orderNo + '）',
    body: head + '申し訳ありません。' + result.reason + '\n' +
      'お手数ですが、別の日でもう一度ご注文ください。\n\n' + detail.join('\n') + foot
  };
}

/** お店宛ての新着通知 */
function buildShopNotice(order, calc, result) {
  var lines = calc.lines.map(function (l) { return '　' + l.name + ' × ' + l.qty; });
  return {
    subject: '【新着注文・' + result.status + '】' + formatPickupDate(order.date) + ' ' + order.time + '　' +
      order.name + ' 様（' + calc.totalQty + '個）',
    body: [
      '注文番号：' + order.orderNo,
      'ステータス：' + result.status + (result.reason ? '（' + result.reason + '）' : ''),
      '受け取り：' + formatPickupDate(order.date) + ' ' + order.time + '　' + order.method,
      'お名前：' + order.name + (order.company ? '（' + order.company + '）' : ''),
      '電話：' + (order.phone || '-'),
      '内容：',
      lines.join('\n') || '　なし',
      '合計：' + calc.totalQty + '個　' + formatYen(calc.totalPrice) + '円',
      'アレルギー・ご要望：' + (order.note || 'なし')
    ].join('\n')
  };
}

/**
 * 受け取り日ごとの製造数を集計する（受付済みの注文だけ）
 * @param {Array} orders [{orderNo, status, date, time, name, company, note, quantities}]
 * @param {Array} productNames 表に並べる商品名
 * @param {Array} slots 表に並べる受け取り時間
 */
function aggregateProduction(orders, targetYmd, productNames, slots) {
  var target = orders.filter(function (o) { return o.status === STATUS_OK && o.date === targetYmd; });
  var slotList = slots.slice();
  target.forEach(function (o) {
    if (slotList.indexOf(o.time) === -1) slotList.push(o.time);
  });
  slotList.sort();

  var byProduct = productNames.map(function (name) {
    var qty = target.reduce(function (sum, o) { return sum + (Number(o.quantities[name]) || 0); }, 0);
    return { name: name, qty: qty };
  });
  var bySlot = slotList.map(function (slot) {
    var counts = {};
    var total = 0;
    productNames.forEach(function (name) {
      var qty = target.filter(function (o) { return o.time === slot; })
        .reduce(function (sum, o) { return sum + (Number(o.quantities[name]) || 0); }, 0);
      counts[name] = qty;
      total += qty;
    });
    return { slot: slot, counts: counts, total: total };
  });
  var notes = target.filter(function (o) { return o.note; }).map(function (o) {
    return { orderNo: o.orderNo, name: o.name, time: o.time, note: o.note };
  });
  return {
    date: targetYmd,
    orderCount: target.length,
    totalQty: byProduct.reduce(function (sum, p) { return sum + p.qty; }, 0),
    byProduct: byProduct,
    bySlot: bySlot,
    notes: notes
  };
}

/** 製造数のお店宛てメール */
function buildProductionMail(agg, shopName) {
  var lines = ['【' + shopName + '】' + formatPickupDate(agg.date) + ' の製造数', ''];
  lines.push('注文 ' + agg.orderCount + '件　合計 ' + agg.totalQty + '個', '');
  lines.push('■ 商品別');
  agg.byProduct.forEach(function (p) { lines.push('　' + p.name + '：' + p.qty); });
  lines.push('', '■ 受け取り時間別');
  agg.bySlot.forEach(function (s) {
    if (s.total === 0) return;
    var parts = Object.keys(s.counts).filter(function (k) { return s.counts[k] > 0; })
      .map(function (k) { return k + ' ' + s.counts[k]; });
    lines.push('　' + s.slot + '（' + s.total + '個）：' + parts.join('、'));
  });
  lines.push('', '■ アレルギー・ご要望');
  if (agg.notes.length === 0) lines.push('　なし');
  agg.notes.forEach(function (n) { lines.push('　' + n.time + ' ' + n.name + ' 様（' + n.orderNo + '）：' + n.note); });
  return { subject: '【製造数】' + formatPickupDate(agg.date) + '　合計' + agg.totalQty + '個', body: lines.join('\n') };
}
