# RI-271: 同じ開始条件を対照方針で操作する課題

対象: #667 / 親 #548。判断: **再試作**。操作APIと実結果の比較は成立したが、人間が遊べる完成UIと人間プレイ評価は未実施。試作のマージと本番採用は別で、Issueはopenを維持する。

## 仮説と境界

同じ会社の出荷を伸ばす手と、その代償を抑える手を2回試すことで、片方の失敗を含めて次の判断を考えられるかを検証する。`pastRunCompare`（#687 / PR #791）は記録済み履歴の閲覧用。今回は `OpposingStrategies` が2つの実 `RunEngine` を所有し、開始、介入、カード、投資、イベント、目標修正、保存再開、終端まで扱う。既存固定比較JSONを再掲したものではない。#666の実験室とは独立し、その新規ファイルには依存しない。

既存ルール・係数・純粋simは変更しない。固定スプリント列、四半期レビュー、敗北条件、`evaluateWinType` による自動称号、通常の初期資源と費用をそのまま使用する。通常UI、メタ報酬、デイリー、途中セーブ、リプレイ、storage所有権への接続はない。RI-188のカード維持費等のルールも新設しない。

試作で追加するルールは、次の2方針を一課題に束ねること、操作の制約、計算上限だけ。

| 方針ID | 毎スプリント開始時のホームチーム | 使用可能な介入 |
| --- | --- | --- |
| `ai` | 稼働コーダーへAIを配布 | assignTask / overtime / firefight |
| `human` | AI配布を外す | pairReview / interruptReview / firefight |

「人手配属」はホームチームの編成を指す。他部署の粗粒度進行や組織のAI導入済み状態を消すものではない。カード・進化・イベント・投資の選択は操作者が決める。両方針の名称は `WinType` に保存しない。

## APIと照合

```ts
const challenge = new OpposingStrategies(defaultOpposingConfig('RI-271'));
challenge.command('ai', { type: 'start' });
challenge.command('ai', { type: 'begin' });
challenge.command('ai', { type: 'advance', ticks: 37 });
const resumed = restoreOpposingStrategies(challenge.serialize());
resumed.command('human', { type: 'start' });
resumed.view();
```

`state(side)` は盤面、手札、候補、フェーズを独立コピーで返す。`command(side, input)` は開始、スプリント起動、1〜120tick進行、方針内介入、カード発動、ドラフト選択/見送り、進化、イベント選択、カード購入/退店、回復/返済、採用/見送り、四半期承認/目標修正を受け付ける。未開始・二重開始・誤フェーズ・方針外・無効入力・既使用/資源不足は拒否し、履歴・資源・RNGを変えない。終端後の再操作と再開始は拒否し、片方の敗北はもう片方の開始や継続を妨げない。報酬の付与はRunEngine内の既存処理だけで、メタへの確定処理はない。

`view()` は共通レシピと意図した方針差分を開始前から公開する。両方が開始すると、実setupフレームから次を照合する。片方が未開始なら照合未完了。

- seed、難易度、試練、シナリオ、通常ラン種別
- 解放カード/レリックの候補プール、研修方針
- 実バランスrulesetの版と指紋
- 初期org、予算、ロスター、空デッキ、レリック、進化資源

既定プールは試作が明示的に全カタログを解放するもの。利用者のメタ解放を代用したとは扱わない。独自の共通プールを指定でき、未知ID・重複・プール外の研修を拒否する。開始資源は既存難易度・試練・シナリオから生成する。Normal/default/試練なしでは予算45、Easyでは60、Hardでは35。全初期数値は比較JSONの `comparison.shared.resources` に残す。

`comparable` はこれらの照合結果であり、公平性の証明ではない。方針による乱数消費やorgの変化によりイベント・候補の経路も変わり得る。同じseedだから同じ乱数列の同じ場面を観測しているとは断定しない。

`terminal` は実 `RunEngine.snapshot()` の勝敗・自動WinType・敗因だけを読み、未終端はnull。`complete` は両方が実終端のときだけtrue。各完了スプリント直後のorg/予算/出荷/滞留/炎上をその場で保存し、後続操作で上書きしない。共通スプリント数と片側だけの区間を返す。異なる長さの累計出荷を一つの総合点にしない。

費用は集中力の実消費累計（還元前の `sprint.metrics.focusSpent`）、進化ポイントの消費、コマンド前後の予算減少/増加を別々に返す。予算の指標は各コマンドの純差分の累積であり、同一コマンド内で相殺された入出金を分解した総支出ではない。HP・士気・負債・AI依存度は各境界と終端の値で代償を読む。組織の指標はホーム、出荷等の通算は既存RunEngineどおり全社分を含む。

## 保存と計算上限

保存schema v1は共通設定、実ruleset、各側の成功入力列、checkpointを持つ。進行中checkpointは `exportCounterfactualFrame()` のスプリント、RNG位置、accumulator、課金済み値を含む。終端は実リプレイフレームを保持する。復元では入力列を最初から実行し、生成されたcheckpoint全体と照合する。保存された勝敗やRNG値だけを信じてhydrateしない。側間に相互作用がないため、両側の入力順はそれぞれ保存する。別ruleset/試作schema・無効入力列・架空終端・資源/RNG改変・余分な保存項目は拒否する。試作の操作規則を変える場合はschemaを上げる。通常セーブの互換契約は変えない。

