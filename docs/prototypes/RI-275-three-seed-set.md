# RI-275 三seed総合戦: 実RunEngineセットAPIの試作

対象 [#671](https://github.com/nimiusrd/devops-tycoon/issues/671) / 親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。**三seed総合戦は見送り**。人間のプレイ評価は未実施。

## 検証する判断と代償

3件を開始前に見て、全ランで同じ優先施策3枠を使う。出荷寄り `delivery`、検証寄り `resilient`、混成 `balanced` のどれにするかを比較する。選ばなかった施策への優先枠を失うことが機会費用になる。これは既存の研修方針によるドラフトの優先抽選であり、カード3枚の所有や確定配布ではない。ラン中の施策獲得・発動・介入は実RunEngineへ入力する。

この試作に共通の残高や追加の架空維持費はない。「一条件に予算を集中する」判断まで実装したとは扱わない。共通方針の制約と、条件ごとの成果/消耗の差を最小の比較対象にする。

## 比較条件

| 順 | seed | 既存シナリオ | 難易度/試練 |
| --- | --- | --- | --- |
| 1 | `RI-275:standard:1` | default | normal / なし |
| 2 | `RI-275:copilot:2` | copilot | normal / なし |
| 3 | `RI-275:devin:3` | devin | normal / なし |

- 解放契約は明示的な `local-prototype-opt-in`。この隔離試作内では3方針と既存の全カード/レリックを利用可能にする。通常メタの解放やクリア履歴を読まず、書き換えない。本番の解放条件は未決定。
- 持越しは `preferredCardIds` の選択のみ。組織・予算・デッキ・レリック・進化・名簿・集中力・トラック・乱数は各ランで新しいRunEngineを生成して初期化する。
- 全ランで既存の固定トラック、出荷計算、実費用、敗北判定、勝利種別の自動判定を使用する。勝利種別や結果を手入力するAPIは持たない。敗北ランのWinTypeは欠落のまま保持する。
- 3件の独立した結果を保持し、出荷合計だけの総合点・順位・報酬を作らない。

## 固定方針比較

6セット18ランを同じ初期条件で実行し、介入の有無を切り替えた。

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

## 見送り理由

全18ランが敗北した固定方針の比較で、3ラン分のプレイ時間に見合う、条件をまたいだ配分の判断は確認できなかった。条件ごとの方針比較は、短い盤面で試せる [#666](https://github.com/nimiusrd/devops-tycoon/issues/666) を優先する。

比較データは整理前の Git 履歴から参照できる。 [`three-seed-set-comparison.json`](https://github.com/nimiusrd/devops-tycoon/blob/0a3d1a52e616b9d9464b2fc2ab58ec8a9d3123ae/docs/prototypes/three-seed-set-comparison.json)
