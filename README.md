# とどうふけんドリル

日本地図で都道府県の位置と形を覚え、県名・県庁所在地を漢字で書けるようにするための、子ども向け学習PWA。
[kanji_drill/](../kanji_drill/)（漢字ドリル）と同じ設計（フレームワーク無し・localStorageのみ・Leitran式間隔反復）を踏襲した独立アプリ。

## ステップ構成

| Step | モード | 内容 | 採点 |
|---|---|---|---|
| 1 | よみ | 漢字の県名→よみ（3択）。地図で場所・形も同時に表示 | 自動 |
| 2 | ばしょ | 地図タップで位置当て／地図ハイライト→県名3択 | 自動 |
| 3 | ちほう | 県名→8地方のどれか（3択）。地図で場所・形も同時に表示 | 自動 |
| 4 | かく | よみ＋地図ヒント→紙に漢字で書く→自己採点 | 自己 |
| 5 | けんちょうしょざいち | （準備中） | - |
| 6 | そうごう | （準備中） | - |

Step1（よみ）・Step2（ばしょ）は、まだ習っていない「ちほう」を先取りできるよう、正誤フィードバックに
「これは○○地方の△△県だよ」と地方名を併記する。いきなりStep3で地方を問われても迷わないようにするため。

Step1・3・4は、文字の暗記だけでなく場所・形も同時に覚えられるよう、対象の県をハイライトした地図
（[app.js](app.js) の `renderMapHint()`）を問題文と一緒に表示する。日本地図全体だと県が小さすぎるため、
`zoomToRegion()` で対象県が属する地方全体がちょうど収まる範囲まで自動でズームする
（`getBoundingClientRect`＋`getScreenCTM`で正確な表示範囲を計算。Step2の全体地図はズームしない）。

Step5・6はデータ（`prefectures_data.js` の `capital`/`capitalReading`/`capitalDiffers`）を先行投入済みだが、UIは未実装（ホームで🔒表示）。

## ローカルでの動作確認

```bash
cd todofuken_drill
python3 -m http.server 8000
```

同じWi-Fiに繋いだiPadのSafariで `http://<MacのIPアドレス>:8000` を開く。

## 公開手順（GitHub Pages・kanji_drillと同方式）

1. 新規のpublic GitHubリポジトリを作成し、このフォルダの中身をpushする
2. リポジトリの Settings → Pages で公開を有効化
3. iPad Safari で公開URLを開き、共有ボタン →「ホーム画面に追加」

**⚠️ 更新の度に必ず [sw.js](sw.js) の `CACHE` バージョン番号を上げること。** 上げないとiPadのService Workerが古いキャッシュを使い続け、更新が反映されない。

## データの出典

- 都道府県データ（[prefectures_data.js](prefectures_data.js)）: 都道府県名・県庁所在地は一般に公知の情報として手動作成。
- 日本地図SVG（[index.html](index.html) にインライン埋込）: [Geolonia Japanese Prefectures](https://github.com/geolonia/japanese-prefectures)（MIT License）より取得。各県要素の `data-code` はJISコード（1〜47、ゼロ埋めなし）。

## 保守メモ

- 状態は localStorage キー `todofukenDrill_v1` のみに保存（サーバー・アカウント無し）。端末変更時は「きろくの書き出し・よみこみ」で移行する。
- 習熟度カードのID規約: `` `s{step}-{都道府県JISコード(2桁ゼロ埋め)}` ``（例: `s1-13` = Step1・東京都）。
- 出題キュー（`buildStepQueue`）はステップごとに独立したSRSを持つ。新出県は8地方の北→南順で少しずつ増える。
