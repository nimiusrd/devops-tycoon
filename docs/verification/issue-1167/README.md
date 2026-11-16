# Review 配置探索の性能検証（#1167）

測定日: 2026-11-17（JST）。比較元は `7c45b0d5`、比較先は本変更。集計の実値、各入力の時間、出力一致のハッシュは [comparison.json](comparison.json) に保存した。

## 変更と維持する契約

プレイヤーが Review の滞留を読み取り、対象の粒を選ぶ際に、配置探索が表示更新を長時間止める問題を対象とする。対象はスプリント盤面の Pixi 描画計画で、HTML 操作と要約の意味、既存のトークン、粒数、ゲーム進行は維持する。新規トークン・コンポーネントは追加しない。

- 最良候補を更新できない位置は、既存の比較関数で判定してから提示計算を省く。列挙順、grid、許容誤差、同点時の選択は変えない。
- 同じ候補・同じ縮尺の提示結果を、盤外・工程間交差・重心の判定で共有する。最初の交差で残りの交差と縮尺の計算を止める。公開の交差件数 API は引き続き全件を数える。
- 二分探索で不変の半径、工程所属、キャラ枠を事前計算する。反復数と座標の演算順は保つ。
- Review の元入力（順序・サイズ・位置・基準点など）と縮尺が完全一致する間、候補ごとの Review 提示座標を再利用する。最後の一形状だけを保持する。非 Review の提示位置は毎回更新し、フロー移動後も各候補の交差と順位を判定し直す。最終シフトの cache key には引き続き非 Review 粒の位置を含める。

## 実ブラウザ

Node v24.16.0 / Dev Container（Linux arm64）、同一 Chromium 158.0.8127.18、headless / SwiftShader による実 WebGL。production build + preview、1024×768、DPR 1、Easy、seed `qa-seed-1031`、速度 1、motion 通常。foreground の一ページずつを直列に実行し、coverage、trace、スクリーンショット、他のテストと分離した。ブラウザ依存ライブラリの準備後、退避した変更前 build と変更後 build を同じ環境で再測定した。

公開 API で startRun → pause → 1,500ms 待機 → beginSetupSprint → pause を行い、canvas と WebGL の準備完了を待つ。滞留場面は pause 中に `game.step(100)` を Review 9 件以上まで実行した。両版とも 26 回で Backlog 20 / Coding 4 / Review 10 / Done 24 に到達した。内部状態の注入は行っていない。

FPS はページ内の RAF 数 / 実経過時間。long task は PerformanceObserver で記録し、12 秒後のページ内タイマーで pause する。計測中に Playwright から state や step を反復呼び出ししない。

| 場面・指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| 通常 FPS | 36.50 | 45.58 |
| 通常の最大 RAF 間隔 | 766.7ms | 747.2ms |
| 通常の long task 合計 / 実計測時間 | 2,257 / 12,164ms | 712 / 12,001ms |
| Review 滞留 FPS | 3.95 | 36.08 |
| Review 滞留の最大 RAF 間隔 | 1,766.7ms | 316.6ms |
| Review 滞留の long task 合計 / 実計測時間 | 12,276 / 14,189ms | 3,534 / 12,001ms |

通常場面の終了状態は両版とも Backlog 34 / Coding 6 / Review 5 / Done 13。滞留場面は両版とも Backlog 1 / Coding 7 / Review 13 / Done 37。変更前はメインスレッドの停止で終了タイマーも遅延した。

CPU profile は FPS と別 run で、同じ開始状態から 8 秒予定で採取した。`findReviewPileShiftInRange` 配下の inclusive sample time は、通常で **939.4 → 192.7ms**、滞留で **8,269.8 → 1,661.1ms**。滞留時のタイマー実経過は 9,428.7 → 8,000.4ms。minify 後の関数名と chunk URL の両方で照合し、他 chunk の同名関数を除いた。生 profile の hash と採取区間全体の sample time も JSON に記録した。

## 単体の cold / warm / flow 進行

同一 Node・依存関係で coverage なしの `planBoardScene` を計測。各 fixture の初回を cold、同一入力を続けて 5 回呼び出した中央値を warm とした。`0.50` は直前の `0.48` からフロー位置を変更した最終シフト cache miss で、Review 提示の部分キャッシュは再利用可能な条件である。

