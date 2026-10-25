// ============================================================
// とどうふけんドリル アプリ本体
//   - Step1 よみ / Step2 ばしょ / Step3 ちほう / Step4 かく の4ステップ
//     （いきなり地方だと難しいので、読み→場所で県に慣れてから地方を学ぶ順）
//   - 間隔反復（Leitner 5箱）でステップごとに「間違えた県」を重点出題
//   - 状態は localStorage に保存（サーバー不要）
// ============================================================

"use strict";

// --- 定数 -----------------------------------------------------
const STORE_KEY = "todofukenDrill_v1"; // localStorage のキー
const DEFAULT_DAILY = 10; // 1日の出題数
const DEFAULT_NEW_PER_DAY = 5; // 1日に増やす新出県の目標数（苦手が少なければ超えて出る）
const NEW_MIN = 2; // 各ステップで1日に最低これだけ新出を入れる（在庫がある時）
const MASTERED_CAP = 2; // 定着済み（箱4以上）の復習の1日の目安上限
const BACKUP_REMIND_DAYS = 14; // 最終バックアップからこの日数が経ったら書き出しを促す
const AWAY_REMIND_DAYS = 5; // 最終学習からこの日数以上空いたら「〇日ぶりだね」を表示（旅行等の数日の間は責めない）
// Leitner の箱ごとの「次に出すまでの日数」（箱が上がるほど間隔が伸びる）
const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 };
const MAX_BOX = 5;
const READING_STEP = 1; // よみ（読み方3択）ステップの番号
const MAP_STEP = 2; // ばしょ（地図）ステップの番号
const REGION_STEP = 3; // ちほう（地方3択）ステップの番号
const WRITE_STEP = 4; // かく（書く・自己採点）ステップの番号
const STEP_LABELS = { 1: "よみ", 2: "ばしょ", 3: "ちほう", 4: "かく" }; // お知らせ文言用のステップ名
const MAX_SNAP_UNITS = 60; // 地図タップの吸着上限（viewBoxユニット）。これより陸から遠いタップは無反応にする
// アプリの表示用バージョン。中身を更新したら sw.js の CACHE と対で必ずインクリメントする
// （ホーム画面に表示することで、iPad側で更新が反映されたか目視確認できるようにする）
const APP_VERSION = "v14";
const BACKUP_APP_ID = "todofuken-drill"; // バックアップJSONの app 値
// 受け口が ok を返した日、または共有/ダウンロードを実行した日。Drive に入った保証は受け口 ok の時のみ
const LAST_BACKUP_KEY = "todofukenDrill_lastBackup";
const DRIVE_SYNC_KEY = "todofukenDrill_driveSync"; // ドライブ受け口の設定 {url, token}（記録とは別キー）
const DRIVE_TIMEOUT_MS = 15000; // 受け口への送信の時間切れ
const MSG_DRIVE_OK = "ドライブに ほぞんしました";
const MSG_DRIVE_FAILED = "ドライブに ほぞんできませんでした。もう一度 おすと ファイルで ほぞん";
const RESTORE_KEY_PREFIX = "todofukenDrill_v1_restore_"; // 復元前の退避キー（+日付）
const WEAK_TOP_N = 10; // バックアップ要約に載せる苦手の件数
const ALL_STEPS = [READING_STEP, MAP_STEP, REGION_STEP, WRITE_STEP]; // 全ステップ
const MSG_BACKUP_SHARED = "ほぞんの がめんを ひらきました。「ファイルに ほぞん」→「ドライブ」";
const MSG_BACKUP_DOWNLOADED = "ファイルを ダウンロードしました";
const MSG_BACKUP_FAILED = "ほぞんできませんでした";
const MSG_RESTORE_BAD_FILE = "このファイルは つかえません。いまの きろくは そのままです";
const MSG_RESTORE_CONFIRM = "いまの きろくを ファイルの きろくに おきかえます。いいですか？";
const MSG_RESTORE_ARCHIVE_FAILED = "いまの きろくを のこせなかったので、やめました。いまの きろくは そのままです";
const MSG_RESTORE_DONE = "もとに もどしました";
const MSG_RESTORE_READ_FAILED = "ファイルを よめませんでした";

// --- 日付ユーティリティ --------------------------------------
/** 今日の日付を YYYY-MM-DD（ローカル時刻）で返す */
function todayStr() {
  return toDateStr(new Date());
}
/** Date を YYYY-MM-DD に変換 */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** 日付文字列に days 日を足した YYYY-MM-DD を返す */
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}
/** 2つの日付文字列(YYYY-MM-DD)の間の日数を返す */
function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// --- ストア（永続化） ----------------------------------------
let store = loadStore();

/** localStorage から状態を読み込む（無ければ初期値） */
function loadStore() {
  const init = {
    progress: {}, // カードID(`s{step}-{prefId}`) -> 習熟度カード
    meta: {
      streak: 0,
      lastStudyDate: null,
      lastBackup: null,
      settings: { dailyCount: DEFAULT_DAILY, newPerDay: DEFAULT_NEW_PER_DAY },
    },
    sessions: {}, // step -> 当日セッション（途中再開用）
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return init;
    const parsed = JSON.parse(raw);
    // 後方互換: 欠けたキーを補う
    return {
      progress: parsed.progress || {},
      meta: Object.assign(init.meta, parsed.meta || {}),
      sessions: parsed.sessions || {},
    };
  } catch (e) {
    console.warn("ストア読込に失敗。初期化します", e);
    return init;
  }
}

/** 状態を localStorage に保存 */
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    alert("保存に失敗しました。空き容量をご確認ください。");
    console.error(e);
  }
}

// --- 都道府県データへのアクセス -------------------------------
/** IDから県データを引く */
function prefById(id) {
  return window.PREFECTURES.find((p) => p.id === id) || null;
}
/** 地方名から並び順（北→南）を引く */
function regionOrder(regionName) {
  const r = window.REGIONS.find((x) => x.name === regionName);
  return r ? r.order : 99;
}
/** ステップと県IDから習熟度カードIDを作る */
function cardId(step, prefId) {
  return `s${step}-${prefId}`;
}

/** 習熟度カードを取得（無ければ新規カードの初期値） */
function getCard(id) {
  if (store.progress[id]) return store.progress[id];
  return {
    box: 1,
    dueDate: todayStr(),
    history: [],
    wrongCount: 0,
    rightCount: 0,
  };
}

