# ミューテーションテスト改善バックログ

実装役向けの作業指示書。ベースラインは GitHub Actions
[Mutation run 30261978402](https://github.com/nimiusrd/devops-tycoon/actions/runs/30261978402)
（2026-07-27、シャード並列・成功）。  
`headSha`: `c065e01ea73cb8df431210dbd6f354cfd3c4059e`

関連設定: [`stryker.config.json`](../stryker.config.json)、[`.github/workflows/mutation.yml`](../.github/workflows/mutation.yml)。  
ベースライン（エピック）: **RI-72**（[`remaining-issues.md`](./remaining-issues.md)）— run 30261978402 専用。  
実装単位: 下表の **`RI-72-A1` 形式**（1 ID = 1PR）。  
再ベースライン: [`.cursor/skills/mutation-remediation-plan/SKILL.md`](../.cursor/skills/mutation-remediation-plan/SKILL.md) に従い、**run ID が変わったときだけ**新しいエピック `RI-{N}` を採番し、実装単位も `RI-{N}-…` で振り直す。同じ run の計画修正では既存エピックを再利用する。旧エピックは完了扱い、未消化単位は新計画へ引き継ぐ。

## 1. ID フォーマット

| 種別 | 形式 | 例 | 意味 |
| --- | --- | --- | --- |
| エピック（ベースライン） | `RI-{N}` | `RI-72` | フルシャード Mutation run 1回分の計画全体。`remaining-issues.md` に載せる |
| 実装単位 | `RI-{N}-{GROUP}{SEQ}` | `RI-72-A1` | 1PR で完了する作業。`GROUP` は優先グループ（A=最高…）、`SEQ` はグループ内の連番（1起算、ゼロ埋めなし） |

規則:

- `{N}` は既存 `RI-(\d+)` の最大+1（欠番再利用なし）。再ベースラインごとに新規。
- `{GROUP}` は大文字1文字 `A`–`Z`。優先度の高い順に A から振る。
- `{SEQ}` はグループ内で着手順に 1, 2, 3…。途中追加は末尾採番（欠番再利用なし）。
- **1実装単位 = 1PR。** ブランチ名・PR タイトル先頭に ID を含める（例: `RI-72-A1: industry の mutation 耐性を上げる`）。
- 実装単位の正本は**本ファイル**。`remaining-issues.md` にはエピックだけを載せ、単位一覧へリンクする。

### 実装単位エントリの書式（必須項目）

各単位は次の見出し＋表＋箇条書きとする。

```markdown
### RI-{N}-{GROUP}{SEQ} — {短いタイトル}

| 項目 | 内容 |
| --- | --- |
| 状態 | 未着手 / 進行中 / 完了 |
| 対象 | `path/to/file.ts`（複数可ならカンマ区切り、原則1ファイル） |
| Baseline | total X% / covered Y% / S=n / NC=n |
| 既存テスト | `tests/unit/….test.ts` または なし |
| 再計測 | `npm run test:mutation:force -- --mutate {path}` |
| 受入 | 数値目標を1行（例: total 70%+） |

やる事:

- {具体的な断言・ケース}
```

完了したら `状態` を `完了` にし、表の下に `After: total …% / S=…（run またはローカル）` を1行追記する。

## 2. 目的と非目的

**目的**

- Survived / NoCoverage が多いコアロジックのユニットテストを強化し、mutation score を上げる。
- 決定論的な `src/sim` / `src/state` の回帰耐性を高める。

**非目的**

- Mutation を PR 必須 CI ゲートにしない（`thresholds.break: null` を維持）。
- スコアのためだけの本番ロジック変更（挙動を変えるリファクタは別課題）。
- 6シャードの HTML レポートを1本に統合すること（必須ではない）。

## 3. ベースライン数値

全体合算（Ignored 除くスコア対象）:

| 指標 | 値 |
| --- | --- |
| Mutation score (total) | **約 73.4%** |
| Mutation score (covered) | **約 77.3%** |
| Killed / Survived / Timeout / NoCoverage | 4157 / 1375 / 513 / 321 |

シャード別:

| シャード | total | Survived | 壁時計（初回） |
| --- | --- | --- | --- |
| sim-run-rest | 63.4% | 329 | ~80分 |
| sim-run-engine | 65.1% | 467 | ~94分 |
| state | 67.0% | 191 | ~4分 |
| sim-orgscale | 77.4% | 199 | ~66分 |
| sim-member-model | 82.7% | 57 | ~30分 |
| sim-root | 86.5% | 132 | ~95分 |

Survived が多い mutator（全体）: `ConditionalExpression` ≫ `EqualityOperator` / `ArithmeticOperator` / `StringLiteral` / `LogicalOperator`。

**エピック完了条件**

- 本ベースラインの実装単位（少なくとも Group A–D。本エピックでは A1–E8）がすべて `完了` であること。

**再ベースライン推奨（エピック完了条件ではない）**

- フルシャード再計測で全体 total がおおむね 80%未満なら、新エピックを採番して追う。
- 中期目安: `engine` / `quarterReview` / `industry` の covered **85%+**

## 4. 作業ルール（実装役共通）

1. **原則はテスト追加・強化のみ。** 本番コード変更は、バグ修正が必要と判明したときに限る。
2. 意図的に落とさない分岐だけ `// Stryker disable next-line` 等を検討する。安易な一括 disable は禁止。
3. **1PR = 1実装単位 ID。** 複数単位をまとめる場合は事前に計画側で ID を統合してから着手する。
4. 変更前に `npm test`、変更後に単位の「再計測」コマンドと `npm run lint` / `npm run format:check`。
5. PR 本文に **実装単位 ID**、Before/After の score（total / covered）と Survived 数を記す。
6. 日本語でコミット・PR する（リポジトリ慣例）。

## 5. 実装単位一覧（着手順）

| ID | タイトル | 状態 | 対象 |
| --- | --- | --- | --- |
| [RI-72-A1](#ri-72-a1--industry-スコア式の境界と係数) | industry スコア式の境界と係数 | 完了 | `src/sim/orgscale/industry.ts` |
| [RI-72-A2](#ri-72-a2--whatifstate-のキーと-modifier) | whatIfState のキーと modifier | 完了 | `src/sim/run/whatIfState.ts` |
| [RI-72-A3](#ri-72-a3--whatifclient-の初カバー) | whatIfClient の初カバー | 完了 | `src/sim/run/whatIfClient.ts` |
| [RI-72-B1](#ri-72-b1--replaypersistence-の失敗系) | replayPersistence の失敗系 | 完了 | `src/state/replayPersistence.ts` |
| [RI-72-B2](#ri-72-b2--metapersistence-の壊れた入力) | metaPersistence の壊れた入力 | 完了 | `src/state/metaPersistence.ts` |
| [RI-72-B3](#ri-72-b3--replay-正規化の条件枝) | replay 正規化の条件枝 | 完了 | `src/state/replay.ts` |
| [RI-72-B4](#ri-72-b4--runpersistence-の境界) | runPersistence の境界 | 完了 | `src/state/runPersistence.ts` |
| [RI-72-C1](#ri-72-c1--quarterreview-の閾値と-outcome) | quarterReview の閾値と outcome | 完了 | `src/sim/run/quarterReview.ts` |
| [RI-72-D1](#ri-72-d1--engine-phase-guard) | engine phase guard | 完了 | `src/sim/run/engine.ts` |
| [RI-72-D2](#ri-72-d2--engine-shop--rest--recruit) | engine shop / rest / recruit | 完了 | `src/sim/run/engine.ts` |
| [RI-72-D3](#ri-72-d3--engine-hydrate--セーブ復元) | engine hydrate / セーブ復元 | 完了 | `src/sim/run/engine.ts` |
| [RI-72-D4](#ri-72-d4--engine-勝敗と-quarterreview-突入) | engine 勝敗と quarterReview 突入 | 完了 | `src/sim/run/engine.ts` |
| [RI-72-D5](#ri-72-d5--engine-nocoverage-潰し) | engine NoCoverage 潰し | 完了 | `src/sim/run/engine.ts` |
| [RI-72-E1](#ri-72-e1--generate-の-teams--id-分岐) | generate の teams / id 分岐 | 完了 | `src/sim/orgscale/generate.ts` |
| [RI-72-E2](#ri-72-e2--effects-の-fold-係数) | effects の fold 係数 | 完了 | `src/sim/run/effects.ts` |
| [RI-72-E3](#ri-72-e3--sprintbaselinebuild-の入力差分) | sprintBaselineBuild の入力差分 | 完了 | `src/sim/run/sprintBaselineBuild.ts` |
| [RI-72-E4](#ri-72-e4--events-の残-survived) | events の残 Survived | 完了 | `src/sim/run/events.ts` |
| [RI-72-E5](#ri-72-e5--outcome-の敗北閾値) | outcome の敗北閾値 | 完了 | `src/sim/outcome.ts` |
| [RI-72-E6](#ri-72-e6--assigntask-の-nocoverage) | assignTask の NoCoverage | 完了 | `src/sim/assignTask.ts` |
| [RI-72-E7](#ri-72-e7--meta-の残-survived) | meta の残 Survived | 完了 | `src/state/meta.ts` |
| [RI-72-E8](#ri-72-e8--roster-の残-survived) | roster の残 Survived | 完了 | `src/sim/member/roster.ts` |

### Group A — ワースト（P0）

### RI-72-A1 — industry スコア式の境界と係数

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/orgscale/industry.ts`](../src/sim/orgscale/industry.ts) |
| Baseline | total 31.48% / covered 32.38% / S=71 / NC=3 |
| 既存テスト | [`tests/unit/orgscale-industry.test.ts`](../tests/unit/orgscale-industry.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/orgscale/industry.ts` |
| 受入 | total **70%+** |

After: total 92.59% / covered 93.46% / S=7（local）

やる事:

- `computeScores` 系の係数を1変数ずつ固定断言
- `Math.min` / `Math.max` 境界、同点 tie-break、league 境界、rival 生成レンジ

### RI-72-A2 — whatIfState のキーと modifier

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/whatIfState.ts`](../src/sim/run/whatIfState.ts) |
| Baseline | total 48.18% / covered 48.18% / S=57 / NC=0 |
| 既存テスト | [`tests/unit/whatIf.test.ts`](../tests/unit/whatIf.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/whatIfState.ts` |
| 受入 | total **70%+** |

やる事:

- `whatIfCacheKey` / state 構築を直接叩き、キー差分・draft join・modifier の `||` / `&&`・clamp を断言

After: total 80.91% / covered 80.91% / S=21 / NC=0（ローカル `npm run test:mutation:force -- --mutate src/sim/run/whatIfState.ts`）

### RI-72-A3 — whatIfClient の初カバー

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/whatIfClient.ts`](../src/sim/run/whatIfClient.ts) |
| Baseline | total 0% / covered n/a / S=0 / NC=32 |
| 既存テスト | なし |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/whatIfClient.ts` |
| 受入 | NoCoverage を大幅減、covered ベースで実用カバレッジあり（目安 total **70%+** または NC≤5） |

After: total 78.13% / covered 78.13% / S=7 / NC=0（local: `npm run test:mutation:force -- --mutate src/sim/run/whatIfClient.ts`）

やる事:

- Worker/Comlink をモックし、成功・import 失敗・remote 例外後 fallback・`resetWhatIfClientForTests` をカバー

### Group B — Persistence / リプレイ

### RI-72-B1 — replayPersistence の失敗系

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/state/replayPersistence.ts`](../src/state/replayPersistence.ts) |
| Baseline | total 50% / covered 73.81% / S=11 / NC=20 |
| 既存テスト | [`tests/unit/replay.test.ts`](../tests/unit/replay.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/state/replayPersistence.ts` |
| 受入 | total **70%+** |

After: total 88.71% / covered 88.71% / S=7 / NC=0 / T=4（ローカル `npm run test:mutation:force -- --mutate src/state/replayPersistence.ts`）

やる事:

- `get` / `clear` / Memory 上限 / `initializeReplayPersistence` fallback / write failure を直接テスト

### RI-72-B2 — metaPersistence の壊れた入力

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/state/metaPersistence.ts`](../src/state/metaPersistence.ts) |
| Baseline | total 59.02% / covered 83.72% / S=7 / NC=18 |
| 既存テスト | [`tests/unit/metaPersistence.test.ts`](../tests/unit/metaPersistence.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/state/metaPersistence.ts` |
| 受入 | total **70%+** |

After: total 81.97% / covered 81.97% / S=11 / NC=0（local: `npm run test:mutation:force -- --mutate src/state/metaPersistence.ts`）

やる事:

- IDB 上の壊れた meta、legacy remove 失敗、legacy 無し fallback

### RI-72-B3 — replay 正規化の条件枝

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/state/replay.ts`](../src/state/replay.ts) |
| Baseline | total 60.14% / covered 65.93% / S=46 / NC=13 |
| 既存テスト | [`tests/unit/replay.test.ts`](../tests/unit/replay.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/state/replay.ts` |
| 受入 | total **70%+** |

After: total 88.51% / covered 90.34% / S=14 / NC=3（local: `npm run test:mutation:force -- --mutate src/state/replay.ts`）

やる事:

- outcome / trials / difficulty / frame 破損、`normalizeReplayKeyframes` の部分破棄と clone 性（ConditionalExpression 対策）

### RI-72-B4 — runPersistence の境界

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/state/runPersistence.ts`](../src/state/runPersistence.ts) |
| Baseline | total 63.03% / covered 69.27% / S=59 / NC=19 |
| 既存テスト | [`tests/unit/runPersistence.test.ts`](../tests/unit/runPersistence.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/state/runPersistence.ts` |
| 受入 | total **70%+** |

After: total 84.36% / covered 84.76% / S=32 / NC=1 / T=3（ローカル `npm run test:mutation:force -- --mutate src/state/runPersistence.ts`）

やる事:

- v1 / 壊れた `replayKeyframes`、`clear` 直呼び、summary / extras 不正値

### Group C — 四半期レビュー

### RI-72-C1 — quarterReview の閾値と outcome

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/quarterReview.ts`](../src/sim/run/quarterReview.ts) |
| Baseline | total 62.27% / covered 63.69% / S=191 / NC=12 |
| 既存テスト | [`tests/unit/quarter-review.test.ts`](../tests/unit/quarter-review.test.ts)、[`quarter-review-seeds.test.ts`](../tests/unit/quarter-review-seeds.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/quarterReview.ts` |
| 受入 | total **75%+** または Survived ≤100 |

After: total 75.28% / covered 76.13% / S=127 / NC=6（ローカル `npm run test:mutation:force -- --mutate src/sim/run/quarterReview.ts`）

やる事:

- `canChooseAdjustment` / `loseReasonForOutcome` / rework 比率閾値（0.3）/ goal 未定義枝 / `OUTCOME_LABELS` 近傍を明示断言
- 仕様変更（Delivery KPI）は RI-68。本単位はテスト強化のみ

### Group D — RunEngine（通しを増やさない）

### RI-72-D1 — engine phase guard

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) |
| Baseline | total 65.14% / covered 68.12% / S=467 / NC=67（ファイル全体。本単位は phase 枝に限定） |
| 既存テスト | [`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/engine.ts` |
| 受入 | 対象枝の Survived を削減（PR に Before/After の該当箇所を記載） |

After: D1 対象行レンジ total 85.19% / covered 85.19% / K=23 / T=23 / S=8 / NC=0（local: `npm run test:mutation:force -- --mutate "src/sim/run/engine.ts:364-366,src/sim/run/engine.ts:517-519,src/sim/run/engine.ts:753-755,src/sim/run/engine.ts:777-779,src/sim/run/engine.ts:891-893,src/sim/run/engine.ts:903-905,src/sim/run/engine.ts:912-914,src/sim/run/engine.ts:919-921,src/sim/run/engine.ts:928-930,src/sim/run/engine.ts:995-997" --testFiles tests/unit/run-engine.test.ts --reporters clear-text --concurrency 4`。Before 同レンジは total 53.70% / covered 58.00% / K=6 / T=23 / S=21 / NC=4）
Full engine mutation は `npm run test:mutation:force -- --mutate src/sim/run/engine.ts --reporters clear-text --concurrency 4` を試行し、dry run 成功（389 tests / 1533 mutants instrumented）後に中断されたため D1 対象行レンジの数値を採用。

やる事:

- phase guard / 不正遷移 / `RunPhaseError` を小さい固定入力で断言

### RI-72-D2 — engine shop / rest / recruit

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) |
| Baseline | total 65.14% / covered 68.12% / S=467 / NC=67（ファイル全体。本単位は shop/rest/recruit 枝に限定） |
| 既存テスト | [`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts)、[`tests/unit/run-engine-d2-shop.test.ts`](../tests/unit/run-engine-d2-shop.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate "src/sim/run/engine.ts:1064-1076,src/sim/run/engine.ts:1094-1173,src/sim/run/engine.ts:1183-1243" --testFiles tests/unit/run-engine.test.ts,tests/unit/run-engine-d2-shop.test.ts --reporters clear-text --concurrency 4` |
| 受入 | shop / rest / recruit 選択枝の Survived 削減を PR に記載 |

After: D2 対象行レンジ total 79.91% / covered 80.28% / K=173 / T=2 / S=43 / NC=1（local: 既存 `tests/unit/run-engine.test.ts` + 新規 `tests/unit/run-engine-d2-shop.test.ts` の両方を `--testFiles` に指定して再計測）。Before 同レンジ（既存 `tests/unit/run-engine.test.ts` のみ）は total 55.25% / covered 56.81% / K=108 / T=13 / S=92 / NC=6。Survived は 92 → 43（49 減）。

やる事:

- shop / rest / recruit の選択枝を固定入力で刺す（通しプレイを増やさない）

### RI-72-D3 — engine hydrate / セーブ復元

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) |
| Baseline | total 65.14% / covered 68.12% / S=467 / NC=67（ファイル全体。本単位は hydrate/復元枝に限定） |
| 既存テスト | [`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts)、persistence 系、[`tests/unit/run-engine-d3-hydrate.test.ts`](../tests/unit/run-engine-d3-hydrate.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/engine.ts` |
| 受入 | hydrate / 復元枝の Survived 削減を PR に記載 |

After: D3 対象行レンジ total 61.83% / covered 62.31% / K=81 / S=49 / NC=1（local: `npm run test:mutation:force -- --incrementalFile /tmp/stryker-d3-after-related-v2.json --mutate src/sim/run/engine.ts:1788-2035 --testFiles tests/unit/runPersistence.test.ts,tests/unit/orgscale-engine.test.ts,tests/unit/whatIf.test.ts,tests/unit/run-engine-d3-hydrate.test.ts --reporters clear-text --concurrency 4`。Before 同条件は total 33.59% / covered 37.61% / K=44 / S=73 / NC=14）

やる事:

- hydrate / セーブ復元まわりの条件・副作用を断言

### RI-72-D4 — engine 勝敗と quarterReview 突入

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) |
| Baseline | total 65.14% / covered 68.12% / S=467 / NC=67（ファイル全体。本単位は勝敗/QR 突入枝に限定） |
| 既存テスト | [`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts)、[`tests/unit/run-engine-d4-outcome.test.ts`](../tests/unit/run-engine-d4-outcome.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/engine.ts` |
| 受入 | 勝敗・quarterReview 突入条件の Survived 削減を PR に記載 |

After: D4 対象行レンジ total 100.00% / covered 100.00% / K=39 / T=6 / S=0 / NC=0（local: `npm run test:mutation:force -- --incrementalFile reports/stryker-d4-after-final.json --mutate "src/sim/run/engine.ts:668-710,src/sim/run/engine.ts:753-773" --testFiles "tests/unit/run-engine.test.ts,tests/unit/run-engine-d4-outcome.test.ts" --reporters clear-text --concurrency 4`。Before 同レンジは total 62.22% / covered 75.68% / K=22 / T=6 / S=9 / NC=8）

やる事:

- 敗北・勝利・quarterReview 突入条件を小さい固定入力で断言

### RI-72-D5 — engine NoCoverage 潰し

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) |
| Baseline | total 65.14% / covered 68.12% / S=467 / NC=67（ファイル全体。本単位は NC 潰し＋ファイル total） |
| 既存テスト | [`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts)、[`tests/unit/run-engine-d2-shop.test.ts`](../tests/unit/run-engine-d2-shop.test.ts)、[`tests/unit/run-engine-d3-hydrate.test.ts`](../tests/unit/run-engine-d3-hydrate.test.ts)、[`tests/unit/run-engine-d4-outcome.test.ts`](../tests/unit/run-engine-d4-outcome.test.ts)、[`tests/unit/run-engine-d5-nocoverage.test.ts`](../tests/unit/run-engine-d5-nocoverage.test.ts)、[`tests/unit/run-engine-d5-survived.test.ts`](../tests/unit/run-engine-d5-survived.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/engine.ts`（原則 `--testFiles` で絞らない） |
| 受入 | NoCoverage **半減以下** かつ ファイル total **75%+** |

After: total 75.26% / covered 75.71% / S=370 / NC=9 / T=38（local: `npm run test:mutation:force -- --mutate src/sim/run/engine.ts --reporters clear-text,json --concurrency 4`、`--testFiles` なし）

やる事:

- NoCoverage 行の洗い出し。到達可能ならテスト、死コードなら削除または正当な disable
- フルスイート（または related 全体）で `engine.ts` を再計測し、ファイル total **75%+** まで残 Survived を潰す
- 通しプレイを増やさず、小さい固定入力で足りる枝から断言する

### Group E — 中優先（P2）

### RI-72-E1 — generate の teams / id 分岐

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/orgscale/generate.ts`](../src/sim/orgscale/generate.ts) |
| Baseline | total 56.86% / covered 56.86% / S=22 / NC=0 |
| 既存テスト | [`tests/unit/orgscale.test.ts`](../tests/unit/orgscale.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/orgscale/generate.ts` |
| 受入 | total **70%+** |

After: total 96.08% / covered 96.08% / S=2 / NC=0（ローカル `npm run test:mutation:force -- --mutate src/sim/orgscale/generate.ts --testFiles tests/unit/orgscale.test.ts --reporters clear-text --concurrency 4`）

やる事:

- `teams` 指定時、`homeTeamId` / `activeTeamId`、extraTeams 非適用を明示

### RI-72-E2 — effects の fold 係数

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/effects.ts`](../src/sim/run/effects.ts) |
| Baseline | total 69.12% / covered 69.12% / S=21 / NC=0 |
| 既存テスト | [`tests/unit/run-systems.test.ts`](../tests/unit/run-systems.test.ts)、[`tests/unit/effects.test.ts`](../tests/unit/effects.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/effects.ts` |
| 受入 | total **75%+** |

After: total 92.65% / covered 92.65% / S=5 / NC=0（local: `npm run test:mutation:force -- --mutate src/sim/run/effects.ts --testFiles tests/unit/run-systems.test.ts,tests/unit/effects.test.ts`）

やる事:

- fold 系の係数・空入力を断言

### RI-72-E3 — sprintBaselineBuild の入力差分

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/sprintBaselineBuild.ts`](../src/sim/run/sprintBaselineBuild.ts) |
| Baseline | total 63.16% / covered 69.23% / S=16 / NC=5 |
| 既存テスト | sprintBaseline 系を確認して拡張 |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/sprintBaselineBuild.ts` |
| 受入 | total **70%+** |

After: total 92.98% / covered 92.98% / S=4 / NC=0（local: `npm run test:mutation:force -- --mutate src/sim/run/sprintBaselineBuild.ts`）

やる事:

- ビルド入力差分で結果が変わることを断言

### RI-72-E4 — events の残 Survived

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/run/events.ts`](../src/sim/run/events.ts) |
| Baseline | total 79.21% / covered 80% / S=20 / NC=1 |
| 既存テスト | [`tests/unit/run-systems.test.ts`](../tests/unit/run-systems.test.ts)、[`tests/unit/run-loop.test.ts`](../tests/unit/run-loop.test.ts)、[`tests/unit/events.test.ts`](../tests/unit/events.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/run/events.ts` |
| 受入 | Survived 半減または total **85%+** |

After: total 99.01% / covered 99.01% / S=1 / NC=0 / T=1（local: `npm run test:mutation:force -- --mutate src/sim/run/events.ts --testFiles tests/unit/events.test.ts,tests/unit/run-loop.test.ts,tests/unit/run-systems.test.ts --reporters clear-text,json --concurrency 1`）

やる事:

- 残 Survived の条件枝を明示断言

### RI-72-E5 — outcome の敗北閾値

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/outcome.ts`](../src/sim/outcome.ts) |
| Baseline | total 72.29% / covered 79.47% / S=31 / NC=15 |
| 既存テスト | 関連ユニットを確認して拡張 |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/outcome.ts` |
| 受入 | total **80%+** |

After: total 96.43% / covered 96.43% / S=6 / NC=0（local: `npm run test:mutation:force -- --mutate src/sim/outcome.ts --reporters clear-text,json --concurrency 4`）

やる事:

- 敗北条件・閾値の境界を断言

### RI-72-E6 — assignTask の NoCoverage

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/assignTask.ts`](../src/sim/assignTask.ts) |
| Baseline | total 72.86% / covered 85% / S=36 / NC=40 |
| 既存テスト | [`tests/unit/assignTask.test.ts`](../tests/unit/assignTask.test.ts) |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/assignTask.ts` |
| 受入 | NC 半減かつ total **80%+** |

After: total 89.29% / covered 89.29% / S=30 / NC=0（ローカル `npm run test:mutation:force -- --mutate src/sim/assignTask.ts`）

やる事:

- NoCoverage 行へ到達する入力を追加

### RI-72-E7 — meta の残 Survived

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/state/meta.ts`](../src/state/meta.ts) |
| Baseline | total 76.42% / covered 79.75% / S=65 / NC=14 |
| 既存テスト | meta 系ユニットを確認して拡張 |
| 再計測 | `npm run test:mutation:force -- --mutate src/state/meta.ts` |
| 受入 | Survived 半減または total **85%+** |

After: total 88.66% / covered 91.38% / S=28 / NC=10（ローカル `npm run test:mutation:force -- --incrementalFile /tmp/stryker-meta-after-final-e7.json --mutate src/state/meta.ts --reporters clear-text,json --concurrency 4`）

やる事:

- Survived が多い条件枝を優先して断言

### RI-72-E8 — roster の残 Survived

| 項目 | 内容 |
| --- | --- |
| 状態 | 完了 |
| 対象 | [`src/sim/member/roster.ts`](../src/sim/member/roster.ts) |
| Baseline | total 80% / covered 83.53% / S=56 / NC=15 |
| 既存テスト | member 系ユニットを確認して拡張 |
| 再計測 | `npm run test:mutation:force -- --mutate src/sim/member/roster.ts` |
| 受入 | Survived 半減または total **88%+** |

After: total 94.65% / covered 94.65% / S=19 / NC=0 / T=12（ローカル `npm run test:mutation:force -- --mutate src/sim/member/roster.ts --reporters clear-text,json --concurrency 4`）

やる事:

- Survived が多い条件枝を優先して断言

## 6. 典型的な Survived の直し方

| Mutator | よくある欠け | 直し方 |
| --- | --- | --- |
| ConditionalExpression / LogicalOperator | `a && b` の片側しか見ていない | 真偽の組み合わせ表で断言 |
| EqualityOperator | `>` と `>=` を区別していない | 境界値ちょうどを断言 |
| ArithmeticOperator | `*` と `/`、`+` と `-` を区別していない | 既知入力の数値結果を固定 |
| MethodExpression (`Math.min`/`max`) | clamp の効きを見ていない | 下限未満・上限超過を入れる |
| StringLiteral | キー連結やラベルを見ていない | キャッシュキー全体 or 部分文字列を断言（低価値なら disable 可） |
| BlockStatement | 早期 return 本体が空でも通る | 副作用（状態変化）を断言 |
| NoCoverage | テストがその行を通っていない | 到達する入力を追加。死コードなら削除 or disable |

## 7. 運用メモ（インフラ）

- 週次 / 手動 Mutation はシャード並列のまま。初回は重いが、incremental cache が載れば差分だけになる。
- 単一ジョブでコア全体を回すと数時間・180分タイムアウトのリスクあり。**通常はシャードまたは `--mutate`。**
- `ignoreStatic: true` 済み。`vitest.mutation.config.ts` で testTimeout 60s。
- 低価値 mutator のグローバル `excludedMutations` は、Group A–D の後に必要なら別実装単位で検討。

## 8. エピック完了・再ベースライン

- 実装単位完了時: 本ファイルの該当単位を `完了` にし After score を追記。PR に単位 ID を明記。
- **エピック RI-72 完了条件**: 実装単位 A1–E8（Group A–D を含む）がすべて完了していること。全体 total おおむね 80%+ は完了条件に含めない（再ベースライン推奨）。
- **RI-72 状態**: **完了**（実装単位 A1–E8 すべて完了）。全体 total のフルシャード再計測は未実施で、次の Mutation run で新エピックを採番して追う。
- **再ベースライン時**: 新エピック `RI-{N}` を採番し、実装単位を `RI-{N}-A1`… で振り直す。旧単位の未消化は新 ID に内容をコピーして引き継ぐ（旧 ID での実装継続はしない）。
