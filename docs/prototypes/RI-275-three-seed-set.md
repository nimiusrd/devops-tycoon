# RI-275 三seed総合戦: 実RunEngineセットAPIの試作

関連: [Issue #671](https://github.com/nimiusrd/devops-tycoon/issues/671)、親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。

判断は **再試作**。固定3条件の進捗・実入力・RNG付き保存・実終端の束ね方は成立した。一方、比較した固定方針は18ランすべて敗北し、人間のプレイ評価も未実施である。本番採用やIssueの完了を意味しない。通常UIに接続せず、独立したAPI試作として残す。

## 検証する判断と代償

3件を開始前に見て、全ランで同じ優先施策3枠を使う。出荷寄り `delivery`、検証寄り `resilient`、混成 `balanced` のどれにするかを比較する。選ばなかった施策への優先枠を失うことが機会費用になる。これは既存の研修方針によるドラフトの優先抽選であり、カード3枚の所有や確定配布ではない。ラン中の施策獲得・発動・介入は実RunEngineへ入力する。

この試作に共通の残高や追加の架空維持費はない。「一条件に予算を集中する」判断まで実装したとは扱わない。共通方針の制約と、条件ごとの成果/消耗の差を最小の比較対象にする。

## 開始前の公開契約

`threeSeedSetDefinition()` が次を返す。初期組織、予算、名簿、固定トラックの長さと四半期目標も、実RunEngineから取得する。具体値は比較JSONに保存する。

| 順 | seed | 既存シナリオ | 難易度/試練 |
| --- | --- | --- | --- |
| 1 | `RI-275:standard:1` | default | normal / なし |
| 2 | `RI-275:copilot:2` | copilot | normal / なし |
| 3 | `RI-275:devin:3` | devin | normal / なし |

- 独自rulesetは `ri275-three-seed-v1`。既存バランス版と指紋も保存し、不一致を拒否する。共有simを変更していないため、通常ランのrulesetは更新しない。
- 解放契約は明示的な `local-prototype-opt-in`。この隔離試作内では3方針と既存の全カード/レリックを利用可能にする。通常メタの解放やクリア履歴を読まず、書き換えない。本番の解放条件は未決定。
- 持越しは `preferredCardIds` の選択のみ。組織・予算・デッキ・レリック・進化・名簿・集中力・トラック・乱数は各ランで新しいRunEngineを生成して初期化する。
- 全ランで既存の固定トラック、出荷計算、実費用、敗北判定、勝利種別の自動判定を使用する。勝利種別や結果を手入力するAPIは持たない。敗北ランのWinTypeは欠落のまま保持する。
- 3件の独立した結果を保持し、出荷合計だけの総合点・順位・報酬を作らない。

新設したルールは「固定3件の順序」「共通の優先施策選択」「試作内全解放」「1ラン敗北後も次へ進めるセット進捗」「中断/放棄契約」である。通常ラン自体の係数・トラック・カード効果は調整していない。

## APIと進捗

```ts
const definition = threeSeedSetDefinition();
const set = new ThreeSeedSet('balanced', definition.unlock.requiredAccess);
set.apply({ revision: 0, command: { type: 'start' } });
set.apply({ revision: 1, command: { type: 'beginSprint' } });
set.apply({ revision: 2, command: { type: 'dispatch', id: 'pairReview' } });
set.apply({ revision: set.view().revision, command: { type: 'step', ms: 1000 } });
set.apply({ revision: set.view().revision, command: { type: 'pause' } });
const json = set.save();
const resumed = ThreeSeedSet.restore(json);
resumed?.apply({ revision: resumed.view().revision, command: { type: 'resume' } });
```

`view()` は複製を返す。操作は実RunEngineの開始、時間経過、介入（自動ターゲット）、手札発動/交換、ドラフト/引き直し、進化、イベント選択、カード購入、退店、休息、採用、四半期レビュー/修正へ接続する。全機能を持つ完成UIではなく、編成変更・部署移動・レリック購入などの操作はこの初手のAPIに含まない。

- `ready → running → between → running → between → running → complete`。終端を検知した操作内で1件だけ保存し、3件目は即座にcompleteへ移る。敗北も1件として残す。
- `pause` は進行中ランを保持し、`resume` まで時間/費用/乱数を進めない。JSON再開でも同じ状態になる。
- `abandon` はセットを不可逆な終了状態にする。未完ランのチェックポイントと消耗は検査用に残し、架空の終端/勝敗/出荷として追加しない。再開可能な中断にはpauseを使う。
- 入力のrevisionは成功入力数と一致する場合だけ受理する。重複送信、二重開始、未知入力、無効な時間値、同じ操作の連打による再精算を拒否する。無効入力ではRNG、ログ、消耗も変わらない。
- 完了/放棄後はすべての操作を拒否する。同一JSONから複数の独立した分岐を作ることはできるが、外部共有記録へ統合する機能はない。

## 保存・再現・上限

独自envelope `three-seed-set-prototype`、schema 1 に、方針、全成功入力、進捗、各終端フレーム、消耗、進行中の `CounterfactualFrame` を保存する。後者にはスプリント盤面、tick、accumulator、RNG消費位置が含まれる。復元は開始から入力を再実行して、RNGと結果を含むチェックポイント全体を照合する。保存内の集計だけを信用せず、改ざん、重複結果、旧rulesetや異なるmodeを拒否する。

履歴は1セット3ラン、成功入力最大12,000件、保存最大4,000,000文字。時間入力は既存の固定step単位から最大1000ms。最終1入力は放棄用に確保する。復元の再実行も12,000入力までで、無制限の時間進行や履歴読込みを行わない。通常storageの所有権、セーブ/共有リプレイ、デイリー単一seed自己ベスト、メタ精算へ接続しない。報酬適格性false、メタ/デイリー報酬0を明示する。RunEngine内部のrunKindは通常のsim処理を使うためnormalだが、外側は専用セットenvelopeのまま扱う。

各結果は実終端の出荷/手戻り/事故などのtotals、予算、組織、診断、敗因/自動WinTypeを持つ。消耗の `budgetDecreases` / `budgetIncreases` は各API入力の前後における予算純減/純増を別々に累積した値で、内部で同時に発生した収入と課金を分離した総支出ではない。`initialBudget - budgetDecreases + budgetIncreases = terminal.budget` を検証する。集中力消費は実スプリントのfocusSpent差分を累積する。疲労や負債は初期/終端組織を併記し、架空の費用へ換算しない。

## 固定方針比較

再実行:

```sh
devcontainer exec --workspace-folder . node scripts/ri275-three-seed-evaluation.mjs
```

[比較JSON](three-seed-set-comparison.json) に初期資源・3seed・ruleset・全成功入力列・実結果・費用を保存する。6セット18ランを同じ初期条件で実行し、各セットのJSON再実行一致も確認する。介入有無だけを切り替える一要因比較を行う。人間が操作に適応することや、最適解を仮定した比較ではない。

固定方針は優先3枚からドラフト選択、該当しなければ先頭、review-1解放、イベント先頭、購入なし、休息heal、採用skip、四半期修正先頭。介入ありは手札全件を順に試し、pairReview/firefight/interruptReviewを試して1000ms進める。介入なしは時間だけ進め、カードも発動しない。拒否された操作は状態を変えず、成功ログに含めない。

| 方針 | 介入 | default出荷 | copilot出荷 | devin出荷 | devin集中力消費 | devin終端HP/負債 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| delivery | なし | 1503 | 2944 | 9307 | 0 | 84.815 / 66 |
| delivery | あり | 1419 | 3198 | 4096 | 72 | 0 / 0 |
| resilient | なし | 1503 | 2944 | 9231 | 0 | 75.140 / 66 |
| resilient | あり | 1468 | 3312 | 12737 | 201 | 80.693 / 12 |
| balanced | なし | 1503 | 2944 | 9231 | 0 | 75.140 / 66 |
| balanced | あり | 1468 | 3283 | 12723 | 204 | 75.090 / 12 |

すべて敗北。defaultは全方針でseniorBurnout、copilotはbudgetExhausted、devinはdeliveryの介入ありだけseniorBurnout、他はbudgetExhausted。出荷だけで選ぶと、defaultでは介入なし、copilot/devinではresilientの介入ありが有利になる。deliveryは介入によりcopilotの出荷が増える一方、devinでは疲弊で早く終了する。固定方針の前提内では選択の影響と消耗の差が現れたが、共通持込みが単条件特化より面白いことや、最高成果の取り切りを証明していない。

## 検証と次の判断条件

対象ユニットで公開契約、全資源初期化、実RunEngineとの中間RNG/終端一致、途中JSON再開、pause/resume、無効入力不変、放棄後/完了後操作、三件目自動確定、二重集計、改ざん拒否、入力上限、報酬非対象を検証する。今回の固定方針に実勝利はなく、勝利種別の多様性は未評価である。

次の再試作は、人間が操作できる最小のセット選択/条件比較/ラン開始/再開/3結果表示を用意し、同じ3条件で次を確認して終了する。

1. 少なくとも一つの適応方針で実勝利まで到達し、自動WinTypeを保持する経路を確認する。
2. 各条件を単独で最適化した場合と、共通持込み制約下の選択を比較し、優先枠を失う代償が理解できるか確認する。
3. 複数人のプレイで、共通方針の変更理由・疲弊と出荷の納得感・3件を続ける負担・再挑戦意欲を記録する。

人間プレイ未実施のためIssueはopenを維持し、PRは `Refs #671`。試作のマージと本番への統合採用は別判断である。

実行環境: 専用worktreeから標準 `.devcontainer/devcontainer.json` を使用。ホストsandboxのDocker buildx書込み制限は権限付き実行で解消し、feature省略やリポジトリ設定変更は行わなかった。コンテナNode v24.16.0。UI/Pixiは変更していないため、対象外のローカルE2E/gallery/全体coverageは追加せず、全体unit/E2EはCIで確認する。
