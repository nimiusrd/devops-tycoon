# RI-302: 保存記録の観戦者予測クイズAPI

対象 [#698](https://github.com/nimiusrd/devops-tycoon/issues/698) / 親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。**観戦者向けクイズは見送り**。人間のプレイ評価は未実施。

## 比較条件

操作していない人が記録を見て結果を予想し、答え合わせできるかを検討した。現行の保存境界は setup / result / draft / quarterReview / won / lost。試作は隣接境界の累計出荷が増えたかどうかを問い、回答またはスキップ後に次の実記録を開示した。

難易度normal、試練なし、seed g1/g2を採用。使える手札を使って介入なしで進め、ドラフトやイベント等は固定方針を適用した。2 seed × 2種類の境界 × 3通りの回答・スキップ × 2つの記録形式で計24ケースを比較した。

## 比較結果

| seed | 初期予算 | 進行回数 | 保存境界数 | 最初のresultの累計出荷 | 実終端の累計出荷 | 実終端 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| g1 | 45 | 46 | 25 | 522 | 5990 | lost / seniorBurnout |
| g2 | 45 | 102 | 53 | 617 | 13431 | lost / budgetExhausted |

両seedとも最初のsetup→resultは増加、result→draftは不変。増加回答/不変回答を入れ替えると正誤だけが変わり、skipは正誤nullで同じ記録値を開示する。実記録g1のdraft→setupは522→530で、完了数1のまま増加する。これをスプリント成果や特定カードの効果とは呼ばない。全件敗北で、勝利例のWinTypeは作らない。

## 見送り理由

現行の記録で出せるのは累計出荷の増加・不変で、境界によっては答えがほぼ決まる。当初の危機予測や介入効果にはスプリント中の細かな記録が必要になる。予想の体験は、自分の操作につながる練習 [#673](https://github.com/nimiusrd/devops-tycoon/issues/673) を優先する。

比較データは整理前の Git 履歴から参照できる。 [`spectator-quiz-comparison.json`](https://github.com/nimiusrd/devops-tycoon/blob/0a3d1a52e616b9d9464b2fc2ab58ec8a9d3123ae/docs/prototypes/spectator-quiz-comparison.json)、[`spectator-quiz-replays.json`](https://github.com/nimiusrd/devops-tycoon/blob/0a3d1a52e616b9d9464b2fc2ab58ec8a9d3123ae/docs/prototypes/spectator-quiz-replays.json)
