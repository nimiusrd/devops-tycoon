# ミューテーションテスト改善バックログ

実装役向けの作業方針。Mutation の課題は対応後に参照する必要が薄いため、**実装単位の進捗は GitHub Issue で管理する**（完了したら close。計画 MD に状態を書き戻さない）。

関連設定: [`stryker.config.json`](../stryker.config.json)、[`.github/workflows/mutation.yml`](../.github/workflows/mutation.yml)。  
計画スキル: [`.cursor/skills/mutation-remediation-plan/SKILL.md`](../.cursor/skills/mutation-remediation-plan/SKILL.md)。

## 1. 管理方針（Issue）

| 種別 | 形式 | 管理場所 | 例 |
| --- | --- | --- | --- |
| エピック（ベースライン） | `RI-{N}` | **GitHub Issue**（タイトル `[RI-{N}]`） | `RI-91` |
| 実装単位 | `RI-{N}-{GROUP}{SEQ}` | **GitHub Issue**（1 Issue = 1PR。エピックのサブイシュー） | `RI-91-A1` |

規則:

- 採番・進捗の正本は GitHub Issue。`remaining-issues.md` に予約行や番号台帳を置かない。
- `{N}` は open/closed のエピック Issue タイトルから見た既存 `RI-(\d+)` の最大+1（欠番再利用なし）。一般バックログとの衝突回避のため文書上の既存 ID は読み取るだけ。フルシャード run の再ベースラインごとに新規エピック。親 Issue 作成が番号予約であり、作成直後に同 ID の競合を再確認する。
- `{GROUP}` は大文字1文字 `A`–`Z`（A が最高優先）。`{SEQ}` はグループ内 1, 2, 3…（ゼロ埋め・欠番再利用なし）。
- **1実装単位 = 1 Issue = 1PR。** Issue / PR タイトル先頭に ID（例: `[RI-91-A1] industry の mutation 耐性を上げる`）。
- 進捗の正本は Issue の open/close。共有 Markdown に状態列や達成率を置かない（並列コンフリクトと本末転倒を避ける）。
- 達成率（total / covered / S / NC）は Issue 必須項目にも完了条件にもしない。
- 完了後は Issue を close するだけでよい（リポジトリへ単位ファイルを残さない）。

### Issue に書くこと（実装単位）

テンプレート: [`.github/ISSUE_TEMPLATE/mutation-unit.md`](../.github/ISSUE_TEMPLATE/mutation-unit.md)

- 対象パス
- 既存テスト
- 再計測コマンド（`npm run test:mutation:force -- --mutate …`）
- 定性的な受入（例: 対象の主要 Survived / NoCoverage をテストで潰す）
- やる事（具体的な断言・ケース）

エピック用トラッキング Issue には run URL・`headSha`・方針を置く。実装単位は **GitHub のサブイシュー**としてエピック配下にぶら下げる（本文への子リンク列挙はしない）。  
子の open / closed はサブイシュー一覧で識別する（別途状態表は作らない）。  
サブイシューがすべて closed になったらエピック Issue も close する。完了後に不足分を足すときはエピックを reopen する。  
再ベースラインでは、親 Issue・サブイシューが揃ったことを確認してから open PR を整理し、その後で **旧エピック Issue 自体**と配下の **全 open サブイシュー**を置換／不要理由付きで close する。引き継ぐ open PR は ID / `Fixes`・`Closes` を新 Issue へ付け替え、引き継がない open PR も理由付きで close する。Issue 運用前に完了した履歴エピック（親 Issue 無し）は Issue 同期対象外。途中作成 Issue の再利用は、本文の run URL / `headSha` が一致するときだけ（番号にかかわらず検索する。未紐づけの作成済み単位 Issue も二重作成しない）。

### 並列作業

- 実装 PR は **自分の Issue に紐づくテスト変更だけ**を触る。計画 MD の状態更新は不要。
- 同一ソースを複数単位に割る場合はシリアル、または単位専用の新規テストファイル（共有テストを編集しない）。

## 2. 目的と非目的

**目的**

- Survived / NoCoverage が多いコアロジックのユニットテストを強化し、mutation score を上げる。
- 決定論的な `src/sim` / `src/state` の回帰耐性を高める。

**非目的**

- Mutation を PR 必須 CI ゲートにしない（`thresholds.break: null` を維持）。
- スコアのためだけの本番ロジック変更（挙動を変えるリファクタは別課題）。
- 6シャードの HTML レポートを1本に統合すること（必須ではない）。
- 単位ごとの達成率を計画や Issue に永久保存すること。

## 3. 作業ルール（実装役共通）

1. **原則はテスト追加・強化のみ。** 本番コード変更は、バグ修正が必要と判明したときに限る。
2. 意図的に落とさない分岐だけ `// Stryker disable next-line` 等を検討する。安易な一括 disable は禁止。
3. **1PR = 1実装単位 Issue。** 複数単位をまとめる場合は事前に Issue 側で統合してから着手する。
4. 変更前に `npm test`、変更後に Issue の再計測コマンドと `npm run lint` / `npm run format:check`。
5. PR 本文に **実装単位 ID**・実施内容・Fixes / Closes で Issue を閉じる。達成率の転記は不要。
6. 日本語でコミット・PR する（リポジトリ慣例）。

## 4. 典型的な Survived の直し方

| Mutator | よくある欠け | 直し方 |
| --- | --- | --- |
| ConditionalExpression / LogicalOperator | `a && b` の片側しか見ていない | 真偽の組み合わせ表で断言 |
| EqualityOperator | `>` と `>=` を区別していない | 境界値ちょうどを断言 |
| ArithmeticOperator | `*` と `/`、`+` と `-` を区別していない | 既知入力の数値結果を固定 |
| MethodExpression (`Math.min`/`max`) | clamp の効きを見ていない | 下限未満・上限超過を入れる |
| StringLiteral | キー連結やラベルを見ていない | キャッシュキー全体 or 部分文字列を断言（低価値なら disable 可） |
| BlockStatement | 早期 return 本体が空でも通る | 副作用（状態変化）を断言 |
| NoCoverage | テストがその行を通っていない | 到達する入力を追加。死コードなら削除 or disable |

## 5. 運用メモ（インフラ）

- 週次 / 手動 Mutation はシャード並列のまま。初回は重いが、incremental cache が載れば差分だけになる。
- 単一ジョブでコア全体を回すと数時間・180分タイムアウトのリスクあり。**通常はシャードまたは `--mutate`。**
- `ignoreStatic: true` 済み。`vitest.mutation.config.ts` で testTimeout 60s。

## 6. RI-72（完了・単位 MD 廃止）

ベースラインは GitHub Actions
[Mutation run 30261978402](https://github.com/nimiusrd/devops-tycoon/actions/runs/30261978402)
（2026-07-27、シャード並列・成功）。  
`headSha`: `c065e01ea73cb8df431210dbd6f354cfd3c4059e`

**状態: 完了**（実装単位 A1–E8）。かつての `plan/mutation-units/` 分割と状態ゲートは廃止した。完了後に参照しない単位詳細はリポジトリに残さない。

当時の参考スナップショット（再計測義務なし）:

| 指標 | 値 |
| --- | --- |
| Mutation score (total) | 約 73.4% |
| Mutation score (covered) | 約 77.3% |
| Killed / Survived / Timeout / NoCoverage | 4157 / 1375 / 513 / 321 |

**次回以降:** 新しいフルシャード run でエピック `RI-{N}` を採番し、実装単位は GitHub Issue として切る（本ファイルの方針とスキルに従う）。
