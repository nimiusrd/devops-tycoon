# RI-270: 同じ仕事を別ビルドで操作する実験室

対象: #666 / 親 #548。判断: **再試作**。独立操作APIと実simの比較・再開を確認した。操作UIと人間プレイ評価は未実施で、Issueはopenを維持する。試作PRのマージは本番採用を意味しない。

## 検証する判断と範囲

実装を加速する構成と、検証へ投資する構成を同じ仕事で触り、出荷・工程の滞留・消耗を見て次の入力を変えられるかが仮説。通常WhatIfは自動予測、RI-271 `OpposingStrategies` は全ランのAI配属と使用介入に対する方針制約。今回は固定仕事1件・固定2ビルドに絞り、操作者が左右を別々のペースで開始・介入・完了まで進める。RI-271や同時試作中の#670/#698の新規ファイルには依存しない。

`createSprint` / `playCardFromHand` / `applyAction` / `stepSprint` / `summarizeSprint` を直接使う。共有simと通常UIは変更しない。通常の固定トラックとWinType自動判定を変更せず、この単一sprint試作ではラン勝敗・WinType・報酬を作らない。RunEngineの難易度・ロスター・全社進行・継続インフラ課金は再現対象外。予算は実験専用に貸与する45で、通常ランやメタから借りない。通常meta/daily/save/replay/storage所有権への書込みはない。

## 共通条件と差分

全条件の開始fixtureは24タスク、ID 0〜23。`id % 3` でroutine/normal/complexを8件ずつ、`id % 6 = 5` のcomplex4件を高価値にする。全件backlog・進捗0・過去の手戻り/障害なし。架空の履歴は生成しない。Taskには独立した作業量フィールドがないため、種類と初期進捗を固定し、種類に応じた既存simの進行量を使う。

orgはdefaultシナリオのAI導入済み状態。初期HP100、士気70、AI依存35、習熟45、テスト55、文書50、品質60、安全60、負債0、出荷0。集中力12、予算45、codingSlots6、AI採用率0.85、習熟正規化0。初期デッキは空。seedは共通、createSprintの24件生成で消費したRNG位置も両側で同じ。生成後の種類/価値だけを上記fixtureへ揃える。期間は共通maxTicksで、既定180、比較では20/40/80。最小tickは試作用に0とし、全件完了なら早期終了、未完了は既存simのtimeoutで工程を残して終了する。

開始時に以下の既存カードをL1で1回取得・実発動する。これが意図した構成差分。全効果・支出は開始前から `compare().policies` に公開し、支払後は `investment` に記録する。

| 側 | 固定施策 | 予算 / 集中力 | 既存効果 |
| --- | --- | --- | --- |
| coding | claude-code | 4 / 3 | coding ×1.2、手戻り率 -0.05、review ×0.9、安全 -4 |
| verification | auto-test | 18 / 3 | coding ×0.95、手戻り率 -0.15、障害率 ×0.8、品質 +10、安全 +8 |

購入費は既存カード価格を使う試作ルール。追加カード購入・進化・維持費・施策廃止はない。RI-188を復活させない。両側の介入候補・費用・クールダウンは既存simで共通で、ビルドごとの介入禁止は設けない。開始後の入力列やその費用が違う場合は、ビルドだけの差と解釈しない。同じseedでも処理分岐で乱数の消費位置は変わるため、同一の障害抽選を対にした因果実験ではない。

## 操作・比較・再開

```ts
const lab = new BuildLaboratory({ seed: 'RI-270', maxTicks: 80, budget: 45 });
lab.act('coding', { type: 'start' });
lab.advance('coding', 10);
lab.act('coding', { type: 'intervene', id: 'pairReview' });
const resumed = restoreBuildLaboratory(lab.serialize());
resumed.act('verification', { type: 'start' });
resumed.advance('verification', 20);
resumed.view('coding');
resumed.compare();
```

`act` はstartまたは既存の全介入IDを受け付ける。assignTaskはtaskIdと任意のlane/assignee、splitPrはtaskIdを指定できる。対象を省略すれば既存simの自動対象選択。`advance` は1〜120tickを進め、実simが完了した時点で止まる。完了済み側があっても他側は独立して開始・継続できる。`view(side)` は初期値・現在のタスク/資源・成功入力列・RNG位置・積算のコピーを返す。取得したデータの変更が内部へ波及しない。

未開始、二重開始、未知/余分な項目、矛盾したtarget、資源不足、対象なし、クールダウン、完了後の操作は拒否する。拒否で時計・資源・RNG・履歴は変わらない。成功介入はコピー上で実行してから確定する。開始時購入/発動、完了、集計に二重課金・二重加算はなく、報酬処理もない。

比較には施策適用前のタスク全体、初期org/予算/集中力、RNG位置、期間の一致を含む。結果は実出荷ポイント、done数、工程別の現在件数、未完了数、reviewピーク、手戻り/障害回数、工程別観測task-tick、カード支出、集中力実消費、残資源、HP/士気/負債の純差分。`remaining` のdone欄は処理済み件数で、未完了はそれ以外の工程の合計。`complete` は両側のsprintが完了したときだけtrueで、timeoutを含む。総合点や勝者は作らない。

