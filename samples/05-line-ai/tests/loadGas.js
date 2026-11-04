// .gs ファイルを node で読み込むための小さな仕組みと、GAS のにせもの（テスト専用）
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

/** src の .gs を1つの環境に読み込む（GAS と同じく、全ファイルが同じグローバルを共有する） */
function loadGas(files, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), context, { filename: f }));
  return context;
}

// ---- ここから GAS のにせもの ----

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    if (this.row === null) return [];
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((r) => r.length !== this.cols)) {
      throw new Error(`範囲の大きさが合いません: ${this.rows}x${this.cols} に ${values.length}x${values[0] && values[0].length}`);
    }
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      line.forEach((v, c) => { this.sheet.data[idx][this.col - 1 + c] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() {
    for (let r = 0; r < this.rows; r++) {
      const line = this.sheet.data[this.row - 1 + r];
      if (line) for (let c = 0; c < this.cols; c++) line[this.col - 1 + c] = '';
    }
    return this;
  }
  setFontWeight() { return this; }
  setFontSize() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
  insertCheckboxes() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    return this.data.reduce((max, row) => {
      let last = 0;
      (row || []).forEach((v, i) => { if (v !== '' && v !== undefined) last = i + 1; });
      return Math.max(max, last);
    }, 0);
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return new FakeRange(this, null);
    if (a < 1 || b < 1 || (c !== undefined && c < 1) || (d !== undefined && d < 1)) {
      throw new Error(`範囲が正しくありません: ${a},${b},${c},${d}`);
    }
    // 本物と同じく、シートの行数を超える範囲はエラー
    if (a + (c || 1) - 1 > this.maxRows) throw new Error('範囲の座標がシートの外です');
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  appendRow(values) {
    if (this.getLastRow() + 1 > this.maxRows) this.maxRows += 1;
    new FakeRange(this, this.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  }
  insertColumnBefore(col) { this.data.forEach((row) => row && row.splice(col - 1, 0, '')); }
  deleteRows(start, n) { this.data.splice(start - 1, n); }
  clear() { this.data = []; }
  setFrozenRows() {}
  setColumnWidth() {}
}

function chain(record) {
  const obj = new Proxy({}, {
    get(_, prop) {
      return (...args) => {
        record.push([prop, ...args]);
        if (prop === 'build') return {};
        return obj;
      };
    }
  });
  return obj;
}

function formatDate(date, _tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

/** GAS のサービスのにせものをまとめて作る */
function createFakeGas() {
  const sheets = [new FakeSheet('シート1')];
  const ss = {
    getId: () => 'ss1',
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    setActiveSheet(s) { this.active = s; return s; },
    moveActiveSheet(pos) { sheets.splice(sheets.indexOf(this.active), 1); sheets.splice(pos - 1, 0, this.active); },
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    rename(n) { this.name = n; },
    setSpreadsheetTimeZone(tz) { this.timeZone = tz; }
  };
  const sent = [];
  const props = {};
  const cache = {};
  const calendars = {};
  let uuid = 0;
  function makeCalendar(name) {
    const id = 'cal-' + (Object.keys(calendars).length + 1);
    const events = [];
    let nextEvent = 1;
    const cal = {
      events,
      getId: () => id,
      getName: () => name,
      setTimeZone(tz) { this.timeZone = tz; return this; },
      createEvent: (title, start, end, opts) => {
        const ev = {
          id: 'ev-' + nextEvent++, title, start, end, description: (opts || {}).description || '',
          getId() { return this.id; },
          getTitle() { return this.title; },
          getStartTime() { return this.start; },
          getEndTime() { return this.end; },
          getDescription() { return this.description; },
          isAllDayEvent: () => false,
          deleteEvent() { events.splice(events.indexOf(this), 1); }
        };
        events.push(ev);
        return ev;
      },
      getEvents: (s, e) => events.filter((ev) => ev.start.getTime() < e.getTime() && ev.end.getTime() > s.getTime()),
      getEventById: (eid) => events.find((ev) => ev.id === eid) || null
    };
    calendars[id] = cal;
    return cal;
  }
  const html = { template: null, title: null };
  const triggers = [];
  const formItems = [];
  const form = {
    getId: () => 'form1',
    getItems: () => formItems.slice(),
    deleteItem: (it) => formItems.splice(formItems.indexOf(it), 1),
    getPublishedUrl: () => 'https://example.com/form',
    getEditUrl: () => 'https://example.com/form/edit'
  };
  ['setTitle', 'setDescription', 'setConfirmationMessage', 'setAllowResponseEdits'].forEach((m) => {
    form[m] = () => form;
  });
  ['addTextItem', 'addMultipleChoiceItem', 'addDateItem', 'addListItem', 'addSectionHeaderItem',
    'addParagraphTextItem'].forEach((m) => {
    form[m] = () => { const rec = [m]; formItems.push(rec); return chain(rec); };
  });

  const ui = {
    alert: () => 'OK',
    prompt: () => ({ getSelectedButton: () => ui.nextButton || 'OK', getResponseText: () => ui.nextText || '' }),
    ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'OK' },
    createMenu: () => chain([])
  };

  const fake = {
    ui, ss, sheets, sent, props, triggers, formItems, cache, html, calendars, quota: 100, activeUser: 'shop@example.com',
    fetches: [],
    fetchHandler: () => ({ code: 200, body: {} }),
    globals: {
      SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, getUi: () => ui },
      FormApp: {
        create: () => form,
        openById: () => form,
        createTextValidation: () => chain([])
      },
      ScriptApp: {
        getService: () => ({ getUrl: () => 'https://example.com/exec' }),
        getProjectTriggers: () => triggers.slice(),
        deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
        newTrigger: (name) => {
          const rec = [];
          const c = chain(rec);
          const uid = 'uid-' + (triggers.length + 1) + '-' + name;
          triggers.push({ getHandlerFunction: () => name, getUniqueId: () => uid, rec });
          return c;
        }
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => (k in props ? props[k] : null),
          setProperty: (k, v) => { props[k] = v; },
          deleteProperty: (k) => { delete props[k]; }
        })
      },
      Session: {
        getEffectiveUser: () => ({ getEmail: () => 'shop@example.com' }),
        getActiveUser: () => ({ getEmail: () => fake.activeUser })
      },
      MailApp: {
        sendEmail: (a, b, c) => {
          const mail = typeof a === 'object' ? a : { to: a, subject: b, body: c };
          if (fake.failTo && fake.failTo.test(mail.subject + ' ' + mail.body)) throw new Error('送信できない宛先です');
          sent.push(mail);
        },
        getRemainingDailyQuota: () => fake.quota - sent.length
      },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      UrlFetchApp: {
        fetch: (url, opts) => {
          fake.fetches.push({ url, opts, body: opts && opts.payload ? JSON.parse(opts.payload) : null });
          const r = fake.fetchHandler(url, opts);
          return {
            getResponseCode: () => r.code,
            getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
          };
        }
      },
      CacheService: {
        getScriptCache: () => ({
          get: (k) => (k in cache ? cache[k] : null),
          put: (k, v) => { cache[k] = String(v); },
          remove: (k) => { delete cache[k]; }
        })
      },
      HtmlService: {
        createTemplateFromFile: (name) => {
          const t = {
            name,
            evaluate: () => {
              html.template = t;
              const out = { setTitle: (x) => { html.title = x; return out; }, addMetaTag: () => out };
              return out;
            }
          };
          return t;
        }
      },
      Utilities: { formatDate, getUuid: () => 'uuid-' + String(++uuid).padStart(8, '0') + '-0000-0000-000000000000' },
      CalendarApp: {
        createCalendar: (name) => makeCalendar(name),
        getCalendarById: (id) => calendars[id] || null
      }
    }
  };
  return fake;
}

const ALL_FILES = ['Logic.gs', 'Common.gs', 'Api.gs', 'Line.gs', 'Setup.gs', 'Sample.gs'];

module.exports = { loadGas, createFakeGas, ALL_FILES };
