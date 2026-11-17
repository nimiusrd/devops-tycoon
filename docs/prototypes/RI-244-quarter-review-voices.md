# RI-244: 四半期レビューの現場・顧客の声

対象: [#640](https://github.com/nimiusrd/devops-tycoon/issues/640)、親 #548、関連 #537。

## 判断と採否

プレイヤーは出荷・品質の達成状況と直近の個人成長を言葉でも振り返り、既存の目標修正またはレビュー承認へ進む。

**記録から導出する表示だけを限定採用する。** 四半期レビュー画面に実装し、イベント・顧客モデル・報酬ルールは追加しない。面白さ・継続意欲・振り返りの有用性について人間のプレイ評価は未実施。PRのマージをその評価の代用にはしない。人間評価を #640 に残すため、PRは `Refs #640` とする。

比較する構成は「既存のOKR・信頼・未達理由・操作のみ」と「同じ状態に声の詳細を追加」。常時二つの声を表示すると操作が遠くなるため、既存の `result-details` を使い、未達理由の後・操作の前に標準で閉じた44pxの見出しを置く。情報を開くひと手間と引き換えに、既存の主要情報を維持する。発言選択や説明軸によるゲーム上の利益・代償は追加しない。

## 発言の正本と本番境界

`src/render/quarterReviewVoicesView.ts` の純関数だけで導出し、Reactはそれを表示する。

| 声 | 入力と扱い |
| --- | --- |
| 現場1人 | 現在の `roster.members` に存在する人物を選び、その名前を使う。ID一致の休職、昇格、レベルアップ、先頭メンバーの順。不在人物の成長記録は使わない |
| 個人成長 | `lastGrowth` は直近スプリントの記録としてだけ読む。「直近スプリントで」と明示し、休職を優先。昇格とレベルアップの重複賛辞は作らず、`docGain` だけから個人の育成を推測しない |
| 成長記録なし | 今回のレビュー結果の確認だけを話し、記録なしを根拠欄へ表示する。過去四半期の成長、研修、指導、担当実績を推測しない |
| ロスターなし | 発言を作らず「発言できるメンバーの記録がありません」と表示。顧客要約と既存操作は残す |
| 顧客1件 | 特定顧客の存在・利用・障害体験を設定しない。「顧客の声（抽象的な要約）」と明示し、今回の出荷・品質KPIと `quarterReview.trust.customers` を根拠として添える。信頼の高低を分ける新しい閾値は作らない |
| 未達・継続不能 | 出荷未達・品質未達を両者へ反映。品質未達を前四半期比の悪化とは言い換えない。出荷・品質が達成でも全体が継続不能なら全体判定に言及。一律の賛辞や欠損KPIの推測はしない |

入力を変更せず、乱数も消費しない。勝敗・信頼・報酬・自動判定・修正効果は既存の正本のまま。声の開閉や修正案プレビューでは声やレビュー記録を変更しない。保存スキーマ・ruleset・リプレイ形式は変更しない。再生時も記録フレームのロスター・成長・レビューから導出する。Pixiの動的盤面には触れず、HTMLの補足だけを追加する。

色は既存 `--text-dim`、見出し・フォーカスは既存 `result-details` を再利用し、新しい意味の色・共有寸法・motionは追加しない。

## 比較条件と再現方法

ゲームルール・資源・係数・操作列に差はない。表示関数を呼ぶ前後の状態を比較し、JSON往復した同一状態で同一の声になることを検証する。勝率やプレイヤー行動の比較実験ではない。

- ユニット: seed `ri244-voices` / easy の実エンジン初期ロスター。6 outcome、出荷・品質の各未達と両未達、顧客信頼0、KPIなし、成長なし、不在ID、昇格・レベルアップ・休職を固定入力で比較する。
- UI: seed `quarter-review-interactions` / easy。声が閉じた詳細として未達理由の後にあること、空ロスターの案内、修正案プレビューと入力不変性を検証する。
- E2E: seed `ri244-voices-e2e` / easy。公開APIで実WebGLスプリントを開始後、表示確認専用の `met` / `missed_adjustable` / `shutdown` を固定する。出荷100/目標100・品質60/目標50、または出荷0・品質20、顧客信頼60/継続不能時0。履歴0件、長いメンバー名、成長あり/なし、ロスター0件を確認する。固定レビューは自然なプレイで到達した結果とは扱わない。
- viewport: 320×568、390×844、768×1024、1024×768、1280×800、1440×900。390pxはreduced motion。Enter/Spaceで開閉し、フォーカス・横はみ出し・既存のOKR/修正案/終了操作を確認する。
- リプレイ: `replay-quarter-review-jump.spec.ts` の記録フレームをインポートし、ボス結果からレビューへ移動。成長記録なしで育成発言を捏造しないことを確認する。
- 実ラン: `boss-sprint-result.spec.ts` の既存シード・操作列でボス結果からレビューへの導線を確認する。

専用worktreeのDev Container（Node 24）で実行する。

```sh
devcontainer exec --workspace-folder . npm test -- tests/unit/render/quarterReviewVoicesView.test.ts tests/unit/ui/quarterReviewInteractions.test.ts --maxWorkers=1
devcontainer exec --workspace-folder . npx tsc -b
devcontainer exec --workspace-folder . npm run lint
devcontainer exec --workspace-folder . npm run format:check
devcontainer exec --workspace-folder . --remote-env PLAYWRIGHT_PORT=5640 npm run test:e2e -- tests/e2e/quarter-review-voices.spec.ts tests/e2e/replay-quarter-review-jump.spec.ts tests/e2e/boss-sprint-result.spec.ts --workers=1
```

実行結果はPRの検証欄に記録する。Pixiコード・複数画面の視覚変更がないためPixiスナップショット更新・galleryは対象外。

## 未評価と次の判断条件

人間が同じseed・難易度・資源・操作列で、声を閉じた状態と開いた状態を比較し、数値だけの画面より投資先の振り返りが容易か、成長の記録範囲が誤解されないか、修正案への到達が妨げられないかを確認する。未達・休職・継続不能の文章も確認し、有用性が低ければ文章・配置を再試作する。

四半期全体の個人成長履歴、発言者選択、顧客ごとの利用履歴、評価への加点は本番採用範囲外。必要になった時点で別途設計する。
