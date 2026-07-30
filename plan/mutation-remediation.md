# ミューテーションテスト改善バックログ

実装役向けの作業指示書。ベースラインは GitHub Actions
[Mutation run 30261978402](https://github.com/nimiusrd/devops-tycoon/actions/runs/30261978402)
（2026-07-27、シャード並列・成功）。  
`headSha`: `c065e01ea73cb8df431210dbd6f354cfd3c4059e`

関連設定: [`stryker.config.json`](../stryker.config.json)、[`.github/workflows/mutation.yml`](../.github/workflows/mutation.yml)。  
ベースライン（エピック）: **RI-72**（[`remaining-issues.md`](./remaining-issues.md)）— run 30261978402 専用。  
実装単位: **`RI-72-A1` 形式**（1 ID = 1PR）。詳細と進捗の正本は [`mutation-units/`](./mutation-units/)。  
再ベースライン: [`.cursor/skills/mutation-remediation-plan/SKILL.md`](../.cursor/skills/mutation-remediation-plan/SKILL.md) に従い、**run ID が変わったときだけ**新しいエピック `RI-{N}` を採番し、実装単位も `RI-{N}-…` で振り直す。同じ run の計画修正では既存エピックを再利用する。旧エピックは完了扱い、未消化単位は新計画へ引き継ぐ。

## 1. ID フォーマットとファイル配置

| 種別 | 形式 | 例 | 意味 |
| --- | --- | --- | --- |
| エピック（ベースライン） | `RI-{N}` | `RI-72` | フルシャード Mutation run 1回分の計画全体。`remaining-issues.md` に載せる |
| 実装単位 | `RI-{N}-{GROUP}{SEQ}` | `RI-72-A1` | 1PR で完了する作業。`GROUP` は優先グループ（A=最高…）、`SEQ` はグループ内の連番（1起算、ゼロ埋めなし） |

規則:

- `{N}` は既存 `RI-(\d+)` の最大+1（欠番再利用なし）。再ベースラインごとに新規。
- `{GROUP}` は大文字1文字 `A`–`Z`。優先度の高い順に A から振る。
- `{SEQ}` はグループ内で着手順に 1, 2, 3…。途中追加は末尾採番（欠番再利用なし）。
- **1実装単位 = 1PR。** ブランチ名・PR タイトル先頭に ID を含める（例: `RI-72-A1: industry の mutation 耐性を上げる`）。
- **本ファイル**はエピック共通（目的・ベースライン・静的な着手順索引・運用メモ）の正本。
- **各実装単位の詳細と進捗（状態 / After）**は [`plan/mutation-units/RI-{N}-{GROUP}{SEQ}.md`](./mutation-units/) が正本。`remaining-issues.md` にはエピックだけを載せ、本ファイルへリンクする。

### 実装単位ファイルの書式（必須）

計画作成時に `plan/mutation-units/` へ 1 単位 1 ファイルを置く。書式は [`mutation-units/README.md`](./mutation-units/README.md) を参照。

```markdown
<!-- mutation-unit: RI-{N}-{GROUP}{SEQ} -->

# RI-{N}-{GROUP}{SEQ} — {短いタイトル}

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

`After:` はテンプレートに置かない。完了時に実装 PR で例えば `After: total 92.59% / covered 93.46% / S=7 / NC=1（local）` を追記する（total / covered / S / NC を数値付きで揃える）。

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

- 本ベースラインの実装単位（少なくとも Group A–D。本エピックでは A1–E8）がすべて `完了` であること（各単位ファイルの `状態`。集計は `npm run mutation:units:status`）。

**再ベースライン推奨（エピック完了条件ではない）**

- フルシャード再計測で全体 total がおおむね 80%未満なら、新エピックを採番して追う。
- 中期目安: `engine` / `quarterReview` / `industry` の covered **85%+**

## 4. 作業ルール（実装役共通）

1. **原則はテスト追加・強化のみ。** 本番コード変更は、バグ修正が必要と判明したときに限る。
2. 意図的に落とさない分岐だけ `// Stryker disable next-line` 等を検討する。安易な一括 disable は禁止。
3. **1PR = 1実装単位 ID。** 複数単位をまとめる場合は事前に計画側で ID を統合してから着手する。
4. 変更前に `npm test`、変更後に単位の「再計測」コマンドと `npm run lint` / `npm run format:check`。
5. PR 本文に **実装単位 ID**、Before/After の score（total / covered）と Survived / NoCoverage 数を記す。
6. 同じ PR で **自分の単位ファイル**（`plan/mutation-units/RI-….md`）の `状態` と `After:` を更新する。
7. 日本語でコミット・PR する（リポジトリ慣例）。

### ファイル分割による並列衝突回避

| ファイル | 誰がいつ触るか | 並列時 |
| --- | --- | --- |
| `plan/mutation-remediation.md` | 計画作成・再ベースライン・エピック完了の親 PR | 実装単位 PR は**編集しない**（状態列を持たない静的索引） |
| `plan/mutation-units/<ID>.md` | その単位の実装 PR | **自分の ID のファイルだけ**更新。他単位と衝突しない |
| `plan/remaining-issues.md` / `plan/README.md` | エピック採番・エピック完了の親 PR | 実装単位 PR は触らない |

状態の横断表示は共有 md へ書き戻さず、現行エピック分だけを次で読む（旧単位ファイルは既定で除外）:

```bash
npm run mutation:units:status
```

同一対象ソースに複数単位がある場合（例: `engine.ts` の D1–D5）は、共有の既存テストを編集せず **単位専用の新規テストファイル**を追加する（またはシリアル着手）。

## 5. 実装単位一覧（着手順・静的索引）

**状態はここに書かない。** 各単位ファイルの `状態` が正本。一覧表示は `npm run mutation:units:status`。

| ID | タイトル | 対象 |
| --- | --- | --- |
| [RI-72-A1](./mutation-units/RI-72-A1.md) | industry スコア式の境界と係数 | `src/sim/orgscale/industry.ts` |
| [RI-72-A2](./mutation-units/RI-72-A2.md) | whatIfState のキーと modifier | `src/sim/run/whatIfState.ts` |
| [RI-72-A3](./mutation-units/RI-72-A3.md) | whatIfClient の初カバー | `src/sim/run/whatIfClient.ts` |
| [RI-72-B1](./mutation-units/RI-72-B1.md) | replayPersistence の失敗系 | `src/state/replayPersistence.ts` |
| [RI-72-B2](./mutation-units/RI-72-B2.md) | metaPersistence の壊れた入力 | `src/state/metaPersistence.ts` |
| [RI-72-B3](./mutation-units/RI-72-B3.md) | replay 正規化の条件枝 | `src/state/replay.ts` |
| [RI-72-B4](./mutation-units/RI-72-B4.md) | runPersistence の境界 | `src/state/runPersistence.ts` |
| [RI-72-C1](./mutation-units/RI-72-C1.md) | quarterReview の閾値と outcome | `src/sim/run/quarterReview.ts` |
| [RI-72-D1](./mutation-units/RI-72-D1.md) | engine phase guard | `src/sim/run/engine.ts` |
| [RI-72-D2](./mutation-units/RI-72-D2.md) | engine shop / rest / recruit | `src/sim/run/engine.ts` |
| [RI-72-D3](./mutation-units/RI-72-D3.md) | engine hydrate / セーブ復元 | `src/sim/run/engine.ts` |
| [RI-72-D4](./mutation-units/RI-72-D4.md) | engine 勝敗と quarterReview 突入 | `src/sim/run/engine.ts` |
| [RI-72-D5](./mutation-units/RI-72-D5.md) | engine NoCoverage 潰し | `src/sim/run/engine.ts` |
| [RI-72-E1](./mutation-units/RI-72-E1.md) | generate の teams / id 分岐 | `src/sim/orgscale/generate.ts` |
| [RI-72-E2](./mutation-units/RI-72-E2.md) | effects の fold 係数 | `src/sim/run/effects.ts` |
| [RI-72-E3](./mutation-units/RI-72-E3.md) | sprintBaselineBuild の入力差分 | `src/sim/run/sprintBaselineBuild.ts` |
| [RI-72-E4](./mutation-units/RI-72-E4.md) | events の残 Survived | `src/sim/run/events.ts` |
| [RI-72-E5](./mutation-units/RI-72-E5.md) | outcome の敗北閾値 | `src/sim/outcome.ts` |
| [RI-72-E6](./mutation-units/RI-72-E6.md) | assignTask の NoCoverage | `src/sim/assignTask.ts` |
| [RI-72-E7](./mutation-units/RI-72-E7.md) | meta の残 Survived | `src/state/meta.ts` |
| [RI-72-E8](./mutation-units/RI-72-E8.md) | roster の残 Survived | `src/sim/member/roster.ts` |

グループ対応: A = ワースト（P0）、B = Persistence / リプレイ、C = 四半期レビュー、D = RunEngine、E = 中優先（P2）。詳細は各単位ファイル。

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

- 実装単位の受入達成時: 同じ実装 PR で **単位ファイル**の `状態` を `完了` にし `After:` を追記。PR 本文にも単位 ID と Before/After を記す。
- エピック完了判定: `npm run mutation:units:status -- --fail-if-incomplete` が成功すること（現行エピックの単位のみ。または同等の確認）。
- **エピック RI-72 完了条件**: 実装単位 A1–E8（Group A–D を含む）がすべて完了していること。全体 total おおむね 80%+ は完了条件に含めない（再ベースライン推奨）。
- **RI-72 状態**: **完了**（実装単位 A1–E8 すべて完了）。全体 total のフルシャード再計測は未実施で、次の Mutation run で新エピックを採番して追う。
- **再ベースライン時**: 新エピック `RI-{N}` を採番し、実装単位を `RI-{N}-A1`… で振り直す。旧単位の未消化は **新 ID の単位ファイル**へ内容をコピーして引き継ぐ（旧 ID での実装継続はしない）。`plan/mutation-units/` 分割と静的索引（状態列なし）を維持する。
