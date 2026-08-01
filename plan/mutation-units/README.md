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

`--fail-if-incomplete` は次を失敗にする: スコープ内の単位ファイル 0 件、§5 静的索引表にある `<ID>.md` の欠落、索引行の重複 ID・壊れたリンク構文・ゼロ埋め／複数文字グループ／SEQ 欠落／小文字化等の不正形式 ID（`RI-72-A01` / `RI-72-AA1` / `RI-72-A` / `ri-72-A1` 等）、現行エピック索引への別エピック ID 混入、現行エピックで索引にない orphan ファイル、README 以外で単位 ID として不正な `.md`（`RI_72_Z99.md` / `ri-72-A1.md` / `RI-072-A1.md` 等。スコープ外でも常に検出）、索引 0 件、単位 ID ラベルのリンク先が `./mutation-units/<ID>.md` でない／不一致、索引のタイトル／対象列と単位ファイル見出し／`対象` の不一致、対象が空（索引・単位とも少なくとも1件の非空パス必須）、対象パスがリポジトリ内に実在すること、索引はちょうど3列（ID｜タイトル｜対象。状態列や余分な列は拒否。HTMLコメントアウト行は索引に含めない）、ファイル先頭の `<!-- mutation-unit: -->` がちょうど1件かつファイル名／見出し ID と一致（HTML コメント／3文字以上の ```・~~~ fenced code 内の進捗行は集計しない。状態等は行頭の正規メタ行のみ）、`状態`／`対象`／`Baseline`／`既存テスト`／`再計測`／`受入` 行の重複・欠落・空欄（`After:` の重複も不可）、`状態` が完了以外、Baseline に total / covered(または n/a) / S / NC が無い、完了なのに実測の `After:` が無い（注記括弧を除いた表層に total/covered/S/NC。`未計測`／`未測定`／表層の `参考値` は拒否。total / covered は 0–100% かつ covered ≥ total、NC=0 なら両者一致、S / NC は非負整数トークン必須。`covered n/a` は total=0・S=0・NC>0 のときだけ）。索引表はコードスパン内の `|` と `\|` を列区切りにしない。`--all`、および現行エピック以外を明示した `--epic` では索引依存検査（欠落・orphan・索引0件・リンク不正・別エピック混入・タイトル／対象不一致）を抑止し、旧エピック保管ファイルの横断表示に使える（ただし単位 0 件は常に失敗）。未知の CLI 引数も拒否する。

## ファイル書式

先頭コメントで ID を固定し、本文は次の形にする（計画作成時にスキルが生成）。  
`After:` 行は**計画テンプレートに含めない**。完了時に実装 PR で追記する。

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
```

完了時の追記例:

```markdown
After: total 92.59% / covered 93.46% / S=7 / NC=1（local）
```
