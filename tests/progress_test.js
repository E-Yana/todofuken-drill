/**
 * progress.js の試験。実行: node tests/progress_test.js
 */
"use strict";
const assert = require("assert");
global.window = {};
require("../prefectures_data.js");
const P = require("../progress.js");
const PREFS = global.window.PREFECTURES;

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

const TODAY = "2026-10-25";
/** 履歴を作る（"o"/"x" を日付つきで並べる） */
function hist(results, date) {
  return results.split("").map((r) => ({ date: date || "2026-10-01", result: r }));
}
/** 固定の乱数（連番で 0以上1未満を返す） */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
const byId = (id) => PREFS.find((p) => p.id === id);

test("best_box_matches_replay", () => {
  assert.strictEqual(P.finalBox(hist("ooo")), 4);
  assert.strictEqual(P.finalBox(hist("oooooox")), 1);
  assert.strictEqual(P.finalBox(hist("oooooo")), 5);
  assert.strictEqual(P.finalBox([]), 1);
  assert.strictEqual(P.bestBox([]), 0);
});

test("best_box_never_drops_after_wrong", () => {
  assert.strictEqual(P.bestBox(hist("oooox")), 5);
  assert.ok(P.isStar(hist("oooxx")));
  assert.ok(!P.isStar(hist("ooxo")));
});

test("before_date_excludes_today", () => {
  const h = [...hist("ooo", "2026-10-24"), ...hist("o", TODAY)];
  assert.strictEqual(P.bestBox(h), 5);
  assert.strictEqual(P.bestBox(h, TODAY), 4);
  assert.strictEqual(P.bestBox(hist("o", TODAY), TODAY), 0);
});

test("skips_unknown_result", () => {
  const h = [...hist("oo"), { date: "2026-10-02", result: "?" }, null, ...hist("o")];
  assert.strictEqual(P.bestBox(h), 4);
  assert.strictEqual(P.finalBox(h), 4);
});

test("color_level_gold_needs_6_units", () => {
  const star = hist("ooo");
  const none = hist("x");
  const e6 = [[], [], [], [], [], []];
  assert.strictEqual(P.colorLevel(e6, []), 0);
  assert.strictEqual(P.colorLevel([none, [], [], [], [], []], []), 1);
  assert.strictEqual(P.colorLevel([star, none, [], [], [], []], []), 2);
  // 5単元が⭐でも金色にはならない
  assert.notStrictEqual(P.colorLevel([star, star, star, star, star, none], []), P.LEVEL_GOLD);
  assert.strictEqual(P.colorLevel([star, star, star, star, star, star], []), P.LEVEL_GOLD);
  // ⑦だけ出題済みでも「まなんだ」に数える
  assert.strictEqual(P.colorLevel(e6, [none]), 1);
  // 今日の分は before で除く
  assert.strictEqual(P.colorLevel([hist("ooo", TODAY), [], [], [], [], []], [], TODAY), 0);
});

test("gold_is_level7_and_5_units_is_level6", () => {
  const star = hist("ooo");
  const none = hist("x");
  assert.strictEqual(P.LEVEL_GOLD, 7);
  assert.strictEqual(P.colorLevel([star, star, star, star, star, none], []), 6);
});

test("keys_open_at_3_units", () => {
  const total = 47;
  const two = P.keyStatus({ 1: 47, 2: 47, 3: 40, 4: 10, 5: 0, 6: 0 }, total);
  assert.strictEqual(two.keys, 2);
  assert.strictEqual(two.unlocked, false);
  assert.strictEqual(two.remaining, 1);
  assert.deepStrictEqual(two.nearest, { step: 3, left: 7 });
  // 6単元のうち3つで開く（⑥が3つ目でもよい）
  const three = P.keyStatus({ 1: 47, 2: 47, 3: 10, 4: 10, 5: 0, 6: 47 }, total);
  assert.strictEqual(three.keys, 3);
  assert.strictEqual(three.unlocked, true);
  assert.strictEqual(three.nearest, null);
});

