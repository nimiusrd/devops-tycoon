# 旧Engineテストの移行契約

[#707](https://github.com/nimiusrd/devops-tycoon/issues/707)は、テストのために維持していた単独スプリントEngineを現行シミュレーションへ段階移行するエピックである。各単位を独立Issueへ切り出し、1単位1PRで進めた。初手[#714](https://github.com/nimiusrd/devops-tycoon/issues/714)で固定step定数の所有元を整理し、RI-106の回帰テストを移した。残る6ファイルを#715・#716・#717で移行し、#718で旧クラスを撤去した。下表は移行前の契約と移行先の記録である。

## 利用経路と所有元

初手の調査では、`src`・`tests`・`scripts`とリポジトリ全体のimportおよび`Engine`・`createEngine`・`FIXED_STEP_MS`参照を検索した。旧クラスとfactoryの利用は下表のunit 7ファイルだけで、本番・開発ツールから旧クラスを呼ぶ経路は見つからなかった。RunEngine、playtest harness、sprintTempoのunitは固定step定数だけを旧モジュールから取得していた。

`FIXED_STEP_MS`の所有元は`src/data/balance/pacing.ts`とし、`PACING_BALANCE.fixedStepMs.value`から導出する。本番のゲーム値・式・乱数消費順は変更せず、ルールセット版も増やさない。

| 旧Engineに依存するテスト | 保証する契約 | 移行先と実装Issue |
| --- | --- | --- |
| `sim/balanceRegistryRegression.test.ts` | AIあり/なしの同一初期条件・50tick後の組織指標、工程集計、Review端数、残タスクの投影がRI-106移行前と一致 | 初手#714で`createSprint/stepSprint`の再現性・因果・効果量・境界へ移す |
| `sim/sprint.test.ts` | 有限終了と全Done、同一seedのリザルト再現、異なるseedの差、複数seedでAIによるReview渋滞/Rework増加、AI利用率、リザルト整合性 | 純TSの`createSprint/stepSprint/summarizeSprint`。[#715](https://github.com/nimiusrd/devops-tycoon/issues/715) |
| `sim/actions.test.ts` | 介入有無による結果差、成功した介入の種類別集計。集中力・cooldown・対象・完了による拒否と副作用は既存の直接関数テストでも保証 | 純TSの`applyAction/stepSprint/summarizeSprint`。#715 |
| `sim/engine.test.ts` | 決定論、固定stepと端数、seedリセット、snapshot独立性、dispatch費用、カード副作用、配布とdraft、選択/スキップ、持越し | 固定stepは初手でRunEngineへ追加。残りは現行公開APIまたは対応する純関数。[#716](https://github.com/nimiusrd/devops-tycoon/issues/716) |
| `sim/cards.test.ts` | 手札発動の費用と効果合成、強化時の永続加算差分、カードによる結果差、未発動デッキ無効果、発動再現性、draftから次スプリントへの進行・出荷持越し | `playCardFromHand`とRunEngineのカード・phase遷移。#716 |
| `scenarios/easyCopilotSprint1.test.ts` | 単独Copilot構成のAI依存単価が未指定でグローバル既定へフォールバック。Easy/Nightmare差と保存復元は既にRunEngineで検証 | `resolveSprintConfig/createSprint`。[#717](https://github.com/nimiusrd/devops-tycoon/issues/717) |
| `render/status.test.ts` | 初期SimStateにorgを上書きしたときのHUD数値・グレード・警告境界・組織集約・差分表示 | 型付きfixtureまたは現行表示adapter。#717。表示契約と`SimState`型を維持する |

表のテストパスは`tests/unit/`からの相対パスである。旧モジュールのmutation対象とSPEC対応表の参照は、撤去時にも再確認する。

## ライフサイクルの契約を移す際の判断

`engine.test.ts`には現行でも必要な契約と旧クラス固有の初期化規則が混在する。#716では次を区別する。

| テスト群 | 維持する保証と現行での確認方法 |
| --- | --- |
| 同一seedと入力列、異なるseed | RunEngineの同じ開始条件・step/dispatch列で状態と結果を比較する。異なるseedの乱数消費は現行RNGで扱い、旧`lastRandom`フィールドを追加しない |
| 固定stepの端数 | RunEngineでstep未満の時間は進めず、境界到達時に1tick進める。分割入力と一括入力の状態一致も比較する |
| `load`と既定値 | 新規ランとseed変更は現行`startRun`等の規則で確認する。旧クラスの空デッキ、AI未導入、依存度3を現行ランの既定値に強制しない |
| `snapshot` | ネストを含む返却値の変更が内部状態に漏れないことを現行APIで保証する |
| `dispatch` | 成立時のfocus減少、focusSpent、effect.focusCostと拒否時無作用を維持する。RunEngineのphaseゲートと敗北判定延期も確認する |
| カード発動 | 費用、quality等の加算差分、強化後の二重適用防止を直接関数とRunEngineで確認する。現行のチーム別baselineを使う |
| dealとdraft | 同じ入力で安定した抽選、枚数、重複排除、プール制限を現行の派生seed・編成で確認する。旧クラス専用のseed文字列を現行に強制しない |
| 次スプリントの選択とスキップ | deck追加/無追加、index進行、tickと端数リセット、focus回復、draft消去、組織指標と永続カード効果の持越しを現行phase遷移で検証する。旧クラスがmorale・HP・documentationを初期値へ戻す規則は現行の回復・持続規則へ読み替える |

## #716の移行結果

`sim/engine.test.ts`と`sim/cards.test.ts`の旧Engine importを解消した。カード結果の因果・未発動時の無効果・同一発動の再現性は、3 seedの実RunEngineスプリントで比較する。カード費用不足の無作用と費用ちょうどの成立、同レベル再発動時の永続加算なし、強化後の品質・セキュリティ加算差分は`playCardFromHand`で検証する。固定stepの初期境界は#714の`runEngineTiming.test.ts`を継続利用し、次スプリントで前回の端数が残らないことはライフサイクル側でも確認する。

現行APIへの読み替えは次のとおり。

- `startRun`はseed変更後に新規ランと同じ`setup`状態へ戻る。所持デッキと進行を初期化し、スプリントは編成後に生成する。既定の難易度はnormal、シナリオはdefault、AIは導入済みであり、旧EngineのAI未導入・依存度3は移植しない。
- 配布seedは`seed:deal:q1-s1`、次回は`seed:deal:q1-s2`。ドラフトは完走時点ではまだなく、`acknowledgeResult`後に`seed:draft:sprintsPlayed`で生成する。解放プールと優先カードも反映する。
- `chooseCard`と`skipDraft`は`evolution`へ進む。カード獲得時は組織へ効果を適用せず、候補外とフェーズ外の選択は状態を変えない。進化・ビート・必要なショップ/休息等を経て、次の`setup`からスプリントを起動する。
- デッキ・チーム別baseline・組織指標は持続する。ビートによる変化を経た`setup`を次回開始の基準にし、開始時はシニアHPを満タンとの差分の50%だけ回復する。morale・documentation等を新規値へ全リセットしない。集中力は新しいスプリント上限まで回復し、費用集計・tick・端数はリセットする。
- 所持カードのテスト構成は`setup`の`exportPersistState/hydratePersistState`で用意し、解放カードプールを明示する。旧クラスの内部deck書換えは使わず、強化は`upgradeCardAt`の返却値で検証する。

検証はNode 24のDev Containerで行い、移行前の対象54テスト、移行後の対象57テスト、RunEngine・永続化関連を含む17ファイル403テストが成功した。`npm run lint`、`npm run format:check`と変更対象のTypeScript型検査も確認した。標準Dev Containerはイメージ構築時の容量不足で起動できず、一時設定の`node:24-bookworm-slim`を使った。リポジトリの環境設定は変更していない。

この単位では本番コード・ゲーム値・乱数消費順・ルールセット版を変更しない。#716完了時点で残っていた`sim/sprint.test.ts`・`sim/actions.test.ts`（#715）、`scenarios/easyCopilotSprint1.test.ts`・`render/status.test.ts`（#717）の4ファイルも後続単位で移行済みである。

## RI106固定値の判断

RI-106のgoldenは、工程係数をレジストリへ移す際に挙動を維持した証拠である。恒久的なゲーム仕様として単一seedのタスクID・lane・浮動小数点の最終桁を固定する理由はない。[architectureのルールセット規則](./architecture.md#52-ルールセットと再現性)と[確率モデルの変更規律](./probability-model.md#11-変更時の規律)に従い、同一ルールセット内の再現性と因果・効果量を保証する。

移行前の固定値はGit履歴に残す。たとえばAIありの依存度`87.80000000000007`、Review端数`0.5831557500000281`とAIなしの依存度`3`、Review端数`0.07127150000001148`は、`ri-106-balance-registry`の50tickを旧Engineで実行した投影である。これらを更新し続けるgoldenは今回残さない。

新しい回帰テストでは同じ初期組織、無効果のカード、シナリオ構成、seed付きRNGを明示して`createSprint/stepSprint`を直接呼ぶ。これは工程単体の統制条件であり、RunEngineの難易度・メンバー編成を再現するfixtureではない。複数seedの同一条件の再実行でorgとsprintを完全比較し、AIあり/なしのペアで工程への影響を比較する。履歴の固定オブジェクトとの完全比較と、現在の実装を同じ入力で再実行する完全比較を区別する。

因果と効果量のテスト閾値は検証条件であり本番係数ではない。ルールセットの因果を変える変更時は、単一seedの数値に合わせる代わりに、同一seedペアの集計と多数seedの工程テストを確認して閾値の根拠を更新する。単なるテスト移行ではゲームルールとルールセット版を変えない。

| 比較条件 | 初手で守る保証 |
| --- | --- |
| `ri-106-balance-registry`と`s1`〜`s5`、各50tick、AIあり/なし | 同じ条件の再実行でorg・sprint・RNG消費位置が一致 |
| 各seedのAIなし | AI利用完了数が0、依存度は初期値から増えない |
| 各seedのAIあり | AI利用完了数が正、依存度の増加が30以上 |
| 6seedのペア集計 | 少なくとも5ペアでReviewピーク・Reworkが増え、合計がそれぞれAIなしの1.5倍・2倍以上 |
| 状態と集計の境界 | 依存度・士気・HPが有限で0〜100、AI利用完了数が完了数以下、Done数と盤面・出荷集計が一致、Review端数が0以上1未満 |
| 完了後のstep | org・sprint・RNG消費位置が変わらない |

移行前コミット`de73b80a`、ルールセット版7で、同一の12条件に対して旧Engineと純TSのorg・sprintを比較し完全一致を確認した。移行前の6seed合計はReviewピークがAIあり98・なし45、Reworkがあり35・なし10であり、上記の最低効果量には余裕を持たせている。この照合は初手の検証証跡であり、旧Engineを必要とする恒久テストとしては残さない。

## #718の撤去結果

[#714](https://github.com/nimiusrd/devops-tycoon/issues/714)・#715・#716・#717の移行完了後、リポジトリ全体（隠し設定を含む）の旧モジュール参照・`Engine/EngineInit/createEngine`を再検索した。7テストファイルの依存解消を確認し、本番・開発ツールの利用もなかったため、[#718](https://github.com/nimiusrd/devops-tycoon/issues/718)で`src/sim/engine.ts`全体を撤去した。RunEngineテスト内の同名`createEngine`ヘルパーは現行RunEngineを生成するものであり、旧factoryの利用ではない。

`SimState`は`deriveStatus`と`RendererAdapter`に引き続き必要なため、`src/sim/types.ts`に保持する。旧モジュールが利用していたactions・cards・org・rng・scenarios・seed・sprint・modelも現行用途があり、撤去しない。現行RunEngine、ゲーム値・式・乱数消費順、ルールセット版7は変更しない。

mutationの`sim-root-rest` shardとStryker設定はファイルglobで対象を列挙するため、旧モジュールは削除により対象から外れる。旧モジュール専用のshard・除外指定はない。SPEC対応表の固定step所有元は#714で更新済みであり、追加変更は不要である。

Node 24.16.0のDev Containerで、撤去前の7移行ファイル・RunEngine関連18ファイル447テストと、撤去後の全unit 253ファイル3,683テスト（同じ対象447テストとmutation shard整合性テストを含む）が成功した。撤去後の`npm run build`・`npm run lint`・`npm run format:check`・`npm run balance:check`も成功し、バランス生成物に差分はない。全unitは`npm test -- --maxWorkers=2`、撤去前の対象unitは`npm test -- <対象パス> --maxWorkers=1`で実行した。`balance:check`はコンテナ内Gitの所有者判定を実行単位の`safe.directory=/workspaces/devops-tycoon`設定で解決して再実行した。
