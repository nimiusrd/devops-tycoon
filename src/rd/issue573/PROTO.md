# #573 Phase 1: レビューBot専用経路の追加評価（本番マージしない）

Issue [#573](https://github.com/nimiusrd/devops-tycoon/issues/573) / 親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。
[#730](https://github.com/nimiusrd/devops-tycoon/pull/730) の隔離モデル（`src/prototypes/reviewBot.ts`）を `src/rd/issue573/` へ複製し、複数 seed・誤検知率・仕事構成で係数版と専用経路を比較する。

本番のカード・工程・通常ラン・保存形式は変更しない。このディレクトリと `scripts/compare-573.mjs` 以外の本番経路は触らない。

Phase 1 は条件固定と決定論スクリプトだけ。全セル比較は走らせない。結果を見てパラメータを後から動かさない。

実行時の正本は `src/rd/issue573/params.mjs` の `FROZEN`。以下はその凍結値の写しである。

## 凍結パラメータ

### 盤面

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| itemCount | `20` | #730 |
| deadline（ticks） | `12` | #730 |
| staffSlots | `3` | #730 |
| verificationPerTick | `2` | #730 |
| 全PRの初期状態 | 実装済み・レビュー待ち（tick 0 で到着） | #730 |

### seed（5）

| seed | 役割 |
| --- | --- |
| `RI-177` | #730 と同じ既存 seed |
| `RI-573-a` | 追加決定論 seed |
| `RI-573-b` | 追加決定論 seed |
| `RI-573-c` | 追加決定論 seed |
| `RI-573-d` | 追加決定論 seed |

RNG は `src/sim/rng.ts` と同じ FNV-1a `hashSeed` + mulberry32 の隔離コピー。本番モジュールは import しない。各案件は ID 順に 1 回 `rng() < fpRate` で誤検知フラグを事前生成する（complex も含む。#730 と同じ消費）。

### 仕事構成（3）× 20件

| composition | 並び |
| --- | --- |
| `routine-heavy` | routine × 20 |
| `complex-heavy` | complex × 20 |
| `half-half` | `[routine, complex]` を 10 回（偶数 ID が routine、奇数 ID が complex） |

`halfHalfPattern` は `alternate-routine-first`。#730 の mixed（complex/routine/routine の繰り返し）とは別構成。

### 誤検知率（2）

| ラベル | fpRate |
| --- | --- |
| #730 default | `0.25` |
| 2x default | `0.50` |

誤検知した routine は Bot 成功後に人間 Review へ戻る。再送しない。追加負担は仕分け 1 + 通常レビュー 3（合計 4 工数）。#730 どおり `humanLeft += 1`（元の routine レビュー 3 に加算）。

### 腕（2）

| arm | 人員配分 | tick あたり有効工数 | 初回 tick |
| --- | --- | --- | --- |
| `coefficient` | 人間 3 枠 | 人間 `3 * 1.2 = 3.6`、Bot 0、検証 2 | 準備なし |
| `dedicated` | 人間 2 + Bot運用 1 | 人間 2、Bot 2、検証 2 | 準備で人間 2 工数を消費し、人間レビューは 0 |

`coefficient` は #730 / `review-bot` カードの `base.reviewEfficiencyMul = 1.2` を定数としてコピーした値。カードデータは live import しない。

人間のみ腕は比較対象に含めない。

### 案件スペック

| kind | value | 人間レビュー工数 | Bot工数 | 専用経路の初期 stage |
| --- | --- | --- | --- | --- |
| routine | `2` | `3` | `1` | `bot` |
| complex | `5` | `6` | `1`（送らない） | `human` |

係数版は全件 `human` から開始する。

### 処理規則（#730 のまま）

- 同じ tick で Bot→人間、人間→検証、Bot→検証を連続処理しない
- 人間 FIFO は `humanQueuedAt`、同時なら ID
- Bot 差戻しは検出 tick を到着とし、既存の人間待ちを ID だけで追い越さない
- Bot 成功も共通の最終検証（2件/tick）を通る
- 出荷は `stage === 'done'` を一度だけ数える
- カード強化・アクティブ・他効果・品質/見逃しは含めない

## 指標（凍結）

| 優先 | 名前 | 定義 |
| --- | --- | --- |
| 主 | `shippedCount` | 期限到達時に `stage === 'done'` の件数 |
| 副 | `medianReviewWaitTicks` | 出荷した案件のレビュー待ち tick の中央値 |

レビュー待ち（1案件）:

1. レビュー待ち区間は Bot または人間 Review に並んでいる期間。最終検証の待ちは含めない。
2. 区間の開始は、初期は tick 0。誤検知差戻しは検出 tick（`humanQueuedAt`）。
3. 区間の待ちは「その区間で初めて工数が入った tick − 開始 tick − 1」。最初の処理 tick で工数が入れば 0。
4. 誤検知で人間へ戻った案件は、Bot 区間の待ちと人間区間の待ちを加算する。
5. 中央値は出荷案件だけ。0 件なら `null`。偶数件は中央 2 件の算術平均。

`deliveredValue` は JSON 診断用に残すが、Phase 1 の表の主指標には使わない。

## 比較行列

`5 seed × 3 composition × 2 fpRate × 2 arm = 60` セル。

```bash
node scripts/compare-573.mjs
node scripts/compare-573.mjs --json /tmp/compare-573.json
```

決定論。同じ入力は同じ表と JSON を返す。壁時計・描画・WebGL は使わない。

## Phase 1 でやらないこと

- 全 60 セルの実行と結果の記録
- 結果を見たあとのパラメータ変更
- 本番コード経路の変更
- 採否（Adopt / Iterate / Kill）の記入

起動確認だけは次で行う。このケースは比較行列に含めない。

```bash
node scripts/compare-573.mjs --smoke
```

1 routine・4 tick・dedicated・誤検知なし。出力形だけ確認し、比較数値は残さない。
