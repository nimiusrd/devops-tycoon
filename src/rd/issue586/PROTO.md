# Issue #586 Phase 1: 実装前計画（隔離 R&D）

対象: [#586](https://github.com/nimiusrd/devops-tycoon/issues/586) / 親 #548 / 元案 038 / 先行試作 [#779](https://github.com/nimiusrd/devops-tycoon/pull/779)（RI-190）。
範囲: Phase 1 のみ。`PROTO.md` と凍結 params、smoke。比較結果は出さない。
本番コード・通常ラン・`RunEngine`・得点・保存・ruleset・描画へは接続しない。

## 隔離

- 置き場は `src/rd/issue586/` と `scripts/compare-586.mjs` だけ。
- RI-190 の定数は複製して `params.mjs` の `COPIED_FROM_190` に置く。`src/prototypes/implementationPlan.ts` / `src/prototypes/modelAssignment.ts` / `src/sim` / `src/data` は import しない。
- PRNG はライブ `src/sim/rng.ts` の FNV-1a + mulberry32 を `rng.mjs` へ複製する。ライブ RNG は import しない。
- UI / Pixi / E2E / gallery は対象外。

## 問いと合格線

複雑さと残り時間で、先に計画する価値が入れ替わるか。

当初の合格線: **complex で余裕ありは計画ありが 5 本中 4 勝以上。単純か期限ぎりぎりの少なくとも一方で、計画なしが 4 勝以上。** それ以外は Kill。引き分けは勝ちに数えない。

Phase 1 の手計算で、単純な仕事は計画ありの厳密勝ちが構造上存在しない。単純は合否から外す。

最終の合格線: **complex で余裕ありは計画ありが 5 本中 4 勝以上、かつ期限ぎりぎり（complex-tight）は計画なしが 5 本中 4 勝以上。** それ以外は Kill。引き分けは勝ちに数えない。Phase 2 は凍結値を動かさず比較する。

## 単一決定指標

採否に使う値は **`shippedValue`** だけ（期限内に終えた仕事の価値）。

```
needed = planTicks + jobWork + (wandered ? wanderExtra : 0)
shippedValue = needed <= deadline ? jobValue - (wandered ? wanderPenalty : 0) : 0
```

完成 tick や迷走回数そのものは得点にしない。タイは勝ちに数えない。

## 盤面（RI-190 の最小複製）

仕事は 1 件。工数 6、価値は simple 10 / complex 18。1 tick に計画 1 か実装 1。計画中は進捗も出荷も増えない。迷走は最初の実装 tick で工数へ足す。完了時に迷走していれば価値から 6 を一度だけ引く。

方針は 2 つ: plan（先に計画 2 tick を払い、complex の迷走率を下げる）、rush（すぐ実装する）。

比較 seed は 5 本: `RI-586-a` .. `RI-586-e`。各 seed で方針より先に `u ~ Uniform[0, 1)` を 1 回引き、4 条件と 2 方針が同じ列を共有する。迷走は `u < wanderRate(kind, policy)`。

## 迷走率

| 仕事 | 計画あり | 計画なし |
| --- | ---: | ---: |
| complex | 0.25 | 0.50 |
| simple | 0.50 | 0.50 |

単純は計画しても迷走率を下げない。計画不要の初動遅延だけが残る。complex では計画ありが半分。同じ u なので「計画だけ迷走」は起きない。

## 期限

期限ぎりぎりは「迷走しなければ、計画ありでちょうど間に合う」。計画ありが必ず間に合わない期限は置かない。

| 条件 | deadline | 根拠 |
| --- | ---: | --- |
| *-tight | 8 | 計画 2 + 工数 6 |
| *-plenty | 12 | RI-190 の complexLong。迷走 +2 でも計画あり 10 ≤ 12 |

#779 の迷走工数 +3 だと、期限 8 で計画なしも 6+3=9 で未完了になり、期限ぎりぎりの計画なし厳密勝ちが消える。実験候補は +2 に固定する。迷走しても計画なしは 8 でちょうど終わる。

## 凍結値

ライブ複製（式には入れない）:

| 複製元 | 値 |
| --- | --- |
| RI-190 seed / 計画 tick | `RI-190` / 2 |
| RI-190 工数 / 迷走工数 / ペナルティ | 6 / 3 / 6 |
| RI-190 価値 | simple 10 / complex 18 |
| RI-190 期末 | 6 / 8 / 12 |
| RI-190 単純短い | rush 10 / plan 0 |
| RI-190 複雑ぎりぎり | rush 0 / plan 18 |
| RI-190 複雑余裕 | rush 12 / plan 18 |

実験候補（式の正本）:

| 名前 | 値 |
| --- | --- |
| seeds | `RI-586-a` .. `RI-586-e` |
| policies | plan, rush |
| decisionMetric | `shippedValue` |
| planTicks / jobWork | 2 / 6 |
| wanderExtra / wanderPenalty | 2 / 6 |
| tight / plenty | 8 / 12 |
| complex 迷走率 | plan 0.25 / rush 0.50 |
| simple 迷走率 | 両方針 0.50 |
| 単純の合否 | 外す |

## 手計算: 必要 tick

```
plan 迷走なし: 2+6=8
plan 迷走あり: 2+6+2=10
rush 迷走なし: 6
rush 迷走あり: 6+2=8
```

| 帯 | u | complex plan | complex rush | simple 両方 |
| --- | --- | --- | --- | --- |
| 両方迷走 | u < 0.25 | 迷走 | 迷走 | 迷走（u < 0.50） |
| 計画なしだけ | 0.25 ≤ u < 0.50 | なし | 迷走 | 迷走 |
| どちらでもない | u ≥ 0.50 | なし | なし | なし |

## 手計算: 4 条件の勝敗

価値は完了なら complex 18 / simple 10、迷走完了なら 12 / 4、未完了は 0。

| 条件 | 抽選 | 計画あり | 計画なし | 勝者 |
| --- | --- | ---: | ---: | --- |
| complex-plenty | 両方迷走 | 12 | 12 | タイ |
| complex-plenty | 計画なしだけ | 18 | 12 | 計画あり |
| complex-plenty | どちらでもない | 18 | 18 | タイ |
| complex-tight | 両方迷走 | 0 | 12 | 計画なし |
| complex-tight | 計画なしだけ | 18 | 12 | 計画あり |
| complex-tight | どちらでもない | 18 | 18 | タイ |
| simple-plenty | 両方迷走 | 4 | 4 | タイ |
| simple-plenty | どちらでもない | 10 | 10 | タイ |
| simple-tight | 両方迷走 | 0 | 4 | 計画なし |
| simple-tight | どちらでもない | 10 | 10 | タイ |

内訳:

- complex-plenty: 計画ありが勝つ抽選はある（計画なしだけ迷走）。計画なしの厳密勝ちは構造上ない（余裕 12 では迷走しても両方完了し、計画ありが損をする帯がない）。
- complex-tight: 両方迷走なら計画なし 12、計画なしだけ迷走なら計画あり 18。両方の厳密勝ちがある。
- simple-plenty: 両方針が同じ迷走率なので結果は常に同点。計画ありの厳密勝ちはない。
- simple-tight: 迷走すると計画ありは 10>8 で未完了、計画なしは 8 で完了（価値 4）。計画ありの厳密勝ちはない。

結論: **単純な仕事で計画ありが一度も勝てない。** 単純は合否から外す。complex-plenty は計画ありが勝つ抽選があり、complex-tight は両方の厳密勝ちがある。数値を後から合わせて隠していない。工数・価値・計画 tick は RI-190 のまま、迷走工数だけ +3 を +2 にした。

## スクリプト

```
node scripts/compare-586.mjs
```

引数なしは smoke。`--full` は Phase 1 では比較結果を書かず、範囲外と表示する。

## 現行実装との境界

- 通常の工程、カード、勝敗、SPEC、保存、ruleset、固定トラック、WebGL 停止契約へは接続しない。
- #552 の仕様調査は未知の要件を調べる行為。本件は既知仕様に対する実行計画で、実 LLM は呼ばない。
- 採否は本 Issue に残す。本番導入は別単位。
