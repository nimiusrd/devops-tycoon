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

workflowは`main`をbaseとするPRだけを対象に、`pull_request_target`でbaseブランチ側の定義を実行し、trusted base、merge base、headを分けて扱います。評価器とpolicyは常にPR base SHA側のファイルを明示して実行し、差分比較だけをPRのmerge baseからheadまでに限定します。tree entryの一覧はblob内容を取得しない`git ls-tree -r -z`を50,000件の上限へ直接streamし、上限検査後にheadのGit Trees APIからsizeだけのmetadataを取得します。trusted baseはfetch済みobject databaseの`git cat-file --batch-check`で、headは同APIのmetadataでblob sizeを確認し、1件8MB・tree合計64MBの上限を検査した後、許可された通常blobのobject IDだけを`git fetch --stdin`で一括取得します。その後に`cat-file blob`でraw blobを展開するため、サイズ検査前のhead blob取得やblobごとの個別promisor fetchを避けられ、`.gitattributes`の`export-ignore`や`export-subst`などの属性変換は比較へ影響しません。tree mode `120000`のsymlinkはOS上へ作らず、object IDとpathをNUL区切りで保持するmanifestとして、`160000`のgitlinkも同じ形式のmanifestとして扱います。PR headのblobを無制限に先取得しないようblobless fetchを使います。head側のコード、script、依存関係は実行しません。PRのbase変更を含む`edited`でも再評価します。main以外へretargetされたPRでは、既存の自動判定コメントを`BASE_BRANCH_OUT_OF_SCOPE`へ更新して古い判定を失効させます。コード取得には`contents: read`だけを使い、結果コメントの更新権限は評価job、再評価job、対象外判定の失効jobに限定します。main以外をbaseとするPRはこのPoCの対象外です。

mainへのpush時は、別jobがmainをbaseとするopenなPR一覧を取得し、100件以下のbatchへ分割してreusable workflowを呼び出します。batchの呼出しは直列化し、呼出し先のPR matrixを最大8件に制限することで、実際にfetchとAPIを行うPR単位の同時実行数を8へ抑えます。trusted baseはblob付きで取得し、headはbloblessのままtree一覧を上限付きで収集した後、PRごとにGit Trees APIからsize metadataだけを1回取得します。各treeのmetadataと一覧は一時ファイルを検査とblob展開で再利用します。再評価のPRごとのREST呼出しは、tree metadata、現在状態の確認、markerコメント一覧、コメント更新または作成の最大4回に限定し、ファイル単位のAPI呼出しは行いません。これにより従来のtree API重複によるbatch全体のGITHUB_TOKEN使用量の急増を避けます。結果はPRごとの専用コメント（`autonomous-merge-shadow-result` marker）を更新するため、base側のpolicyやProject Healthが変わったときも古い判定を残しません。通常のPR評価でも同じコメントを更新するため、head更新後に古い結果を残しません。評価器または評価前のfetch・tree展開・manifest生成・base側自己テストが完了できない場合も、既存の結果を残さず`HUMAN_REVIEW_REQUIRED` / `EVALUATION_FAILED`へ更新します。base push再評価でもtrusted base側の評価器テストを先に実行します。両経路ともコメント投稿直前にPRの現在のbase branch、base/head SHAを再確認し、古いrunは結果を書き込みません。通常評価とbase push再評価はPR番号単位のconcurrencyでコメントupsertを直列化します。この再評価job、通常評価job、対象外判定の失効jobだけがissueコメント更新権限を持ち、コード実行やmerge操作は行いません。PRで評価器・policy・workflowを変更しても、そのPRの評価ルールや実行定義には反映されず、変更されたこと自体がHard Gateになります。

このPRが最初の導入PRの場合、baseブランチにはまだ`pull_request_target`のworkflow定義がないためworkflow自体が実行されません。そのため初回導入PRは人手レビュー必須として扱い、merge後の次のPRから通常の数値評価が始まります。baseにworkflowは存在するが評価器・policyがない場合は、`HUMAN_REVIEW_REQUIRED (bootstrap)`とRisk `N/A`をSummaryへ出して終了します。

## devops-tycoon向けの初期policy

このリポジトリの実際の構造に合わせ、次の領域を特に高リスクとしています。

