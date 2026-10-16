/**
 * backup.js の試験。実行: node tests/backup_test.js
 */
"use strict";
const assert = require("assert");
const B = require("../backup.js");

const APP_ID = "todofuken-drill";
const STORE_KEY = "todofukenDrill_v1";
const PREFIX = "todofukenDrill_v1_restore_";
const D1 = "2026-10-17";

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed += 1;
    console.log("FAIL " + name + "\n" + e.stack);
  }
}

/** localStorage の代わりになる簡易ストレージ。 */
function fakeStorage(init, opts) {
  const m = new Map(Object.entries(init || {}));
  const o = opts || {};
  return {
    get length() {
      return m.size;
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (o.failSet) throw new Error("quota");
      m.set(k, o.corruptOnSet ? v + "x" : v);
    },
    removeItem: (k) => m.delete(k),
    keys: () => Array.from(m.keys()),
  };
}

const sampleStore = () => ({
  imported: [{ id: "m-1", prompt: "目を{__}ます", answer: "覚", word: "覚ます" }],
  progress: { "k-1": { box: 2, wrongCount: 1 }, "v-1": { box: 4, wrongCount: 0 } },
  meta: { streak: 3, lastStudyDate: D1, inboxSeen: ["m-1"], settings: { dailyCount: 10 } },
  session: null,
});

test("往復で store が一致する", () => {
  const st = sampleStore();
  const text = JSON.stringify(B.buildBackup({ appId: APP_ID, appVersion: "v16", today: D1, summary: {}, state: st }));
  const r = B.parseBackup(text, APP_ID);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.legacy, false);
  assert.deepStrictEqual(r.state, st);
});

test("旧形式（生の store）が legacy として戻る", () => {
  const st = sampleStore();
  const r = B.parseBackup(JSON.stringify(st), APP_ID);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.legacy, true);
  assert.deepStrictEqual(r.state, st);
});

test("壊れた JSON・別アプリ・format違い・progress不正を拒否", () => {
  const good = B.buildBackup({ appId: APP_ID, appVersion: "v16", today: D1, summary: {}, state: sampleStore() });
  assert.strictEqual(B.parseBackup("{broken", APP_ID).ok, false);
  assert.strictEqual(B.parseBackup("[]", APP_ID).ok, false);
  assert.strictEqual(B.parseBackup(JSON.stringify({ ...good, app: "tani-drill" }), APP_ID).ok, false);
  assert.strictEqual(B.parseBackup(JSON.stringify({ ...good, format: 2 }), APP_ID).ok, false);
  const bad = (mut) => {
    const st = sampleStore();
    mut(st);
    return B.parseBackup(JSON.stringify(st), APP_ID).ok;
  };
  assert.strictEqual(bad((s) => (s.progress = [])), false);
  assert.strictEqual(bad((s) => (s.progress["k-1"].box = "2")), false);
  assert.strictEqual(bad((s) => (s.progress["k-1"] = null)), false);
  assert.strictEqual(bad((s) => (s.imported = {})), false);
  assert.strictEqual(bad((s) => (s.sessions = [])), false);
  assert.strictEqual(bad((s) => (s.meta = "x")), false);
  assert.strictEqual(B.parseBackup(JSON.stringify({ foo: 1 }), APP_ID).ok, false);
});

test("ファイル名に日付とアプリ名が入る", () => {
  assert.strictEqual(B.backupFileName(APP_ID, D1), "todofuken_drill_backup_2026-10-17.json");
  assert.strictEqual(B.backupFileName("todofuken-drill", D1), "todofuken_drill_backup_2026-10-17.json");
});

test("現記録が無ければ退避しない", () => {
  const s = fakeStorage();
  const r = B.archiveCurrentRecord(s, STORE_KEY, PREFIX, D1);
  assert.deepStrictEqual(r, { ok: true, skipped: true });
  assert.deepStrictEqual(s.keys(), []);
});

test("退避は生文字列をそのまま別キーへ（重複時は _2, _3）", () => {
  const s = fakeStorage({ [STORE_KEY]: '{"progress":{}}' });
  const r1 = B.archiveCurrentRecord(s, STORE_KEY, PREFIX, D1);
  const r2 = B.archiveCurrentRecord(s, STORE_KEY, PREFIX, D1);
  assert.strictEqual(r1.key, PREFIX + D1);
  assert.strictEqual(r2.key, PREFIX + D1 + "_2");
  assert.strictEqual(s.getItem(r1.key), '{"progress":{}}');
});

test("退避の書き込み失敗・読み戻し不一致は中止（既存記録はそのまま）", () => {
  const raw = '{"progress":{}}';
  const s1 = fakeStorage({ [STORE_KEY]: raw }, { failSet: true });
  assert.strictEqual(B.archiveCurrentRecord(s1, STORE_KEY, PREFIX, D1).ok, false);
  assert.strictEqual(s1.getItem(STORE_KEY), raw);
  const s2 = fakeStorage({ [STORE_KEY]: raw }, { corruptOnSet: true });
  assert.strictEqual(B.archiveCurrentRecord(s2, STORE_KEY, PREFIX, D1).ok, false);
  assert.strictEqual(s2.getItem(STORE_KEY), raw);
  assert.deepStrictEqual(s2.keys(), [STORE_KEY]);
});

test("退避キーは新しい2本だけ残る（3回復元しても2本）", () => {
  const s = fakeStorage({ [STORE_KEY]: '{"progress":{}}' });
  ["2026-10-15", "2026-10-16", D1, D1].forEach((d) => B.archiveCurrentRecord(s, STORE_KEY, PREFIX, d));
  const keys = B.listArchiveKeys(s, PREFIX);
  assert.deepStrictEqual(keys, [PREFIX + D1 + "_2", PREFIX + D1]);
  assert.ok(s.getItem(STORE_KEY) !== null);
});

if (failed > 0) {
  console.log(failed + " 件失敗");
  process.exit(1);
}
console.log("すべて成功");
