---
name: mutation-remediation-plan
description: Fetches Stryker mutation test results from GitHub Actions artifacts, aggregates scores and Survived/NoCoverage hotspots, and writes an implementer-ready remediation plan. Mints a new epic RI only for a new full-shard baseline run ID; same-run edits reuse the epic. Implementation units are GitHub Issues (not plan/mutation-units Markdown). Use when asked to analyze mutation reports, plan mutation score improvements, process Mutation workflow runs, rebaseline mutation remediation, or draft/update plan/mutation-remediation.md from a GHA run URL.
---

# ミューテーション結果からの実装計画

Mutation ワークフローの成果物を取得・集計し、実装役が Issue 単位で着手できる計画に落とす。コード修正自体は行わない（計画・バックログ・Issue 作成まで）。

## 前提

- 設定: [`stryker.config.json`](../../../stryker.config.json)
- GHA: [`.github/workflows/mutation.yml`](../../../.github/workflows/mutation.yml)（シャード並列、任意／週次）
- 方針: [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md)
- バックログ: [`plan/remaining-issues.md`](../../../plan/remaining-issues.md)（**フルシャードの run ID が変わったときだけ新しいエピックを採番**）
- 実装単位の進捗正本: **GitHub Issue**（1 Issue = 1PR。完了したら close。単位 MD は作らない）

## なぜ Issue か

Mutation の実装単位は対応後に参照する必要が薄い。共有 Markdown や単位ファイルに状態・達成率を置くと、並列コンフリクトや壊れやすい数値ゲートが増えて本末転倒になる。Issue の open/close だけを進捗にする。

**進捗の見方:** 実装単位はエピックの **サブイシュー**に一本化する。GitHub のサブイシュー一覧で open / closed が分かるので、それを正本にする（本文への子リンク列挙や別途状態表・MD 転記はしない）。

## バックログ ID の採番

### エピック（ベースライン）

**新しいフルシャード run**（現行計画に記録された run ID と異なる）で計画を作る／差し替えるときだけ、新しいエピック `RI-{N}` を採番する。  
**同じ run ID** の計画追記・書式修正・Issue の補完では、既存エピックを再利用し、未完了エピックを完了扱いにしない。

新規 run のとき:

1. [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) とリポジトリ全体から既存エピック番号 `RI-(\d+)`（ハイフン無しの本体）の最大を求める（欠番は再利用しない）。実装単位 `RI-72-A1` の `-A1` は番号計算に含めない。
2. 候補 `RI-{max+1}` について GitHub Issue を検索する（タイトル `[RI-{N}]` / `[RI-{N}-…]`、open/closed 両方）。
   - エピック Issue 本文の **run URL と `headSha` が今回の run と一致**するときだけ再利用する（同じ ID の二重作成を避ける）。
   - タイトルだけ一致して run / `headSha` が違う、または本文に run 記録が無い途中残骸は **使用済み ID** として扱い、`RI-{max+2}` 以降を採番する（別 run の弱点を流用しない）。
