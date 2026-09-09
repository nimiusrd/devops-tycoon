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

workflowは`pull_request_target`でbaseブランチ側の定義を実行し、trusted base、merge base、headを分けて扱います。評価器とpolicyは常にPR base SHA側のファイルを明示して実行し、差分比較だけをPRのmerge baseからheadまでに限定します。Git treeは`ls-tree -z`で列挙し、`cat-file blob`でraw blobを直接展開するため、`.gitattributes`の`export-ignore`や`export-subst`などの属性変換は比較へ影響しません。tree mode `120000`のsymlinkはOS上へ作らずobject IDのmanifestとして、`160000`のgitlinkもmanifestとして扱います。raw blobは展開前に1件8MB・tree合計64MB・tree entry 50,000件の上限を検査します。head側のコード、script、依存関係は実行しません。PRのbase変更を含む`edited`でも再評価します。コード取得には`contents: read`だけを使い、結果コメントの更新権限は評価jobと再評価jobに限定します。

baseブランチへのpush時は、別jobがopenなPR一覧を取得し、各PRの現在のbase SHA・merge base・head SHAで再評価します。結果はPRごとの専用コメント（`autonomous-merge-shadow-result` marker）を更新するため、base側のpolicyやProject Healthが変わったときも古い判定を残しません。通常のPR評価でも同じコメントを更新するため、head更新後に古い結果を残しません。評価器または評価前のfetch・tree展開・manifest生成・base側自己テストが完了できない場合も、既存の結果を残さず`HUMAN_REVIEW_REQUIRED` / `EVALUATION_FAILED`へ更新します。両経路ともコメント投稿直前にPRの現在のbase/head SHAを再確認し、古いrunは結果を書き込みません。workflowのconcurrencyもPR番号またはpush refごとに分離します。この再評価jobと通常評価jobだけがissueコメント更新権限を持ち、コード実行やmerge操作は行いません。PRで評価器・policy・workflowを変更しても、そのPRの評価ルールや実行定義には反映されず、変更されたこと自体がHard Gateになります。

このPRが最初の導入PRの場合、baseブランチにはまだ`pull_request_target`のworkflow定義がないためworkflow自体が実行されません。そのため初回導入PRは人手レビュー必須として扱い、merge後の次のPRから通常の数値評価が始まります。baseにworkflowは存在するが評価器・policyがない場合は、`HUMAN_REVIEW_REQUIRED (bootstrap)`とRisk `N/A`をSummaryへ出して終了します。

## devops-tycoon向けの初期policy

このリポジトリの実際の構造に合わせ、次の領域を特に高リスクとしています。

| 対象 | 初期扱い | 理由 |
| --- | --- | --- |
| `.github/workflows/**`、`.devcontainer/**`、`.codex/environments/**`、`.codex/config.toml`、`.nvmrc` | Hard Gate | CI・実行環境・Codex権限を変更するため |
| `package.json`、`package-lock.json`、`*.config.*`、`tsconfig*.json` | Hard Gate | 依存関係・ビルド・テスト契約を変更するため |
| `.prettierrc.json`、`.prettierignore` | Hard Gate | フォーマット設定や対象範囲を変更するため |
| `.gitmodules`、Git treeのgitlink（mode `160000`） | Hard Gate | submodule構成または参照SHAを変更するため |
| `src/state/**`、`src/game.ts` | Hard Gate | セーブ、永続化、状態遷移を束ねる中核のため |
| `src/sim/run/**`、`src/sim/engine.ts`、`src/sim/rng.ts`、`src/sim/seed.ts` | Hard Gate | ラン進行とseed再現性の中核であるため |
| `src/data/balance/**`、`src/data/contentCatalog.ts` | Hard Gate | バランス、確率、コンテンツ契約を変更するため |
| `index.html`、`src/**`、`public/**` | リスク加点 | 起動・実装・視覚変更を含め、変更量と対応するテスト種別を組み合わせて判定するため |
| `src/sim/**`、`src/data/**`、`src/ui/**`、`src/render/**`、`src/**/*.css` | リスク加点 | 領域ごとの変更影響を細分化して判定するため |
| `src/App.tsx`、`src/main.tsx` | リスク加点 | ルート画面と起動処理を変更するため |
| `tests/**`、`tests/**/*-snapshots/**`、`tests/**/__snapshots__/**`、`docs/**`、`*.md` | 低加点 | 変更量は計測するが、単独ではHard Gateにしないため |
| `tests/playtest/**`、`tests/fixtures/**` | リスク加点 | suffixを持たないtest支援モジュールも含む共有fixture・シナリオ基盤を変更するため |
| `tests/unit/helpers/**`、`tests/e2e/fixtures.ts`、`tests/e2e/seedMeta.ts`、`tests/playtest/harness.ts`、`tests/playtest/globalSetup.ts` | Hard Gate | 多数のテストから共有されるfixture・測定・初期化基盤を変更するため |
| `.agents/skills/**`、`**/AGENTS.md`、`docs/design-system.md`、`vite.webglModules.ts` | Hard Gate | エージェント手順、階層別の作業指示、UI規約、またはWebGLビルド契約を変更するため |

初期閾値は、Project Health `90`、最低Project Health `80`、PR Risk `25`です。Project Healthは事故確率ではなく、CI・テスト・セキュリティ・復旧能力を後から実測値へ置き換えるためのcontrol maturity indexです。変更行数、変更ファイル数、変更path、コード変更に対するテスト変更の有無を固定ルールで採点します。

検証判定はPR全体でテストファイルが1件あるかだけでは決めません。UI・CSS・静的アセットはE2Eまたは視覚スナップショット、simulation・data・state・audio・scriptsは対応するunit/playtest領域など、変更pathに対応するverification scopeごとに実際のrunnerが探索するsuffix（Vitest unit/srcは`.test.ts`/`.spec.ts`、playtestは`.test.ts`のみ、Playwright e2eは`.test.ts`/`.spec.ts`）の追加行があるテストを要求します。削除または純減のテスト変更には別のリスクを加算し、同内容の純粋renameは削除リスクだけでなく検証充足からも除外します。Git treeのsubmodule gitlink変更はファイルシステム走査に依存せずHard Gateにします。snapshot entryにはGitの実行権限（`100644` / `100755`）も保持し、内容が同じmode-only変更も差分として扱います。不正UTF-8を含むblobはbinaryとして保守的に扱い、実際のbyte列が同じ行へ置換されないようにします。大きなテキストは決定論的な保守的カウントへ切り替え、反復行を含む差分で比較時間が無制限に増えないようにし、snapshot読込みも1ファイル8MB・1評価64MB・各snapshot 50,000ファイルまでに制限します。

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
