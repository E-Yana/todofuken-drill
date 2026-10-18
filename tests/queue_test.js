/**
 * queue.js の試験。実行: node tests/queue_test.js
 */
"use strict";
const assert = require("assert");
const Q = require("../queue.js");

const TODAY = "2026-10-19";
const OLD = "2026-10-01";
const FUTURE = "2026-11-30";

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

let seq = 0;
/** 期限切れの復習カード（箱・期限などを上書きできる）。 */
function due(box, extra) {
  seq += 1;
  return Object.assign(
    { id: "d" + seq, box: box, dueDate: OLD, wrongCount: 0, tier: 1, idx: seq, seen: true },
    extra || {}
  );
}
/** 未出題カード。 */
function fresh(extra) {
  seq += 1;
  return Object.assign(
    { id: "n" + seq, box: 1, dueDate: TODAY, wrongCount: 0, tier: 1, idx: seq, seen: false },
    extra || {}
  );
}
function many(n, make) {
  return Array.from({ length: n }, () => make());
}
const OPTS = { today: TODAY, daily: 10, newMin: 2, newTarget: 3, masteredCap: 3 };
function run(items, o) {
  const ids = Q.composeDaily(items, Object.assign({}, OPTS, o || {}));
  const byId = new Map(items.map((x) => [x.id, x]));
  const rows = ids.map((id) => byId.get(id));
  return {
    ids: ids,
    weak: rows.filter((x) => x.seen && x.box <= 3).length,
    mastered: rows.filter((x) => x.seen && x.box >= 4).length,
    fresh: rows.filter((x) => !x.seen).length,
  };
}

test("定着が溢れても新出が最低数入る", () => {
  const r = run([...many(30, () => due(5)), ...many(10, fresh)]);
  assert.ok(r.fresh >= OPTS.newMin);
});

test("苦手が多い日も新出が最低数・定着が1問入る", () => {
  const r = run([...many(20, () => due(1)), ...many(5, () => due(5)), ...many(5, fresh)]);
  assert.ok(r.fresh >= OPTS.newMin);
  assert.ok(r.mastered >= 1);
  assert.strictEqual(r.ids.length, OPTS.daily);
});

test("定着が上限を超えない（新出が残っている時）", () => {
  const r = run([...many(30, () => due(5)), ...many(30, fresh)]);
  assert.ok(r.mastered <= OPTS.masteredCap);
});

test("余った枠は新出で埋まる", () => {
  const r = run([...many(1, () => due(1)), ...many(3, () => due(5)), ...many(20, fresh)]);
  assert.deepStrictEqual([r.weak, r.mastered, r.fresh], [1, 3, 6]);
});

test("未出題の優先は新出の先頭に並ぶ", () => {
  const normal = many(5, fresh);
  const pri = fresh({ tier: 0, idx: 999 });
  const r = run([...normal, pri]);
  const firstFresh = r.ids.find((id) => id.startsWith("n"));
  assert.strictEqual(firstFresh, pri.id);
});

test("箱5の優先語は定着として数える", () => {
  const items = [...many(10, () => due(5, { tier: 0 })), ...many(10, fresh)];
  const r = run(items);
  assert.strictEqual(r.weak, 0);
  assert.ok(r.mastered <= OPTS.masteredCap);
});

test("新出が尽きたら定着で埋まり枠がそろう", () => {
  const r = run(many(30, () => due(5)));
  assert.strictEqual(r.ids.length, OPTS.daily);
  assert.strictEqual(r.fresh, 0);
});

test("枠に入らない定着は古い順に選ばれる", () => {
  const olds = [due(5, { dueDate: "2026-09-01" }), due(5, { dueDate: "2026-09-02" }), due(5, { dueDate: "2026-09-03" })];
  const newer = many(10, () => due(5, { dueDate: "2026-10-10" }));
  const r = run([...newer, ...olds, ...many(20, fresh)]);
  olds.forEach((o) => assert.ok(r.ids.includes(o.id)));
  assert.strictEqual(r.mastered, OPTS.masteredCap);
});

test("D問を超えない", () => {
  const r = run([...many(30, () => due(1)), ...many(30, () => due(5)), ...many(30, fresh)]);
  assert.strictEqual(r.ids.length, OPTS.daily);
  assert.strictEqual(new Set(r.ids).size, r.ids.length);
});

test("期限が未来の復習は出ない", () => {
  const r = run([...many(5, () => due(2, { dueDate: FUTURE })), ...many(3, fresh)]);
  assert.strictEqual(r.weak, 0);
  assert.strictEqual(r.ids.length, 3);
});

if (failed > 0) {
  console.log(failed + " 件失敗");
  process.exit(1);
}
console.log("すべて成功");
