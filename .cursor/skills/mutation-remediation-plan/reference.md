# ミューテーション結果の集計リファレンス

## artifact レイアウト

```text
/tmp/mutation-results-<RUN_ID>/
├── mutation-report-sim-root/
│   ├── stryker-incremental-sim-root.json
│   └── mutation/index.html
├── mutation-report-sim-run-engine/
│   └── ...
└── ...
```

シャード名は workflow の `matrix.id` と一致する（例: `sim-root`, `sim-run-engine`, `state`）。  
フルシャード baseline では上記6シャード分が揃っていること。`mutation-report-custom` のみの run は部分分析。

## status の意味

| status | 意味 | score への寄与 |
| --- | --- | --- |
| Killed | テストが変異を検出 | 分子に加算 |
| Timeout | タイムアウト扱い（検出扱い） | 分子に加算 |
| Survived | テストが通ったまま | 分母のみ（弱点） |
| NoCoverage | その行を通るテストなし | total 分母のみ（未計測） |
| Ignored | ignoreStatic 等で除外 | スコア対象外 |

## 集計スクリプト例

```javascript
// node で incremental JSON を読み、ファイル単位に集計する例
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = [];
for (const [file, info] of Object.entries(j.files || {})) {
  const c = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, ignored: 0 };
  for (const m of info.mutants || []) {
    const k = {
      Killed: 'killed',
      Survived: 'survived',
      Timeout: 'timeout',
      NoCoverage: 'noCoverage',
      Ignored: 'ignored',
    }[m.status];
    if (k) c[k]++;
  }
  const denom = c.killed + c.survived + c.timeout + c.noCoverage;
  const cov = c.killed + c.survived + c.timeout;
  rows.push({
    file,
    ...c,
    scoreTotal: denom ? (100 * (c.killed + c.timeout)) / denom : null,
    scoreCovered: cov ? (100 * (c.killed + c.timeout)) / cov : null,
  });
}
rows.sort((a, b) => (a.scoreTotal ?? 999) - (b.scoreTotal ?? 999));
console.table(rows.slice(0, 30));
```

## 壁時計の取り方

```bash
gh run view <RUN_ID> --json jobs \
  --jq '.jobs[] | {name, startedAt, completedAt, conclusion}'
```

## Batch 分割の目安

- 1PR で触る本番／テストは、関連する数ファイルまでに抑える
- `engine.ts` のように Survived が数百のファイルは、phase / shop・rest / hydrate / 敗北などで PR を分割する
- 各 PR の検証は該当 `--mutate` のみ（フルシャードは記録用・週次用）

## 出力テンプレ（ユーザー向け要約）

```markdown
## サマリー
- run: <url>
- エピック: RI-NN（再ベースラインのため新規）
- 実装単位: RI-NN-A1 …（件数 M、最優先 RI-NN-A1）
- 全体 total: X% / covered: Y%
- ワースト: file (Z%)

## 推奨着手順
| ID | 対象 | 受入 |
| --- | --- | --- |
| RI-NN-A1 | … | total 70%+ |

## 文書
- plan/mutation-remediation.md をエピック RI-NN + 実装単位付きで更新
- 旧ミューテーションエピックは完了（後続 RI-NN に置換）
```

