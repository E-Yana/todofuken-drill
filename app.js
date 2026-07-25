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
const DEFAULT_NEW_PER_DAY = 5; // 1日に増やす新出県の数
const BACKUP_REMIND_DAYS = 14; // 最終バックアップからこの日数が経ったら書き出しを促す
// Leitner の箱ごとの「次に出すまでの日数」（箱が上がるほど間隔が伸びる）
const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 15 };
const MAX_BOX = 5;
const READING_STEP = 1; // よみ（読み方3択）ステップの番号
const MAP_STEP = 2; // ばしょ（地図）ステップの番号
const REGION_STEP = 3; // ちほう（地方3択）ステップの番号
const WRITE_STEP = 4; // かく（書く・自己採点）ステップの番号
const MAX_SNAP_UNITS = 60; // 地図タップの吸着上限（viewBoxユニット）。これより陸から遠いタップは無反応にする
// アプリの表示用バージョン。中身を更新したら sw.js の CACHE と対で必ずインクリメントする
// （ホーム画面に表示することで、iPad側で更新が反映されたか目視確認できるようにする）
const APP_VERSION = "v3";

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
 * 指定ステップの今日出す県IDの配列を作る。
 *   1. 復習（既出で期限到来）を優先（箱小→間違い多い順）
 *   2. 新規（未学習）を、北→南の地方順で newPerDay 件まで
 *   3. 全体を dailyCount で切る
 */
function buildStepQueue(step) {
  const today = todayStr();
  const dailyCount = store.meta.settings.dailyCount || DEFAULT_DAILY;
  const newPerDay = store.meta.settings.newPerDay ?? DEFAULT_NEW_PER_DAY;

  const sorted = window.PREFECTURES.slice().sort((a, b) => {
    const ra = regionOrder(a.region);
    const rb = regionOrder(b.region);
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });

  const pool = sorted.map((p, idx) => ({
    p,
    c: getCard(cardId(step, p.id)),
    idx,
  }));

  const reviews = pool
    .filter((x) => x.c.history.length > 0 && x.c.dueDate <= today)
    .sort((a, b) => {
      if (a.c.box !== b.c.box) return a.c.box - b.c.box; // 苦手(箱小)を先に
      return b.c.wrongCount - a.c.wrongCount; // 間違い回数が多い順
    });

  const fresh = pool
    .filter((x) => x.c.history.length === 0)
    .sort((a, b) => a.idx - b.idx);
  const freshCapped = fresh.slice(0, newPerDay);

  const ordered = [...reviews, ...freshCapped];
  return ordered.slice(0, dailyCount).map((x) => x.p.id);
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
  document.getElementById("home-streak").textContent = store.meta.streak || 0;
  document.getElementById("home-mastered").textContent = totalMastered();

  [READING_STEP, MAP_STEP, REGION_STEP, WRITE_STEP].forEach((step) => {
    const el = document.getElementById("progress-" + step);
    if (el) el.textContent = `${masteredForStep(step)}/47`;
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
  document.getElementById("app-version").textContent = APP_VERSION;
  showScreen("home");
}

/** ホームの「きろくを書き出してね」促しの表示/非表示を更新する */
function updateBackupReminder(today) {
  const el = document.getElementById("home-backup-reminder");
  if (!el) return;
  const hasProgress = Object.keys(store.progress).length > 0;
  const last = store.meta.lastBackup;
  const due = !last || addDays(last, BACKUP_REMIND_DAYS) <= today;
  el.classList.toggle("hidden", !(hasProgress && due));
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
    quizState = { step, ids: s.ids, index: s.index, results: s.results || {} };
  } else {
    const ids = buildStepQueue(step);
    if (ids.length === 0) {
      renderHome();
      return;
    }
    quizState = { step, ids, index: 0, results: {} };
    store.sessions[step] = { date: today, ids, index: 0, results: {} };
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
  };
  saveStore();
  if (quizState.index >= quizState.ids.length) {
    finishSession();
  } else {
    showStepQuestion();
  }
}

function finishSession() {
  finishStepSession(quizState.ids, quizState.results);
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
    mapState = { ids: s.ids, index: s.index, results: s.results || {} };
  } else {
    const ids = buildStepQueue(MAP_STEP);
    if (ids.length === 0) {
      renderHome();
      return;
    }
    mapState = { ids, index: 0, results: {} };
    store.sessions[MAP_STEP] = { date: today, ids, index: 0, results: {} };
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
  finishStepSession(mapState.ids, mapState.results);
}

// --- 結果画面（Step1〜4共通） ---------------------------------
/** 連続日数の更新とスコア表示。ids/results はステップ問わず共通形式 */
function finishStepSession(ids, results) {
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
}

// --- バックアップ（エクスポート / 復元） ---------------------
function exportData() {
  const blob = new Blob([JSON.stringify(store, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `todofuken_drill_backup_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  store.meta.lastBackup = todayStr();
  saveStore();
}

function restoreData(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("不正なデータ");
    store = {
      progress: parsed.progress || {},
      meta: Object.assign(
        {
          streak: 0,
          lastStudyDate: null,
          lastBackup: null,
          settings: { dailyCount: DEFAULT_DAILY, newPerDay: DEFAULT_NEW_PER_DAY },
        },
        parsed.meta || {}
      ),
      sessions: parsed.sessions || {},
    };
    store.meta.lastBackup = todayStr();
    saveStore();
    return { ok: true, msg: "きろくを復元しました。" };
  } catch (e) {
    return { ok: false, msg: "復元に失敗しました。バックアップJSONを確認してください。" };
  }
}

function openBackup() {
  document.getElementById("restore-msg").textContent = "";
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
  document.getElementById("btn-backup").addEventListener("click", openBackup);
  document.getElementById("home-backup-reminder").addEventListener("click", openBackup);

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
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("restore-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = restoreData(reader.result);
      flashMsg("restore-msg", res);
    };
    reader.readAsText(file);
  });
  document.getElementById("btn-backup-back").addEventListener("click", renderHome);
}

function main() {
  bindEvents();
  renderHome();

  // ストレージ永続化を要求（iOS の自動削除を受けにくくする。失敗しても動作に影響なし）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // PWA: service worker 登録（http/https 環境のみ。file:// では何もしない）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW登録失敗", e));
  }
}

document.addEventListener("DOMContentLoaded", main);
