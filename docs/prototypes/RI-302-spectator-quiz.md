# RI-302: 保存記録の観戦者予測クイズAPI

対象: #698 / 親 #548。判定: **再試作**。今回は独立した読み取りAPIの情報境界と状態遷移を検証する。UI、編集画面、人間による理解しやすさ・楽しさ・観戦参加意欲は未評価。Issueはopenを維持し、試作PRのマージを本番採用やIssue完了と扱わない。

## 判断と代償

仮説は、操作していない人も、現在までの記録から次の結果を予想し、実記録と比較して振り返れること。今回は「次の保存境界で累計出荷数が増えたか／変わらなかったか」の1種類だけを問う。回答する場合は予想を1回確定し、答え合わせ後に変更できない。参加しない場合はskipで同じ実結果へ進める。資源、時間、報酬、連勝点、投票、通信、外部サービスは追加しない。通常ランの固定トラック、自動WinType、カード、敗北条件は変更しない。

`src/prototypes/spectatorQuiz.ts` の `SpectatorQuiz.open(raw, currentIndex, nextIndex)` は既存 `parseReplayShare` を通し、配列indexが連続し、保存位置とフェーズ遷移が整合する一組だけを受理する。これは記録された2点の比較であり、カードの因果効果、危機の発生時刻、カードを使わなかった場合の結果を推測しない。

現行キーフレームは **setup / result / draft / quarterReview / won / lost** のみ。sprint中の任意tick、ライブ危機実況、入力ログ再実行は未対応。result→draftのようにスプリントが進まない境界もあり、その正解は不変になる。簡単に答えが決まる設問を楽しさの証拠にしない。

## 情報開示境界

| 段階 | APIが公開する記録・操作 | 公開しない情報 |
| --- | --- | --- |
| question | 現在index・phase・完了スプリント数・累計出荷、固定の指標IDと2選択肢 | 次phase・次の出荷数、未来フレーム、最終outcome、seed、RNG、元JSON、label、contentSnapshot |
| answer / skip後（ready） | 上記と確定した回答またはskip | 正解、実結果、正誤 |
| reveal | 次index・phase・完了スプリント数・累計出荷、実際の増加/不変、正誤（skipはnull） | 因果説明・未記録の中間状態 |

`view()` は許可した数値だけを新しいオブジェクトへ投影する。元フレームのスプレッドやlabelの表示は行わない。作者による設問ルール説明は本書の説明であり、`recordedCurrent` / `recordedNext` は記録の事実。自由な作者説明をAPIで受け付けないため、答えや架空の因果を注記経由で混ぜない。資料の未来数値・label・結果画像文言を変更しても、同じ現在フレームのquestion/readyは同じになることを検証する。

`source: recorded-replay` は記録値との照合という意味だけで、真正性の保証ではない。ローカルJSONを解析すれば答えを読める。parserも本APIも署名、改変検出、本人性、チート防止を提供しない。公開モデルの境界を、端末所有者に対する秘密保護と混同しない。

## 状態遷移・再開

`open → question → answer(1回) または skip → ready → reveal`。回答前のreveal、未知回答、二重回答、skip後の回答、完了後の再revealを理由付きで拒否する。無効操作で進捗は変わらない。別インスタンスを開き直すことはできるが、報酬/課金/集計/履歴は存在せず二重消費は発生しない。閲覧継続に正解や回答を必須にしない。通常の閲覧APIをロックする接続もない。

`checkpoint()` は版1・元JSONのSHA-256・2つのindex・回答/skip・reveal済みかだけを返す。未来フレームや答えは含めない。`resume(raw, checkpoint)` は同じ元JSONを実parserで再検証し、ダイジェストを照合して全段階から復元する。元JSONの空白を変えた場合も別資料として拒否する。ダイジェストは対応検査であり、改ざん不能な進捗証明ではない。進捗に乱数はない。元ランのRNG位置付きスナップショットは変更せず、通常save/replay形式の拡張もしない。

## 未知・欠損・不整合と上限

parserの拒否は `replay_corrupt` / `replay_unsupported_version` として伝える。出荷数・完了数が非負の安全な整数でなければ `unknown_recorded_count`、位置欠損は `unknown_recorded_position`、status矛盾は `inconsistent_status`。飛び越しindexは `non_adjacent_indices`、逆転・省略が疑われる保存位置や非対応遷移は `invalid_recorded_adjacency`。累計出荷の減少は `inconsistent_delivered_total`。終端とoutcomeの出荷/診断/勝利種別/敗因が違えば `inconsistent_terminal_outcome`。欠損を0へ、未知を成功へ補完しない。スプリント間のイベント等でも累計出荷は変わりうるため、完了数不変だけを根拠に出荷増加を拒否しない。

