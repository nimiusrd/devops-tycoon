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

まず今回の run について、中断再開も含めて既存のエピックを探す（`mutation-remediation.md` だけを見ない）:

1. タイトルが `[RI-\d+]` のエピック Issue（open/closed 両方）を検索し、本文の **run URL と `headSha` が今回と一致**するものがあれば、その `RI-{N}` を再利用する → **同じ run の再編集**（下節）。
2. 無ければ [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) に今回の run ID を含むエピック行があれば、その `RI-{N}` を候補にする。
   - **親 Issue が無い完了済み履歴エピック**（Issue 運用前に完了した例: RI-72）は **Issue 同期の対象外**。方針文書の追記・書式修正のみ行い、単位 Issue 作成・サブイシュー紐づけ・reopen はしない。新しいフルシャード run なら別エピックを採番する。
   - **親 Issue が無い進行中エピック**は、下節「新規 run」の親 Issue 作成（手順3）へ合流してから単位同期する（文書だけ再利用して親無しのまま進めない）。
3. どちらも無く、[`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) の記録 run が今回と同じなら **同じ run の再編集**（下節）。親 Issue が無ければ手順2と同じ分岐。
4. それ以外が **新しいフルシャード run**。未完了エピックを完了扱いにしないまま、下記「新規 run」へ進む。

### 採番の最大番号

新しい `RI-{N}` を決めるときは、次をすべて見て `RI-(\d+)`（ハイフン無しの本体）の最大を求める（欠番は再利用しない）。実装単位 `RI-72-A1` の `-A1` は含めない:

1. [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) の表・詳細節（**予約行**含む）
2. リポジトリ内の他ドキュメントに出るエピック ID
3. タイトルが `[RI-\d+]` の **open/closed 両方の GitHub Issue**（親 Issue 作成直後でも番号が埋まるようにする）

一般バックログ作業も Mutation エピックも、この最大番号規則を使う。親 Issue だけ作って `remaining-issues.md` 未更新のあいだに、別作業が同じ `RI-{N}` を採番しない。

### 新規 run

1. 上節「採番の最大番号」で最大を求め、再利用 ID が無ければ `RI-{max+1}`。
2. 採番候補のタイトル `[RI-{N}]` が既にあり、本文の run / `headSha` が今回と違う、または記録が無い途中残骸なら **使用済み ID** として扱い、次の空き番号へ進む（別 run の弱点を流用しない）。
3. エピック用トラッキング Issue を作成または再利用する（タイトル `[RI-{N}] …`。本文に **今回の** run URL・`headSha`・方針）。
4. **親 Issue 作成直後に ID を予約する。** [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) へ `RI-{N}` の行を upsert する（状態は **進行中（予約）** でよい。詳細は後で揃える）。切替完了前でも他作業が同じ番号を採番できないようにする。
5. タイトル `[RI-{N}-…]` の実装単位 Issue を **open/closed 両方**列挙する（サブイシュー未紐づけの作成済みも含む）。無い ID だけ新規作成する（テンプレは [`.github/ISSUE_TEMPLATE/mutation-unit.md`](../../../.github/ISSUE_TEMPLATE/mutation-unit.md)）。未消化の旧単位があれば新 ID / 新 Issue へ内容を引き継ぐ（この時点では **open PR の付け替えはまだしない**）。
6. 手順5の全実装単位をエピックの **サブイシュー**として紐づける（UI、または GraphQL `addSubIssue`）。未リンクの既存 Issue は新規作成せず紐づけだけする。進捗の正本はサブイシュー関係にする。
7. **エピック Issue と必要なサブイシューが揃ったことを確認する。** `gh issue create` / サブイシュー紐づけが使えずユーザーへ手順だけ渡す場合は、ここで中断する（旧エピックの完了扱い・計画の新エピック切替・open PR の付け替えは行わない。作成確認後に再開）。
8. **確認完了後・旧 Issue close 前に**、旧単位に紐づく **open PR をすべて列挙**する。引き継ぐ PR はタイトル先頭 ID と `Fixes` / `Closes` を **新 Issue** へ付け替える。引き継がない PR は `新ベースラインでは不要` など理由を付けて **close** する（旧子 Issue だけ閉じて PR を残さない）。付け替え後に中断しても、正本切替前なら旧 Issue はまだ open のままなので矛盾を避けられる。
9. **文書切替より先に**、直前のミューテーション改善エピック（未着手・進行中）があれば文書上 **完了** にし、完了要約へ「後続ベースライン `RI-XX` に置換」と書く。続けて **旧エピック Issue 自体を close** し、配下の **open サブイシューをすべて列挙して close** する（引き継いだものは `#<新Issue> へ引き継ぎ`、引き継がないものは `新ベースラインでは不要` など理由をコメント）。中断再開で手順が飛ばないよう、旧 close を新文書反映より前に固定する。
10. [`plan/remaining-issues.md`](../../../plan/remaining-issues.md) の予約行を、今回の run / エピック Issue リンク付きの本行・詳細節へ揃える（タイトル例: `ミューテーションテストに基づくユニットテスト強化（run <RUN_ID>）`）。状態を **進行中** にする。
11. [`plan/mutation-remediation.md`](../../../plan/mutation-remediation.md) をそのベースライン用に更新する（**run ID と `headSha` を必ず記録**）。実装単位の静的索引や単位 MD は置かない。
12. [`plan/README.md`](../../../plan/README.md) の mutation 行は「現行 RI-XX」が分かるよう更新する。

**同じ run の再編集時**（エピック採番は行わない）:

1. run / `headSha` が今回と一致していることを確認する。
2. **親 Issue が無い完了済み履歴エピック**なら Issue 同期対象外（上節）。方針文書の追記・書式修正だけして終了する。
3. **親 Issue が無い進行中エピック**なら、新規 run の手順3〜4で親 Issue 作成と予約行を済ませてから続ける。
4. **単位 Issue の確認を先に行う**（新規 run の手順5〜7相当）: タイトル `[RI-{N}-…]` を open/closed 両方列挙し、無い ID だけ新規作成、サブイシュー未紐づけは紐づける。既存 Issue の本文はテンプレで上書きしない。揃うまで `remaining-issues` / README の切替や旧 close に進まない。
5. エピックがすでに close / `remaining-issues.md` が完了で、かつ不足単位を足す必要があるときだけ、確認後にエピック Issue を **reopen** し、バックログを **進行中** に戻す（履歴エピックの書式修正だけでは reopen しない）。
6. 引き継ぎ対象の open PR 付け替えと、引き継がない open PR の理由付き close（新規 run の手順8相当）。
7. 置換済みのはずの **旧エピック Issue / 旧サブイシュー / 引き継がない旧単位の open PR** が残っていないか確認し、残っていれば新規 run の手順8〜9相当で整理する。
8. その後で方針文書（`mutation-remediation.md`）の追記・書式修正、[`plan/remaining-issues.md`](../../../plan/remaining-issues.md) の upsert（run ID・エピック Issue リンク）、[`plan/README.md`](../../../plan/README.md) の現行表記を揃える。

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

- **同じ run / 中断再開**: Issue・`remaining-issues`・計画のどれかに今回の run があればそのエピックを再利用する。親 Issue が無い完了済み履歴は Issue 同期対象外。それ以外は **単位 Issue 確認を先に**行い、その後で open PR 整理・旧残留 close・`remaining-issues` / README upsert・必要なら reopen する。
- **新しいフルシャード run**: 「バックログ ID の採番」に従い、親 Issue 作成と予約行 → 不足サブイシュー作成・紐づけ確認 → open PR 付け替え／不要 PR close → 旧エピック Issue と全 open サブイシュー close → 文書切替、の順で進める。

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
- 親 Issue が無い完了済み履歴エピックに対して単位 Issue 作成・サブイシュー紐づけ・reopen を試みる
- 親 Issue 作成前に単位 Issue を親へ紐づけようとする
- 親 Issue 作成後、`remaining-issues.md` 予約行も open/closed Issue 番号も見ずに同じ `RI-{N}` を別作業で採番する
- 単位 Issue 未確認のまま `remaining-issues` / README 切替や旧エピック close に進む
- サブイシュー紐づけ確認前に open PR の `Fixes` / `Closes` を新 Issue へ付け替える（失敗時に旧正本と矛盾する）
- 再ベースライン時に引き継いだ旧子 Issue を open のまま残す
- 途中作成済みの `[RI-{N}-…]` Issue を無視して同 ID を二重作成する
- run URL / `headSha` が一致しない別 run の途中 Issue を再利用する
- 中断再開時に、今回 run と一致する既存エピックを無視して次番号を採番する
- 作成済みだが未紐づけの `[RI-{N}-…]` Issue を無視して同 ID を二重作成する
- 同じ run の再開で `remaining-issues.md` のエピック行や `plan/README.md` の現行表記を放置する
- サブイシューがすべて closed なのにエピック Issue / `remaining-issues.md` を完了にしない
- 完了済みエピックへ不足 Issue を足すとき、親 Issue / バックログを reopen・進行中に戻さない
- 文書切替後の中断再開で、置換対象の旧 Issue を open のまま残す
- 旧エピック置換時に、旧エピック Issue 自体や引き継がない旧サブイシューを open のまま残す
- 未消化単位の open PR を新 Issue へ付け替えず、マージ後も新サブイシューが open のまま残る状態を作る
- 引き継がない旧単位の open PR を close せず、不要な旧ベースライン向け変更が後から取り込まれる余地を残す
- 本文リンク列挙とサブイシューを併用して進捗の見方を二系統にする

## 追加リソース

- 集計の観点と出力例: [reference.md](reference.md)
