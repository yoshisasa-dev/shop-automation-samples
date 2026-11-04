/**
 * 初期設定：シート・フォーム・トリガーを用意する
 */

var DEFAULT_SETTINGS = [
  ['店名', 'まるっと弁当（サンプル店）', '画面・メールに出るお店の名前'],
  ['通知先メール', '', '新着注文や製造数を受け取るアドレス。空なら設置したアカウントに届く'],
  ['締切_何日前', '1', '受け取り日の何日前まで受け付けるか'],
  ['締切_時刻', '15:00', '締め切りの時刻'],
  ['定休日', '日', '受け付けない曜日。複数ならカンマ区切り（例：土,日）'],
  ['1日の上限食数', '100', '1日に受け付ける合計個数'],
  ['1回の上限個数', '30', '1回の注文で受け付ける合計個数（いたずらの大量注文よけ）'],
  ['何日先まで受け付けるか', '30', '今日から何日先の受け取り日まで受け付けるか'],
  ['受け取り時間', '11:00,11:30,12:00,12:30,13:00', 'フォームに出す受け取り時間。変えたら「フォームの商品・選択肢を更新」'],
  ['受け取り方法', '店頭受け取り,配達（近隣のみ）', 'フォームに出す受け取り方法。変えたら「フォームの商品・選択肢を更新」'],
  ['製造数の集計時刻', '16', '毎日この時（0〜23）に翌日分を集計してメール。変えたら「初期設定」をもう一度'],
  ['デモモード', 'ON', 'OFF以外のあいだは、お客さん宛てのメールも通知先に届く。本番で使うときだけOFF']
];

var DEFAULT_MENU = [
  ['唐揚げ弁当', 650, true],
  ['鮭弁当', 700, true],
  ['日替わり弁当', 600, true],
  ['幕の内弁当', 900, true],
  ['お茶（500ml）', 150, true]
];

var SHEET_PRODUCTION = '製造数';
var QTY_CHOICES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '15', '20'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🍱 サンプル店')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('フォームのURLを表示', 'showFormUrl')
    .addItem('フォームの商品・選択肢を更新', 'updateForm')
    .addSeparator()
    .addItem('明日の製造数を今すぐ集計', 'productionNow')
    .addSeparator()
    .addItem('サンプル注文を入れる', 'createSampleOrders')
    .addItem('注文一覧をリセット', 'resetOrders')
    .addToUi();
}

/** 初期設定。何度実行しても入力済みの設定・メニュー・注文は消えない */
function setup() {
  var ss = getSs_();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());

  ensureSheet_(SHEET_ORDERS);
  ensureSheet_(SHEET_PRODUCTION);
  ensureMenuSheet_();
  ensureSettings_(DEFAULT_SETTINGS);
  ensureSheet_(SHEET_LOG, ['日時', '種類', '内容']);

  var settings = readSettings_();
  var menu = readMenu_();
  var ordersSheet = ss.getSheetByName(SHEET_ORDERS);
  setOrderColumnWidths_(ordersSheet, syncOrderHeaders_(ordersSheet, menu.map(function (m) { return m.name; })));
  arrangeSheets_(ss);

  var form = getOrCreateForm_(settings);
  buildForm_(form, settings, menu);
  installTriggers_(form.getId(), productionHour_(settings));
  ss.rename((settings['店名'] || 'サンプル店') + ' 注文管理');

  log_('設定', '初期設定を実行しました');
  SpreadsheetApp.getUi().alert('初期設定が終わりました 🎉\n\nご注文フォーム：\n' + form.getPublishedUrl() +
    '\n\n「設定」シートで店名や締め切りを変えられます。');
}

/** 設定やメニューを変えたあと、フォームを作り直す */
function updateForm() {
  var settings = readSettings_();
  var form = getOrCreateForm_(settings);
  var menu = readMenu_();
  buildForm_(form, settings, menu);
  syncOrderHeaders_(ensureSheet_(SHEET_ORDERS), menu.map(function (m) { return m.name; }));
  SpreadsheetApp.getUi().alert('フォームを更新しました。\n' + form.getPublishedUrl());
}

function showFormUrl() {
  var form = getOrCreateForm_(readSettings_());
  SpreadsheetApp.getUi().alert('ご注文フォーム：\n' + form.getPublishedUrl() + '\n\n編集画面：\n' + form.getEditUrl());
}