**観測task-tickの定義:** 各step直前の工程別件数を1tick分ずつ積算する。codingは作業中、reworkは炎上中も含む。処理を受けるtickも含み、同tick内のbacklog→coding→reviewなどの通過は捉えられない。介入はstep間に即時実行され、その前後の滞在時間は推定しない。doneも含めた積算合計は `24 × 実tick数`。純粋な待ち時間、処理能力の不足時間、施策の因果寄与とは呼ばない。早期終了時は観測期間が違うため、実tick数・未完了と合わせて読む。

HP/士気/負債は回復・clamp・処理内の相殺を含む純差分で、総消費を分解した値ではない。集中力は還元前の `metrics.focusSpent`、予算消費はカード価格のみ。全ランの消耗・インフラ支出まで測ったとは扱わない。

JSON schema1には試作規則、balance ruleset版/指紋、共通設定、両側の全状態と成功入力列が入る。復元は入力列を最初から再実行し、初期値・全タスク・資源・積算・時計・RNG位置を保存全体と照合する。外部の結果をそのままhydrateしない。別ruleset、改変checkpoint、無効/二重入力、余分な保存項目は拒否する。左右の履歴を別々に再実行しても同一状態になることを検証する。通常セーブの互換形式は拡張しない。

上限は2側固定、仕事24件固定、各側最大360tick、1要求120tick、成功入力1024件、seed 1〜128文字、予算0〜1000、保存1,000,000 UTF-8 bytes。成功入力上限時は`limit`で停止し、完了を捏造しない。各種simログもtick・タスク・成功入力数で有限になる。拒否入力は蓄積しない。復元にも同じ制約を適用する。

## 再現比較と判断

[全条件・入力・費用・実結果](build-laboratory-comparison.json) を専用スクリプトで生成した。基準main `800199c6`、balance v8。3seed × 期間20/40/80の9課題は期間だけを変える一要因感度。両側とも開始後は介入しない。各課題を同条件で2回実行し、全結果と最終保存のSHA256一致を保存した。進行中・片側未開始・終了時も10tickごとのJSON往復で全状態一致を確認した。

| seed / maxTicks | coding 出荷 / 未完了 / 実tick | verification 出荷 / 未完了 / 実tick |
| --- | --- | --- |
| RI-270 / 20 | 130 / 15 / 20 | 175 / 13 / 20 |
| RI-270 / 40 | 270 / 7 / 40 | 306 / 4 / 40 |
| RI-270 / 80 | 355 / 0 / 58 | 410 / 0 / 74 |
| RI-270:1 / 20 | 71 / 18 / 20 | 160 / 11 / 20 |
| RI-270:1 / 40 | 150 / 12 / 40 | 242 / 2 / 40 |
| RI-270:1 / 80 | 251 / 3 / 80 | 304 / 0 / 64 |
| RI-270:2 / 20 | 190 / 11 / 20 | 271 / 9 / 20 |
| RI-270:2 / 40 | 378 / 0 / 38 | 519 / 0 / 31 |
| RI-270:2 / 80 | 378 / 0 / 38 | 519 / 0 / 31 |

この固定fixture/入力ではverificationの出荷が高い一方、予算支出は14多い。RI-270/80ではcodingが16tick早く完了し、review観測task-tickは359対283、HP純変化は-46.65対約-38.55。出荷・完了までの時間・観測WIP・予算は同じ指標ではない。seed:2では完了時間の大小も逆転する。特定ビルドの常時優位やボトルネック移動の因果を断定しない。

別枠 `operationWitness` はRI-270/80で10tickごとに障害があればfirefight、reviewがあればpairReviewを試す機械方針。全成功/拒否入力を残し、出荷386対408、両側61tick、集中力7対7、予算4対18の支出となった。介入可能なAPIの証拠であり、人間の判断・適応・面白さの評価ではない。

**再試作の次条件:** 左右を切り替えて最後まで操作できるUIを別単位で作り、人間3名が各1課題を操作する。施策差分と費用を説明できるか、出荷以外に工程件数/観測WIP/消耗を1つ以上使って次の入力を変えられるか、比較後に別条件を試したくなるかを記録する。説明不能・誤読・離脱理由を含めて採否を再判断する。現段階ではIssue完了と本番統合を宣言しない。

## 検証経路

標準Dev Containerは初回にDocker buildxのホストキャッシュ書込みがsandbox拒否された。承認済みの範囲で昇格して同じ標準設定を起動し、Node v24.16.0で検証した。設定の変更や一時configの代替は不要だった。

```sh
devcontainer exec --workspace-folder . node scripts/ri270-build-laboratory-evaluation.mjs
devcontainer exec --workspace-folder . npm test -- src/prototypes/buildLaboratory.test.ts --maxWorkers=1
devcontainer exec --workspace-folder . npm run lint
devcontainer exec --workspace-folder . npm run format:check
devcontainer exec --workspace-folder . npm run build
```

対象ユニットは初期一致、既存card/action/stepとの一致、独立操作、呼出順逆転、RNG位置付き再開、防御的コピー、無効/矛盾入力の無消費拒否、二重開始/介入/完了後、費用不足、保存改変/上限、複数seedの同条件再実行を検証する。UI/Pixi変更はなく、無関係なローカルE2E/galleryと全体coverageは実行しない。全体unit/coverageと必須E2EはPRのCIで確認する。