3. エピック用トラッキング Issue を作成または（手順2で許可された場合のみ）再利用する（タイトル `[RI-{N}] …`。本文に **今回の** run URL・`headSha`・方針）。
4. 足りない実装単位 Issue だけ作成する（タイトル `[RI-{N}-{GROUP}{SEQ}] …`。テンプレは [`.github/ISSUE_TEMPLATE/mutation-unit.md`](../../../.github/ISSUE_TEMPLATE/mutation-unit.md)）。未消化の旧単位があれば新 ID / 新 Issue へ内容を引き継ぐ。
5. 各実装単位をエピックの **サブイシュー**として紐づける（UI、または GraphQL `addSubIssue`）。進捗の正本はサブイシュー関係だけにする。
6. **エピック Issue と必要なサブイシューが揃ったことを確認する。** `gh issue create` / サブイシュー紐づけが使えずユーザーへ手順だけ渡す場合は、ここで中断する（旧エピックの完了扱いや計画の新エピック切替は行わない。作成確認後に再開）。
7. **文書切替より先に**、直前のミューテーション改善エピック（未着手・進行中）があれば文書上 **完了** にし、完了要約へ「後続ベースライン `RI-XX` に置換。未消化は新 Issue へ引き継ぎ」と書く。あわせて **旧エピック Issue と、引き継いだ旧サブイシューをすべて close** する（コメント例: `RI-XX へ置換。未消化は #<新Issue> へ引き継ぎ`）。中断再開で手順が飛ばないよう、旧 close を新文書反映より前に固定する。
8. [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) に新行と詳細節を追加する。タイトル例: `ミューテーションテストに基づくユニットテスト強化（run <RUN_ID>）`。エピック Issue へリンクする。
9. [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) をそのベースライン用に更新する（**run ID と `headSha` を必ず記録**）。実装単位の静的索引や単位 MD は置かない。
10. [`plan/README.md`](../../../plan/README.md) の mutation 行は「現行 RI-XX」が分かるよう更新する。

**同じ run の再編集時**は手順 9 と次のみ（エピック採番は行わない）:

- 方針文書の追記・書式修正
- 置換済みのはずの **旧エピック / 旧サブイシューが open のまま残っていないか**確認し、残っていれば手順7相当で close する
- エピックのサブイシュー一覧を見る。不足分だけ Issue を追加し、サブイシューとして紐づける。既存 Issue の本文はテンプレで上書きしない
- エピックがすでに close / `remaining-issues.md` が完了なら、不足分を足す前にエピック Issue を **reopen** し、バックログを **進行中** に戻す

**エピック完了時**（再ベースラインを待たない）:

- サブイシューがすべて closed になったら、エピック Issue を close する
- [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) のエピックを **完了** にし、短い完了要約を書く
- [`plan/README.md`](../../../plan/README.md) の現行表記を更新する

部分分析（custom / `mutate` 指定）では **新しいエピックも実装単位も採番しない**。

### 実装単位（1PR・1 Issue）

| 種別 | 形式 | 例 |
| --- | --- | --- |
| エピック | `RI-{N}` | `RI-73` |
| 実装単位 | `RI-{N}-{GROUP}{SEQ}` | `RI-73-A1` |

- `{GROUP}`: 優先グループ `A`–`Z`（A が最高）
- `{SEQ}`: グループ内連番（1起算、ゼロ埋めなし、欠番再利用なし）
- **1実装単位 = 1 Issue = 1PR。** タイトル先頭に `[ID]` を付ける
- Issue に達成率（total / covered / S / NC）を必須で書かせない・完了ゲートにしない
- 完了は Issue を close（PR の `Fixes #n` / `Closes #n` でよい）。サブイシューが揃って closed ならエピックも close する

### 並列実装

1. 実装 PR は自分の Issue に対応するテスト変更だけを行う。計画 MD の状態更新は不要。
2. PR 本文には実施内容を書く（達成率の転記は不要）。
3. 同一対象ソースを複数単位に割る場合は「シリアル」または「単位専用の新規テストファイル」。
4. バッチ同期や「後で Markdown に転記」に頼らない。

## 手順

### 1. 対象 run を特定する

ユーザーが run URL / run ID を出していればそれを使う。無ければ:

```bash
gh run list --workflow=mutation.yml --limit 5 --json databaseId,conclusion,status,url,createdAt,headSha
```

成功（`conclusion=success`）で artifact がある run を選ぶ。失敗のみの場合はログ原因を報告して終了する。

**ベースライン用**はフルシャード実行のみを使う。artifact 名が `mutation-report-<shard>` で、想定シャード（`sim-root`, `sim-run-engine`, `sim-run-rest`, `sim-orgscale`, `sim-member-model`, `state`）が揃っていることを確認する。`mutation-report-custom` のみ、または `mutate` 入力付きの部分実行は **対象範囲限定の分析** とし、全体ベースラインや新 RI 採番には使わない。

