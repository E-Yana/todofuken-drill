# とどうふけんドリル（小4）— このアプリの説明（Claude向け）

小学4年生の都道府県学習アプリ（よみ・ばしょ・ちほう・かく）。iPadで使う。公開: GitHub `E-Yana/todofuken-drill`（**push 先は `master`**）
子どもの学習記録はiPadの中（localStorage `todofukenDrill_v1`）にしか無い。

## バックアップ兼きろく（2026-10-17〜）
- ホームの「きろくを ほぞん」で `todofuken_drill_backup_YYYY-MM-DD.json`（`app`・`format`・`summary`＝読む用：ステップ別・苦手上位10（県・ステップ・間違い回数・箱）・連続日数／`state`＝復元用）。処理は `backup.js`（漢字ドリルと同一内容）、試験は `node tests/backup_test.js`
- `todofukenDrill_lastBackup`＝共有シート/ダウンロードを実行した日（Drive 保存の保証ではない）。旧 `store.meta.lastBackup` は読むだけ
- ふくげんはホームの「きろくの ふくげん」から。復元前の退避は `todofukenDrill_v1_restore_<日付>[_n]`（新しい2本だけ残る）。戻したい時はその値を `todofukenDrill_v1` に書き戻す

## 守ること
- `app.js` の `APP_VERSION` と `sw.js` の `CACHE` は対で上げる（上げないと更新バナーも出ない）
- 公開リポジトリなので、子どもの名前・学校名・住所などは書かない
- 標準3機能の正本は本社 `.claude/rules/home-apps.md`
