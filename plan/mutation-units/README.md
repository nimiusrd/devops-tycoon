# ミューテーション実装単位（1ファイル = 1PR）

各 `RI-{N}-{GROUP}{SEQ}.md` が実装単位の**進捗と詳細の正本**。  
エピック共通の説明・ベースライン数値・静的な着手順は [`../mutation-remediation.md`](../mutation-remediation.md) を参照。

## なぜ分割するか

同一 Markdown の一覧表・状態行を複数 PR が並列更新すると衝突する（RI-72 で多発）。  
単位ごとにファイルを分けると、実装 PR は自分の単位ファイルだけを更新でき、進捗更新の漏れも起きにくい。

## 実装単位 PR が触るもの

1. テスト（とやむを得ない最小の本番修正）
2. **このディレクトリの自分の単位ファイルだけ**（`状態`、必要なら任意の作業メモ、`やる事` の消化メモ）

触らないもの: `plan/mutation-remediation.md`（静的索引）、`plan/remaining-issues.md`、`plan/README.md`（エピック完了時のみ親が更新）。

## 状態の一覧表示

共有ファイルへ状態を書き戻さず、単位ファイルから集計する。  
既定は [`mutation-remediation.md`](../mutation-remediation.md) の現行エピックに属する単位のみ（旧エピックの残ファイルは含めない）。

```bash
npm run mutation:units:status
npm run --silent mutation:units:status -- --json
node scripts/mutation-units-status.mjs --json
node scripts/mutation-units-status.mjs --epic RI-72
node scripts/mutation-units-status.mjs --all
npm run mutation:units:status -- --fail-if-incomplete
```

`--fail-if-incomplete` は構造整合と `状態=完了` だけを見る。**達成率（total / covered）や S/NC 件数の記載・整合は要求しない**（壊れやすく、完了ゲートの対象にしない）。

失敗にする主な条件: スコープ内の単位ファイル 0 件、§5 静的索引の欠落／重複／壊れたリンク／不正形式 ID、現行エピック索引への別エピック混入、orphan ファイル、不正な単位 ID ファイル名、索引 0 件、索引リンク先不一致、索引と単位のタイトル／対象不一致、対象が空、対象がリポジトリ内の通常ファイルでない（`..`・ディレクトリ・repo 外は不可）、索引はちょうど3列（状態列禁止。HTML コメント／fenced code 内の表は索引に含めない）、単位コメント／見出し ID の不一致、必須メタ（`状態`／`対象`／`既存テスト`／`再計測`／`受入`）の重複・欠落・空欄、`状態` が完了以外。`Baseline` / `After:` は任意（0または1行）。`--all`、および現行エピック以外を明示した `--epic` では索引依存検査を抑止する（単位 0 件は常に失敗）。未知の CLI 引数も拒否する。

## ファイル書式

先頭コメントで ID を固定し、本文は次の形にする（計画作成時にスキルが生成）。  
**達成率・score・S/NC 件数は単位ファイルに書かない**（エピック共通のベースライン数値は `mutation-remediation.md` 側のスナップショットに任せる）。

```markdown
<!-- mutation-unit: RI-{N}-{GROUP}{SEQ} -->

# RI-{N}-{GROUP}{SEQ} — {短いタイトル}

| 項目 | 内容 |
| --- | --- |
| 状態 | 未着手 / 進行中 / 完了 |
| 対象 | `path/to/file.ts` |
| 既存テスト | `tests/unit/….test.ts` または なし |
| 再計測 | `npm run test:mutation:force -- --mutate {path}` |
| 受入 | 定性的な完了条件（例: 対象の主要 Survived / NoCoverage をテストで潰す） |

やる事:

- …
```

完了時は `状態` を `完了` にする。作業メモが必要なら任意で `After:` を1行足してよい（数値スコアは不要）。