// --- 出題キューの組み立て（mistake-weighted SRS） ------------
/**
 * 指定ステップの今日出す県IDの配列を作る（配分は queue.js の composeDaily）。
 *   苦手＝期限が来た箱1〜3／定着＝期限が来た箱4以上／新出＝未出題（北→南の地方順）
 *   1. 新出の最低数と定着1問を確保 2. 苦手で埋める 3. 新出を目標数まで
 *   4. 定着を上限まで 5. 余りは新出、それでも余れば定着で埋める
 *   表示順は 苦手→定着→新出。戻り値は県id（カードidではない）
 */
function buildStepQueue(step) {
  const daily = store.meta.settings.dailyCount || DEFAULT_DAILY;
  const newTarget = store.meta.settings.newPerDay ?? DEFAULT_NEW_PER_DAY;

  const sorted = window.PREFECTURES.slice().sort((a, b) => {
    const ra = regionOrder(a.region);
    const rb = regionOrder(b.region);
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });

  const items = sorted.map((p, idx) => {
    const c = getCard(cardId(step, p.id));
    return {
      id: p.id,
      box: c.box,
      dueDate: c.dueDate,
      wrongCount: c.wrongCount,
      tier: 0,
      idx,
      seen: c.history.length > 0,
    };
  });
  return window.DrillQueue.composeDaily(items, {
    today: todayStr(),
    daily,
    newMin: NEW_MIN,
    newTarget,
    masteredCap: MASTERED_CAP,
  });
}

// --- 回答の記録（SRS更新） -----------------------------------
/** 自己採点/自動採点の結果を記録し、箱と次回期限を更新する */
function recordAnswer(id, ok) {
  const c = JSON.parse(JSON.stringify(getCard(id)));
  c.history.push({ date: todayStr(), result: ok ? "o" : "x" });
  if (ok) {
    c.rightCount += 1;
    c.box = Math.min(c.box + 1, MAX_BOX);
  } else {
    c.wrongCount += 1;
    c.box = 1; // 間違えたら箱1へ戻す＝翌日また出る
  }
  c.dueDate = addDays(todayStr(), INTERVALS[c.box]);
  store.progress[id] = c;
  saveStore();
}

// --- 統計 -----------------------------------------------------
/** 指定ステップでマスター（箱4以上）した県数 */
function masteredForStep(step) {
  return window.PREFECTURES.filter((p) => {
    const c = store.progress[cardId(step, p.id)];
    return c && c.box >= 4;
  }).length;
}
/** 指定ステップで一度でも学習した県数（履歴あり）。正解しても減らないので初日から動く指標 */
function touchedForStep(step) {
  return window.PREFECTURES.filter((p) => {
    const c = store.progress[cardId(step, p.id)];
    return c && c.history.length > 0;
  }).length;
}
/** そのステップで今日やる問題が残っているか（途中のセッション、または新しく組める出題がある） */
function hasStepWorkToday(step) {
  const s = store.sessions[step];
  if (s && s.date === todayStr() && s.index < s.ids.length) return true;
  return buildStepQueue(step).length > 0;
}
/** 出題済みの県のうち、今日より後でいちばん早い復習日（YYYY-MM-DD）。無ければ null */
function nextDueForStep(step) {
  const today = todayStr();
  let next = null;
  window.PREFECTURES.forEach((p) => {
    const c = store.progress[cardId(step, p.id)];
    if (!c || c.history.length === 0 || c.dueDate <= today) return;
    if (next === null || c.dueDate < next) next = c.dueDate;
  });
  return next;
}
/** YYYY-MM-DD を「10/25」の形にする */
function formatMonthDay(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}
/** 今日の分が終わった時にホームへ出すお知らせ文 */
function stepDoneMessage(step) {
  const next = nextDueForStep(step);
  const nextText = next ? ` つぎは ${formatMonthDay(next)} だよ` : "";
  return `🎉 きょうの ${STEP_LABELS[step]}は おわり！${nextText}`;
}
/** ホームのお知らせを書き換える（空文字で消す） */
function setHomeStepMsg(text) {
  const el = document.getElementById("home-step-msg");
  el.textContent = text;
  el.classList.toggle("hidden", text === "");
}
/** 出題が0件の時：ホームを描き直した後にお知らせを出す（逆順だと renderHome が消してしまう） */
function showStepDone(step) {
  renderHome();
  setHomeStepMsg(stepDoneMessage(step));
}

/** いずれかのステップで一度でも学習した県数 */
function touchedAny() {
  return window.PREFECTURES.filter((p) =>
    [READING_STEP, MAP_STEP, REGION_STEP, WRITE_STEP].some((step) => {
      const c = store.progress[cardId(step, p.id)];
      return c && c.history.length > 0;
    })
  ).length;
}
/** Step1〜4すべてマスター済みの県数（＝完全に覚えた県） */
function totalMastered() {
  return window.PREFECTURES.filter((p) =>
    [READING_STEP, MAP_STEP, REGION_STEP, WRITE_STEP].every((step) => {
      const c = store.progress[cardId(step, p.id)];
      return c && c.box >= 4;
    })
  ).length;
}
/** 苦手リスト（Step1〜4の合計間違い回数が多い順）を返す */
function weakList(limit = 5) {
  const totals = window.PREFECTURES.map((p) => {
    let wrong = 0;
    [READING_STEP, MAP_STEP, REGION_STEP, WRITE_STEP].forEach((step) => {
      const c = store.progress[cardId(step, p.id)];
      if (c) wrong += c.wrongCount;
    });
    return { p, wrong };
  }).filter((x) => x.wrong > 0);
  return totals.sort((a, b) => b.wrong - a.wrong).slice(0, limit);
}

// ============================================================
// 画面制御
// ============================================================
const screens = ["home", "quiz", "map", "result", "backup"];
function showScreen(name) {
  screens.forEach((s) => {
    const el = document.getElementById("screen-" + s);
    if (el) el.classList.toggle("hidden", s !== name);
  });
  window.scrollTo(0, 0);
}

