# ミューテーションテスト改善バックログ

実装役向けの作業指示書。ベースラインは GitHub Actions
[Mutation run 30261978402](https://github.com/nimiusrd/devops-tycoon/actions/runs/30261978402)
（2026-07-27、シャード並列・成功）。

関連設定: [`stryker.config.json`](../stryker.config.json)、[`.github/workflows/mutation.yml`](../.github/workflows/mutation.yml)。  
バックログ ID: **RI-72**（[`remaining-issues.md`](./remaining-issues.md)）— 本ベースライン（run 30261978402）専用。  
再ベースライン（新しいフルシャード Mutation run から計画を更新）: [`.cursor/skills/mutation-remediation-plan/SKILL.md`](../.cursor/skills/mutation-remediation-plan/SKILL.md) に従い **新しい RI-NN を採番**し、本ファイルの ID・数値・Batch を差し替える。旧 RI は完了扱いにして未消化分を新計画へ引き継ぐ。

## 1. 目的と非目的

**目的**

- Survived / NoCoverage が多いコアロジックのユニットテストを強化し、mutation score を上げる。
- 決定論的な `src/sim` / `src/state` の回帰耐性を高める。

**非目的**

- Mutation を PR 必須 CI ゲートにしない（`thresholds.break: null` を維持）。
- スコアのためだけの本番ロジック変更（挙動を変えるリファクタは別課題）。
- 6シャードの HTML レポートを1本に統合すること（必須ではない）。

## 2. ベースライン数値

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

**目標（ゲートではない目安）**

- 短期: 全体 total **80%+**、下記ワーストファイルを **70%未満から脱出**
- 中期: `engine` / `quarterReview` / `industry` の covered **85%+**

## 3. 作業ルール（実装役共通）

1. **原則はテスト追加・強化のみ。** 本番コード変更は、バグ修正が必要と判明したときに限る。
2. 意図的に落とさない分岐（表示用文言、到達不能な防御節など）だけ `// Stryker disable next-line` 等を検討する。安易な一括 disable は禁止。
3. 1PR は **1バッチ**（下表）に収める。Batch D はさらにファイル／テーマで分割してよい。
4. 変更前に `npm test`、変更後に対象の mutation 再計測と `npm run lint` / `npm run format:check`。
5. 再計測コマンド（ローカルまたは GHA `mutate` 入力）:

```bash
# 例: 単一ファイル（推奨）
npm run test:mutation:force -- --mutate src/sim/orgscale/industry.ts

# 例: GHA 手動実行で mutate に同じパターンを渡す
```

6. PR 本文に **Before/After の score（total / covered）と Survived 数** を記す。
7. 日本語でコミット・PR する（リポジトリ慣例）。

## 4. バッチ一覧（この順で着手）

### Batch A — ワースト3（優先度最高）

| 対象 | Baseline total | Survived / NC | 既存テスト | やる事 |
| --- | --- | --- | --- | --- |
| [`src/sim/orgscale/industry.ts`](../src/sim/orgscale/industry.ts) | **31.5%** | S71 | [`tests/unit/orgscale-industry.test.ts`](../tests/unit/orgscale-industry.test.ts) | `computeScores` 系の係数を1変数ずつ固定断言。`Math.min`/`Math.max` 境界、同点 tie-break、league 境界、rival 生成レンジ |
| [`src/sim/run/whatIfState.ts`](../src/sim/run/whatIfState.ts) | **48.2%** | S57 | [`tests/unit/whatIf.test.ts`](../tests/unit/whatIf.test.ts) | `whatIfCacheKey` / state 構築を直接叩き、キー差分・draft join・modifier の `\|\|`/`&&`・clamp を断言 |
| [`src/sim/run/whatIfClient.ts`](../src/sim/run/whatIfClient.ts) | **0%** | NC32 | **なし** | Worker/Comlink をモックし、成功・import 失敗・remote 例外後 fallback・`resetWhatIfClientForTests` をカバー |

受入（Batch A）:

- 上記3ファイルがいずれも total **70%+**（`whatIfClient` は covered ベースで実用カバレッジがあり、NoCoverage を大幅減）
- 既存 `npm test` がグリーン

### Batch B — Persistence / リプレイ正規化

| 対象 | Baseline total | 既存テスト | やる事 |
| --- | --- | --- | --- |
| [`src/state/replayPersistence.ts`](../src/state/replayPersistence.ts) | 50% | [`tests/unit/replay.test.ts`](../tests/unit/replay.test.ts) | `get`/`clear`/Memory 上限/`initializeReplayPersistence` fallback/write failure を直接テスト |
| [`src/state/metaPersistence.ts`](../src/state/metaPersistence.ts) | 59% | [`tests/unit/metaPersistence.test.ts`](../tests/unit/metaPersistence.test.ts) | IDB 上の壊れた meta、legacy remove 失敗、legacy 無し fallback |
| [`src/state/replay.ts`](../src/state/replay.ts) | 60% | [`tests/unit/replay.test.ts`](../tests/unit/replay.test.ts) | outcome/trials/difficulty/frame 破損、`normalizeReplayKeyframes` の部分破棄と clone 性（ConditionalExpression 対策） |
| [`src/state/runPersistence.ts`](../src/state/runPersistence.ts) | 63% | [`tests/unit/runPersistence.test.ts`](../tests/unit/runPersistence.test.ts) | v1/壊れた `replayKeyframes`、`clear` 直呼び、summary/extras 不正値 |

受入（Batch B）: 各ファイル total **70%+**。

### Batch C — 四半期レビュー

| 対象 | Baseline | Survived | 既存テスト | やる事 |
| --- | --- | --- | --- | --- |
| [`src/sim/run/quarterReview.ts`](../src/sim/run/quarterReview.ts) | 62.3% | **191** | [`tests/unit/quarter-review.test.ts`](../tests/unit/quarter-review.test.ts)、[`quarter-review-seeds.test.ts`](../tests/unit/quarter-review-seeds.test.ts) | `canChooseAdjustment` / `loseReasonForOutcome` / rework 比率閾値（0.3）/ goal 未定義枝 / `OUTCOME_LABELS` 近傍を明示断言 |

受入（Batch C）: total **75%+** または Survived を大幅減（目安 191 → 100 以下）。

注: RI-68（Delivery KPI スケール）は別課題。本バッチは **テスト強化のみ**。仕様変更が必要なら RI-68 側の PR に回す。

### Batch D — RunEngine（分割推奨）

| 対象 | Baseline | Survived / NC | 既存テスト |
| --- | --- | --- | --- |
| [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) | 65.1% | **S467 / NC67** | [`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts) ほか通し系 |

方針: **通しプレイテストを増やさない。** 固定入力の小さい単体ケースで枝を刺す。

分割例（各々1PR可）:

1. D1: phase guard / 不正遷移 / `RunPhaseError`
2. D2: shop / rest / recruit の選択枝
3. D3: hydrate / セーブ復元まわり
4. D4: 敗北・勝利・quarterReview 突入条件
5. D5: NoCoverage 行の洗い出し（未使用枝なら disable 検討、到達可能ならテスト）

受入（Batch D 完了時）: engine total **75%+**、NoCoverage 半減以上。

### Batch E — 中優先の残り（P2）

スコアまたは Survived 数で効くものから順に、ファイル単位 PR でよい。

| 対象 | Baseline total | メモ |
| --- | --- | --- |
| [`src/sim/orgscale/generate.ts`](../src/sim/orgscale/generate.ts) | 56.9% | teams 指定・home/activeTeam・extraTeams |
| [`src/sim/run/effects.ts`](../src/sim/run/effects.ts) | 69.1% | fold 系の係数・空入力 |
| [`src/sim/run/sprintBaselineBuild.ts`](../src/sim/run/sprintBaselineBuild.ts) | 63.2% | ビルド入力差分 |
| [`src/sim/run/events.ts`](../src/sim/run/events.ts) | 79.2% | Survived 残の条件枝 |
| [`src/sim/outcome.ts`](../src/sim/outcome.ts) | 72.3% | 敗北条件・閾値 |
| [`src/sim/assignTask.ts`](../src/sim/assignTask.ts) | 72.9% | NoCoverage 40 あり |
| [`src/state/meta.ts`](../src/state/meta.ts) | 76.4% | Survived 65（数が多い） |
| [`src/sim/member/roster.ts`](../src/sim/member/roster.ts) | 80.0% | Survived 56 |

## 5. 典型的な Survived の直し方

| Mutator | よくある欠け | 直し方 |
| --- | --- | --- |
| ConditionalExpression / LogicalOperator | `a && b` の片側しか見ていない | 真偽の組み合わせ表で断言 |
| EqualityOperator | `>` と `>=` を区別していない | 境界値ちょうどを断言 |
| ArithmeticOperator | `*` と `/`、`+` と `-` を区別していない | 既知入力の数値結果を固定 |
| MethodExpression (`Math.min`/`max`) | clamp の効きを見ていない | 下限未満・上限超過を入れる |
| StringLiteral | キー連結やラベルを見ていない | キャッシュキー全体 or 部分文字列を断言（低価値なら disable 可） |
| BlockStatement | 早期 return 本体が空でも通る | 副作用（状態変化）を断言 |
| NoCoverage | テストがその行を通っていない | 到達する入力を追加。死コードなら削除 or disable |

## 6. 運用メモ（インフラ）

- 週次 / 手動 Mutation はシャード並列のまま。初回は重いが、incremental cache が載れば差分だけになる。
- 単一ジョブでコア全体を回すと数時間・180分タイムアウトのリスクあり。**通常はシャードまたは `--mutate`。**
- `ignoreStatic: true` 済み。`vitest.mutation.config.ts` で testTimeout 60s。
- 低価値 mutator のグローバル `excludedMutations` は、Batch A–D の後に必要なら別 PR で検討。

## 7. 完了時のバックログ更新

- バッチ完了ごとに本ファイルの該当行に ✅ と再計測 score を追記してよい（短く）。PR には現行の RI-NN を明記する。
- **現行 RI を完了にする条件**: そのベースライン計画の Batch A–D の受入を満たし、全体 total がおおむね 80%以上。
- **再ベースライン時**: スキルに従い新 RI を採番する。旧 RI は完了要約へ「後続 RI-XX に置換」と移し、未消化 Batch は新計画へ引き継ぐ（旧 ID での実装継続はしない）。
- 完了時は [`remaining-issues.md`](./remaining-issues.md) を更新し、本ファイルは現行ベースラインの正本として残す。
