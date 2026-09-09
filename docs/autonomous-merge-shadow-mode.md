# Autonomous Merge Shadow Mode

このPoCは、PRを止めたりmergeしたりせずに、将来のAutonomous Merge Gateに必要な判定データを集めるためのものです。

## 判定の流れ

```text
PR base SHA ──→ trusted evaluator.py + policy.toml
       │
       └── merge base SHA ──→ ファイル内容の比較 ←── PR head SHA
                                      │
                                      ▼
                               PR Risk / Decision
```

workflowはtrusted base、merge base、headを分けて扱います。評価器とpolicyは常にPR base SHA側のファイルを明示して実行し、差分比較だけをPRのmerge baseからheadまでに限定します。head側のコード、script、依存関係は実行しません。権限も`contents: read`だけです。PRで評価器・policyを変更しても、そのPRの評価ルールには反映されず、変更されたこと自体がHard Gateになります。

このPRが最初の導入PRでbase SHAに評価器・policyがまだ存在しない場合は、workflowは`HUMAN_REVIEW_REQUIRED (bootstrap)`とRisk `N/A`をSummaryへ出して終了します。これはtrustedな評価基準がまだbaseにないための保守的な初回判定で、PRをblockするものではありません。merge後、次のPRから通常の数値評価が始まります。

## devops-tycoon向けの初期policy

このリポジトリの実際の構造に合わせ、次の領域を特に高リスクとしています。

| 対象 | 初期扱い | 理由 |
| --- | --- | --- |
| `.github/workflows/**`、`.devcontainer/**`、`.nvmrc` | Hard Gate | CI・実行環境を変更するため |
| `package.json`、`package-lock.json`、`*.config.*`、`tsconfig*.json` | Hard Gate | 依存関係・ビルド・テスト契約を変更するため |
| `src/state/**`、`src/game.ts` | Hard Gate | セーブ、永続化、状態遷移を束ねる中核のため |
| `src/sim/run/**`、`src/sim/engine.ts`、`src/sim/rng.ts`、`src/sim/seed.ts` | Hard Gate | ラン進行とseed再現性の中核であるため |
| `src/data/balance/**`、`src/data/contentCatalog.ts` | Hard Gate | バランス、確率、コンテンツ契約を変更するため |
| `src/sim/**`、`src/data/**`、`src/ui/**`、`src/render/**`、`src/**/*.css` | リスク加点 | 変更量とテスト有無を組み合わせて判定するため |
| `tests/**`、`tests/**/*-snapshots/**`、`tests/**/__snapshots__/**`、`docs/**`、`*.md` | 低加点 | 変更量は計測するが、単独ではHard Gateにしないため |

初期閾値は、Project Health `90`、最低Project Health `80`、PR Risk `25`です。Project Healthは事故確率ではなく、CI・テスト・セキュリティ・復旧能力を後から実測値へ置き換えるためのcontrol maturity indexです。変更行数、変更ファイル数、変更path、コード変更に対するテスト変更の有無を固定ルールで採点します。

## ローカル実行

baseとheadのディレクトリを用意したうえで、base側の評価器とpolicyを指定します。

```bash
python3 /path/to/base/.github/autonomous-merge/evaluate.py \
  --base-dir /path/to/merge-base \
  --head-dir /path/to/head \
  --policy /path/to/base/.github/autonomous-merge/policy.toml \
  --trusted-base-dir /path/to/base \
  --format markdown
```

決定論的なテストは次で実行できます。

```bash
python3 -m unittest discover \
  -s .github/autonomous-merge \
  -p 'test_*.py'
```

## ロールアウト計画

1. まずこのworkflowをrequired checkにせずmergeし、Shadow Modeを有効にする。
2. 1〜2スプリント、または最低30日間、Actions Summaryの判定と人間レビュー結果を記録する。
3. `ELIGIBLE_FOR_AUTONOMOUS_MERGE`なのに重大なレビュー指摘、revert、hotfixが発生したケースをFalse Negativeとして最優先で調査する。
4. 閾値やpath ruleを調整し、十分な実績が得られた場合だけ、対象を限定したrequired check接続を別PRで検討する。自動mergeの実装はこのPoCの範囲外とする。

## 観測するメトリクス

- Decision別のPR数・割合（eligible / human review）
- Hard Gate理由別の件数（状態、シミュレーション、balance、CIなど）
- False Negative率（eligible判定後の重大レビュー指摘、revert、hotfix）
- False Positive率（human判定だが実際には低リスクだったPR）
- 変更行数・ファイル数とレビュー時間、CI時間の相関
- CI failure / flaky test / rerun成功率
- deploy後のrevert・hotfix率と復旧時間

特にFalse Negativeをゼロに近づけることを優先し、Risk `25`を事故確率として解釈しないでください。最初の目的は、既存のレビュー判断と安全に比較できる基準線を作ることです。