// --- ホーム画面 ----------------------------------------------
function renderHome() {
  setHomeStepMsg("");
  const total = window.PREFECTURES.length;
  document.getElementById("home-streak").textContent = store.meta.streak || 0;
  document.getElementById("home-mastered").textContent = totalMastered();
  document.getElementById("home-total").textContent = total;
  document.getElementById("home-touched").textContent = touchedAny();
  document.getElementById("home-touched-total").textContent = total;

  // Step別は「まなんだ県/47」を主に出す（マスターは箱4以上＝3回正解が必要で、
  // 学習し始めの時期は全部0になり実態と合わないため）。マスターは⭐で併記する
  [READING_STEP, MAP_STEP, REGION_STEP, WRITE_STEP].forEach((step) => {
    const el = document.getElementById("progress-" + step);
    if (!el) return;
    const mastered = masteredForStep(step);
    const star = mastered > 0 ? `⭐${mastered} ` : "";
    const count = `${star}${touchedForStep(step)}/${total}`;
    // 今日の分が終わったステップは、押しても問題が出ないことがボタンで分かるようにする
    const done = !hasStepWorkToday(step);
    document.getElementById("btn-step-" + step).classList.toggle("done", done);
    if (done) {
      const next = nextDueForStep(step);
      const nextText = next ? `・つぎ ${formatMonthDay(next)}` : "";
      el.textContent = `✅ きょうは おわり${nextText}｜${count}`;
    } else {
      el.textContent = count;
    }
  });

  const weak = weakList(5);
  const weakBox = document.getElementById("home-weak");
  if (weak.length === 0) {
    weakBox.innerHTML = '<p class="muted">まだ苦手リストはありません。</p>';
  } else {
    weakBox.innerHTML =
      "<ul>" +
      weak
        .map(
          (x) =>
            `<li><span class="weak-kanji">${escapeHtml(x.p.name)}</span>` +
            `<span class="muted">（×${x.wrong}回）</span></li>`
        )
        .join("") +
      "</ul>";
  }

  updateBackupReminder(todayStr());
  updateAwayNote(todayStr());
  document.getElementById("app-version").textContent = APP_VERSION;
  showScreen("home");
}

/** 最終保存日を返す。別キーを優先し、無ければ旧 store.meta.lastBackup を見る（既存端末で促しが突然出ないように） */
function getLastBackup() {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY);
    if (v) return v;
  } catch (e) {
    /* 読めなければ旧値へ */
  }
  return store.meta.lastBackup || null;
}

/** 保存を実行した日を別キーへ書く（旧 store.meta.lastBackup には書かない） */
function setLastBackup() {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, todayStr());
  } catch (e) {
    console.warn("lastBackup の保存に失敗", e);
  }
}

/** ホームの「きろくを書き出してね」促しの表示/非表示を更新する */
function updateBackupReminder(today) {
  const el = document.getElementById("home-backup-reminder");
  if (!el) return;
  const hasProgress = Object.keys(store.progress).length > 0;
  const last = getLastBackup();
  const due = !last || addDays(last, BACKUP_REMIND_DAYS) <= today;
  el.classList.toggle("hidden", !(hasProgress && due));
}

