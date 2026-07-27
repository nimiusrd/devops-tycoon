---
name: mutation-remediation-plan
description: Fetches Stryker mutation test results from GitHub Actions artifacts, aggregates scores and Survived/NoCoverage hotspots, and writes an implementer-ready remediation plan with a new backlog RI ID per baseline run. Use when asked to analyze mutation reports, plan mutation score improvements, process Mutation workflow runs, rebaseline mutation remediation, or draft/update plan/mutation-remediation.md from a GHA run URL.
---

# ミューテーション結果からの実装計画

Mutation ワークフローの成果物を取得・集計し、実装役が Batch 単位で着手できる計画に落とす。コード修正自体は行わない（計画・バックログ更新まで）。

## 前提

- 設定: [`stryker.config.json`](../../../stryker.config.json)
- GHA: [`.github/workflows/mutation.yml`](../../../.github/workflows/mutation.yml)（シャード並列、任意／週次）
- 計画の正本テンプレ: [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md)
- バックログ: [`plan/remaining-issues.md`](../../../plan/remaining-issues.md)（**フルシャード再ベースライン実行ごとに新しい RI-NN を採番**）

## バックログ ID の採番

### エピック（ベースライン）

フルシャード結果から計画を書く／更新するたびに、**必ず新しいエピック `RI-{N}` を1つ採番**する。同じ RI を再利用してベースラインを上書きしない。

1. [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) とリポジトリ全体から既存エピック番号 `RI-(\d+)`（ハイフン無しの本体）の最大を求める（欠番は再利用しない）。実装単位 `RI-72-A1` の `-A1` は番号計算に含めない。
2. 新エピック = `RI-{max+1}`。
3. 表に新行を追加し、詳細節を書く。タイトル例: `ミューテーションテストに基づくユニットテスト強化（run <RUN_ID>）`。実装単位一覧は [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) へリンク。
4. [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) をそのベースライン用に更新する。
5. 直前のミューテーション改善エピック（未着手・進行中）があれば **完了** にし、完了要約へ「後続ベースライン `RI-XX` に置換。未消化の実装単位は新計画へ引き継ぎ」と短く書く。
6. [`plan/README.md`](../../../plan/README.md) の mutation 行は「現行 RI-XX」が分かるよう更新する。

部分分析（custom / `mutate` 指定）では **新しいエピックも実装単位も採番しない**。

### 実装単位（1PR）

エピック配下の作業は次の形式で採番し、[`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) にのみ詳細を置く（`remaining-issues.md` にはエピックだけ）。

| 種別 | 形式 | 例 |
| --- | --- | --- |
| エピック | `RI-{N}` | `RI-72` |
| 実装単位 | `RI-{N}-{GROUP}{SEQ}` | `RI-72-A1` |

- `{GROUP}`: 優先グループ `A`–`Z`（A が最高）
- `{SEQ}`: グループ内連番（1起算、ゼロ埋めなし、欠番再利用なし）
- **1実装単位 = 1PR。** タイトル先頭に ID を付ける

各単位は次の書式で書く（必須）:

```markdown
### RI-{N}-{GROUP}{SEQ} — {短いタイトル}

| 項目 | 内容 |
| --- | --- |
| 状態 | 未着手 / 進行中 / 完了 |
| 対象 | `path/to/file.ts` |
| Baseline | total X% / covered Y% / S=n / NC=n |
| 既存テスト | `tests/unit/….test.ts` または なし |
| 再計測 | `npm run test:mutation:force -- --mutate {path}` |
| 受入 | 数値目標を1行 |

やる事:

- …
```

一覧表（ID / タイトル / 状態 / 対象）をセクション先頭に置き、詳細をその下に続ける。


## 手順

### 1. 対象 run を特定する

ユーザーが run URL / run ID を出していればそれを使う。無ければ:

```bash
gh run list --workflow=mutation.yml --limit 5 --json databaseId,conclusion,status,url,createdAt,headSha
```

成功（`conclusion=success`）で artifact がある run を選ぶ。失敗のみの場合はログ原因を報告して終了する。

**ベースライン用**はフルシャード実行のみを使う。artifact 名が `mutation-report-<shard>` で、想定シャード（`sim-root`, `sim-run-engine`, `sim-run-rest`, `sim-orgscale`, `sim-member-model`, `state`）が揃っていることを確認する。`mutation-report-custom` のみ、または `mutate` 入力付きの部分実行は **対象範囲限定の分析** とし、全体ベースラインや Batch 順の上書き・新 RI 採番には使わない。

run の `headSha` を控える。手順4の実装・テスト照合は、その SHA のツリーで行う（`git checkout` / worktree、または現 `HEAD` との差分を明記）。SHA が一致しないまま弱点判定しない。

### 2. artifact を取得する

前回残骸の混入を避けるため、run ID ごとの新規ディレクトリを使う（または取得前に中身を削除する）。

```bash
OUT=/tmp/mutation-results-<RUN_ID>
rm -rf "$OUT"
mkdir -p "$OUT"
gh run download <RUN_ID> -D "$OUT"
```

期待（フルシャード）: 各 `mutation-report-<shard>/` に `stryker-incremental-*.json` と `mutation/index.html`。

### 3. スコアを集計する

各 `stryker-incremental-*.json` の `files.*.mutants[].status` を集計する。

- total score = `(killed + timeout) / (killed + survived + timeout + noCoverage)`
- covered score = `(killed + timeout) / (killed + survived + timeout)`
- Ignored は分母に含めない

出力する表:

1. シャード別 score / Survived / NoCoverage / 壁時計（job の started〜completed）
2. 全体合算（フルシャード run のときのみ「全体」と書く）
3. ワーストファイル（total score 昇順。件数の少ないノイズ除外の目安は **mutant count ≥ 20**。score 0% でも件数が十分なファイルは残す）
4. Survived 数が多いファイル
5. Survived の mutator 内訳（上位）
6. NoCoverage ホットスポット（件数は少なくても score 0% になり得るため別掲）

必要ならワースト数ファイルについて Survived の行・mutator・replacement サンプルを抜く。

### 4. 実装・テストと照合する

手順1の `headSha` 上で、ワーストファイルごとに:

1. 既存 `tests/unit` の import / describe を探す
2. カバー印象を `strong` / `thin` / `none` で付ける
3. 「次に足すべき断言」を1行で書く（境界値、条件組み合わせ、副作用など）

広範な探索は `explore` サブエージェントを使ってよい。

### 5. 新エピックと実装単位を採番し計画を書く

「バックログ ID の採番」に従い新エピック `RI-{N}` と実装単位 `RI-{N}-A1`… を発行してから、[`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) をそのベースライン用に更新する。含めるもの:

- 対象 run URL・`headSha`・**エピック ID**・全体 score（フルシャード時）
- **ID フォーマット節**（エピック / 実装単位）とエントリ書式
- 目的 / 非目的（必須ゲート化しない、原則テストのみ強化）
- 作業ルール（**1PR=1実装単位**、再計測コマンド、PR に単位 ID と Before/After）
- 実装単位一覧表＋各単位の必須エントリ（状態 / 対象 / Baseline / 既存テスト / 再計測 / 受入 / やる事）
- 前回計画から未消化があれば、新単位 ID へ内容を引き継いだ旨を明記
- 典型的 Survived の直し方表
- 再計測例:

```bash
npm run test:mutation:force -- --mutate <file>
```

### 6. ユーザーへの提示

日本語で簡潔に:

1. **採番したエピック RI-{N}** と実装単位の件数・最優先単位（例: RI-72-A1）
2. 対象 run
3. 全体・シャードの score サマリー（部分 run なら範囲を明示し、RI 未採番である旨）
4. 推奨着手順（実装単位 ID の表）
5. 計画ファイルへのパス
6. 実装は別エージェント／別 PR（単位 ID ごと）で行う旨（依頼が計画のみの場合）

## 優先度の付け方

| 優先 | 基準 |
| --- | --- |
| P0 | total score が著しく低い、または NoCoverage で実質未計測 |
| P1 | Survived 絶対数が多い本丸（例: `engine.ts`, `quarterReview.ts`） |
| P2 | score は中程度だが Survived が残る周辺 |
| P3 | 低価値 mutator 除外や運用衛生（後回し） |

通し E2E 的ユニットを増やして score を稼がない。小さい固定入力で条件枝・境界・副作用を刺す。

## やってはいけないこと

- Mutation を PR 必須ゲートにする変更を計画に含めない（ユーザーが明示した場合を除く）
- スコア目的の本番ロジック改変を推奨しない
- 単一ジョブでコア全体フル再計測を前提にしない（シャードまたは `--mutate`）
- artifact が無い run を根拠に数値計画を作らない
- custom / 部分 `mutate` run の集計で全体ベースラインを上書きしない
- **同じエピック RI のまま別 run のベースラインへ上書きしない**（必ず新エピック）
- 実装単位 ID をエピック無しで採番しない / 1PR に複数単位を詰め込まない（要統合なら計画側で先に ID をまとめる）
- 欠番のエピック番号・単位 SEQ を再利用しない

## 追加リソース

- 集計の観点と出力例: [reference.md](reference.md)
