# RI-277: 実simの資源予想練習API

対象: #673 / 親 #548。判定: **再試作**。専用APIで初回予想・実操作・毎tickの観測・実終了後の照合・JSON再開を検証する。**同じ画面での予想と照合UI、人間プレイ、先読みの上達・楽しさは未評価**。Issueはopenを維持し、Refs #673 とする。試作マージは本番採用やIssue完了ではない。

## プレイヤー価値、判断と代償

仮説は「次に危なくなる資源を自分で予想し、自分の実操作の結果と照合すると、読みの根拠を振り返れる」。最初の判断はレビュー渋滞・シニアHP・出荷不足・危機なしの一つ。予想は費用も効果もなく、skipでも同じ盤面を進められる。途中で考え直せるが、初回回答は保持し変更時点を区別する。

実際に備える操作は通常の介入。集中力、HP、士気、クールダウンの費用・利益・代償は実RunEngineの既存規則に従う。初回スプリントのデッキは通常どおり空で、手札操作は公開しない。例えばpairReviewに集中力を払えば別の介入へ回す余地が減る。予想が当たっても通常成果・報酬を加算しない。操作で危機を避けた場合に初回予想が外れても、読みが悪かったとは判定しない。因果効果の推定や反実仮想の正解ではなく、その入力列で観測された事実との照合である。

## 固定練習と通常ルールの境界

`src/prototypes/resourcePrediction.ts` はnormal/default・試練なしの通常RunEngineで開始し、最初の通常スプリント1件が実際に終了したところで練習完了とする。seedだけを受け取り、初期資源・費用・係数の任意注入、強制完了、手入力スコア、WinType指定、勝利条件解除は受け付けない。通常の固定トラックと勝利種別の自動判定は変更しない。1スプリント終了はラン勝利ではない。通常ランを最後まで進めるAPIでもない。

新ルールは以下の練習用危険指標、回答履歴、照合のみ。通常の敗北条件・KPI・報酬条件とは独立する。開始前から `resourcePredictionDefinition()` と `view().definition` で同じ閾値を公開し、途中変更を許さない。

| 指標ID | 成立条件 | 観測範囲 |
| --- | --- | --- |
| reviewQueue | Reviewレーンのタスク数 >= 8 | 開始直後、毎tick終了後、成功した実操作直後 |
| seniorHp | 選択中チームのorg.seniorHp <= 35 | 同上 |
| deliveryLag | 処理済tick >= 60、かつ当該スプリントのmetrics.delivered < 100 | 同上。未完了タスクを将来出荷へ換算しない |
| none | 上記3指標が最後まで一度も成立しない | 練習終了後のみ確定 |

これらは試作固定の操作的定義であり、主観的な「危ない」を後付けしない。出荷不足は通常KPI達成の予言ではない。異なる閾値を検討する場合は試作rulesetを更新して別比較にする。

`begin`直後を処理済tick 0、`step`は必ず100ms = 1実tickとし、`stepSprint(tick=0)`の直後は処理済tick 1。RunEngineの `sprintTick` と一致する。ゲーム入力の直後にも観測するため、同じtickに複数の観測indexがある。各指標の初回到達tickと観測indexを保存し、**最小の観測indexで初めて成立した全指標を同時成立の正解集合**とする。別操作で同じtickに後から成立した指標は同時とはしない。集合のどれか一つを予想していれば正解。危機なしならnoneだけ正解。skipの正誤はnull。記録されないtick内の処理途中の瞬間最大・最小を推測しない。

専用履歴はbudget/focus/seniorHp/morale/techDebt/aiDependency/reviewQueue/delivered/focusSpentとcomplete、原因入力revision・tick・indexを保存する。通常のTimelineSampleやring bufferの欠落を0として補完しない。最後のstepではRunEngineのスプリント精算まで実行され、その後の実snapshotを観測する。観測対象は選択中チームの詳細盤面で、全社累計出荷や別チームの危機と混同しない。

## API・回答履歴

`new ResourcePredictionPractice(seed)` → ready → `predict`または`skip` → `begin` → running → 実終了でcomplete。readyとrunningのどちらでも`change`できる。readyでの変更はtick/index=null、runningでは直前の処理済tick・観測index、全変更に入力revisionを付ける。最初の回答/skipはoriginalに残し、初回正誤と最新回答の正誤を分ける。変更で元の回答を書き換えない。

各入力は `{ revision, command }`。成功入力だけがrevisionを1進める。未知キー、未知選択肢、source欠損、重複/古いrevision、別phase、二重回答、未回答のbegin、同一回答への無変更、実simが拒否した費用不足/対象なし操作、完了後の全入力を無消費拒否する。拒否した入力でsim、時間、RNG、資源、回答、履歴は変わらない。skipを明示してからbeginすれば予想せず進める。

sourceは`self` / `system-what-if` / `unknown`の自己申告。初回と変更それぞれに保存し、WhatIfを見た回答を本人の先読みや上達の証拠にしない。APIはシステムWhatIfを計算・表示しない。端末外で見た情報や自己申告の真正性は保証できない。正誤によらず`learningEvidence:false`とし、人間評価がない計算結果から学習効果を主張しない。途中の実観測は読めるが、照合結果はcompleteのみ公開する。