/** ホームの「〇日ぶりだね」表示を更新する（本人向け・責めない前向きな一言） */
function updateAwayNote(today) {
  const el = document.getElementById("home-away-note");
  if (!el) return;
  const last = store.meta.lastStudyDate;
  if (!last || last === today) {
    el.classList.add("hidden");
    return;
  }
  const gapDays = daysBetween(last, today);
  if (gapDays >= AWAY_REMIND_DAYS) {
    el.textContent = `${gapDays}日ぶりだね！またいっしょに がんばろう`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

/** 達成メッセージ（新しくマスターした数）を結果画面に表示する。0以下なら非表示にする */
function renderAchievement(newlyMastered, unit) {
  const el = document.getElementById("result-achievement");
  if (!el) return;
  if (newlyMastered > 0) {
    el.textContent = `🌟 新しく ${newlyMastered}${unit} マスターしたよ！`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// --- 配列シャッフル --------------------------------------------
/** 配列をシャッフルした新しい配列を返す（Fisher-Yates） */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- 選択肢の生成（distractor） --------------------------------
function otherRegions(correctRegion, n) {
  const pool = window.REGIONS.map((r) => r.name).filter((r) => r !== correctRegion);
  return shuffleArray(pool).slice(0, n);
}
function otherReadings(correctPref, n) {
  const pool = window.PREFECTURES.filter((p) => p.id !== correctPref.id).map((p) => p.reading);
  return shuffleArray(pool).slice(0, n);
}
function otherPrefNames(correctPref, n) {
  const pool = window.PREFECTURES.filter((p) => p.id !== correctPref.id).map((p) => p.name);
  return shuffleArray(pool).slice(0, n);
}

/** 3択ボタンを描画し、選んだら onSelect(choice, ok) を呼ぶ（共通の選択肢UI） */
function renderChoices(containerId, correctText, distractorTexts, onSelect) {
  const choices = shuffleArray([correctText, ...distractorTexts]);
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.addEventListener("click", () => {
      const ok = choice === correctText;
      box.querySelectorAll(".choice-btn").forEach((b) => {
        b.disabled = true;
        if (b.textContent === correctText) b.classList.add("ok");
        else if (b === btn && !ok) b.classList.add("ng");
      });
      onSelect(ok);
    });
    box.appendChild(btn);
  });
}

// ============================================================
// 地図（インラインSVGの clone・ハイライト・タップ判定）
// ============================================================
/** 非表示テンプレートから地図SVGを複製して返す */
function cloneMapSvg() {
  const tpl = document.getElementById("map-template").querySelector("svg");
  return tpl.cloneNode(true);
}
/** 指定の県要素にハイライト用クラスを付ける（data-code は数値で照合） */
function highlightPrefecture(svg, prefId, className) {
  const code = parseInt(prefId, 10);
  const el = svg.querySelector(`[data-code="${code}"]`);
  if (el) el.classList.add(className);
}
/**
 * 地図の viewBox を、指定した地方に属する県だけがちょうど収まる範囲までズームする。
 * getBoundingClientRect + getScreenCTM で座標変換するため、svg が表示状態（display:none でない）の
 * コンテナに appendChild 済みであることが前提（呼び出し順に注意）。
 */
function zoomToRegion(svg, regionName) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return; // 取得できない場合は全体表示のままにする
  const inv = ctm.inverse();
  const pt = svg.createSVGPoint();
  const codes = window.PREFECTURES.filter((pr) => pr.region === regionName).map((pr) =>
    parseInt(pr.id, 10)
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  codes.forEach((code) => {
    const el = svg.querySelector(`[data-code="${code}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.left, rect.bottom],
      [rect.right, rect.bottom],
    ].forEach(([x, y]) => {
      pt.x = x;
      pt.y = y;
      const p = pt.matrixTransform(inv);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
  });
  if (!isFinite(minX)) return;

  const PAD_RATIO = 0.18; // 地方の周囲に少し余白を残す
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * PAD_RATIO;
  const padY = h * PAD_RATIO;
  svg.setAttribute("viewBox", `${minX - padX} ${minY - padY} ${w + padX * 2} ${h + padY * 2}`);
}

/**
 * 各県の「本体形状」の外接矩形を viewBox ユーザー座標で求める。
 * 東京のように本土と離島が1つの <path> にまとまっている県は、要素全体の bbox を取ると
 * 本土〜小笠原間の海上まで含んだ縦長の箱になり、代表点が陸から外れてしまう。
 * そのためサブパス単位で測り、面積が最大のもの（＝本土）だけを代表として採用する。
 * getBBox()/getCTM() はレンダリング状態が前提なので、svg を表示中のコンテナへ appendChild し、
 * 画面を表示状態にしてから呼ぶこと（.hidden が display:none のため非表示だと 0/null になる）。
 * @returns {{code:number,minX:number,minY:number,maxX:number,maxY:number}[]}
 */
function measurePrefShapes(svg) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const pt = svg.createSVGPoint();
  const shapes = [];

  svg.querySelectorAll("g.prefecture[data-code]").forEach((g) => {
    const code = parseInt(g.getAttribute("data-code"), 10);

    // 測る対象を集める。複数サブパスを持つ path は分割して一時要素で測る
    const parts = []; // { el } = 既存要素 / { d } = 一時生成するパス
    g.querySelectorAll("path, polygon").forEach((el) => {
      if (el.tagName.toLowerCase() === "polygon") {
        parts.push({ el });
        return;
      }
      const subs = (el.getAttribute("d") || "").match(/M[^M]+/g) || [];
      if (subs.length <= 1) parts.push({ el });
      else subs.forEach((d) => parts.push({ d }));
    });

    let bestBox = null;
    let bestCtm = null;
    let bestArea = -1;
    parts.forEach((part) => {
      let el = part.el;
      let temp = null;
      if (!el) {
        // 一時パスを同じ親に置いて測る。同期処理内で必ず除去するので描画はされない
        temp = document.createElementNS(SVG_NS, "path");
        temp.setAttribute("d", part.d);
        g.appendChild(temp);
        el = temp;
      }
      let box = null;
      let ctm = null;
      try {
        box = el.getBBox();
        ctm = el.getCTM(); // 要素のローカル座標 → SVGルートのユーザー座標
      } catch (err) {
        box = null;
      }
      if (temp) temp.remove();
      if (!box || !ctm) return;
      const area = box.width * box.height;
      if (area <= bestArea) return;
      bestArea = area;
      bestBox = box;
      bestCtm = ctm;
    });
    if (!bestBox) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    [
      [bestBox.x, bestBox.y],
      [bestBox.x + bestBox.width, bestBox.y],
      [bestBox.x, bestBox.y + bestBox.height],
      [bestBox.x + bestBox.width, bestBox.y + bestBox.height],
    ].forEach(([x, y]) => {
      pt.x = x;
      pt.y = y;
      const q = pt.matrixTransform(bestCtm);
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    });
    shapes.push({ code, minX, minY, maxX, maxY });
  });
  return shapes;
}

/**
 * タップ位置から回答対象の県コードを決める。
 * 県の形状を直接タップした場合はそれを最優先し（ブラウザの厳密な当たり判定をそのまま使う）、
 * 外した場合のみ「本体形状の矩形までの距離が最短の県」へ吸着させる。
 * 東京のように実寸10px程度の県でも狙って選べるようにするための処理。
 * 各点が必ず1県だけに帰属するので、隣接県の判定領域が重なることはない。
 * @returns {number|null} 県コード。陸から遠すぎる場合は null
 */
function resolveTappedPref(e, svg, shapes) {
  const hit = e.target.closest("g.prefecture[data-code]");
  if (hit) return parseInt(hit.getAttribute("data-code"), 10);

  // スクリーン座標 → viewBox ユーザー座標（zoomToRegion と同じ手法）
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const q = pt.matrixTransform(ctm.inverse());

  let best = null;
  let bestD = Infinity;
  shapes.forEach((s) => {
    // 点と矩形の距離（矩形の内側なら 0）
    const dx = Math.max(s.minX - q.x, 0, q.x - s.maxX);
    const dy = Math.max(s.minY - q.y, 0, q.y - s.maxY);
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = s.code;
    }
  });
  return bestD <= MAX_SNAP_UNITS ? best : null;
}

/** 指定コンテナに、対象の県をハイライトし地方全体が見える範囲にズームした地図を描画する（よみ・ちほう・かく の3ステップで共通利用） */
function renderMapHint(containerId, p) {
  const hint = document.getElementById(containerId);
  hint.innerHTML = "";
  const svg = cloneMapSvg();
  hint.appendChild(svg); // 先にDOMへ追加してレイアウトさせてから座標変換する
  highlightPrefecture(svg, p.id, "pref-target");
  zoomToRegion(svg, p.region);
}

// ============================================================
// クイズ画面（Step1=よみ / Step3=ちほう / Step4=かく）
// ============================================================
let quizState = null; // { step, ids, index, results }

/** セッションを開始（途中なら再開、完了済みなら作り直し） */
function startStep(step) {
  if (step === MAP_STEP) {
    startMapStep();
    return;
  }
  const today = todayStr();
  const s = store.sessions[step];
  if (s && s.date === today && s.index < s.ids.length) {
    quizState = {
      step,
      ids: s.ids,
      index: s.index,
      results: s.results || {},
      masteredBefore: s.masteredBefore ?? masteredForStep(step),
    };
  } else {
    const ids = buildStepQueue(step);
    if (ids.length === 0) {
      showStepDone(step);
      return;
    }
    const masteredBefore = masteredForStep(step);
    quizState = { step, ids, index: 0, results: {}, masteredBefore };
    store.sessions[step] = { date: today, ids, index: 0, results: {}, masteredBefore };
    saveStore();
  }
  showStepQuestion();
}

/** 現在の問題を表示（Step1/3=3択エリア、Step4=書くエリアを出し分け） */
function showStepQuestion() {
  const prefId = quizState.ids[quizState.index];
  const p = prefById(prefId);
  document.getElementById("quiz-progress").textContent =
    `${quizState.index + 1} / ${quizState.ids.length}`;
  document.getElementById("quiz-choice-feedback").classList.add("hidden");

  const isWrite = quizState.step === WRITE_STEP;
  document.getElementById("quiz-choice-area").classList.toggle("hidden", isWrite);
  document.getElementById("quiz-write-area").classList.toggle("hidden", !isWrite);

  // 地図のズーム計算(getBoundingClientRect)がレイアウトを必要とするため、
  // 中身を組み立てる前に画面を表示状態にしておく
  showScreen("quiz");

  if (quizState.step === READING_STEP) {
    document.getElementById("quiz-instruction").textContent = "この 県の名前、なんて よむ？";
    document.getElementById("quiz-prompt").textContent = p.name;
    renderMapHint("quiz-map-hint", p);
    renderChoices("quiz-choices", p.reading, otherReadings(p, 2), (ok) => gradeChoice(ok));
  } else if (quizState.step === REGION_STEP) {
    document.getElementById("quiz-instruction").textContent = "この 県は どの ちほう？";
    document.getElementById("quiz-prompt").textContent = p.name;
    renderMapHint("quiz-map-hint", p);
    renderChoices("quiz-choices", p.region, otherRegions(p.region, 2), (ok) => gradeChoice(ok));
  } else if (quizState.step === WRITE_STEP) {
    document.getElementById("write-reading").textContent = p.reading;
    document.getElementById("reveal-answer").textContent = p.name;
    renderMapHint("write-map-hint", p);
    document.getElementById("reveal-area").classList.add("hidden");
    document.getElementById("btn-reveal").classList.remove("hidden");
  }
}

/** Step1/3の3択採点（自動） */
function gradeChoice(ok) {
  const prefId = quizState.ids[quizState.index];
  const p = prefById(prefId);
  const id = cardId(quizState.step, prefId);
  recordAnswer(id, ok);
  quizState.results[prefId] = ok ? "o" : "x";
  quizState.index += 1;
  store.sessions[quizState.step] = {
    date: todayStr(),
    ids: quizState.ids,
    index: quizState.index,
    results: quizState.results,
    masteredBefore: quizState.masteredBefore,
  };
  saveStore();
  document.getElementById("quiz-choice-feedback-msg").textContent = buildChoiceFeedback(
    quizState.step,
    ok,
    p
  );
  document.getElementById("quiz-choice-feedback").classList.remove("hidden");
}

/**
 * 選択式クイズの正誤フィードバック文言。
 * よみフェーズは、まだ習っていない「ちほう」をここで先に予習できるよう地方名を併記する。
 * ちほうフェーズ自体はその地方を問うているので併記せず、シンプルな文言のままにする。
 */
function buildChoiceFeedback(step, ok, p) {
  const prefix = ok ? "せいかい！" : "おしい！";
  if (step === REGION_STEP) return prefix + (ok ? "🎉" : "");
  return `${prefix}これは${p.region}地方の${p.name}だよ`;
}

function nextStepQuestion() {
  if (quizState.index >= quizState.ids.length) {
    finishSession();
  } else {
    showStepQuestion();
  }
}

/** Step4: 答えを表示（自己採点ボタンを出す） */
function revealWriteAnswer() {
  document.getElementById("reveal-area").classList.remove("hidden");
  document.getElementById("btn-reveal").classList.add("hidden");
}

/** Step4: 自己採点（ok=できた / false=まちがえた） */
function gradeWrite(ok) {
  const prefId = quizState.ids[quizState.index];
  const id = cardId(WRITE_STEP, prefId);
  recordAnswer(id, ok);
  quizState.results[prefId] = ok ? "o" : "x";
  quizState.index += 1;
  store.sessions[WRITE_STEP] = {
    date: todayStr(),
    ids: quizState.ids,
    index: quizState.index,
    results: quizState.results,
    masteredBefore: quizState.masteredBefore,
  };
  saveStore();
  if (quizState.index >= quizState.ids.length) {
    finishSession();
  } else {
    showStepQuestion();
  }
}

function finishSession() {
  finishStepSession(quizState.ids, quizState.results, quizState.step, quizState.masteredBefore);
}

// ============================================================
// 地図画面（Step2=ばしょ。偶数問=タップで位置当て／奇数問=ハイライト→3択）
// ============================================================
// picked/shapes/svg/pref は問題ごとの一時情報（localStorage には ids/index/results だけ保存する）
let mapState = null; // { ids, index, results, picked, shapes, svg, pref }
let mapTapHandler = null; // 現在アタッチ中のタップリスナー（1回のみ有効にするため保持）

function startMapStep() {
  const today = todayStr();
  const s = store.sessions[MAP_STEP];
  if (s && s.date === today && s.index < s.ids.length) {
    mapState = {
      ids: s.ids,
      index: s.index,
      results: s.results || {},
      masteredBefore: s.masteredBefore ?? masteredForStep(MAP_STEP),
    };
  } else {
    const ids = buildStepQueue(MAP_STEP);
    if (ids.length === 0) {
      showStepDone(MAP_STEP);
      return;
    }
    const masteredBefore = masteredForStep(MAP_STEP);
    mapState = { ids, index: 0, results: {}, masteredBefore };
    store.sessions[MAP_STEP] = { date: today, ids, index: 0, results: {}, masteredBefore };
    saveStore();
  }
  showMapQuestion();
}

function showMapQuestion() {
  const prefId = mapState.ids[mapState.index];
  const p = prefById(prefId);
  document.getElementById("map-progress").textContent =
    `${mapState.index + 1} / ${mapState.ids.length}`;
  document.getElementById("map-feedback").classList.add("hidden");
  document.getElementById("map-confirm").classList.add("hidden");
  mapState.picked = null;

  const container = document.getElementById("map-container");
  container.innerHTML = "";
  const svg = cloneMapSvg();
  container.appendChild(svg);

  // 形状の計測(getBBox/getCTM)は表示状態でないと機能しないため、
  // 中身を組み立てる前に画面を表示状態にしておく
  showScreen("map");

  const choiceArea = document.getElementById("map-choice-area");
  const isLocate = mapState.index % 2 === 0; // 偶数=タップで位置当て／奇数=ハイライト→3択

  if (isLocate) {
    document.getElementById("map-instruction").textContent = "この 県は どこ？ 地図を タップしよう";
    document.getElementById("map-prompt").textContent = p.name;
    choiceArea.classList.add("hidden");
    choiceArea.innerHTML = "";
    mapState.shapes = measurePrefShapes(svg);
    mapState.svg = svg;
    mapState.pref = p;
    mapTapHandler = (e) => onMapTap(e, svg);
    svg.addEventListener("click", mapTapHandler);
  } else {
    document.getElementById("map-instruction").textContent = "地図で 光っている 県は どこ？";
    document.getElementById("map-prompt").textContent = "";
    highlightPrefecture(svg, p.id, "pref-target");
    choiceArea.classList.remove("hidden");
    renderMapChoices(p);
  }
}

/** 地図タップ＝「選択」。この時点では採点せず、確認ボタンで確定させる（選び直し可能） */
function onMapTap(e, svg) {
  const code = resolveTappedPref(e, svg, mapState.shapes);
  if (code === null) return; // 陸から遠いタップは無視し、そのまま選び直させる
  svg.querySelectorAll(".pref-picked").forEach((el) => el.classList.remove("pref-picked"));
  const g = svg.querySelector(`g.prefecture[data-code="${code}"]`);
  if (g) g.classList.add("pref-picked");
  mapState.picked = code;
  // 県名は出さない（答えが漏れるため）。色だけで「いまここを選んでいる」と示す
  document.getElementById("map-confirm").classList.remove("hidden");
}

/** 「ここで いい？」で選択を確定して採点する */
function confirmMapAnswer() {
  if (!mapState || mapState.picked === null) return;
  const svg = mapState.svg;
  const p = mapState.pref;
  svg.removeEventListener("click", mapTapHandler);
  document.getElementById("map-confirm").classList.add("hidden");
  // 確定前の選択色は必ず外す。pref-correct/pref-wrong と同じ !important のため、
  // 残すと同詳細度となり CSS の記述順で勝敗が決まってしまう
  svg.querySelectorAll(".pref-picked").forEach((el) => el.classList.remove("pref-picked"));

  const ok = mapState.picked === parseInt(p.id, 10);
  const picked = svg.querySelector(`g.prefecture[data-code="${mapState.picked}"]`);
  if (picked) picked.classList.add(ok ? "pref-correct" : "pref-wrong");
  if (!ok) highlightPrefecture(svg, p.id, "pref-correct");
  recordMapAnswer(p.id, ok);
  showMapFeedback(ok, p);
}

/** 3択（地図でハイライトされた県の名前を当てる）を描画 */
function renderMapChoices(p) {
  renderChoices("map-choice-area", p.name, otherPrefNames(p, 2), (ok) => {
    recordMapAnswer(p.id, ok);
    showMapFeedback(ok, p);
  });
}

function recordMapAnswer(prefId, ok) {
  const id = cardId(MAP_STEP, prefId);
  recordAnswer(id, ok);
  mapState.results[prefId] = ok ? "o" : "x";
  mapState.index += 1;
  store.sessions[MAP_STEP] = {
    date: todayStr(),
    ids: mapState.ids,
    index: mapState.index,
    results: mapState.results,
    masteredBefore: mapState.masteredBefore,
  };
  saveStore();
}

/** 地図フェーズのフィードバック。まだ習っていない「ちほう」をここで先に予習できるよう地方名を併記する */
function showMapFeedback(ok, p) {
  const prefix = ok ? "せいかい！" : "おしい！";
  document.getElementById("map-feedback-msg").textContent =
    `${prefix}これは${p.region}地方の${p.name}だよ`;
  document.getElementById("map-feedback").classList.remove("hidden");
}

function nextMapQuestion() {
  if (mapState.index >= mapState.ids.length) {
    finishMapSession();
  } else {
    showMapQuestion();
  }
}

function finishMapSession() {
  finishStepSession(mapState.ids, mapState.results, MAP_STEP, mapState.masteredBefore);
}

// --- 結果画面（Step1〜4共通） ---------------------------------
/** 連続日数の更新とスコア表示。ids/results はステップ問わず共通形式。
 *  step/masteredBefore は達成メッセージ（そのStepで新しくマスターした県数）の算出に使う */
function finishStepSession(ids, results, step, masteredBefore) {
  const today = todayStr();
  if (store.meta.lastStudyDate !== today) {
    if (store.meta.lastStudyDate === addDays(today, -1)) {
      store.meta.streak = (store.meta.streak || 0) + 1;
    } else {
      store.meta.streak = 1;
    }
    store.meta.lastStudyDate = today;
    saveStore();
  }

  const okCount = ids.filter((id) => results[id] === "o").length;
  const total = ids.length;
  document.getElementById("result-score").textContent = `${okCount} / ${total}`;

  const ratio = total ? okCount / total : 0;
  let msg = "よくがんばったね！";
  if (ratio === 1) msg = "全部できた！すごい！🎉";
  else if (ratio >= 0.7) msg = "いいちょうし！この調子！👍";
  else msg = "まちがえた県は明日また出るよ。だいじょうぶ！";
  document.getElementById("result-msg").textContent = msg;
  document.getElementById("result-streak").textContent = `🔥 連続 ${store.meta.streak} 日`;

  // 達成メッセージ（そのStepで新しくマスターした県の数だけを前向きに伝える。正答率は見せない）
  const masteredAfter = masteredForStep(step);
  renderAchievement(masteredAfter - (masteredBefore ?? masteredAfter), "けん");

  const wrong = ids
    .filter((id) => results[id] === "x")
    .map((id) => prefById(id))
    .filter(Boolean);
  const wrongBox = document.getElementById("result-weak");
  if (wrong.length === 0) {
    wrongBox.innerHTML = '<p class="muted">今日はぜんぶ○！</p>';
  } else {
    wrongBox.innerHTML =
      "<p>今日まちがえた県（明日また出ます）：</p><div class='kanji-row'>" +
      wrong.map((p) => `<span class="weak-kanji">${escapeHtml(p.name)}</span>`).join("") +
      "</div>";
  }

  showScreen("result");
  autoBackupToDrive(); // 結果画面の表示は待たない
}

// --- バックアップ兼きろく（保存 / 復元） ---------------------
/** ステップ別のできた県数（箱4以上）と、まなんだ県数 */
function stepSummary() {
  return ALL_STEPS.map((step) => ({
    step,
    mastered: masteredForStep(step),
    touched: touchedForStep(step),
    total: window.PREFECTURES.length,
  }));
}

/** 苦手上位（ステップ別のカード単位。間違い回数の多い順） */
function weakCards(limit = WEAK_TOP_N) {
  const rows = [];
  window.PREFECTURES.forEach((p) => {
    ALL_STEPS.forEach((step) => {
      const c = store.progress[cardId(step, p.id)];
      if (c && c.wrongCount > 0) rows.push({ p, step, c });
    });
  });
  return rows
    .sort((a, b) => b.c.wrongCount - a.c.wrongCount || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, limit)
    .map((x) => ({ id: x.p.id, name: x.p.name, step: x.step, wrongCount: x.c.wrongCount, box: x.c.box }));
}

/** Claude が読む要約（ステップ別の数・苦手上位・連続日数・最終学習日） */
function buildBackupSummary() {
  return {
    totalMastered: totalMastered(),
    totalCount: window.PREFECTURES.length,
    steps: stepSummary(),
    weak: weakCards(WEAK_TOP_N),
    streak: store.meta.streak || 0,
    lastStudyDate: store.meta.lastStudyDate || null,
  };
}

function setBackupStatus(id, text, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "form-msg " + (ok ? "ok" : "ng");
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 保存の結果を、ホームとバックアップ画面の両方の表示欄に出す */
function showBackupStatus(text, ok = true) {
  setBackupStatus("home-backup-status", text, ok);
  setBackupStatus("backup-status", text, ok);
}

let fileFallbackPending = false; // ドライブ送信に失敗済み＝次のタップで共有/ダウンロードを開く
let driveBusy = false; // ドライブ送信中の二重タップ防止（自動送信中も立てる）
let autoBackupPromise = null; // 結果画面からの自動送信（送信中だけ値が入る）

/** 受け口へ送って ok:true を読めた時だけ true を返す（時間切れ・オフライン・非200・壊れた応答は false）。 */
async function sendToDrive(settings, backup, kind) {
  const req = DrillBackup.buildDriveRequest(settings, backup, kind);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DRIVE_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, Object.assign({ signal: ctrl.signal }, req.options));
    if (!res.ok) return false;
    return DrillBackup.parseDriveResponse(await res.text()).ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 保存結果の後始末（保存日を記録し、促しを更新する）。成功した時だけ呼ぶ */
function finishBackup(msg) {
  showBackupStatus(msg);
  setLastBackup();
  updateBackupReminder(todayStr());
}

/** 従来の経路（共有シート → 不可・失敗ならダウンロード）。挙動は変えない。 */
async function saveBackupAsFile(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      finishBackup(MSG_BACKUP_SHARED);
    } else {
      downloadFile(file);
      finishBackup(MSG_BACKUP_DOWNLOADED);
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // とちゅうで やめた
    try {
      downloadFile(file);
      finishBackup(MSG_BACKUP_DOWNLOADED);
    } catch (e2) {
      showBackupStatus(MSG_BACKUP_FAILED, false);
    }
  }
}

/** ドライブ設定済みなら送信。失敗時は保存日の記録も共有も行わず、次のタップで従来経路へ。 */
async function saveBackupToDrive(settings, backup) {
  driveBusy = true;
  showBackupStatus("ドライブに ほぞんしています…");
  try {
    if (await sendToDrive(settings, backup, "backup")) {
      fileFallbackPending = false;
      finishBackup(MSG_DRIVE_OK);
    } else {
      fileFallbackPending = true;
      showBackupStatus(MSG_DRIVE_FAILED, false);
    }
  } finally {
    driveBusy = false;
  }
}

/** 送る中身の組み立て（手動ボタンと自動送信で共用） */
function makeBackup() {
  const today = todayStr();
  const backup = DrillBackup.buildBackup({
    appId: BACKUP_APP_ID,
    appVersion: APP_VERSION,
    today,
    summary: buildBackupSummary(),
    state: store,
  });
  return { today, backup };
}

/** 自動送信が送信中なら、その旨を出して終わるのを待つ（黙って無視しない） */
async function waitAutoBackup(showStatus) {
  if (!autoBackupPromise) return;
  showStatus("ドライブに ほぞんしています…");
  await autoBackupPromise;
}

/**
 * テスト終了時の自動送信。未設定・送信中なら何もしない。
 * 成功時だけ保存日を記録し、失敗時は何も触らない（画面にも出さない）。
 */
function autoBackupToDrive() {
  if (driveBusy) return;
  const settings = DrillBackup.parseDriveSettings(safeGetDriveSync());
  if (!settings) return;
  driveBusy = true;
  autoBackupPromise = (async () => {
    try {
      if (await sendToDrive(settings, makeBackup().backup, "backup")) {
        fileFallbackPending = false;
        setLastBackup();
        updateBackupReminder(todayStr());
      }
    } catch (e) {
      // 自動送信の失敗は無言（従来の手動ボタンと7日の促しが安全網）
    } finally {
      driveBusy = false;
      autoBackupPromise = null;
    }
  })();
}

/** きろくを保存する（ドライブ設定済みなら受け口へ。未設定・失敗の次のタップは共有シート/ダウンロード） */
async function saveBackup() {
  await waitAutoBackup((text) => showBackupStatus(text));
  if (driveBusy) return;
  const { today, backup } = makeBackup();
  const file = new File([JSON.stringify(backup, null, 2)], DrillBackup.backupFileName(BACKUP_APP_ID, today), {
    type: "application/json",
  });
  const settings = DrillBackup.parseDriveSettings(safeGetDriveSync());
  if (!settings || fileFallbackPending) {
    // 未設定、または直前のドライブ送信が失敗＝今のタップで従来経路を開く
    fileFallbackPending = false;
    await saveBackupAsFile(file);
    return;
  }
  await saveBackupToDrive(settings, backup);
}

// ---- ドライブの設定欄 ----

/** 設定の生文字列を読む（読めなければ null） */
function safeGetDriveSync() {
  try {
    return localStorage.getItem(DRIVE_SYNC_KEY);
  } catch (e) {
    return null;
  }
}

function setDriveStatus(text, ok = true) {
  setBackupStatus("drive-status", text, ok);
}

function loadDriveForm() {
  const s = DrillBackup.parseDriveSettings(safeGetDriveSync());
  document.getElementById("drive-url").value = s ? s.url : "";
  document.getElementById("drive-token").value = s ? s.token : "";
}

function readDriveForm() {
  return DrillBackup.parseDriveSettings(
    JSON.stringify({
      url: document.getElementById("drive-url").value,
      token: document.getElementById("drive-token").value,
    }),
  );
}

function saveDriveSettings() {
  const s = readDriveForm();
  if (!s) {
    setDriveStatus("URLか あいことばが ただしくありません。ほぞんしませんでした", false);
    return;
  }
  try {
    localStorage.setItem(DRIVE_SYNC_KEY, JSON.stringify(s));
  } catch (e) {
    setDriveStatus("せっていを ほぞんできませんでした", false);
    return;
  }
  fileFallbackPending = false;
  setDriveStatus("せっていを ほぞんしました");
}

/** 本物のバックアップを kind:"test" で送る（latest を汚さない） */
async function testDrive() {
  await waitAutoBackup((text) => setDriveStatus(text));
  if (driveBusy) return;
  const s = readDriveForm();
  if (!s) {
    setDriveStatus("URLか あいことばが ただしくありません", false);
    return;
  }
  driveBusy = true;
  setDriveStatus("ためしています…");
  try {
    const ok = await sendToDrive(s, makeBackup().backup, "test");
    setDriveStatus(ok ? "ためしに ほぞんできました" : "ためしに ほぞんできませんでした", ok);
  } finally {
    driveBusy = false;
  }
}

/** バックアップ側の store から、loadStore と同じ補い方で新しい store を組み立てる */
function storeFromBackup(src) {
  const init = {
    meta: {
      streak: 0,
      lastStudyDate: null,
      lastBackup: null,
      settings: { dailyCount: DEFAULT_DAILY, newPerDay: DEFAULT_NEW_PER_DAY },
    },
  };
  return {
    progress: src.progress || {},
    meta: Object.assign(init.meta, src.meta || {}),
    sessions: src.sessions || {},
  };
}

/** 検証済みの store を適用する（退避に成功してから呼ぶ） */
function applyRestoredStore(src) {
  store = storeFromBackup(src);
  saveStore();
  setLastBackup();
  quizState = null;
  mapState = null; // 地図出題中の古い状態も捨てる
  renderHome();
}

/** バックアップファイルのテキストから復元する（検証 → 確認 → 退避 → 適用） */
function restoreFromText(text) {
  const res = DrillBackup.parseBackup(text, BACKUP_APP_ID);
  if (!res.ok) {
    setBackupStatus("restore-msg", MSG_RESTORE_BAD_FILE, false);
    return;
  }
  if (!confirm(MSG_RESTORE_CONFIRM)) return;
  // 現記録があるのに退避できなかった時だけ中止する（記録が空の端末では退避を飛ばして復元できる）
  const arch = DrillBackup.archiveCurrentRecord(localStorage, STORE_KEY, RESTORE_KEY_PREFIX, todayStr());
  if (!arch.ok) {
    setBackupStatus("restore-msg", MSG_RESTORE_ARCHIVE_FAILED, false);
    return;
  }
  applyRestoredStore(res.state);
  showBackupStatus(MSG_RESTORE_DONE); // 復元後はホームへ戻るので、ホームの表示欄にも出す
}

function openBackup() {
  document.getElementById("restore-msg").textContent = "";
  document.getElementById("backup-status").textContent = "";
  showScreen("backup");
}

// ============================================================
// 共通ユーティリティ
// ============================================================
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function flashMsg(elId, result) {
  const el = document.getElementById(elId);
  el.textContent = result.msg;
  el.className = "form-msg " + (result.ok ? "ok" : "ng");
}

// ============================================================
// イベント結線・初期化
// ============================================================
function bindEvents() {
  // ホーム
  document.querySelectorAll(".step-btn[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => startStep(parseInt(btn.getAttribute("data-step"), 10)));
  });
  document.getElementById("btn-backup").addEventListener("click", saveBackup);
  document.getElementById("btn-backup-restore").addEventListener("click", openBackup);
  // 促しバナーのタップも保存を直接実行する
  document.getElementById("home-backup-reminder").addEventListener("click", saveBackup);

  // クイズ（Step1/3/4共通）
  document.getElementById("btn-quiz-quit").addEventListener("click", renderHome);
  document.getElementById("btn-quiz-next").addEventListener("click", nextStepQuestion);
  document.getElementById("btn-reveal").addEventListener("click", revealWriteAnswer);
  document.getElementById("btn-correct").addEventListener("click", () => gradeWrite(true));
  document.getElementById("btn-wrong").addEventListener("click", () => gradeWrite(false));

  // 地図（Step2）
  document.getElementById("btn-map-quit").addEventListener("click", renderHome);
  document.getElementById("btn-map-next").addEventListener("click", nextMapQuestion);
  document.getElementById("btn-map-confirm").addEventListener("click", confirmMapAnswer);

  // 結果
  document.getElementById("btn-home").addEventListener("click", renderHome);

  // バックアップ
  document.getElementById("btn-export").addEventListener("click", saveBackup);
  document.getElementById("drive-save").addEventListener("click", saveDriveSettings);
  document.getElementById("drive-test").addEventListener("click", testDrive);
  document.getElementById("restore-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => restoreFromText(String(reader.result));
    reader.onerror = () => setBackupStatus("restore-msg", MSG_RESTORE_READ_FAILED, false);
    reader.readAsText(file);
    e.target.value = ""; // 同じファイルをもう一度選べるように
  });
  document.getElementById("btn-backup-back").addEventListener("click", renderHome);
}

function main() {
  bindEvents();
  loadDriveForm();
  renderHome();

  // ストレージ永続化を要求（iOS の自動削除を受けにくくする。失敗しても動作に影響なし）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // PWA: service worker 登録（http/https 環境のみ。file:// では何もしない）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    // すでに制御中のSWがあった状態から controller が変わった場合だけ「更新」とみなす
    // （初回インストール時も controllerchange は発火するが、それは更新ではないので除外する）
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadControllerAtLoad) return;
      const btn = document.getElementById("home-update-banner");
      if (!btn) return;
      btn.classList.remove("hidden");
      btn.onclick = () => location.reload();
    });
    navigator.serviceWorker
      .register("sw.js")
      // 自動更新チェックは最大24時間に1回しか走らない仕様のため、起動のたび明示的に即チェックする
      .then((reg) => reg.update().catch(() => {}))
      .catch((e) => console.warn("SW登録失敗", e));
  }
}

document.addEventListener("DOMContentLoaded", main);
