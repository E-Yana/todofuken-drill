/**
 * 1日の出題の配分（DOM・store・window に触れない純関数だけ）。
 * ブラウザでは window.DrillQueue、node では module.exports に公開する。
 * 漢字ドリルと都道府県ドリルは独立リポジトリのため、同じ内容のファイルを両方に置く（ずれたら両方直す）。
 */
(function (root) {
  "use strict";

  // ---- 定数 ----
  var WEAK_MAX_BOX = 3; // 苦手＝期限が来た復習のうち、この箱以下
  var MASTERED_MIN_COUNT = 1; // 定着を最低でも残す問数（在庫がある時）

  /** 苦手の並び：優先層→箱小→間違い多い→元の順。 */
  function compareWeak(a, b) {
    return a.tier - b.tier || a.box - b.box || b.wrongCount - a.wrongCount || a.idx - b.idx;
  }

  /** 定着の並び：期限が古い→間違い多い→元の順。日付は "YYYY-MM-DD" の文字列比較。 */
  function compareMastered(a, b) {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return b.wrongCount - a.wrongCount || a.idx - b.idx;
  }

  /** 新出の並び：優先層（tier0）が先頭→元の順。 */
  function compareFresh(a, b) {
    return a.tier - b.tier || a.idx - b.idx;
  }

  /**
   * 1日の出題IDの配列を返す（表示順は 苦手→定着→新出）。
   * items: [{id, box, dueDate, wrongCount, tier, idx, seen}]
   * opts : {today, daily, newMin, newTarget, masteredCap}
   * 配る順：①新出の最低数＋定着1問 ②苦手 ③新出を目標数まで ④定着を上限まで
   *         ⑤余りは新出で埋め、それでも余れば定着で埋める（空にしない）
   */
  function composeDaily(items, opts) {
    var weak = items
      .filter(function (x) { return x.seen && x.dueDate <= opts.today && x.box <= WEAK_MAX_BOX; })
      .sort(compareWeak);
    var mastered = items
      .filter(function (x) { return x.seen && x.dueDate <= opts.today && x.box > WEAK_MAX_BOX; })
      .sort(compareMastered);
    var fresh = items.filter(function (x) { return !x.seen; }).sort(compareFresh);

    var left = opts.daily;
    var nWeak = 0;
    var nMastered = 0;
    var nFresh = 0;

    /** 在庫と残り枠の範囲で、want 件までその山から追加で取る。 */
    function take(pileLength, taken, want) {
      var add = Math.max(0, Math.min(want - taken, pileLength - taken, left));
      left -= add;
      return taken + add;
    }

    nFresh = take(fresh.length, nFresh, opts.newMin);
    nMastered = take(mastered.length, nMastered, MASTERED_MIN_COUNT);
    nWeak = take(weak.length, nWeak, weak.length);
    nFresh = take(fresh.length, nFresh, opts.newTarget);
    nMastered = take(mastered.length, nMastered, opts.masteredCap);
    nFresh = take(fresh.length, nFresh, fresh.length);
    nMastered = take(mastered.length, nMastered, mastered.length);

    return []
      .concat(weak.slice(0, nWeak), mastered.slice(0, nMastered), fresh.slice(0, nFresh))
      .map(function (x) { return x.id; });
  }

  var api = { composeDaily: composeDaily };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DrillQueue = api;
  }
})(typeof window !== "undefined" ? window : this);