test("keys_six_units_one_complete_is_one_key", () => {
  const total = 47;
  // ⑥だけ47県そろうと鍵は1本。残りが同点（0県）なら番号の小さい単元が一番近い
  const one = P.keyStatus({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 47 }, total);
  assert.strictEqual(one.keys, 1);
  assert.strictEqual(one.remaining, 2);
  assert.deepStrictEqual(one.nearest, { step: 1, left: 47 });
});

test("combined_type_deterministic", () => {
  PREFS.forEach((p) => {
    for (let i = 0; i < 10; i++) {
      const t = P.combinedType(i, p.id);
      assert.strictEqual(t, P.combinedType(i, p.id));
      assert.ok(t >= 0 && t < P.COMBINED_TYPE_COUNT);
    }
  });
  const seen = new Set([0, 1, 2, 3, 4].map((i) => P.combinedType(i, "03")));
  assert.strictEqual(seen.size, P.COMBINED_TYPE_COUNT);
});

test("capital_choices_same_region", () => {
  const iwate = byId("03");
  for (let s = 1; s <= 20; s++) {
    const ds = P.capitalDistractors(iwate, PREFS, seeded(s));
    assert.strictEqual(ds.length, 2);
    ds.forEach((d) => assert.strictEqual(d.region, iwate.region));
  }
});

test("capital_choices_fallback_single_region", () => {
  const hokkaido = byId("01");
  const ds = P.capitalDistractors(hokkaido, PREFS, seeded(7));
  assert.strictEqual(ds.length, 2);
  ds.forEach((d) => assert.notStrictEqual(d.region, hokkaido.region));
});

test("capital_choices_unique", () => {
  PREFS.forEach((p) => {
    for (let s = 1; s <= 5; s++) {
      const ds = P.capitalDistractors(p, PREFS, seeded(s));
      const texts = [P.capitalDisplay(p), ...ds.map(P.capitalDisplay)];
      assert.strictEqual(new Set(texts).size, 3);
    }
  });
});

test("tokyo_no_city_suffix", () => {
  assert.strictEqual(P.capitalDisplay(byId("13")), "東京");
  assert.strictEqual(P.capitalDisplay(byId("03")), "盛岡市");
  assert.strictEqual(P.capitalWithReading(byId("03")), "盛岡（もりおか）市");
  assert.strictEqual(P.capitalWithReading(byId("13")), "東京（とうきょう）");
});

test("capital_tier_18", () => {
  assert.strictEqual(PREFS.filter((p) => P.capitalTier(p) === 0).length, 18);
  assert.strictEqual(P.capitalTier(byId("03")), 0);
  assert.strictEqual(P.capitalTier(byId("02")), 1);
});

test("capital_kana_only_is_saitama_only", () => {
  const kana = PREFS.filter((p) => P.capitalIsKanaOnly(p));
  assert.deepStrictEqual(kana.map((p) => p.id), ["11"]);
  assert.strictEqual(P.capitalIsKanaOnly(byId("03")), false);
});

test("same_kanji_note_for_29", () => {
  const same = PREFS.filter((p) => P.capitalSharesKanji(p));
  assert.strictEqual(same.length, 29);
  assert.ok(same.some((p) => p.id === "13")); // 東京都を含む
  same.forEach((p) => assert.strictEqual(p.capitalDiffers, false));
  assert.strictEqual(P.capitalSharesKanji(byId("11")), false); // さいたまは添えない
});

test("newly_mastered_today", () => {
  const histories = [
    [...hist("oo", "2026-10-24"), ...hist("o", TODAY)], // 今日はじめて箱4 -> 数える
    hist("ooo", "2026-10-20"), // 前から⭐ -> 数えない
    hist("o", TODAY), // まだ⭐でない -> 数えない
    [...hist("ooo", "2026-10-20"), ...hist("x", TODAY)], // 前から⭐ -> 数えない
  ];
  assert.strictEqual(P.newlyMasteredCount(histories, TODAY), 1);
  // 同じ日の2回目でも結果は変わらない（今日より前だけで比べる）
  assert.strictEqual(P.newlyMasteredCount(histories, TODAY), 1);
});

if (failed > 0) {
  console.log(failed + " 件失敗");
  process.exit(1);
}
console.log("すべて成功");
