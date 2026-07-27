---
name: mutation-remediation-plan
description: Fetches Stryker mutation test results from GitHub Actions artifacts, aggregates scores and Survived/NoCoverage hotspots, and writes an implementer-ready remediation plan. Use when asked to analyze mutation reports, plan mutation score improvements, process Mutation workflow runs, update RI-72, or draft plan/mutation-remediation.md from a GHA run URL.
---

# ミューテーション結果からの実装計画

Mutation ワークフローの成果物を取得・集計し、実装役が Batch 単位で着手できる計画に落とす。コード修正自体は行わない（計画・バックログ更新まで）。

## 前提

- 設定: [`stryker.config.json`](../../../stryker.config.json)
- GHA: [`.github/workflows/mutation.yml`](../../../.github/workflows/mutation.yml)（シャード並列、任意／週次）
- 計画の正本テンプレ: [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md)
- バックログ: RI-72（[`plan/remaining-issues.md`](../../../plan/remaining-issues.md)）

## 手順

### 1. 対象 run を特定する

ユーザーが run URL / run ID を出していればそれを使う。無ければ:

```bash
gh run list --workflow=mutation.yml --limit 5 --json databaseId,conclusion,status,url,createdAt,headSha
```

成功（`conclusion=success`）で artifact がある run を選ぶ。失敗のみの場合はログ原因を報告して終了する。

### 2. artifact を取得する

```bash
mkdir -p /tmp/mutation-results
gh run download <RUN_ID> -D /tmp/mutation-results
```

期待: `mutation-report-<shard>/` ごとに `stryker-incremental-*.json` と `mutation/index.html`。

### 3. スコアを集計する

各 `stryker-incremental-*.json` の `files.*.mutants[].status` を集計する。

- total score = `(killed + timeout) / (killed + survived + timeout + noCoverage)`
- covered score = `(killed + timeout) / (killed + survived + timeout)`
- Ignored は分母に含めない

出力する表:

1. シャード別 score / Survived / NoCoverage / 壁時計（job の started〜completed）
2. 全体合算
3. ワーストファイル（total 昇順、mutant 数の少ないノイズは除外してよい。目安 total≥20）
4. Survived 数が多いファイル
5. Survived の mutator 内訳（上位）
6. NoCoverage ホットスポット

必要ならワースト数ファイルについて Survived の行・mutator・replacement サンプルを抜く。

### 4. 実装・テストと照合する

ワーストファイルごとに:

1. 既存 `tests/unit` の import / describe を探す
2. カバー印象を `strong` / `thin` / `none` で付ける
3. 「次に足すべき断言」を1行で書く（境界値、条件組み合わせ、副作用など）

広範な探索は `explore` サブエージェントを使ってよい。

### 5. 計画を書く／更新する

[`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) を新規作成またはベースライン節を更新する。含めるもの:

- 対象 run URL と全体 score
- 目的 / 非目的（必須ゲート化しない、原則テストのみ強化）
- 作業ルール（1PR=1バッチ、再計測コマンド、PR に Before/After を書く）
- **Batch A→E** の優先順（ワースト・Survived 絶対数・NoCoverage を重視）
- 各バッチの対象ファイル、既存テスト、やる事、受入条件
- 典型的 Survived の直し方表
- 再計測:

```bash
npm run test:mutation:force -- --mutate <file>
```

未登録なら [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) に RI を追加し、[`plan/README.md`](../../../plan/README.md) からリンクする。既存 RI-72 があれば受入と文書へのリンクを整合させる。

### 6. ユーザーへの提示

日本語で簡潔に:

1. 全体・シャードの score サマリー
2. 推奨 Batch 順（表）
3. 計画ファイルへのパス
4. 実装は別エージェント／別 PR で行う旨（依頼が計画のみの場合）

## 優先度の付け方

| 優先 | 基準 |
| --- | --- |
| P0 | total が著しく低い、または NoCoverage で実質未計測 |
| P1 | Survived 絶対数が多い本丸（例: `engine.ts`, `quarterReview.ts`） |
| P2 | score は中程度だが Surived が残る周辺 |
| P3 | 低価値 mutator 除外や運用衛生（後回し） |

通し E2E 的ユニットを増やして score を稼がない。小さい固定入力で条件枝・境界・副作用を刺す。

## やってはいけないこと

- Mutation を PR 必須ゲートにする変更を計画に含めない（ユーザーが明示した場合を除く）
- スコア目的の本番ロジック改変を推奨しない
- 単一ジョブでコア全体フル再計測を前提にしない（シャードまたは `--mutate`）
- artifact が無い run を根拠に数値計画を作らない

## 追加リソース

- 集計の観点と出力例: [reference.md](reference.md)
