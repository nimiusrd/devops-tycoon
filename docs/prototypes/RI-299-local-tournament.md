# RI-299: ローカル大会の読み取り専用比較API

対象 [#695](https://github.com/nimiusrd/devops-tycoon/issues/695) / 親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。**専用の大会モードは見送り、過去ラン比較 [#687](https://github.com/nimiusrd/devops-tycoon/issues/687) に集約**。人間のプレイ評価は未実施。

## 比較条件

同じ開始条件の記録を2〜4件持ち寄り、出荷と勝利種別を並べる試作。過去ラン比較の条件照合を使い、開始時の予算・組織・初期資源も照合した。条件が異なる記録は別組、欠損や矛盾のある記録は比較不能とした。重複取込で参加件数は増えず、参加者の本人性の確認や順位付けは設けなかった。

難易度normal、試練なし、default、同seedの初期予算は45。plainは使用可能な手札で進行し、skilledはペアレビュー・滞留時の割込み・延焼前の火消しを加えた。その他の選択は固定し、施策・介入費用と消耗は実ルールに従った。

## 比較結果

| seed | 方針 | 累計出荷 | 記録上WinType | 結果・代償 |
| --- | --- | ---: | --- | --- |
| g1 | plain | 5990 | null | lost / seniorBurnout |
| g1 | skilled | 6189 | null | lost / seniorBurnout |
| g2 | plain | 13431 | null | lost / budgetExhausted |
| g2 | skilled | 3051 | null | lost / seniorBurnout |

2 seedで方針一要因を変えると出荷の大小が逆転する。この4件は条件照合と記録表示の材料であり、方針の一般的な強さ、楽しさ、人間の適応行動の証明ではない。全件敗北なので勝利例のWinTypeは捏造せずnullで残した。

## 集約後に参照する条件

同条件の記録を並べる目的は [#687](https://github.com/nimiusrd/devops-tycoon/issues/687) と重なり、試作も同じ条件照合を再利用した。共有ファイルを過去ラン比較へ取り込む場合に、条件不一致・欠損・重複の扱いを参照する。

比較データは整理前の Git 履歴から参照できる。 [`local-tournament-comparison.json`](https://github.com/nimiusrd/devops-tycoon/blob/0a3d1a52e616b9d9464b2fc2ab58ec8a9d3123ae/docs/prototypes/local-tournament-comparison.json)、[`local-tournament-replays.json`](https://github.com/nimiusrd/devops-tycoon/blob/0a3d1a52e616b9d9464b2fc2ab58ec8a9d3123ae/docs/prototypes/local-tournament-replays.json)
