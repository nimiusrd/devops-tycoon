# Issue #476 R&D prototype（本番バランスではない）

Easy で納品が甘く S が連発する件（[#476](https://github.com/nimiusrd/devops-tycoon/issues/476)）の **捨て実験**。  
**本番の Easy / S 既定値は書き換えない。このブランチを live バランスとしてマージしないこと。**

AI の短期リターンつまみ（`aiDependencyPerTask` など。#359 / #387）は意図的に未変更。

## バリアント切り替え（再ビルド不要）

クエリ `?rd=` またはタイトル画面の R&D ピッカー。

| 指定 | 意味 |
| --- | --- |
| 未指定 / `baseline` / `off` / `live` | 現行ライブ値 |
| `threshold` / `threshold-only` | S 閾値だけ上げる。Easy 納品ペースは baseline |
| `pace` / `pace-only` | Easy 納品ペースだけ締める。S 閾値は baseline |

未知値は baseline。既定は baseline なので、実験者が選ばない限り本番挙動のまま。

研究プレイ条件（Issue 本文と同じ）:

- Easy / 組織タイプ 標準 / 試練 0 / seed `devops-tycoon` / Sprint 1–3 のみ

例（Pages または `npm run dev`）:

- baseline: `?seed=devops-tycoon`
- threshold-only: `?rd=threshold&seed=devops-tycoon`
- pace-only: `?rd=pace&seed=devops-tycoon`

## つまみ（コード上の正本）

調査して使った実つまみ。推測で別パラメータは触っていない。

### 1. S 評価の閾値（評価バー）

- 消費: `src/sim/sprintGrade.ts` → `evaluateSprintGrade` / `gradeFromRatio`
- 正本: `src/data/balance/sprint.ts` → `SPRINT_BALANCE.gradeThresholdS`
- ID: `sprint.grade.threshold.S`
- 式: 健全比 `ratio = (delivered - penalties) / max(1, delivered) + stabilizingBonus` がこの値以上なら S
- **threshold-only だけがここを変える。pace-only は変えない。**

### 2. Easy 納品 / 出荷ペース（どれだけ仕事が出るか）

S1–3 の通常スプリント量は次の **2 値がセット** で決まる（床だけ下げても `taskCountMul` 側が 52 件で勝つ）。

| つまみ | ファイル | ID / フィールド |
| --- | --- | --- |
| Easy 通常タスク床 | `src/data/balance/pacing.ts` → `PACING_BALANCE.normalTaskFloorEasy` | `pacing.task.normalFloor.easy` |
| Easy タスク量倍率 | `src/data/difficulties.ts` → `DIFFICULTY_DEFS.easy.taskCountMul` | `getDifficulty('easy').taskCountMul` |

消費:

- 床: `src/sim/run/sprintBaselineBuild.ts` → `normalTaskFloor('easy')`
- 倍率: `src/sim/run/engine.ts` の `baseConfig.taskCount = round(28 * taskCountMul)`（シナリオ基底 28）

**pace-only だけがこの 2 値を変える。threshold-only は変えない。**

elite / boss 床と elite 倍率は、研究プレイが Sprint 1–3（四半期 6 本中の前半）なので未変更。

## 値

| つまみ | baseline（ライブ） | threshold-only | pace-only |
| --- | --- | --- | --- |
| `sprint.grade.threshold.S` | `0.955` | **`0.99`** | `0.955` |
| `pacing.task.normalFloor.easy` | `58` | `58` | **`50`**（Normal 床） |
| Easy `taskCountMul` | `1.85` | `1.85` | **`1.65`**（Normal 倍率） |

通常スプリントの期待タスク数（標準シナリオ・一時 modifier なし）:

- baseline / threshold-only: `max(58, round(28 × 1.85))` = **58**
- pace-only: `max(50, round(28 × 1.65))` = **50**

実験幅の意図:

- S を `0.955 → 0.99`（+3.5pp）。観察メモの完了率 96–98% / 全スプリント S を、3 本で動かせる大きさ。A/B/C 境界は据え置き。
- Easy 量を Hard（床 42 / mul 1.4）へは寄せず、**Easy の組織補正のまま Normal 相当の出荷量**にする。

## メトリクス

タイトルと盤面右下に R&D HUD。スプリントリザルト時は console にも 1 行出す。

- rank（S/A/B/…）
- delivered
- completion（`done / taskCount`）
- スプリント終了時の senior HP
- max review-wait（`reviewQueueMax`）

本番 UI / 本番テストは足していない。

## 意図的に触っていないもの

- AI 依存の単価 `aiDependencyPerTask`（#359 / #387）
- AI 出荷価値・リテラシー係数（`process.ai.deliveryValue.*`）
- Easy の `reworkRateAdd` / `reviewEfficiencyMul` / `seniorHpCostMul`
- 四半期 Delivery 目標 `outcome.quarter.goal.multiplier.easy`
- elite / boss のタスク床・倍率
- A/B/C 評価境界、ペナルティ係数
- バランスレジストリのライブ値そのもの（`SPRINT_BALANCE` / `PACING_BALANCE` / `DIFFICULTY_DEFS` の定数）

実験の実体は `src/rd/issue476Experiment.ts`。ランタイムで上書きするだけ。