1課題は2側固定、各側の成功操作は4096件、要求進行は合計60,000tick、1操作は最大120tick、最大24スプリント。24回目の結果・レビューは処理でき、その後のsetupから追加起動はできない。境界履歴は最大24件。保存は8,000,000文字で拒否する。復元も同じ入力/進行上限で再計算する。拒否入力を内部履歴へ溜めない。外部の評価スクリプトは試行回数にも有限guardを置く。上限到達は `progress: limited` とし、playingのまま終端nullを維持する。敗北や完了を捏造しない。

## 再現比較

[全入力・条件・費用・境界・実結果](opposing-strategies-comparison.json) は `scripts/ri271-opposing-strategies-evaluation.mjs` で生成する。基点mainは `d0e0b25bfbf65432fa2caebfec7c6666faad55ae`、balance ruleset v8。基本比較は3seed × Easy/Normal/Hardの9課題で、難易度だけを変える一要因感度。両側のプールと研修は常に共通。aiを終端/上限まで操作してからhumanを開始し、開始後と最終状態のJSON再開も照合する。

固定入力方針は、手札順に発動を試し、120tickごとにaiはassignTask、humanはpairReview。炎上時にfirefight、humanはレビュー6件以上ならinterruptReviewも試す。ドラフト先頭、進化なし、即敗北/即採用を避けた先頭イベント、heal、採用skip、退店、目標修正先頭。失敗した入力と理由も評価JSONへ全件残す。

| 難易度 / seed末尾 | ai: 完了数 / 出荷 / 終端 | human: 完了数 / 出荷 / 終端 |
| --- | --- | --- |
| Easy / なし | 1 / 853 / 燃え尽き | 24 / 9344 / 上限・未決着 |
| Easy / :1 | 4 / 3750 / 燃え尽き | 4 / 2540 / 燃え尽き |
| Easy / :2 | 1 / 891 / 燃え尽き | 24 / 8174 / 上限・未決着 |
| Normal / なし | 1 / 739 / 燃え尽き | 5 / 2740 / 燃え尽き |
| Normal / :1 | 4 / 2956 / 燃え尽き | 24 / 6666 / KPI未達 |
| Normal / :2 | 6 / 4100 / レビュー凍結 | 24 / 6010 / KPI未達 |
| Hard / なし | 1 / 464 / 燃え尽き | 5 / 2245 / 燃え尽き |
| Hard / :1 | 4 / 2326 / 燃え尽き | 17 / 5532 / 予算切れ |
| Hard / :2 | 2 / 892 / 燃え尽き | 1 / 430 / 燃え尽き |

seed :2ではHardだけ継続期間の大小が逆転する。humanの長期継続を常に有利とは読めず、24回まで続いても勝利に届かない例がある。出荷・継続・費用・終端を別々に読む必要がある。

別枠の実勝利確認はEasy / RI-271で両側のカードプールをauto-testだけにし、介入なし、review-1→quality-1→dev-1→quality-2→review-2→dev-2→quality-3を毎回試す。複数要因を変えるため上記感度には合算しない。aiは12回/出荷13216でレビュー凍結、humanは12回/出荷9780で勝利し、自動称号は **happiness**。両側とも集中力90・進化27を消費、予算減少は18対14。aiの出荷の多さだけを成功とは扱えない。勝利確認の全入力も同JSONの `terminal-win-witness` に記録する。

固定方針同士の結果であり、最適戦略、人間の適応行動、面白さ、本番の係数調整の根拠にはしない。

## 次の判断と検証

**再試作**とする。共通条件の公開、実操作、失敗保存、もう片方の継続、勝利種別の自動読取、再開はAPIとして確認できた。一方、序盤敗北と長期未達の差が操作判断の学びになるか、2回目の継続意欲を保つかは未確認。

次は両方針を切り替えて操作し、共通条件・意図した差分・失敗・未決着を読めるプレイ画面を別単位で作る。人間3名が各1課題を操作し、共通条件を説明できるか、片方敗北後に継続できるか、2指標以上で代償を説明して次の入力を変えられるかを確認する。説明できない条件と途中離脱の理由を記録してから採否を再判断する。現段階では本番統合もIssue完了も宣言しない。

標準Dev Container起動はGH CLI featureのGHCR取得がtimeout。同じ `mcr.microsoft.com/devcontainers/typescript-node:24-bookworm` からfeatureだけを省いた一時設定 `/private/tmp/devops-tycoon-667-container/devcontainer.json` で起動した。リポジトリの設定は変更していない。Node v24.16.0、npm ciと既定Playwrightインストール完了。今回の実行経路は以下。

```sh
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-667-container/devcontainer.json node scripts/ri271-opposing-strategies-evaluation.mjs
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-667-container/devcontainer.json npm test -- src/prototypes/opposingStrategies.test.ts --maxWorkers=1
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-667-container/devcontainer.json npm run lint
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-667-container/devcontainer.json npm run format:check
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-667-container/devcontainer.json npm run build
```

対象ユニットは、実RunEngineとのスプリント一致、RNG位置付きの両側再開、入力/保存改変拒否、拒否入力不変、二重開始/介入/カード/進化/終端の不変、敗北後の他側継続、実勝利と自動称号、上限時の未決着を検証する。UI/Pixi変更がないためローカルE2E/galleryは対象外。全体unit/coverageと必須E2EはCIで確認する。