| 入力 | 初回: 変更前 → 後 | warm 中央値: 変更前 → 後 |
| --- | ---: | ---: |
| Review 3 + Coding 9 | 2.48 → 2.10ms | 0.48 → 0.45ms |
| Review 9 + Coding 9（ID 一意） | 1,710.01 → 118.54ms | 0.99 → 0.37ms |
| Review 15 + Coding flow 0.48 | 7,129.78 → 815.21ms | 2.85 → 0.97ms |
| 同上 flow 0.50（cache miss） | 8,296.04 → 103.05ms | 3.31 → 0.99ms |
| qa-seed-1031 / step 26 | 2,790.40 → 348.51ms | 3.28 → 1.03ms |
| qa-seed-1030 / step 30（解なしで再探索） | 7,141.93 → 924.05ms | 7,357.53 → 141.74ms |

合成 fixture 4 件と、3 seed × 5 時点の公開エンジン snapshot、計 19 入力を比較した。入力、**シーン計画全体と 320 / 390 / 1024 相当の提示粒配列が全て完全一致**した。比較は JSON の数値を含めて行い、許容誤差による一致判定は用いていない。既存の工程キャラ回避・盤外防止・粒の分離・ヒット判定 unit に加え、最適化前の選択基準点を固定する回帰テストを追加した。

## 再実行

両版に同じ `scripts/benchmark-review-pile.mjs` を置き、各版の正確な lockfile で依存関係と production build を準備する。ブラウザ計測は一版ずつ直列に実行する。

```sh
devcontainer exec --workspace-folder . node scripts/benchmark-review-pile.mjs unit reports/1167-after
devcontainer exec --workspace-folder . npm run build
devcontainer exec --workspace-folder . npm run preview -- --host 127.0.0.1 --port 5187 --strictPort
# 別ターミナルで、他のテストや計測を止めて実行
devcontainer exec --workspace-folder . node scripts/benchmark-review-pile.mjs browser reports/1167-after http://127.0.0.1:5187
```

`unit.json`、`browser.json`、入力別の完全出力、通常・滞留の `.cpuprofile` は指定した出力先へ保存される。今回の生データは `reports/1167-before/` と `reports/1167-after/`（git 管理外）に保持している。

## 検証と残る範囲

- `devcontainer exec --workspace-folder . npm test -- tests/unit/render --maxWorkers=2`: **76 ファイル・886 tests 成功**（終了コード 0）。
- 関連 E2E: `sprint-pixi-visual`、`board-pile-overlap`、`board-dot-readability`、`review-pile-hit-tap-1001`、`board-target-preview`、`task-hit-area` を Chromium と `webkit-review-pile-hit-tap` project で実行。**53 条件成功**。WebKit に限定されている全粒タップの Chromium 版 6 条件は既存指定どおり skip。
- 全粒タップ: **320 / 390 / 1024 × exact / integer の全 6 条件成功**。各 Review 粒を毎回初期状態から選択し、確定した task ID まで検証する既存 E2E を使用した。
- レイアウト: `sprint-layout.spec.ts --grep '通常スプリントの5 viewport|8〜11件|12件以上' --project=chromium --workers=2`: **3 tests 成功**（終了コード 0）。320 / 390 / 768 / 1024 / 1440 の通常・渋滞・Review Hell、および reduced motion を確認。
- `npm run lint`、`npm run format:check`、`npm run build`: Dev Container で成功（終了コード 0）。

E2E は `devcontainer exec --workspace-folder . --remote-env PLAYWRIGHT_PORT=54168 npm run test:e2e -- ...` で実行した。初回は 2 workers で、既存テストの撮影先 `/opt/cursor/artifacts` 不足による 5 件と、WebKit 描画準備の待機失敗 3 件が発生した。撮影先を作成して失敗条件を 1 worker で再実行し、途中でブラウザが終了した 320px・integer の 1 件も単独実行で成功した。タイムアウト値と視覚ベースラインは変更していない。

実行ログは `reports/1167-render-unit.log`、`reports/1167-e2e.log`、`reports/1167-e2e-retry.log`、`reports/1167-e2e-retry-webkit.log`、`reports/1167-layout-e2e.log`、`reports/1167-build.log` に保持。対象はスプリント一画面の座標計算のため、複数画面変更向けの gallery は対象外とした。

各条件一回の短時間測定であり、絶対 FPS は software WebGL 環境の値である。実機 GPU / Safari の性能や全 seed・難易度の性能を示さない。測定した滞留場面で秒単位の停止は解消したが、数百 ms の long task は残る。別 seed の重い単体入力（qa-seed-1030 / step 35）も初回 11,374 → 1,351ms まで改善したものの、初回探索の負荷が全てなくなったわけではない。
