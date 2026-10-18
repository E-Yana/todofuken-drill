/**
 * バックアップ兼きろく（DOM に触れない純関数だけ）。
 * ブラウザでは window.DrillBackup、node では module.exports に公開する。
 * 参照実装は tani_drill/logic.js の buildBackup / parseBackup / backupFileName。
 * 漢字ドリルと都道府県ドリルは独立リポジトリのため、同じ内容のファイルを両方に置く（ずれたら両方直す）。
 */
(function (root) {
  "use strict";

  // ---- 定数 ----
  var BACKUP_FORMAT = 1;
  var BACKUP_KEEP = 2; // 置換前の退避キーを残す本数（新しい順）
  var ARCHIVE_FIRST_SUFFIX = 2; // 同じ日の2本目の退避キーに付ける番号（_2, _3…）
  var ARCHIVE_SUFFIX_SEP = "_";

  /** プレーンなオブジェクトか（配列・null は除く）。 */
  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /** 復元用の state と、読むための summary を1つにまとめる。 */
  function buildBackup(opts) {
    return {
      app: opts.appId,
      format: BACKUP_FORMAT,
      exportedAt: opts.today,
      appVersion: opts.appVersion,
      summary: opts.summary,
      state: opts.state,
    };
  }

  /** 各カードが「box が数値のオブジェクト」かを確かめる。 */
  function cardsLookValid(progress) {
    return Object.keys(progress).every(function (id) {
      var c = progress[id];
      return isPlainObject(c) && typeof c.box === "number" && isFinite(c.box);
    });
  }

  /** store の形を確かめる（progress 必須。imported/sessions/meta は存在すれば型を見る）。 */
  function storeLooksValid(st) {
    if (!isPlainObject(st) || !isPlainObject(st.progress)) return false;
    if (!cardsLookValid(st.progress)) return false;
    if (st.imported !== undefined && !Array.isArray(st.imported)) return false;
    if (st.sessions !== undefined && !isPlainObject(st.sessions)) return false;
    if (st.meta !== undefined && !isPlainObject(st.meta)) return false;
    return true;
  }

  /**
   * バックアップ文字列を検証して state（store 全体）を取り出す。
   * 新形式は app 一致＋format===1。旧形式（app が無く progress を持つ生の store）も legacy として受理する。
   * 戻り値: { ok: true, state, legacy } または { ok: false, reason }
   */
  function parseBackup(text, appId) {
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: "json" };
    }
    if (!isPlainObject(obj)) return { ok: false, reason: "app" };
    var state;
    var legacy = false;
    if (obj.app === undefined && isPlainObject(obj.progress)) {
      state = obj;
      legacy = true;
    } else if (obj.app === appId) {
      if (obj.format !== BACKUP_FORMAT) return { ok: false, reason: "format" };
      state = obj.state;
    } else {
      return { ok: false, reason: "app" };
    }
    if (!storeLooksValid(state)) return { ok: false, reason: "state" };
    return { ok: true, state: state, legacy: legacy };
  }

  /** バックアップのファイル名（例: kanji_drill_backup_2026-10-17.json）。 */
  function backupFileName(appId, today) {
    return appId.replace(/-/g, "_") + "_backup_" + today + ".json";
  }

  /** storage に重ならない退避キー（_2, _3…）を返す。 */
  function uniqueArchiveKey(storage, base) {
    var key = base;
    var n = ARCHIVE_FIRST_SUFFIX;
    while (storage.getItem(key) !== null) {
      key = base + ARCHIVE_SUFFIX_SEP + n;
      n += 1;
    }
    return key;
  }

  /** 退避キーの並べ替え用に「日付」と「同日の連番」へ分ける。 */
  function archiveOrder(key, prefix) {
    var rest = key.slice(prefix.length);
    var parts = rest.split(ARCHIVE_SUFFIX_SEP);
    return { date: parts[0], n: parts.length > 1 ? parseInt(parts[1], 10) || 0 : 1 };
  }

  /** prefix を持つ退避キーを新しい順に並べて返す。 */
  function listArchiveKeys(storage, prefix) {
    var keys = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (k !== null && k.indexOf(prefix) === 0) keys.push(k);
    }
    return keys.sort(function (a, b) {
      var oa = archiveOrder(a, prefix);
      var ob = archiveOrder(b, prefix);
      if (oa.date !== ob.date) return oa.date < ob.date ? 1 : -1;
      return ob.n - oa.n;
    });
  }

  /** 古い退避キーを消し、新しい BACKUP_KEEP 本だけ残す（消せなくても学習は止めない）。 */
  function pruneArchives(storage, prefix) {
    listArchiveKeys(storage, prefix)
      .slice(BACKUP_KEEP)
      .forEach(function (k) {
        try {
          storage.removeItem(k);
        } catch (e) {
          /* 古い控えを消せなくても復元は進める */
        }
      });
  }

  /**
   * 置換前に現記録（localStorage の生文字列）を別キーへ退避する。
   * - 現記録が無ければ退避しない（skipped）。記録が消えた端末でも復元できるように
   * - 書いたあと読み戻して一致を確かめる。例外・不一致は握りつぶさず ok:false（呼び出し側は中止する）
   * 戻り値: { ok: true, skipped: true } / { ok: true, key } / { ok: false }
   */
  function archiveCurrentRecord(storage, storeKey, prefix, today) {
    var raw;
    var key;
    try {
      raw = storage.getItem(storeKey);
      if (raw === null) return { ok: true, skipped: true };
      key = uniqueArchiveKey(storage, prefix + today);
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error("mismatch");
    } catch (e) {
      try {
        if (key) storage.removeItem(key);
      } catch (e2) {
        /* 後始末の失敗は無視（既存記録には触れていない） */
      }
      return { ok: false };
    }
    pruneArchives(storage, prefix);
    return { ok: true, key: key };
  }

  // ---- ドライブ自動保存（Apps Script 受け口）の純関数 ----

  var DRIVE_CONTENT_TYPE = "text/plain;charset=utf-8"; // application/json だとプリフライトで失敗するため使わない
  var DRIVE_KINDS = ["backup", "test"];
  var DRIVE_URL_HOST = "script.google.com"; // 受け口として認める https のホスト

  /**
   * 受け口へ送る fetch 用の引数を組み立てる。独自ヘッダーは付けない。
   * settings: {url, token} / backup: buildBackup の結果 / kind: "backup" | "test"
   */
  function buildDriveRequest(settings, backup, kind) {
    if (DRIVE_KINDS.indexOf(kind) < 0) throw new Error("kind が不正です");
    return {
      url: settings.url,
      options: {
        method: "POST",
        headers: { "Content-Type": DRIVE_CONTENT_TYPE },
        body: JSON.stringify({
          token: settings.token,
          app: backup.app,
          kind: kind,
          content: JSON.stringify(backup),
        }),
      },
    };
  }

  /** 受け口の応答本文を読む。{ok:true} のときだけ成功。壊れた JSON・ok:false・空は失敗。 */
  function parseDriveResponse(text) {
    try {
      var v = JSON.parse(text);
      return { ok: isPlainObject(v) && v.ok === true };
    } catch (e) {
      return { ok: false };
    }
  }

  /** localStorage の文字列から {url, token} を検証する。無効なら null。 */
  function parseDriveSettings(raw) {
    try {
      var v = JSON.parse(raw);
      if (!isPlainObject(v) || typeof v.url !== "string" || typeof v.token !== "string") return null;
      var url = v.url.trim();
      var token = v.token.trim();
      if (token === "") return null;
      var u = new URL(url);
      if (u.protocol !== "https:" || u.hostname !== DRIVE_URL_HOST) return null;
      return { url: url, token: token };
    } catch (e) {
      return null;
    }
  }

  var api = {
    buildDriveRequest: buildDriveRequest,
    parseDriveResponse: parseDriveResponse,
    parseDriveSettings: parseDriveSettings,
    BACKUP_FORMAT: BACKUP_FORMAT,
    BACKUP_KEEP: BACKUP_KEEP,
    buildBackup: buildBackup,
    parseBackup: parseBackup,
    backupFileName: backupFileName,
    listArchiveKeys: listArchiveKeys,
    archiveCurrentRecord: archiveCurrentRecord,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DrillBackup = api;
  }
})(typeof window !== "undefined" ? window : this);
