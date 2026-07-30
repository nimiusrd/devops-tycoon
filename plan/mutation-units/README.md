# ミューテーション実装単位（1ファイル = 1PR）

各 `RI-{N}-{GROUP}{SEQ}.md` が実装単位の**進捗と詳細の正本**。  
エピック共通の説明・ベースライン数値・静的な着手順は [`../mutation-remediation.md`](../mutation-remediation.md) を参照。

## なぜ分割するか

同一 Markdown の一覧表・状態行を複数 PR が並列更新すると衝突する（RI-72 で多発）。  
単位ごとにファイルを分けると、実装 PR は自分の単位ファイルだけを更新でき、進捗更新の漏れも起きにくい。

## 実装単位 PR が触るもの

1. テスト（とやむを得ない最小の本番修正）
2. **このディレクトリの自分の単位ファイルだけ**（`状態`、`After:`、必要なら「やる事」の消化メモ）

触らないもの: `plan/mutation-remediation.md`（静的索引）、`plan/remaining-issues.md`、`plan/README.md`（エピック完了時のみ親が更新）。

## 状態の一覧表示

共有ファイルへ状態を書き戻さず、単位ファイルから集計する:

```bash
npm run mutation:units:status
npm run mutation:units:status -- --json
```

## ファイル書式

先頭コメントで ID を固定し、本文は次の形にする（計画作成時にスキルが生成）。

```markdown
<!-- mutation-unit: RI-{N}-{GROUP}{SEQ} -->

# RI-{N}-{GROUP}{SEQ} — {短いタイトル}

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

After: total …% / covered …% / S=… / NC=…（完了時）
```