run の `headSha` を控える。手順4の実装・テスト照合は、その SHA のツリーで行う。  
**作業ブランチを `git checkout <headSha>` で切り替えない。** 確認は `git show <headSha>:path`、または読み取り専用の別 worktree に限定する。計画・バックログの更新コミットは現行ブランチ上で行う。現行 `HEAD` と `headSha` が異なる場合は差分を明記する。SHA 未確認のまま弱点判定しない。

### 2. artifact を取得する

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
3. ワーストファイル（total score 昇順。件数の少ないノイズ除外の目安は **mutant count ≥ 20**）
4. Survived 数が多いファイル
5. Survived の mutator 内訳（上位）
6. NoCoverage ホットスポット

必要ならワースト数ファイルについて Survived の行・mutator・replacement サンプルを抜く。

### 4. 実装・テストと照合する

手順1の `headSha` 上で、ワーストファイルごとに:

1. 既存 `tests/unit` の import / describe を探す
2. カバー印象を `strong` / `thin` / `none` で付ける
3. 「次に足すべき断言」を1行で書く

広範な探索は `explore` サブエージェントを使ってよい。

### 5. 計画を書く／ Issue を切る

現行 [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) の run ID と比較する。

- **同じ run**: 既存エピックを再利用し、旧 Issue の残留 close・必要なら reopen のうえ、サブイシュー一覧を見て不足だけ追加・紐づけする。
- **新しいフルシャード run**: 「バックログ ID の採番」に従い、同一 run の途中 Issue のみ再利用 → 不足サブイシュー作成 → 旧 Issue close → 文書切替、の順で進める。

リポジトリに含めるもの:

- 対象 run URL・**`headSha`**・エピック ID・全体 score（参考スナップショット）
- Issue 運用方針（単位 MD / 状態ゲートは作らない）
- 目的 / 非目的 / 作業ルール / Survived の直し方 / 再計測例

リポジトリに含めないもの:

- 実装単位ごとの状態表・達成率・`plan/mutation-units/` ファイル

### 6. ユーザーへの提示

日本語で簡潔に:

1. **採番したエピック RI-{N}** と実装単位 Issue の件数・最優先単位
2. 対象 run
3. 全体・シャードの score サマリー（部分 run なら範囲を明示し、RI 未採番である旨）
4. 作成した（または作成案の）Issue 一覧
5. 実装は別エージェント／別 PR（Issue ごと）で行う旨

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
- **異なるフルシャード run** なのに既存エピックのままベースライン数値を上書きしない（新エピックを採番する）
- **同じ run** の文書修正で新エピックを誤って採番し、未完了エピックを完了扱いにしない
- 実装単位 ID をエピック無しで採番しない / 1PR に複数単位を詰め込まない
- 欠番のエピック番号・単位 SEQ を再利用しない
- 作業ブランチを baseline `headSha` に checkout したまま文書を更新しない
- **`plan/mutation-units/` や状態ゲートスクリプトを復活させない**
- Issue / 計画に達成率を必須項目や完了ゲートとして載せる
- Issue 未作成のまま旧エピックを完了扱いにする／計画だけ新エピックへ切り替える
- 再ベースライン時に引き継いだ旧子 Issue を open のまま残す
- 途中作成済みの `[RI-{N}-…]` Issue を無視して同 ID を二重作成する
- run URL / `headSha` が一致しない別 run の途中 Issue を再利用する
- サブイシューがすべて closed なのにエピック Issue / `remaining-issues.md` を完了にしない
- 完了済みエピックへ不足 Issue を足すとき、親 Issue / バックログを reopen・進行中に戻さない
- 文書切替後の中断再開で、置換対象の旧 Issue を open のまま残す
- 本文リンク列挙とサブイシューを併用して進捗の見方を二系統にする

## 追加リソース

- 集計の観点と出力例: [reference.md](reference.md)