`view()`は複製を返す。通常UI、GameHandle、通常save/replay、メタ・デイリー報酬、localStorage/IndexedDB、複数タブのstorage所有権へ接続しない。

## 専用保存と上限

専用JSONはkind=`resource-prediction-prototype`、schema version=1、prototype ruleset=`ri277-resource-prediction-v1`、BALANCE version/fingerprint、seed、全成功入力、全観測・回答・実状態・RNG位置を保存する。通常ゲームのrulesetは変更しない。

`restore`はJSON構造・上限・同一rulesetを確認して新規RunEngineで入力を再実行し、保存した全checkpointとcanonical JSONで完全一致する場合だけ再開する。任意frameをhydrateせず、欠損・改変・別ruleset・違うRNG位置は拒否する。自己整合した入力列とcheckpointを作り直す改変や本人性を検出する署名ではない。

RunEngineはlost時のcounterfactual exportに対応しないため、最後の生存フレームも明示して保存する。終端のstepだけ直前の実フレームを複製して実stepSprintを1tick再生し、終端sprintの完全一致を確認してRNG位置を記録する。予測や強制結果ではない。complete再開後もゲーム操作を再開・再精算しない。

上限は成功入力2048、観測2048、処理済tick1600、タスク1000、seed80文字、JSON2,000,000 UTF-16文字、深さ48、探索250,000ノード、配列5000要素、文字列/キー16,000文字。固定盤面がタスク/tick契約を外れた場合は明示的に失敗し、切捨てて結果を作らない。過剰な回答変更で入力枠を使い切った場合は、それ以上進めずその時点のJSONを検査できる。通常ランの保存枠は使わない。

## 比較と検証

再現コマンド（Node v24.16.0）:

```sh
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-673-container/devcontainer.json node scripts/ri277-resource-prediction-evaluation.mjs
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-673-container/devcontainer.json npm test -- src/prototypes/resourcePrediction.test.ts --maxWorkers=1
```

標準configはGH CLI featureの取得が失敗したため、同じNode24-bookwormイメージでfeatureだけ省略した/tmp一時configを使用。repo設定は変更しない。

比較JSONは3seed g1/g2/g3 × 予想 / skip / tick12変更 / pairReview介入の12ケース。通常開始時の全資源・設定・カード・ロスター、全試行入力（拒否も含む）、全成功入力、全観測、実結果・費用、RNG付きcheckpointを保存する。基準はカード/編成/レバーを変えず1tickずつ進める固定方針。pairReviewケースだけ10tickごとに同介入を試す。他条件を変えず、同じseedで一要因比較する。tick12変更ケースだけsystem-what-ifとして記録するが、実際のWhatIf計算は行わない。全ケースでtick15と終了後のJSON再開を検証する。

| seed | 方針 | 終了tick | 出荷 | 終了HP | 残focus | Review初回tick | HP初回tick |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| g1 | 基準 | 116 | 493 | 46.66 | 13 | 21 | — |
| g1 | pairReview | 80 | 524 | 46.80 | 9 | 21 | — |
| g2 | 基準 | 99 | 592 | 50.08 | 13 | 18 | — |
| g2 | pairReview | 99 | 610 | 55.20 | 9 | 22 | — |
| g3 | 基準 | 106 | 615 | 31.58 | 13 | 19 | 102 |
| g3 | pairReview | 111 | 617 | 38.92 | 9 | 25 | — |

全ケース初期予算45。予想/skip/変更は基準と同じ資源・RNG・出荷。pairReviewだけ実focusを4消費し、g3ではHP閾値を回避するが終了tickは5増える。これはその固定方針での観測差であり、一般的な最善手とは断定しない。今回の実記録はすべて最初がReview危機で、出荷不足・同時成立・危機なしは実プレイ例を得ていない。この偏りは次の設問/閾値評価の残課題。HPは表だけ小数2桁に丸め、JSONに元値を残す。

予想/skip/変更の違いで実状態・RNG・資源推移が不変であることを確認する。介入差は固定入力の比較であり、人間の適応・選択の楽しさの証明ではない。資源差は実観測、正誤は上記の指標だけを使う。

対象unitは実RunEngineとの各tick照合、実操作、初回回答/変更/skip、不正入力の無消費、全段階再開、終端再開、未知版・別ruleset・BALANCE不一致・RNG改変・履歴改変・サイズ/入力/観測/タスク上限を検証する。同時成立や危機なしの純粋集計境界fixtureは単体テスト専用で、実プレイ結果として扱わない。

## 採否と次の判断条件

**再試作**。API上の再現可能な照合までを今回の成果とする。残る不確実性は、人間が「最初の予想」「備えた後の実結果」「途中変更」「WhatIfを見た回答」「危機なし・同時成立」を区別して振り返れるか。

次はこのAPIに接続する隔離した同画面の予想/実操作/照合UIを作り、skipで進めること、初回と変更の表示、複数正解とnoneの理解を人間評価する。開始前に評価手順と比較する閾値・設問を固定し、選択理由、実操作で払った代償、誤認、再挑戦意欲を記録して採否を再判定する。担当・実施日は未定。通常UI・保存・報酬への本番統合は今回行わない。

UI/Pixi変更なし。対象unit・build・lint・format:checkをローカルで行い、全体unit/coverageとHTML/WebGL E2Eは必須CI両ジョブで確認する。無関係なローカルE2E/galleryは追加しない。
