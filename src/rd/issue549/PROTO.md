# Issue #549 Phase 1: 機能セット出荷（隔離 R&D）

対象: [#549](https://github.com/nimiusrd/devops-tycoon/issues/549) / 親 #548 / 元案 001 / 先行試作 [#733](https://github.com/nimiusrd/devops-tycoon/pull/733)。
範囲: Phase 1 のみ。`PROTO.md` と凍結 params、smoke。比較結果は出さない。
本番コード・通常ラン・`RunEngine`・得点・保存・ruleset・描画へは接続しない。

## 隔離

- 置き場は `src/rd/issue549/` と `scripts/compare-549.mjs` だけ。
- #733 の定数は複製して `params.mjs` の `COPIED_FROM_733` に置く。`src/prototypes/featureSets.ts` / `src/sim` / `src/data` は import しない。
- PRNG はライブ `src/sim/rng.ts` の FNV-1a + mulberry32 を `rng.mjs` へ複製する。ライブ RNG は import しない。
- UI / Pixi / E2E / gallery は対象外。

## 単一決定指標

採否に使う値は **`totalShippedValue`** だけ。

```
totalShippedValue = individualValue + setReward
setReward = sum(completed set integrationValue)
```

#733 は個別出荷と統合価値を別欄に保った。本実験は同じ二欄を足して一つの比較値にする。報酬値は #733 のまま（reports 8、alerts 5）。個別価値をセット報酬へ再加算しない。

完成 tick・手戻り回数は説明用に別掲し、合否には使わない。

## 盤面（#733 の複製）

seed は `RI-153` と `RI-549-a` .. `RI-549-d`。方針は 2 つ: immediate-ship（`0→1→3→4→5→2`）、feature-complete-first（`3→4→5→0→1→2`）。一工数/tick。未選択は待機できる。期限切れで強制 Done やセット完成を付けない。

| 機能 | タスクID | 役割 | 必要工数 | 個別価値 |
| --- | ---: | --- | ---: | ---: |
| レポート | 0 | API | 2 | 4 |
| レポート | 1 | 画面 | 2 | 4 |
| レポート | 2 | 移行 | 5 | 4 |
| 通知 | 3 | API | 1 | 2 |
| 通知 | 4 | 画面 | 1 | 2 |
| 通知 | 5 | 移行 | 4 | 3 |

| 機能 | 必須タスク | 統合価値 |
| --- | --- | ---: |
| reports | 0, 1, 2 | 8 |
| alerts | 3, 4, 5 | 5 |

所属は固定。セット間でタスクを重複利用しない。各タスクは Done で個別価値を一度だけ確定する。セットは最後の必須タスクが Done となった tick に一度だけ完成を記録し、統合価値を確定する。統合価値は個別タスク価値の再加算ではない。

## 手戻り

#733 では移行タスク（`id % 3 === 2`、タスク 2 と 5）だけが初期抽選で `reworkPending` を持つ。実装完了直後に手戻りなら追加 1 工数。再作業を終えるまで Done・個別出荷・機能完成を確定しない。

本実験も同じ対象・同じ追加 1 工数。抽選だけを隔離 PRNG にする。各 seed × 条件で `createRng(seed)` を一度作り、#733 と同じ短絡（移行タスクのときだけ `rng() < p`）で 2 回引く。同一 seed・同一条件の 2 方針は同じ初期盤面を共有する。`p` は条件の `reworkProbability`。

`RI-153` かつ baseline（`p = 0.25`）では #733 と同じくタスク 2 のみ手戻り予定。

## 条件

| 条件 | deadline | reworkProbability | 意味 |
| --- | ---: | ---: | --- |
| baseline | 8 | 0.25 | #733 のまま |
| tight-deadline | 6 | 0.25 | ゼロ手戻りでセットがちょうど完成する最小 tick |
| heavy-rework | 8 | 0.50 | 手戻り確率を baseline の 2 倍 |

tight-deadline の 6 は alerts のゼロ手戻り工数 `1+1+4`。reports は `2+2+5 = 9` なので、先に完成しうるセットは alerts だけ。

## 凍結値

ライブ複製（式には入れない）:

| 複製元 | 値 |
| --- | --- |
| #733 seed / deadline / 工数/tick | `RI-153` / 8 / 1 |
| #733 手戻り確率 / 追加工数 | 0.25 / 1 |
| #733 即時出荷 個別/統合 | 12 / 0 |
| #733 機能完成 個別/統合 | 11 / 5 |
| タスク工数 | 2, 2, 5, 1, 1, 4 |
| タスク個別価値 | 4, 4, 4, 2, 2, 3 |
| セット統合価値 | reports 8, alerts 5 |
| 即時出荷順 | 0, 1, 3, 4, 5, 2 |
| 機能完成順 | 3, 4, 5, 0, 1, 2 |

実験候補（式の正本）:

| 名前 | 値 |
| --- | --- |
| seeds | `RI-153`, `RI-549-a`, `RI-549-b`, `RI-549-c`, `RI-549-d` |
| policies | immediate-ship, feature-complete-first |
| decisionMetric | `totalShippedValue` |
| baseline deadline / p | 8 / 0.25 |
| tight-deadline | 6 |
| heavy-rework p | 0.50 |
| rework extra work | 1 |
| reports / alerts 統合価値 | 8 / 5 |

## 手計算: 実現可能性

手戻り対象は移行 2 件だけなので、抽選の組は `(R2, R5) ∈ {0,1}²`。どちらの方針も期限 6 と 8 ではタスク 2 に到達しない（即時出荷は 5 の途中で終わり、機能完成は 0 の途中まで）。**R2 はどの条件の得点にも乗らない。** 効くのは R5（通知移行の追加 1 工数）だけ。

ゼロ手戻りの必要 tick:

```
immediate-ship:
  0+1+3+4 = 6 で個別 12。alerts 完成はさらに 5 の 4 工数で合計 10。
  reports 完成はこの順では 10 + 5 = 15。
feature-complete-first:
  3+4+5 = 6 で alerts 完成（個別 7 + セット 5 = 12）。
  R5=1 なら 7 tick で alerts 完成（個別 7 + セット 5 = 12）。
  残りで 0 を 2 tick 進めれば個別 11、合計 16。
```

| 条件 | 抽選 | immediate | feature-complete | 勝者 | 即時のセット | 機能完成のセット |
| --- | --- | ---: | ---: | --- | --- | --- |
| baseline | R5=0 | 12 | 16 | feature-complete | なし | alerts（tick 6） |
| baseline | R5=1 | 12 | 12 | tie | なし | alerts（tick 7） |
| tight-deadline | R5=0 | 12 | 12 | tie | なし | alerts（tick 6） |
| tight-deadline | R5=1 | 12 | 4 | immediate | なし | なし |
| heavy-rework | R5=0 | 12 | 16 | feature-complete | なし | alerts（tick 6） |
| heavy-rework | R5=1 | 12 | 12 | tie | なし | alerts（tick 7） |

内訳:

- baseline / heavy-rework（期限 8）: 即時は常に 0,1,3,4 だけを終え、5 に 2 tick。セットは **抽選に関係なく完成しない**（alerts に 10 tick 必要）。機能完成は R5 の有無にかかわらず alerts を完成する（6 または 7 ≤ 8）。得点は 16 対 12、または 12 対 12。**即時が出す厳密な勝ちは構造上ない。**
- tight-deadline（期限 6）: 即時は常に個別 12、セット **抽選に関係なく完成しない**。機能完成は R5=0 のときだけ alerts がちょうど完成し 12（タイ）。R5=1 なら 5 が未完で個別 4。**機能完成が出す厳密な勝ちは構造上ない。**
- heavy-rework は期限が baseline と同じなので、可能な得点の組は baseline と同一。変わるのは R5=1 の確率（0.25 → 0.50）だけ。

結論: **どの条件でも「機能完成が厳密に勝つ抽選」と「即時が出荷で厳密に勝つ抽選」は同時には存在しない。** セット完成は即時方針では常に起きず、baseline / heavy-rework の機能完成方針では常に起きる。tight-deadline だけが抽選でセット完成の有無が分かれる。

数値を後から合わせて隠していない。報酬値・工数・方針順は #733 のまま。

## 二重計上

- 個別出荷イベント数 = Done タスク数。価値は Done タスクの個別値の合計。
- セット完成イベント数 = `completions.length`。`featureId` は高々 1 回。
- `setReward` は完成セットの `integrationValue` の合計であり、個別値を含めない。
- smoke は #733 の RI-153 再現に加え、手戻りなし・期限 20 で両セットを完成させ、追加 tick で値が動かないことを assert する。

## スクリプト

```
node scripts/compare-549.mjs
```

引数なしは smoke。`--full` は Phase 1 では比較結果を書かず、範囲外と表示する。

## 現行実装との境界

- 通常の Task 型・工程・描画・SPEC・保存・ruleset・固定トラック・勝利種別は変更しない。
- 製品画面全体（元案 076）は本件の前提にしない。
- 採否は本 Issue に残す。本番導入は別単位。