受理する遷移はsetup→result/lost、result→draft/quarterReview、draft→setup/lost、quarterReview→won/lost/次四半期setup。setup→resultでは完了数+1・同四半期の位置+1を要求し、setup→lostは完了前/完了直後の両方を許す。他は完了数不変と記録位置一致（次四半期setupのみ四半期+1・位置0）を要求する。記録にない経路の補間はしない。構造が整合する改変JSONまで実プレイと認証するものではない。

旧v1もparserで読め、必要な整数と隣接関係が残っていれば同じ記録比較を行える。欠けているrulesetや表示定義を現行値に補完してカード効果を再計算しない。未知の保存スキーマは拒否。未知ruleset自体は整数の記録比較を妨げないが、そのルールの意味や現行互換を保証しない。

試作独自の上限は元JSON 2,000,000 UTF-16文字、キーフレーム256、進捗512文字、深さ48、探索250,000ノード、配列5,000要素、文字列/キー16,000文字。タスク・履歴・イベント等の埋込配列にも配列上限を適用し、parser/hydrate前に検査する。切捨てや元資料の保存はしない。状態は現在/次の数値と進捗1件のみで、操作履歴を蓄積しない。

## 再現資料と比較

```sh
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-issue-698-container/devcontainer.json node scripts/ri302-spectator-quiz-evaluation.mjs
devcontainer exec --workspace-folder . --config /private/tmp/devops-tycoon-issue-698-container/devcontainer.json npm test -- src/prototypes/spectatorQuiz.test.ts --maxWorkers=1
```

標準configはGH CLI featureのGHCR取得がtimeoutしたため、同じ `mcr.microsoft.com/devcontainers/typescript-node:24-bookworm` でfeatureだけ省略した一時configを使用（Node v24.16.0）。リポジトリconfigは変更していない。

`tests/unit/helpers/spectatorQuizFixture.ts` は公開RunEngineをnormal・試練なし・seed g1/g2で実際の終端まで進める。入力は既存 `runFlow.advance` の既定plain固定方針。可能な手札を使用し、介入なしでstep(1,000,000)、ドラフト先頭、ビート既定選択、休息heal等を実行する。進行回数も記録し、上限40,000回で未決着なら資料生成を失敗させる。手入力結果や架空のWinTypeは作らない。

`spectator-quiz-replays.json` は初期フレーム全体（予算/組織/資源/設定/プール）と、game.tsと同じ連続同phase置換で取得した全保存境界、実終端outcome、rulesetを保存する。`spectator-quiz-comparison.json` は2 seed × setup→result/result→draft × 増加回答/不変回答/skip × v2/旧v1 の24ケース。質問、確定入力、実結果、各段階の進捗JSON、再開一致と無消費を残す。旧v1行は同じ実記録の版付きメタデータだけを落とした互換検証であり、過去版で実行したランを捏造したものではない。

| seed | 初期予算 | 進行回数 | 保存境界数 | 最初のresultの累計出荷 | 実終端の累計出荷 | 実終端 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| g1 | 45 | 46 | 25 | 522 | 5990 | lost / seniorBurnout |
| g2 | 45 | 102 | 53 | 617 | 13431 | lost / budgetExhausted |

両seedとも最初のsetup→resultは増加、result→draftは不変。増加回答/不変回答を入れ替えると正誤だけが変わり、skipは正誤nullで同じ記録値を開示する。実記録g1のdraft→setupは522→530で、完了数1のまま増加する。これをスプリント成果や特定カードの効果とは呼ばない。全件敗北で、勝利例のWinTypeは作らない。

乱数を使うのは資料元のRunEngineだけで、観戦回答は乱数も係数も使わない。同じseedの再記録一致、同じ記録に対する回答/skip一要因の比較、複数seedでの実parser/再開一致を検証する。計算は人間の予測や適応の証拠ではない。固定plain方針の優劣を比較する試作でもない。

## 検証と次の判断条件

対象unitは実parser・実RunEngineでの再生成、正解/不正解/不変/skip、未来情報を変えた公開モデル一致、全段階再開、旧形式、未知/欠損/矛盾/隣接不正、入力上限、二重/完了後操作を確認する。実行中ランの `exportCounterfactualFrame`（RNG位置を含む）を操作前後で照合し、localStorage/IndexedDBアクセスがないことも監視する。

**再試作**。次の不確実性は、現在と次の記録境界、累計値と1スプリント成果、作者の説明と記録事実を人間が区別できるか。次は隔離した閲覧UIで、参加しない人がskipして進めること、未回答では未来値が見えないこと、答え合わせ後にカードの因果効果だと誤認しないことを人間に確認する。事前に複数の難易度の設問と質問文を用意し、境界の説明とskipの理解、選択理由、再挑戦意欲を記録して採否を再判定する。UI実装・人間評価は未実施で、担当/実施日は未定。

UI/Pixi変更なし。ローカルの無関係なE2E/gallery/全体coverageは追加せず、対象unit・lint・format・buildと、マージ前の必須CI両ジョブで検証する。