function ensureMenuSheet_() {
  var sheet = ensureSheet_(SHEET_MENU, ['商品名', '価格（税込）', '販売中']);
  if (sheet.getLastRow() === 1) {
    sheet.getRange(2, 1, DEFAULT_MENU.length, 3).setValues(DEFAULT_MENU);
  }
  // 使っている行＋20行ぶんだけ（シート全体に付けると空の行まで読むことになる）
  var rows = Math.min(sheet.getLastRow() - 1 + 20, sheet.getMaxRows() - 1);
  sheet.getRange(2, 3, rows, 1).insertCheckboxes();
  sheet.getRange(2, 2, rows, 1).setNumberFormat('#,##0"円"');
  sheet.setColumnWidth(1, 200);
}

/** シートの並び順をそろえ、最初からある空のシートを消す */
function arrangeSheets_(ss) {
  [SHEET_ORDERS, SHEET_PRODUCTION, SHEET_MENU, SHEET_SETTINGS, SHEET_LOG].forEach(function (name, i) {
    var sheet = ss.getSheetByName(name);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });
  ss.getSheets().forEach(function (sheet) {
    var known = [SHEET_ORDERS, SHEET_PRODUCTION, SHEET_MENU, SHEET_SETTINGS, SHEET_LOG];
    if (known.indexOf(sheet.getName()) === -1 && sheet.getLastRow() === 0) ss.deleteSheet(sheet);
  });
  ss.setActiveSheet(ss.getSheetByName(SHEET_ORDERS));
}

function getOrCreateForm_(settings) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FORM_ID');
  if (id) {
    try {
      return FormApp.openById(id);
    } catch (err) {
      log_('注意', '保存されていたフォームが開けなかったため、新しく作ります：' + err);
    }
  }
  var form = FormApp.create((settings['店名'] || 'サンプル店') + ' ご注文フォーム');
  props.setProperty('FORM_ID', form.getId());
  // 新しいフォームには送信のトリガーが無いので、ここで付け直す
  installTriggers_(form.getId(), productionHour_(settings));
  return form;
}

/** 製造数の集計時刻（0〜23の整数でなければ16時） */
function productionHour_(settings) {
  var hour = settingNumber_(settings, '製造数の集計時刻', 16);
  return hour === Math.floor(hour) && hour >= 0 && hour <= 23 ? hour : 16;
}

/** フォームの質問を設定とメニューから作り直す */
function buildForm_(form, settings, menu) {
  var shopName = settings['店名'] || 'サンプル店';
  var daysBefore = settingNumber_(settings, '締切_何日前', 1);
  var deadlineText = '受け取り日の' + daysBefore + '日前 ' + normalizeHm(settings['締切_時刻'] || '15:00') + ' まで';
  var closed = parseList(settings['定休日']);

  form.getItems().forEach(function (item) { form.deleteItem(item); });
  form.setTitle(shopName + ' ご注文フォーム')
    .setDescription('※これは架空のサンプル店です。実際の注文・お支払いは発生しません。\n\n' +
      '受付：' + deadlineText + '\n' +
      (closed.length ? '定休日：' + closed.join('・') + '曜日\n' : '') +
      'ご注文後、確認メールをお送りします。')
    .setConfirmationMessage('ご注文ありがとうございます。確認メールをお送りしましたので、内容をご確認ください。')
    .setAllowResponseEdits(false);

  form.addTextItem().setTitle(FIELD.name).setRequired(true);
  form.addTextItem().setTitle(FIELD.company);
  form.addTextItem().setTitle(FIELD.email).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail()
      .setHelpText('メールアドレスの形で入力してください').build());
  form.addTextItem().setTitle(FIELD.phone).setRequired(true);
  form.addMultipleChoiceItem().setTitle(FIELD.method).setRequired(true)
    .setChoiceValues(parseList(settings['受け取り方法']));
  form.addDateItem().setTitle(FIELD.date).setRequired(true).setHelpText(deadlineText);
  form.addListItem().setTitle(FIELD.time).setRequired(true)
    .setChoiceValues(parseList(settings['受け取り時間']));

  form.addSectionHeaderItem().setTitle('ご注文の商品')
    .setHelpText('個数を選んでください（選ばなかった商品は0個になります）');
  menu.forEach(function (item) {
    form.addListItem().setTitle(quantityTitle(item.name, item.price)).setChoiceValues(QTY_CHOICES);
  });
  form.addParagraphTextItem().setTitle(FIELD.note);
}

/** フォーム送信と毎日の集計のトリガーを登録し直す */
function installTriggers_(formId, hour) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onOrderSubmit', 'dailyProduction'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onOrderSubmit').forForm(formId).onFormSubmit().create();
  ScriptApp.newTrigger('dailyProduction').timeBased().everyDays(1).atHour(hour).inTimezone(TZ).create();
}