| 対象 | 初期扱い | 理由 |
| --- | --- | --- |
| `.github/workflows/**`、`.github/actions/**`、`scripts/check-balance.mjs`、`.devcontainer/**`、`.codex/environments/**`、`.codex/config.toml`、`.codex/config.toml.example`、`.nvmrc` | Hard Gate | CI判定・実行環境・Codex権限を変更するため |
| `package.json`、`package-lock.json`、`npm-shrinkwrap.json`、`.npmrc`、`*.config.*`、`tsconfig*.json` | Hard Gate | 依存関係・npm実行環境・ビルド・テスト契約を変更するため |
| `.prettierrc.json`、`.prettierignore` | Hard Gate | フォーマット設定や対象範囲を変更するため |
| `.gitmodules`、Git treeのgitlink（mode `160000`） | Hard Gate | submodule構成または参照SHAを変更するため |
| `src/state/**`、`src/game.ts` | Hard Gate | セーブ、永続化、状態遷移を束ねる中核のため |
| `src/sim/run/**`、`src/sim/engine.ts`、`src/sim/rng.ts`、`src/sim/seed.ts` | Hard Gate | ラン進行とseed再現性の中核であるため |
| `src/data/balance/**`、`src/data/contentCatalog.ts` | Hard Gate | バランス、確率、コンテンツ契約を変更するため |
| `index.html`、`src/**`、`public/**` | リスク加点 | 起動・実装・視覚変更を含め、変更量と対応するテスト種別を組み合わせて判定するため（audio資産はaudio scope） |
| `src/sim/**`、`src/data/**`、`src/ui/**`、`src/render/**`、`src/**/*.css` | リスク加点 | 領域ごとの変更影響を細分化して判定するため |
| `src/App.tsx`、`src/main.tsx` | リスク加点 | ルート画面と起動処理を変更するため |
| `public/assets/audio/**` | リスク加点 | 音源変更としてaudioテストとの対応を確認するため |
| `tests/**`、`tests/**/*-snapshots/**/*.png`、`tests/**/__snapshots__/**/*.snap`、`docs/**`、`*.md` | 低加点 | 変更量は計測するが、単独ではHard Gateにしないため |
| `tests/playtest/**`、`tests/fixtures/**` | リスク加点 | suffixを持たないtest支援モジュールも含む共有fixture・シナリオ基盤を変更するため |
| `tests/unit/helpers/*.ts`のうち`.test.ts`/`.spec.ts`でないsuffixなし共有helper、`tests/e2e/fixtures.ts`、`tests/e2e/seedMeta.ts`、`tests/playtest/harness.ts`、`tests/playtest/globalSetup.ts` | Hard Gate | 多数のテストから共有されるfixture・測定・初期化基盤を変更するため（`runFlow.test.ts`など通常テストは除外） |
| `.agents/skills/**`、`**/AGENTS.md`、`**/CLAUDE.md`、`**/CODEOWNERS`、`docs/design-system.md`、`vite.webglModules.ts` | Hard Gate | エージェント手順、階層別の作業指示、レビュー所有者、UI規約、またはWebGLビルド契約を変更するため |
| `ASSETS.md`、`LICENSE*`、`LICENSES/**` | Hard Gate | アセット・コード・第三者ライセンスの条件を変更するため |

初期閾値は、Project Health `90`、最低Project Health `80`、PR Risk `25`です。Project Healthは事故確率ではなく、CI・テスト・セキュリティ・復旧能力を後から実測値へ置き換えるためのcontrol maturity indexです。変更行数、変更ファイル数、変更path、コード変更に対するテスト変更の有無を固定ルールで採点します。

検証判定はPR全体でテストファイルが1件あるかだけでは決めません。UI・CSS・静的アセットはE2Eまたは視覚スナップショット、simulation・data・state・audio・scriptsは対応するunit/playtest領域など、変更pathに対応するverification scopeごとに実際のrunnerが探索するsuffix（Vitest unit/srcは`.test.ts`/`.spec.ts`、playtestは`.test.ts`のみ、Playwright e2eは`.test.ts`/`.spec.ts`）の追加行がある通常blobのテストを要求します。`src/**/*.test.ts` / `src/**/*.spec.ts`などglobal test globに一致するファイルはscopeのコード変更から除外します。コメント・空白だけの追加や、コメント化によって実行可能コードが減るテスト変更は検証変更として扱わず、削除リスクを加算します。PythonのverificationはPython tokenizerで`#`コメントを除去して比較します。`public/assets/audio/**`はvisual scopeから除外してaudio scopeで扱います。visual scopeのbinary検証は、実際にこのリポジトリで生成されるPNG（`tests/**/*-snapshots/**/*.png`）に一致し、かつ所有specの`toHaveScreenshot()`が生成名を参照する場合だけ受け入れます。Vitest snapshot（`tests/**/__snapshots__/**/*.snap`）は所有testの`toMatchSnapshot()`と標準snapshot keyが対応する場合だけ、simulation/data scopeの検証として受け入れます。snapshotディレクトリ内の未参照PNG、READMEなど任意テキスト、通常のbinary testは除外します。削除・純減・symlink化のテスト変更、または追加行が`.skip`・`.fixme`・`.todo`・`.skipIf`・`.runIf`で無効化する変更には検証充足を与えず、削除リスクを加算します。`test.concurrent.skip`や`test.skip.concurrent`、`test['skip']`、`test[\`skip\`]`、`test?.skip`、`it["todo"]`のようなcomputed propertyやoptional chainingを含む連結modifierも無効化として扱います。template literalの`${...}`内のコメントも実行内容を変えない変更として除外し、コード部分の空白だけを正規化して文字列・template・正規表現リテラル内の意味のある空白は保持します。同内容の純粋renameは削除リスクだけでなく検証充足からも除外し、Playwright、通常Vitest、playtest、Pythonのrunnerを跨ぐrenameは除外しません。Git treeのsubmodule gitlink変更はファイルシステム走査に依存せずHard Gateにします。snapshot entryにはGitの実行権限（`100644` / `100755`）も保持し、内容が同じmode-only変更も差分として扱います。不正UTF-8を含むblobはbinaryとして保守的に扱い、実際のbyte列が同じ行へ置換されないようにします。大きなテキストは決定論的な保守的カウントへ切り替え、反復行を含む差分で比較時間が無制限に増えないようにし、snapshot読込みも1ファイル8MB・1評価64MB・各snapshot 50,000ファイルまでに制限します。

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
