/**
 * 最高到達段階・ぬりえの色・⑥の鍵・⑤の選択肢など、進み具合まわりの純関数（DOM・store・window に触れない）。
 * ブラウザでは window.DrillProgress、node では module.exports に公開する。
 * 乱数は引数（rand）で受けるので、試験では固定の乱数を渡せる。
 */
(function (root) {
  "use strict";

  // ---- 定数 ----
  var MAX_BOX = 5; // 箱の上限（app.js の MAX_BOX と同じ）
  var START_BOX = 1; // 新規カードの箱
  var STAR_MIN_BOX = 4; // ⭐（マスター）とみなす箱
  var RESULT_OK = "o"; // 履歴の正解
  var RESULT_NG = "x"; // 履歴の不正解
  var COLOR_UNIT_COUNT = 5; // ぬりえと鍵の対象になる単元の数（①〜⑤）
  var KEYS_REQUIRED = 3; // ⑥が開くのに必要な鍵（⭐が全県そろった単元）の数
  var LEVEL_UNTOUCHED = 0; // 未学習
  var LEVEL_TOUCHED = 1; // まなんだ（どこかで出題済み）
  var LEVEL_GOLD = LEVEL_TOUCHED + COLOR_UNIT_COUNT; // 5単元とも⭐＝金色
  var COMBINED_TYPE_COUNT = 5; // ⑥の問題の種類の数
  var COMBINED_TYPES = { READING: 0, MAP: 1, REGION: 2, CAPITAL: 3, REVERSE: 4 }; // ⑥の問題の種類
  var CAPITAL_CHOICE_DISTRACTORS = 2; // ⑤の誤答の数（3択）
  var CITY_SUFFIX = "市"; // 県庁所在地の表示に付ける語
  var NO_CITY_SUFFIX_IDS = ["13"]; // 「市」を付けない県（東京都）
  var TIER_PRIORITY = 0; // 重点（県庁所在地の漢字が県名と違う県）
  var TIER_NORMAL = 1; // 通常
  var ID_RADIX = 10; // 県番号の基数

  /** 履歴の1件が正解/不正解のどちらかか（壊れた記録は飛ばすための判定） */
  function isKnownResult(entry) {
    return !!entry && (entry.result === RESULT_OK || entry.result === RESULT_NG);
  }

  /**
   * 履歴を頭から再生して、最後の箱と途中の最高の箱を返す（recordAnswer と同じ規則）。
   * beforeDate を渡すと、その日より前の履歴だけを使う。履歴が無ければ best は 0（未学習）。
   * 正解でも不正解でもない記録は、その1件だけ飛ばす。
   */
  function replay(history, beforeDate) {
    var box = START_BOX;
    var best = 0;
    (history || []).forEach(function (entry) {
      if (!isKnownResult(entry)) return;
      if (beforeDate && !(entry.date < beforeDate)) return;
      box = entry.result === RESULT_OK ? Math.min(box + 1, MAX_BOX) : START_BOX;
      best = Math.max(best, box);
    });
    return { final: best === 0 ? START_BOX : box, best: best };
  }

  /** 一度でも到達した最高の箱（beforeDate より前だけで計算できる）。履歴なしは 0 */
  function bestBox(history, beforeDate) {
    return replay(history, beforeDate).best;
  }

  /** 履歴を再生した最後の箱（保存済みの box と一致するはずの値） */
  function finalBox(history) {
    return replay(history).final;
  }

  /** 最高段階が⭐（箱4以上）か */
  function isStar(history, beforeDate) {
    return bestBox(history, beforeDate) >= STAR_MIN_BOX;
  }

  /**
   * 県1つのぬりえの段階（0=未学習／1=まなんだ／2〜5=⭐の単元が1〜4つ／6=5単元とも⭐の金色）。
   * colorHistories: ①〜⑤の履歴の配列、extraHistories: それ以外（⑥）の履歴の配列。
   * beforeDate を渡すと、その日より前の履歴だけで決める。
   */
  function colorLevel(colorHistories, extraHistories, beforeDate) {
    var stars = colorHistories.filter(function (h) { return isStar(h, beforeDate); }).length;
    var all = colorHistories.concat(extraHistories || []);
    var touched = all.some(function (h) { return bestBox(h, beforeDate) > 0; });
    if (!touched) return LEVEL_UNTOUCHED;
    return stars >= COLOR_UNIT_COUNT ? LEVEL_GOLD : LEVEL_TOUCHED + stars;
  }

  /**
   * ⑥の鍵の状態。starCounts: 単元番号 -> ⭐の県数、total: 県の総数。
   * 戻り値: {keys, remaining, unlocked, nearest}。nearest は鍵まであと少しの単元 {step, left}（無ければ null）
   */
  function keyStatus(starCounts, total) {
    var steps = Object.keys(starCounts).map(Number);
    var keys = steps.filter(function (s) { return starCounts[s] >= total; }).length;
    var open = steps
      .filter(function (s) { return starCounts[s] < total; })
      .sort(function (a, b) { return starCounts[b] - starCounts[a] || a - b; });
    var nearest = open.length ? { step: open[0], left: total - starCounts[open[0]] } : null;
    var unlocked = keys >= KEYS_REQUIRED;
    return {
      keys: keys,
      remaining: Math.max(0, KEYS_REQUIRED - keys),
      unlocked: unlocked,
      nearest: unlocked ? null : nearest,
    };
  }

  /** ⑥の問題の種類（出題の何問目か＋県番号 を種類数で割った余り。保存せず毎回同じ値になる） */
  function combinedType(index, prefId) {
    return (index + parseInt(prefId, ID_RADIX)) % COMBINED_TYPE_COUNT;
  }

  /** 配列をシャッフルした新しい配列を返す（rand は 0以上1未満を返す関数） */
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /** 県庁所在地の表示の部品（盛岡／もりおか／市）。東京都だけ「市」が付かない */
  function capitalParts(pref) {
    var suffix = NO_CITY_SUFFIX_IDS.indexOf(pref.id) >= 0 ? "" : CITY_SUFFIX;
    return { base: pref.capital, reading: pref.capitalReading, suffix: suffix };
  }

  /** 県庁所在地の表示名（例: 盛岡市／東京） */
  function capitalDisplay(pref) {
    var p = capitalParts(pref);
    return p.base + p.suffix;
  }

  /** 答え合わせ用の表示（例: 盛岡（もりおか）市） */
  function capitalWithReading(pref) {
    var p = capitalParts(pref);
    return p.base + "（" + p.reading + "）" + p.suffix;
  }

  /**
   * ⑤の誤答になる県を2つ返す。同じ地方の別の県から選び、足りなければ全国から補う。
   * 正解と同じ表示の所在地・誤答同士の重複はさせない。
   */
  function capitalDistractors(pref, prefectures, rand) {
    var others = prefectures.filter(function (p) {
      return p.id !== pref.id && capitalDisplay(p) !== capitalDisplay(pref);
    });
    var same = shuffle(others.filter(function (p) { return p.region === pref.region; }), rand);
    var far = shuffle(others.filter(function (p) { return p.region !== pref.region; }), rand);
    var picked = [];
    var seen = {};
    same.concat(far).forEach(function (p) {
      var key = capitalDisplay(p);
      if (picked.length >= CAPITAL_CHOICE_DISTRACTORS || seen[key]) return;
      seen[key] = true;
      picked.push(p);
    });
    return picked;
  }

  /** ⑤の重点の層（県庁所在地の漢字が県名と違う県が先） */
  function capitalTier(pref) {
    return pref.capitalDiffers ? TIER_PRIORITY : TIER_NORMAL;
  }

  /**
   * 「今日より前の履歴では最高段階が箱4未満、今は箱4以上」の履歴の数（きょう新しくマスターした数）。
   * histories: 県ごとの履歴の配列の配列。
   */
  function newlyMasteredCount(histories, today) {
    return histories.filter(function (h) {
      return !isStar(h, today) && isStar(h);
    }).length;
  }

  var api = {
    bestBox: bestBox,
    finalBox: finalBox,
    isStar: isStar,
    colorLevel: colorLevel,
    keyStatus: keyStatus,
    combinedType: combinedType,
    COMBINED_TYPES: COMBINED_TYPES,
    COMBINED_TYPE_COUNT: COMBINED_TYPE_COUNT,
    KEYS_REQUIRED: KEYS_REQUIRED,
    LEVEL_GOLD: LEVEL_GOLD,
    capitalParts: capitalParts,
    capitalDisplay: capitalDisplay,
    capitalWithReading: capitalWithReading,
    capitalDistractors: capitalDistractors,
    capitalTier: capitalTier,
    newlyMasteredCount: newlyMasteredCount,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DrillProgress = api;
  }
})(typeof window !== "undefined" ? window : this);
