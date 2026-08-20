# バランスパラメータ一覧

> **このファイルは自動生成です。直接編集しないでください。**
> 更新するには `npm run balance:docs` を実行してください。

## ルールセット

- 版: `1`
- 指紋: `048bf3b3b6e01a89d6c53aed919f906cb98b6cf2c3bad15c394adb3e86bebb74`
- 指紋方式: `1`

版は手動更新する単調増加整数である。結果へ影響する変更では直前の版から 1 増やす。

### 版を増やす条件

- ゲームが参照する値、式、分岐、丸め位置、乱数消費順を変える
- 結果へ影響するコンテンツのID、値、重み、抽選・評価に使う配列順を変える
- 指紋の射影または算出方式を変える

### 版を増やさない条件

- label、description、unit、allowedRange、tags、derived などの表示・検証専用メタデータだけを変える
- 体験目標帯などの検証メタデータ、表示専用値、テスト・測定条件、生成物の整形だけを変える

### 指紋対象

- バランスレジストリの安定IDと実行値
- 抽選・評価に使う配列順
- コンテンツのゲーム結果へ影響するID・値・重み

### 指紋対象外

- label、description、unit、allowedRange、tags、derived、integer
- 体験目標帯などの検証メタデータ、表示専用値
- seed と入力列

| ID | ラベル | 現在値 | 単位 | 許容範囲 | 関連制約 | 説明 | タグ | 派生値 |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| `action.aiThrottle.cooldownTicks` | AIスロットルクールダウン | `80` | `ticks` | `0〜1000（整数）` | — | AIスロットルの発動後に待つtick数。 | action, aiThrottle, cooldown | いいえ |
| `action.aiThrottle.durationTicks` | AIスロットル持続tick | `40` | `ticks` | `1〜1000（整数）` | — | AIスロットルによるAI流入抑制が続くtick数。 | action, aiThrottle, duration | いいえ |
| `action.aiThrottle.focusCost` | AIスロットル集中力コスト | `2` | `points` | `0〜20（整数）` | — | AIスロットルを1回発動するために消費する集中力。 | action, aiThrottle, focus | いいえ |
| `action.aiThrottle.gaugeGain` | AIスロットル連携ゲージ | `0.2` | `ratio` | `0〜1` | — | AIスロットル成功時に増える連携ゲージの割合。 | action, aiThrottle, gauge | いいえ |
| `action.andon.baseMoraleCost` | アンドン基本士気コスト | `4` | `points` | `0〜100（整数）` | — | アンドンの発動で常に消費する士気。 | action, andon, morale, side-effect | いいえ |
| `action.andon.cooldownTicks` | アンドンクールダウン | `250` | `ticks` | `0〜1000（整数）` | — | アンドンの発動後に待つtick数。 | action, andon, cooldown | いいえ |
| `action.andon.durationTicks` | アンドン持続tick | `12` | `ticks` | `1〜1000（整数）` | — | アンドンによるタスク流入停止が続くtick数。 | action, andon, duration | いいえ |
| `action.andon.focusCost` | アンドン集中力コスト | `5` | `points` | `0〜20（整数）` | — | アンドンを1回発動するために消費する集中力。 | action, andon, focus | いいえ |
| `action.andon.gaugeGain` | アンドン連携ゲージ | `0.15` | `ratio` | `0〜1` | — | アンドン成功時に増える連携ゲージの割合。 | action, andon, gauge | いいえ |
| `action.andon.seniorHpCost` | アンドン薄キューシニアHPコスト | `14` | `points` | `0〜100（整数）` | — | Reviewが薄い盤面でアンドンを発動したときのシニアHPコスト。 | action, andon, senior-hp, side-effect | いいえ |
| `action.andon.stabilityReviewMinimum` | アンドン渋滞判定Review件数 | `10` | `count` | `1〜100（整数）` | — | このReview件数以上ならアンドンを渋滞対応とみなす。 | action, andon, threshold | いいえ |
| `action.andon.thinMoraleCost` | アンドン薄キュー追加士気コスト | `12` | `points` | `0〜100（整数）` | — | Reviewが薄い盤面でアンドンを発動したときの追加士気コスト。 | action, andon, morale, side-effect | いいえ |
| `action.assignTask.cooldownTicks` | タスク差配クールダウン | `50` | `ticks` | `0〜1000（整数）` | — | タスク差配の発動後に待つtick数。 | action, assignTask, cooldown | いいえ |
| `action.assignTask.focusCost` | タスク差配集中力コスト | `1` | `points` | `0〜20（整数）` | — | タスク差配を1回発動するために消費する集中力。 | action, assignTask, focus | いいえ |
| `action.assignTask.gaugeGain` | タスク差配連携ゲージ | `0.2` | `ratio` | `0〜1` | — | タスク差配成功時に増える連携ゲージの割合。 | action, assignTask, gauge | いいえ |
| `action.assignTask.idealMoraleMinimum` | タスク差配理想士気コスト下限 | `1` | `points` | `0〜100（整数）` | `action.assignTask.idealMoraleMinimum` ≤ `action.assignTask.moraleCost` | 理想差配を基本士気コストの半分にしたときの下限。 | action, assignTask, morale, boundary | いいえ |
| `action.assignTask.mismatchStreakMaximum` | タスク差配偏重ペナルティ上限 | `3` | `count` | `0〜100（整数）` | — | ミスマッチ差配に加えるstreakペナルティの上限。 | action, assignTask, morale, boundary | いいえ |
| `action.assignTask.moraleCost` | タスク差配基本士気コスト | `3` | `points` | `0〜100（整数）` | `action.assignTask.idealMoraleMinimum` ≤ `action.assignTask.moraleCost` | ミスマッチ差配で消費する基本士気。 | action, assignTask, morale, side-effect | いいえ |
| `action.assignTask.progress` | タスク差配進捗増分 | `0.5` | `ratio` | `0〜1` | — | タスク差配1回で進めるCoding進捗の割合。 | action, assignTask, progress | いいえ |
| `action.combo.gaugeFocusRefund` | 連携ゲージ満タン時集中力回復 | `3` | `points` | `0〜20（整数）` | — | 連携ゲージが満タンになったときに回復する集中力。 | action, combo, focus | いいえ |
| `action.firefight.cooldownTicks` | 緊急対応クールダウン | `40` | `ticks` | `0〜1000（整数）` | — | 緊急対応の発動後に待つtick数。 | action, firefight, cooldown | いいえ |
| `action.firefight.focusCost` | 緊急対応集中力コスト | `1` | `points` | `0〜20（整数）` | — | 緊急対応を1回発動するために消費する集中力。 | action, firefight, focus | いいえ |
| `action.firefight.gaugeGain` | 緊急対応連携ゲージ | `0.34` | `ratio` | `0〜1` | — | 緊急対応成功時に増える連携ゲージの割合。 | action, firefight, gauge | いいえ |
| `action.firefight.lightMoraleCost` | 緊急対応単発先消し士気コスト | `5` | `points` | `0〜100（整数）` | — | 余裕のある単発先消しで消費する士気。 | action, firefight, morale, side-effect | いいえ |
| `action.firefight.lightSeniorHpCost` | 緊急対応単発先消しシニアHPコスト | `11` | `points` | `0〜100（整数）` | `action.firefight.seniorHpCostMaximum` ≤ `action.firefight.lightSeniorHpCost` | 余裕のある単発先消しで消費するシニアHP。 | action, firefight, senior-hp, side-effect | いいえ |
| `action.firefight.seniorHpCost` | 緊急対応シニアHPコスト | `2` | `points` | `0〜100（整数）` | `action.firefight.seniorHpCost` ≤ `action.firefight.seniorHpCostMaximum` | 緊急時の緊急対応で消費する基礎シニアHP。 | action, firefight, senior-hp, side-effect | いいえ |
| `action.firefight.seniorHpCostMaximum` | 緊急対応連打HP上限 | `6` | `points` | `0〜100（整数）` | `action.firefight.seniorHpCost` ≤ `action.firefight.seniorHpCostMaximum`<br>`action.firefight.seniorHpCostMaximum` ≤ `action.firefight.lightSeniorHpCost` | 緊急対応の連打で増えるシニアHPコストの上限。 | action, firefight, senior-hp, boundary | いいえ |
| `action.firefight.seniorHpEscalation` | 緊急対応連打HP増分 | `1` | `points` | `0〜100（整数）` | — | 同一スプリントで緊急対応を重ねるたびに増えるシニアHPコスト。 | action, firefight, senior-hp, escalation | いいえ |
| `action.firefight.stabilityBurnTicks` | 緊急対応猶予閾値 | `15` | `ticks` | `0〜1000（整数）` | — | このtick以下の猶予なら緊急対応を緊急盤面とみなす。 | action, firefight, threshold | いいえ |
| `action.firefight.stabilityMinimumBurning` | 緊急対応複数炎上閾値 | `2` | `count` | `1〜100（整数）` | — | この件数以上の炎上を緊急対応すると緊急盤面とみなす。 | action, firefight, threshold | いいえ |
| `action.interruptReview.cooldownTicks` | 割り込みレビュークールダウン | `70` | `ticks` | `0〜1000（整数）` | — | 割り込みレビューの発動後に待つtick数。 | action, interruptReview, cooldown | いいえ |
| `action.interruptReview.focusCost` | 割り込みレビュー集中力コスト | `3` | `points` | `0〜20（整数）` | — | 割り込みレビューを1回発動するために消費する集中力。 | action, interruptReview, focus | いいえ |
| `action.interruptReview.gaugeGain` | 割り込みレビュー連携ゲージ | `0.34` | `ratio` | `0〜1` | — | 割り込みレビュー成功時に増える連携ゲージの割合。 | action, interruptReview, gauge | いいえ |
| `action.interruptReview.reviewCount` | 割り込みレビュー処理件数 | `4` | `count` | `1〜100（整数）` | — | 割り込みレビューで一度に処理するReview件数の上限。 | action, interruptReview, effect | いいえ |
| `action.interruptReview.seniorHpCost` | 割り込みレビューシニアHPコスト | `2` | `points` | `0〜100（整数）` | — | 割り込みレビューで消費するシニアHP。 | action, interruptReview, senior-hp, side-effect | いいえ |
| `action.organizationStat.maximum` | 組織指標上限 | `100` | `points` | `100〜100（整数）` | `action.organizationStat.minimum` ≤ `action.organizationStat.maximum` | 介入・差配が増減する組織指標のclamp上限。 | action, organization, boundary | いいえ |
| `action.organizationStat.minimum` | 組織指標下限 | `0` | `points` | `0〜0（整数）` | `action.organizationStat.minimum` ≤ `action.organizationStat.maximum` | 介入・差配が増減する組織指標のclamp下限（0に固定）。 | action, organization, boundary | いいえ |
| `action.overtime.cooldownTicks` | 残業号令クールダウン | `200` | `ticks` | `0〜1000（整数）` | — | 残業号令の発動後に待つtick数。 | action, overtime, cooldown | いいえ |
| `action.overtime.durationTicks` | 残業号令持続tick | `30` | `ticks` | `1〜1000（整数）` | — | 残業号令のスループットブーストが続くtick数。 | action, overtime, duration | いいえ |
| `action.overtime.focusCost` | 残業号令集中力コスト | `4` | `points` | `0〜20（整数）` | — | 残業号令を1回発動するために消費する集中力。 | action, overtime, focus | いいえ |
| `action.overtime.gaugeGain` | 残業号令連携ゲージ | `0.15` | `ratio` | `0〜1` | — | 残業号令成功時に増える連携ゲージの割合。 | action, overtime, gauge | いいえ |
| `action.overtime.moraleCost` | 残業号令士気コスト | `8` | `points` | `0〜100（整数）` | — | 残業号令で消費する士気。 | action, overtime, morale, side-effect | いいえ |
| `action.overtime.seniorHpCost` | 残業号令シニアHPコスト | `6` | `points` | `0〜100（整数）` | — | 残業号令で消費するシニアHP。 | action, overtime, senior-hp, side-effect | いいえ |
| `action.pairReview.aiLiteracyGain` | ペアレビューAI Literacy増加 | `6` | `points` | `0〜100（整数）` | — | ペアレビュー成功時に増えるAI Literacy。 | action, pairReview, ai-literacy | いいえ |
| `action.pairReview.cooldownTicks` | ペアレビュークールダウン | `60` | `ticks` | `0〜1000（整数）` | — | ペアレビューの発動後に待つtick数。 | action, pairReview, cooldown | いいえ |
| `action.pairReview.focusCost` | ペアレビュー集中力コスト | `2` | `points` | `0〜20（整数）` | — | ペアレビューを1回発動するために消費する集中力。 | action, pairReview, focus | いいえ |
| `action.pairReview.gaugeGain` | ペアレビュー連携ゲージ | `0.3` | `ratio` | `0〜1` | — | ペアレビュー成功時に増える連携ゲージの割合。 | action, pairReview, gauge | いいえ |
| `action.pairReview.reviewCount` | ペアレビュー処理件数 | `2` | `count` | `1〜100（整数）` | — | ペアレビューで一度に処理するReview件数の上限。 | action, pairReview, effect | いいえ |
| `action.splitPr.cooldownTicks` | PR分割クールダウン | `50` | `ticks` | `0〜1000（整数）` | — | PR分割の発動後に待つtick数。 | action, splitPr, cooldown | いいえ |
| `action.splitPr.focusCost` | PR分割集中力コスト | `2` | `points` | `0〜20（整数）` | — | PR分割を1回発動するために消費する集中力。 | action, splitPr, focus | いいえ |
| `action.splitPr.gaugeGain` | PR分割連携ゲージ | `0.25` | `ratio` | `0〜1` | — | PR分割成功時に増える連携ゲージの割合。 | action, splitPr, gauge | いいえ |
| `action.splitPr.moraleCost` | PR分割士気コスト | `4` | `points` | `0〜100（整数）` | — | PR分割で消費する士気。 | action, splitPr, morale, side-effect | いいえ |
| `action.splitPr.progressPenalty` | PR分割進捗ペナルティ | `0.2` | `ratio` | `0〜1` | — | PR分割時に巻き戻すタスク進捗の割合。 | action, splitPr, progress, side-effect | いいえ |
| `action.splitPr.seniorHpCost` | PR分割シニアHPコスト | `4` | `points` | `0〜100（整数）` | — | PR分割で消費するシニアHP。 | action, splitPr, senior-hp, side-effect | いいえ |
| `action.task.progress.maximum` | タスク進捗上限 | `0.999` | `ratio` | `0.999〜1` | `action.task.progress.minimum` ≤ `action.task.progress.maximum` | 介入によるタスク進捗のclamp上限。通常のCoding進行より低くしない。 | action, task, progress, boundary | いいえ |
| `action.task.progress.minimum` | タスク進捗下限 | `0` | `ratio` | `0〜0` | `action.task.progress.minimum` ≤ `action.task.progress.maximum` | 介入によるタスク進捗のclamp下限。 | action, task, progress, boundary | いいえ |
| `card.draft.candidateCount` | ドラフト候補数 | `3` | `count` | `1〜10（整数）` | — | 通常ドラフト・引き直し・ショップが提示するカード候補の枚数。 | card, draft, shop | いいえ |
| `card.draft.mulliganMaxAttempts` | ドラフト引き直しの最大再試行回数 | `16` | `count` | `1〜64（整数）` | — | 元候補と同じ集合を避けて引き直すときの最大試行回数。 | card, draft, mulligan | いいえ |
| `card.draft.preferredWeightMultiplier` | 優先施策のドラフト重み倍率 | `3` | `multiplier` | `1〜10` | — | 研修方針で優先したカードのレアリティ重みへ掛ける倍率。 | card, draft, training-policy | いいえ |
| `card.effect.additive.maximum` | 加算系カード効果の上限 | `50` | `points` | `0〜200` | `card.effect.additive.minimum` ≤ `card.effect.additive.maximum` | 品質・リテラシーなど加算フィールドをclampする上限。 | card, effect, boundary | いいえ |
| `card.effect.additive.minimum` | 加算系カード効果の下限 | `-50` | `points` | `-200〜0` | `card.effect.additive.minimum` ≤ `card.effect.additive.maximum` | 品質・リテラシーなど加算フィールドをclampする下限。 | card, effect, boundary | いいえ |
| `card.effect.multiplier.maximum` | 乗算系カード効果の上限 | `3` | `multiplier` | `1〜10` | `card.effect.multiplier.minimum` ≤ `card.effect.multiplier.maximum` | 速度・効率など乗算フィールドをclampする上限。 | card, effect, boundary | いいえ |
| `card.effect.multiplier.minimum` | 乗算系カード効果の下限 | `0.3` | `multiplier` | `0.1〜1` | `card.effect.multiplier.minimum` ≤ `card.effect.multiplier.maximum` | 速度・効率など乗算フィールドをclampする下限。 | card, effect, boundary | いいえ |
| `card.effect.reworkRateAdd.maximum` | Rework率加算の上限 | `0.5` | `multiplier` | `0〜1` | `card.effect.reworkRateAdd.minimum` ≤ `card.effect.reworkRateAdd.maximum` | カード効果の Rework 率加算をclampする上限。 | card, effect, rework, boundary | いいえ |
| `card.effect.reworkRateAdd.minimum` | Rework率加算の下限 | `-0.5` | `multiplier` | `-1〜0` | `card.effect.reworkRateAdd.minimum` ≤ `card.effect.reworkRateAdd.maximum` | カード効果の Rework 率加算をclampする下限。 | card, effect, rework, boundary | いいえ |
| `card.hand.size` | スプリント開始時の手札枚数 | `3` | `count` | `1〜10（整数）` | — | スプリント開始時にデッキから配る手札の枚数。 | card, hand | いいえ |
| `card.play.focusCostMinimum` | 手札発動の集中力コスト下限 | `1` | `points` | `1〜10（整数）` | — | 丸め後および強化による減少後の、手札発動コストの下限。 | card, play, focus | いいえ |
| `card.upgrade.levelMultiplier` | 強化レベルごとの効果増分 | `0.5` | `multiplier` | `0〜2` | — | 強化レベルが1を超えるごとに効果へ加える係数。k = 1 + この値 × max(0, level - 1)。 | card, upgrade | いいえ |
| `coarse.team.aggregate.healthRank.aiDependencyThreshold` | 健康ランクの AI 依存度境界 | `50` | `percent` | `0〜100（整数）` | — | 健康ランクの AI 依存度ペナルティが始まる境界。 | coarse-team, aggregate, health-rank, ai | いいえ |
| `coarse.team.aggregate.healthRank.aiDependencyWeight` | 健康ランクの AI 依存度係数 | `0.5` | `multiplier` | `0〜2` | — | 健康ランクの指数へ掛ける AI 依存度係数。 | coarse-team, aggregate, health-rank, ai | いいえ |
| `coarse.team.aggregate.healthRank.moraleWeight` | 健康ランクの士気係数 | `0.6` | `multiplier` | `0〜2` | — | 健康ランクの指数へ掛ける士気係数。 | coarse-team, aggregate, health-rank | いいえ |
| `coarse.team.aggregate.healthRank.techDebtCap` | 健康ランクの負債評価上限 | `100` | `points` | `0〜1000（整数）` | — | 健康ランクの指数で負債評価を頭打ちにする上限。 | coarse-team, aggregate, health-rank, tech-debt | いいえ |
| `coarse.team.aggregate.healthRank.techDebtWeight` | 健康ランクの負債係数 | `0.25` | `multiplier` | `0〜2` | — | 健康ランクの指数へ掛ける負債係数。 | coarse-team, aggregate, health-rank, tech-debt | いいえ |
| `coarse.team.aggregate.healthRank.threshold.A` | 健康ランク A 閾値 | `40` | `points` | `-100〜200` | `coarse.team.aggregate.healthRank.threshold.A` < `coarse.team.aggregate.healthRank.threshold.S`<br>`coarse.team.aggregate.healthRank.threshold.B` < `coarse.team.aggregate.healthRank.threshold.A` | 健康ランクの A 判定閾値。 | coarse-team, aggregate, health-rank, boundary | いいえ |
| `coarse.team.aggregate.healthRank.threshold.B` | 健康ランク B 閾値 | `25` | `points` | `-100〜200` | `coarse.team.aggregate.healthRank.threshold.B` < `coarse.team.aggregate.healthRank.threshold.A`<br>`coarse.team.aggregate.healthRank.threshold.C` < `coarse.team.aggregate.healthRank.threshold.B` | 健康ランクの B 判定閾値。 | coarse-team, aggregate, health-rank, boundary | いいえ |
| `coarse.team.aggregate.healthRank.threshold.C` | 健康ランク C 閾値 | `10` | `points` | `-100〜200` | `coarse.team.aggregate.healthRank.threshold.C` < `coarse.team.aggregate.healthRank.threshold.B` | 健康ランクの C 判定閾値。 | coarse-team, aggregate, health-rank, boundary | いいえ |
| `coarse.team.aggregate.healthRank.threshold.S` | 健康ランク S 閾値 | `55` | `points` | `-100〜200` | `coarse.team.aggregate.healthRank.threshold.A` < `coarse.team.aggregate.healthRank.threshold.S` | 健康ランクの S 判定閾値。 | coarse-team, aggregate, health-rank, boundary | いいえ |
| `coarse.team.aggregate.reviewHellRatioMinimum` | 部門 Review Hell 比率境界 | `0.3333333333333333` | `ratio` | `0〜1` | — | 部門を Review Hell と見せる Review Hell チーム比率の下限。 | coarse-team, aggregate, health, boundary | いいえ |
| `coarse.team.aggregate.reviewResilience.base` | 部門 Review 耐性の基礎値 | `100` | `points` | `0〜100（整数）` | — | 部門 Review 耐性の行列補正前の基礎値。 | coarse-team, aggregate, review | いいえ |
| `coarse.team.aggregate.reviewResilience.maximum` | 部門 Review 耐性の上限 | `100` | `points` | `0〜100（整数）` | `coarse.team.aggregate.reviewResilience.minimum` ≤ `coarse.team.aggregate.reviewResilience.maximum` | 部門 Review 耐性へ適用する上限。 | coarse-team, aggregate, review, boundary | いいえ |
| `coarse.team.aggregate.reviewResilience.minimum` | 部門 Review 耐性の下限 | `0` | `points` | `0〜100（整数）` | `coarse.team.aggregate.reviewResilience.minimum` ≤ `coarse.team.aggregate.reviewResilience.maximum` | 部門 Review 耐性へ適用する下限。 | coarse-team, aggregate, review, boundary | いいえ |
| `coarse.team.aggregate.reviewResilience.queuePenalty` | 部門 Review 耐性の行列係数 | `6` | `points` | `0〜100` | — | 平均 Review 行列 1 件あたりの部門 Review 耐性減算。 | coarse-team, aggregate, review | いいえ |
| `coarse.team.aggregate.score.minimum` | 全社スコアの下限 | `0` | `points` | `0〜100000（整数）` | — | 全社・ランキング各スコアへ適用する下限。 | coarse-team, aggregate, score, industry, boundary | いいえ |
| `coarse.team.aggregate.score.onFirePenalty` | 全社スコアの炎上ペナルティ | `40` | `points` | `0〜1000（整数）` | — | 炎上チーム 1 件あたりの全社・総合スコア減算。 | coarse-team, aggregate, score, industry | いいえ |
| `coarse.team.aggregate.score.techDebtCap` | 全社スコアの負債評価上限 | `300` | `points` | `0〜2000（整数）` | — | 全社・総合スコアで負債評価を頭打ちにする上限。 | coarse-team, aggregate, score, tech-debt | いいえ |
| `coarse.team.aggregate.score.techDebtWeight` | 全社スコアの負債係数 | `0.5` | `multiplier` | `0〜2` | — | 全社・総合スコアへ掛ける負債係数。 | coarse-team, aggregate, score, tech-debt, industry | いいえ |
| `coarse.team.capacity.incident.base` | 粗粒度 Incident bias の基礎値 | `0.08` | `probability` | `0〜1` | — | 粗粒度 Incident 発生 bias の基礎確率。 | coarse-team, incident, capacity | いいえ |
| `coarse.team.capacity.incident.maximum` | 粗粒度 Incident bias の上限 | `0.45` | `probability` | `0〜1` | `coarse.team.capacity.incident.minimum` ≤ `coarse.team.capacity.incident.maximum` | 粗粒度 Incident bias へ適用する上限。 | coarse-team, incident, capacity, boundary | いいえ |
| `coarse.team.capacity.incident.minimum` | 粗粒度 Incident bias の下限 | `0.02` | `probability` | `0〜1` | `coarse.team.capacity.incident.minimum` ≤ `coarse.team.capacity.incident.maximum` | 粗粒度 Incident bias へ適用する下限。 | coarse-team, incident, capacity, boundary | いいえ |
| `coarse.team.capacity.incident.perIncident` | 粗粒度 Incident bias の保有件数係数 | `0.05` | `probability` | `0〜1` | — | 未鎮火 Incident 1 件あたりの Incident bias 加算。 | coarse-team, incident, capacity | いいえ |
| `coarse.team.capacity.incident.qualityGapWeight` | 粗粒度 Incident bias の品質不足係数 | `0.002` | `multiplier` | `0〜1` | — | 品質不足 1 ポイントあたりの Incident bias 加算。 | coarse-team, incident, capacity, quality | いいえ |
| `coarse.team.capacity.incident.securityFragilityWeight` | 粗粒度 Incident bias の Security 脆弱度係数 | `0.08` | `probability` | `0〜1` | — | Security 脆弱度へ掛ける Incident bias 係数。 | coarse-team, incident, capacity, security | いいえ |
| `coarse.team.capacity.review.base` | 粗粒度 Review 容量の基礎値 | `55` | `points` | `0〜200` | — | チーム Review 容量の基礎値。 | coarse-team, review, capacity | いいえ |
| `coarse.team.capacity.review.maximum` | 粗粒度 Review 容量の上限 | `100` | `points` | `0〜100` | `coarse.team.capacity.review.minimum` ≤ `coarse.team.capacity.review.maximum` | 粗粒度 Review 容量へ適用する上限。 | coarse-team, review, capacity, boundary | いいえ |
| `coarse.team.capacity.review.minimum` | 粗粒度 Review 容量の下限 | `10` | `points` | `0〜100` | `coarse.team.capacity.review.minimum` ≤ `coarse.team.capacity.review.maximum` | 粗粒度 Review 容量へ適用する下限。 | coarse-team, review, capacity, boundary | いいえ |
| `coarse.team.capacity.review.perEngineer` | 粗粒度 Review 容量の人数係数 | `4` | `points` | `0〜50` | — | エンジニア 1 人あたりの Review 容量加算。 | coarse-team, review, capacity | いいえ |
| `coarse.team.capacity.review.perQueue` | 粗粒度 Review 容量の行列係数 | `2` | `points` | `0〜50` | — | Review 行列 1 件あたりの Review 容量減算。 | coarse-team, review, capacity | いいえ |
| `coarse.team.enter.focusPenalty` | チーム入り込み集中力ペナルティ | `-2` | `points` | `-100〜0（整数）` | — | 別チームへ入り込んだ次スプリントの集中力上限へ加える値。 | coarse-team, enter-team, focus | いいえ |
| `coarse.team.enter.lockSprints` | チーム入り込み拘束スプリント数 | `1` | `count` | `0〜20（整数）` | — | チーム入り込み後に別チームへ切り替えられないスプリント数。 | coarse-team, enter-team | いいえ |
| `coarse.team.health.congested.aiDependencyMinimum` | Congested の AI 依存度境界 | `70` | `percent` | `0〜100（整数）` | — | チームを Congested と判定する AI 依存度の下限。 | coarse-team, aggregate, health, ai, boundary | いいえ |
| `coarse.team.health.congested.queueMinimum` | Congested の行列境界 | `6` | `count` | `0〜100（整数）` | `coarse.team.health.congested.queueMinimum` < `coarse.team.health.reviewHell.queueMinimum` | チームを Congested と判定する Review 行列の下限。 | coarse-team, aggregate, health, review, boundary | いいえ |
| `coarse.team.health.reviewHell.incidentMinimum` | Review Hell の Incident 境界 | `2` | `count` | `0〜100（整数）` | — | チームを Review Hell と判定する未鎮火 Incident 数の下限。 | coarse-team, aggregate, health, incident, boundary | いいえ |
| `coarse.team.health.reviewHell.queueMinimum` | Review Hell の行列境界 | `12` | `count` | `0〜100（整数）` | `coarse.team.health.congested.queueMinimum` < `coarse.team.health.reviewHell.queueMinimum` | チームを Review Hell と判定する Review 行列の下限。 | coarse-team, aggregate, health, review, boundary | いいえ |
| `coarse.team.industry.league.goldMaximum` | ゴールドリーグ順位比率上限 | `0.45` | `ratio` | `0〜1` | `coarse.team.industry.league.platinumMaximum` < `coarse.team.industry.league.goldMaximum`<br>`coarse.team.industry.league.goldMaximum` < `coarse.team.industry.league.silverMaximum` | 自社順位比率がこの値以下ならゴールドリーグとする。 | coarse-team, industry, league, boundary | いいえ |
| `coarse.team.industry.league.platinumMaximum` | プラチナリーグ順位比率上限 | `0.2` | `ratio` | `0〜1` | `coarse.team.industry.league.platinumMaximum` < `coarse.team.industry.league.goldMaximum` | 自社順位比率がこの値以下ならプラチナリーグとする。 | coarse-team, industry, league, boundary | いいえ |
| `coarse.team.industry.league.silverMaximum` | シルバーリーグ順位比率上限 | `0.75` | `ratio` | `0〜1` | `coarse.team.industry.league.goldMaximum` < `coarse.team.industry.league.silverMaximum` | 自社順位比率がこの値以下ならシルバーリーグとする。 | coarse-team, industry, league, boundary | いいえ |
| `coarse.team.industry.ranking.ai.shippingWeight` | AI 活用ランキングの出荷係数 | `0.5` | `multiplier` | `0〜2` | — | AI 活用ランキングへ掛ける出荷係数。 | coarse-team, industry, ranking, ai | いいえ |
| `coarse.team.industry.ranking.aiDependencyThreshold` | AI 活用ランキングの AI 依存度境界 | `60` | `percent` | `0〜100（整数）` | — | AI 活用ランキングの AI 依存度ペナルティが始まる境界。 | coarse-team, industry, ranking, ai | いいえ |
| `coarse.team.industry.ranking.aiDependencyWeight` | AI 活用ランキングの AI 依存度係数 | `3` | `multiplier` | `0〜10` | — | AI 活用ランキングへ掛ける AI 依存度係数。 | coarse-team, industry, ranking, ai | いいえ |
| `coarse.team.industry.ranking.aiGuidelineWeight` | AI 活用ランキングのガイドライン係数 | `3` | `multiplier` | `0〜10` | — | AI 活用ランキングへ掛ける AI ガイドライン係数。 | coarse-team, industry, ranking, ai | いいえ |
| `coarse.team.industry.ranking.growth.moraleWeight` | 急成長ランキングの士気係数 | `2` | `multiplier` | `0〜10` | — | 急成長ランキングへ掛ける士気係数。 | coarse-team, industry, ranking, growth | いいえ |
| `coarse.team.industry.ranking.growth.shippingWeight` | 急成長ランキングの出荷係数 | `0.4` | `multiplier` | `0〜2` | — | 急成長ランキングへ掛ける出荷係数。 | coarse-team, industry, ranking, growth | いいえ |
| `coarse.team.industry.ranking.healthy.aiDependencyThreshold` | 健全経営ランキングの AI 依存度境界 | `50` | `percent` | `0〜100（整数）` | — | 健全経営ランキングの AI 依存度ペナルティが始まる境界。 | coarse-team, industry, ranking, healthy, ai | いいえ |
| `coarse.team.industry.ranking.healthy.aiDependencyWeight` | 健全経営ランキングの AI 依存度係数 | `2` | `multiplier` | `0〜10` | — | 健全経営ランキングへ掛ける AI 依存度係数。 | coarse-team, industry, ranking, healthy, ai | いいえ |
| `coarse.team.industry.ranking.healthy.moraleWeight` | 健全経営ランキングの士気係数 | `5` | `multiplier` | `0〜20` | — | 健全経営ランキングへ掛ける士気係数。 | coarse-team, industry, ranking, healthy | いいえ |
| `coarse.team.industry.ranking.healthy.techDebtCap` | 健全経営ランキングの負債評価上限 | `200` | `points` | `0〜2000（整数）` | — | 健全経営ランキングで負債評価を頭打ちにする上限。 | coarse-team, industry, ranking, healthy, tech-debt | いいえ |
| `coarse.team.industry.ranking.healthy.techDebtWeight` | 健全経営ランキングの負債係数 | `0.3` | `multiplier` | `0〜2` | — | 健全経営ランキングへ掛ける負債係数。 | coarse-team, industry, ranking, healthy, tech-debt | いいえ |
| `coarse.team.industry.rival.aiDependencyRange` | 業界ライバル AI 依存度の抽選範囲 | `100` | `percent` | `0〜100（整数）` | — | 業界ライバル生成時の AI 依存度乱数範囲。 | coarse-team, industry, rival, ai | いいえ |
| `coarse.team.industry.rival.aiGuidelineRange` | 業界ライバル AI ガイドラインの抽選範囲 | `100` | `percent` | `0〜100（整数）` | — | 業界ライバル生成時の AI ガイドライン乱数範囲。 | coarse-team, industry, rival, ai | いいえ |
| `coarse.team.industry.rival.moraleBase` | 業界ライバル士気の基礎値 | `30` | `percent` | `0〜100（整数）` | — | 業界ライバル生成時の士気基礎値。 | coarse-team, industry, rival, morale | いいえ |
| `coarse.team.industry.rival.moraleRange` | 業界ライバル士気の抽選範囲 | `60` | `percent` | `0〜100（整数）` | — | 業界ライバル生成時の士気乱数範囲。 | coarse-team, industry, rival, morale | いいえ |
| `coarse.team.industry.rival.onFireRange` | 業界ライバル炎上数の抽選範囲 | `4` | `count` | `1〜20（整数）` | — | 業界ライバル生成時の炎上チーム数乱数範囲。 | coarse-team, industry, rival, incident | いいえ |
| `coarse.team.industry.rival.shippingBase` | 業界ライバル出荷の基礎値 | `200` | `points` | `0〜10000（整数）` | — | 業界ライバル生成時の出荷基礎値。 | coarse-team, industry, rival, shipping | いいえ |
| `coarse.team.industry.rival.shippingRange` | 業界ライバル出荷の抽選範囲 | `1600` | `points` | `0〜10000（整数）` | — | 業界ライバル生成時の出荷乱数範囲。 | coarse-team, industry, rival, shipping | いいえ |
| `coarse.team.industry.rival.techDebtRange` | 業界ライバル負債の抽選範囲 | `260` | `points` | `0〜2000（整数）` | — | 業界ライバル生成時の技術的負債乱数範囲。 | coarse-team, industry, rival, tech-debt | いいえ |
| `coarse.team.industry.rivalCount` | 業界ランキングのライバル数 | `11` | `count` | `1〜100（整数）` | — | 自社を除く業界ランキング参加組織数。 | coarse-team, industry, rival | いいえ |
| `coarse.team.industry.seasonCount` | 業界シーズン数 | `4` | `count` | `1〜20（整数）` | — | seed から派生する業界シーズン番号の範囲。 | coarse-team, industry, season | いいえ |
| `coarse.team.initial.homeEngineersDefault` | ホームチーム人数の既定値 | `5` | `count` | `0〜100（整数）` | — | 単発の組織スケール生成でプレイヤー人数を省略したときの既定値。 | coarse-team, initial, headcount | いいえ |
| `coarse.team.rival.aiDependencySpread` | ライバル AI 依存度の振れ幅 | `25` | `percent` | `0〜100（整数）` | — | 通常のライバルチームへ加える AI 依存度の一様な振れ幅。 | coarse-team, rival, initial, ai | いいえ |
| `coarse.team.rival.aiDependencySpreadLowLiteracy` | 低リテラシー時ライバル AI 依存度の振れ幅 | `10` | `percent` | `0〜100（整数）` | — | AI リテラシーが危険域の組織でライバルへ加える依存度振れ幅。 | coarse-team, rival, initial, ai, boundary | いいえ |
| `coarse.team.rival.aiLiteracyJitter` | ライバル AI リテラシーの振れ幅 | `20` | `percent` | `0〜100（整数）` | — | ホームチームの AI リテラシーを中心にした振れ幅。 | coarse-team, rival, initial, ai | いいえ |
| `coarse.team.rival.aiLiteracyMaximum` | ライバル AI リテラシーの上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.rival.aiLiteracyMinimum` ≤ `coarse.team.rival.aiLiteracyMaximum` | ライバル初期 AI リテラシーへ適用する上限。 | coarse-team, rival, initial, ai, boundary | いいえ |
| `coarse.team.rival.aiLiteracyMinimum` | ライバル AI リテラシーの下限 | `10` | `percent` | `0〜100（整数）` | `coarse.team.rival.aiLiteracyMinimum` ≤ `coarse.team.rival.aiLiteracyMaximum` | ライバル初期 AI リテラシーへ適用する下限。 | coarse-team, rival, initial, ai, boundary | いいえ |
| `coarse.team.rival.documentationJitter` | ライバルドキュメント水準の振れ幅 | `15` | `percent` | `0〜100（整数）` | — | ホームチームのドキュメント水準を中心にした振れ幅。 | coarse-team, rival, initial, documentation | いいえ |
| `coarse.team.rival.documentationMaximum` | ライバルドキュメント水準の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.rival.documentationMinimum` ≤ `coarse.team.rival.documentationMaximum` | ライバル初期ドキュメント水準へ適用する上限。 | coarse-team, rival, initial, documentation, boundary | いいえ |
| `coarse.team.rival.documentationMinimum` | ライバルドキュメント水準の下限 | `20` | `percent` | `0〜100（整数）` | `coarse.team.rival.documentationMinimum` ≤ `coarse.team.rival.documentationMaximum` | ライバル初期ドキュメント水準へ適用する下限。 | coarse-team, rival, initial, documentation, boundary | いいえ |
| `coarse.team.rival.engineerMinimum` | ライバル人数の下限 | `3` | `count` | `0〜100（整数）` | — | ライバル初期人数の乱数へ加える基礎人数。 | coarse-team, rival, initial, headcount | いいえ |
| `coarse.team.rival.engineerRollRange` | ライバル人数の抽選範囲 | `6` | `count` | `1〜100（整数）` | — | ライバル初期人数へ加える整数乱数の範囲。 | coarse-team, rival, initial, headcount | いいえ |
| `coarse.team.rival.extraShippingMultiplier` | 追加チーム初期出荷倍率 | `0.4` | `multiplier` | `0〜2` | — | 採用ドラフトで追加するチームのテンプレート出荷へ掛ける倍率。 | coarse-team, rival, initial, shipping, extra-team | いいえ |
| `coarse.team.rival.incidentRollMultiplier` | ライバル初期 Incident 抽選倍率 | `2.4` | `multiplier` | `0〜10` | — | ライバル初期 Incident 件数の乱数へ掛ける倍率。 | coarse-team, rival, initial, incident | いいえ |
| `coarse.team.rival.incidentRollOffset` | ライバル初期 Incident 抽選オフセット | `0.6` | `count` | `0〜10` | — | ライバル初期 Incident 件数の乱数から引くオフセット。 | coarse-team, rival, initial, incident | いいえ |
| `coarse.team.rival.moraleJitter` | ライバル士気の振れ幅 | `20` | `points` | `0〜100（整数）` | — | ホームチームの士気を中心にしたライバル士気の振れ幅。 | coarse-team, rival, initial, morale | いいえ |
| `coarse.team.rival.moraleMaximum` | ライバル士気の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.rival.moraleMinimum` ≤ `coarse.team.rival.moraleMaximum` | ライバル初期士気へ適用する上限。 | coarse-team, rival, initial, morale, boundary | いいえ |
| `coarse.team.rival.moraleMinimum` | ライバル士気の下限 | `10` | `percent` | `0〜100（整数）` | `coarse.team.rival.moraleMinimum` ≤ `coarse.team.rival.moraleMaximum` | ライバル初期士気へ適用する下限。 | coarse-team, rival, initial, morale, boundary | いいえ |
| `coarse.team.rival.qualityJitter` | ライバル品質の振れ幅 | `15` | `percent` | `0〜100（整数）` | — | ホームチームの品質を中心にした振れ幅。 | coarse-team, rival, initial, quality | いいえ |
| `coarse.team.rival.qualityMaximum` | ライバル品質の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.rival.qualityMinimum` ≤ `coarse.team.rival.qualityMaximum` | ライバル初期品質へ適用する上限。 | coarse-team, rival, initial, quality, boundary | いいえ |
| `coarse.team.rival.qualityMinimum` | ライバル品質の下限 | `20` | `percent` | `0〜100（整数）` | `coarse.team.rival.qualityMinimum` ≤ `coarse.team.rival.qualityMaximum` | ライバル初期品質へ適用する下限。 | coarse-team, rival, initial, quality, boundary | いいえ |
| `coarse.team.rival.reviewQueueJitter` | ライバル Review 行列の振れ幅 | `4` | `count` | `0〜100（整数）` | — | ホームチームの行列を中心にしたライバル行列の振れ幅。 | coarse-team, rival, initial, review | いいえ |
| `coarse.team.rival.reviewQueueMinimum` | ライバル初期 Review 行列の下限 | `2` | `count` | `0〜100（整数）` | — | ライバル初期行列と追加チームの行列へ適用する下限。 | coarse-team, rival, initial, review, boundary | いいえ |
| `coarse.team.rival.securityJitter` | ライバル Security の振れ幅 | `15` | `percent` | `0〜100（整数）` | — | ホームチームの Security を中心にした振れ幅。 | coarse-team, rival, initial, security | いいえ |
| `coarse.team.rival.seniorHpJitter` | ライバルシニア HP の振れ幅 | `15` | `points` | `0〜100（整数）` | — | ホームチームのシニア HP を中心にした振れ幅。 | coarse-team, rival, initial, senior-hp | いいえ |
| `coarse.team.rival.seniorHpMaximum` | ライバルシニア HP の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.rival.seniorHpMinimum` ≤ `coarse.team.rival.seniorHpMaximum` | ライバル初期シニア HP へ適用する上限。 | coarse-team, rival, initial, senior-hp, boundary | いいえ |
| `coarse.team.rival.seniorHpMinimum` | ライバルシニア HP の下限 | `40` | `percent` | `0〜100（整数）` | `coarse.team.rival.seniorHpMinimum` ≤ `coarse.team.rival.seniorHpMaximum` | ライバル初期シニア HP へ適用する下限。 | coarse-team, rival, initial, senior-hp, boundary | いいえ |
| `coarse.team.rival.shippingJitterMultiplier` | ライバル初期出荷の相対振れ幅 | `0.6` | `multiplier` | `0〜2` | — | ホーム出荷に対するライバル出荷振れ幅の倍率。 | coarse-team, rival, initial, shipping | いいえ |
| `coarse.team.rival.shippingMinimum` | ライバル初期出荷の下限 | `40` | `points` | `0〜10000（整数）` | — | ライバル初期出荷と追加チームのテンプレート出荷へ適用する下限。 | coarse-team, rival, initial, shipping, boundary | いいえ |
| `coarse.team.rival.techDebtJitter` | ライバル技術的負債の振れ幅 | `40` | `points` | `0〜1000（整数）` | — | ホームチームの負債を中心にしたライバル負債の振れ幅。 | coarse-team, rival, initial, tech-debt | いいえ |
| `coarse.team.rival.techDebtMinimum` | ライバル技術的負債の下限 | `20` | `points` | `0〜1000（整数）` | — | ライバル初期負債をホーム値から派生するときの下限。 | coarse-team, rival, initial, tech-debt, boundary | いいえ |
| `coarse.team.rival.testCoverageJitter` | ライバルテストカバレッジの振れ幅 | `15` | `percent` | `0〜100（整数）` | — | ホームチームのテストカバレッジを中心にした振れ幅。 | coarse-team, rival, initial, quality | いいえ |
| `coarse.team.rival.testCoverageMaximum` | ライバルテストカバレッジの上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.rival.testCoverageMinimum` ≤ `coarse.team.rival.testCoverageMaximum` | ライバル初期テストカバレッジへ適用する上限。 | coarse-team, rival, initial, quality, boundary | いいえ |
| `coarse.team.rival.testCoverageMinimum` | ライバルテストカバレッジの下限 | `20` | `percent` | `0〜100（整数）` | `coarse.team.rival.testCoverageMinimum` ≤ `coarse.team.rival.testCoverageMaximum` | ライバル初期テストカバレッジへ適用する下限。 | coarse-team, rival, initial, quality, boundary | いいえ |
| `coarse.team.step.aiDependency.pressureBase` | AI 圧力倍率の基礎値 | `1` | `multiplier` | `0〜5` | — | AI 依存度差分を反映する前の粗粒度圧力倍率。 | coarse-team, step, ai | いいえ |
| `coarse.team.step.aiDependency.pressureMaximum` | AI 圧力倍率の上限 | `1.2` | `multiplier` | `0〜5` | `coarse.team.step.aiDependency.pressureMinimum` ≤ `coarse.team.step.aiDependency.pressureMaximum` | AI 依存度差分を反映した粗粒度圧力倍率の上限。 | coarse-team, step, ai, boundary | いいえ |
| `coarse.team.step.aiDependency.pressureMinimum` | AI 圧力倍率の下限 | `0.4` | `multiplier` | `0〜5` | `coarse.team.step.aiDependency.pressureMinimum` ≤ `coarse.team.step.aiDependency.pressureMaximum` | AI 依存度差分を反映した粗粒度圧力倍率の下限。 | coarse-team, step, ai, boundary | いいえ |
| `coarse.team.step.aiDependency.pressurePerDelta` | AI 依存度差分による圧力係数 | `0.02` | `multiplier` | `0〜1` | — | AI 依存度差分を粗粒度のランダムドリフト圧力へ変換する係数。 | coarse-team, step, ai, adjustment | いいえ |
| `coarse.team.step.aiDependency.randomDriftChance` | 粗粒度 AI 依存度ランダムドリフト確率 | `0.3` | `probability` | `0〜1` | — | AI 圧力に応じて AI 依存度が 1 上がる基礎確率。 | coarse-team, step, ai | いいえ |
| `coarse.team.step.aiLiteracy.gainChance` | 粗粒度 AI リテラシー成長確率 | `0.4` | `probability` | `0〜1` | — | 粗粒度ステップで AI リテラシーが 1 上がる確率。 | coarse-team, step, ai | いいえ |
| `coarse.team.step.fire.chanceMaximum` | 粗粒度 Incident 発生確率の上限 | `0.5` | `probability` | `0〜1` | `coarse.team.step.fire.chanceMinimum` ≤ `coarse.team.step.fire.chanceMaximum` | 粗粒度 Incident 発生確率へ適用する上限。 | coarse-team, step, incident, boundary | いいえ |
| `coarse.team.step.fire.chanceMinimum` | 粗粒度 Incident 発生確率の下限 | `0.02` | `probability` | `0〜1` | `coarse.team.step.fire.chanceMinimum` ≤ `coarse.team.step.fire.chanceMaximum` | 粗粒度 Incident 発生確率へ適用する下限。 | coarse-team, step, incident, boundary | いいえ |
| `coarse.team.step.fire.chancePerAiDependency` | 粗粒度 Incident 発生の AI 依存度係数 | `0.0015` | `multiplier` | `0〜1` | — | AI 依存度を Incident 発生確率へ変換する係数。 | coarse-team, step, incident, ai | いいえ |
| `coarse.team.step.fire.multiplierBase` | 粗粒度 Incident 発生倍率の基礎値 | `1` | `multiplier` | `0〜5` | — | Incident 差分補正前の発生倍率。 | coarse-team, step, incident | いいえ |
| `coarse.team.step.fire.multiplierMaximum` | 粗粒度 Incident 発生倍率の上限 | `1.2` | `multiplier` | `0〜5` | `coarse.team.step.fire.multiplierMinimum` ≤ `coarse.team.step.fire.multiplierMaximum` | Incident 発生倍率へ適用する上限。 | coarse-team, step, incident, boundary | いいえ |
| `coarse.team.step.fire.multiplierMinimum` | 粗粒度 Incident 発生倍率の下限 | `0.35` | `multiplier` | `0〜5` | `coarse.team.step.fire.multiplierMinimum` ≤ `coarse.team.step.fire.multiplierMaximum` | Incident 発生倍率へ適用する下限。 | coarse-team, step, incident, boundary | いいえ |
| `coarse.team.step.incident.adjustmentMultiplier` | Incident 差分による発生倍率係数 | `0.12` | `multiplier` | `0〜2` | — | Incident 差分を発生倍率へ変換する係数。 | coarse-team, step, incident, adjustment | いいえ |
| `coarse.team.step.incident.containChanceBase` | 粗粒度 Incident 鎮火確率の基礎値 | `0.35` | `probability` | `0〜1` | — | Review 容量補正前の粗粒度 Incident 鎮火確率。 | coarse-team, step, incident | いいえ |
| `coarse.team.step.incident.containChancePerReviewCapacity` | 粗粒度 Incident 鎮火の Review 容量係数 | `0.004` | `multiplier` | `0〜1` | — | Review 容量を粗粒度 Incident 鎮火確率へ変換する係数。 | coarse-team, step, incident, review | いいえ |
| `coarse.team.step.incidentRate.minimum` | 粗粒度 Incident 率倍率の下限 | `0.2` | `multiplier` | `0〜5` | — | 実行モディファイアの Incident 率倍率へ適用する下限。 | coarse-team, step, incident, boundary | いいえ |
| `coarse.team.step.morale.adjustmentBias` | 士気差分バイアス | `0.5` | `points` | `0〜10` | — | 士気レバー差分を粗粒度士気増減へ変換するバイアス。 | coarse-team, step, morale, adjustment | いいえ |
| `coarse.team.step.morale.highQueueDelta` | 高行列時の士気変化 | `-3` | `points` | `-20〜20（整数）` | — | 高行列帯で適用する粗粒度士気変化。 | coarse-team, step, morale | いいえ |
| `coarse.team.step.morale.highQueueMinimum` | 士気の高行列境界 | `8` | `count` | `0〜100（整数）` | — | この行列を超えると粗粒度士気の高行列減少を適用する。 | coarse-team, step, morale, review, boundary | いいえ |
| `coarse.team.step.morale.incidentDelta` | Incident 保有時の士気変化 | `-2` | `points` | `-20〜20（整数）` | — | 未鎮火 Incident 保有時に適用する粗粒度士気変化。 | coarse-team, step, morale, incident | いいえ |
| `coarse.team.step.morale.lowQueueDelta` | 低行列時の士気変化 | `1` | `points` | `-20〜20（整数）` | — | 低行列帯で適用する粗粒度士気変化。 | coarse-team, step, morale | いいえ |
| `coarse.team.step.morale.maximum` | 粗粒度士気の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.step.morale.minimum` ≤ `coarse.team.step.morale.maximum` | 粗粒度進行後の士気へ適用する上限。 | coarse-team, step, morale, boundary | いいえ |
| `coarse.team.step.morale.midQueueDelta` | 中行列時の士気変化 | `-1` | `points` | `-20〜20（整数）` | — | 中行列帯で適用する粗粒度士気変化。 | coarse-team, step, morale | いいえ |
| `coarse.team.step.morale.midQueueMinimum` | 士気の中行列境界 | `4` | `count` | `0〜100（整数）` | — | この行列を超えると粗粒度士気の中行列減少を適用する。 | coarse-team, step, morale, review, boundary | いいえ |
| `coarse.team.step.morale.minimum` | 粗粒度士気の下限 | `5` | `percent` | `0〜100（整数）` | `coarse.team.step.morale.minimum` ≤ `coarse.team.step.morale.maximum` | 粗粒度進行後の士気へ適用する下限。 | coarse-team, step, morale, boundary | いいえ |
| `coarse.team.step.morale.noIncidentDelta` | Incident なし時の士気変化 | `1` | `points` | `-20〜20（整数）` | — | 未鎮火 Incident がないときに適用する粗粒度士気変化。 | coarse-team, step, morale, incident | いいえ |
| `coarse.team.step.morale.randomMultiplier` | 粗粒度士気乱数の倍率 | `2` | `multiplier` | `0〜20` | — | 粗粒度士気ランダム項へ掛ける倍率。 | coarse-team, step, morale, random | いいえ |
| `coarse.team.step.morale.randomOffset` | 粗粒度士気乱数のオフセット | `1` | `count` | `0〜20` | — | 粗粒度士気ランダム項から引くオフセット。 | coarse-team, step, morale, random | いいえ |
| `coarse.team.step.morale.randomRange` | 粗粒度士気乱数の入力幅 | `2` | `count` | `0〜20` | — | 粗粒度士気ランダム項へ掛ける乱数幅。 | coarse-team, step, morale, random | いいえ |
| `coarse.team.step.normalize.incidentDivisor` | 粗粒度 Incident 正規化除数 | `2` | `count` | `1〜20（整数）` | — | 非選択チームの Incident 発生件数を平均値へ正規化する除数。 | coarse-team, step, incident, normalization | いいえ |
| `coarse.team.step.quality.lossChance` | 粗粒度品質低下確率 | `0.25` | `probability` | `0〜1` | — | 粗粒度ステップで品質が 1 下がる確率。 | coarse-team, step, quality | いいえ |
| `coarse.team.step.quality.maximum` | 粗粒度品質の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.step.quality.minimum` ≤ `coarse.team.step.quality.maximum` | 粗粒度進行後の品質へ適用する上限。 | coarse-team, step, quality, boundary | いいえ |
| `coarse.team.step.quality.minimum` | 粗粒度品質の下限 | `10` | `percent` | `0〜100（整数）` | `coarse.team.step.quality.minimum` ≤ `coarse.team.step.quality.maximum` | 粗粒度進行後の品質へ適用する下限。 | coarse-team, step, quality, boundary | いいえ |
| `coarse.team.step.queue.drainCapacityDivisor` | 粗粒度行列消化の容量除数 | `25` | `points` | `1〜100（整数）` | — | Review 容量を行列消化量へ変換する除数。 | coarse-team, step, review | いいえ |
| `coarse.team.step.queue.randomMultiplier` | 粗粒度行列乱数の倍率 | `2` | `multiplier` | `0〜20` | — | 粗粒度行列ランダム項へ掛ける倍率。 | coarse-team, step, review, random | いいえ |
| `coarse.team.step.queue.randomOffset` | 粗粒度行列乱数のオフセット | `0.7` | `count` | `0〜20` | — | 粗粒度行列ランダム項から引くオフセット。 | coarse-team, step, review, random | いいえ |
| `coarse.team.step.queue.randomRange` | 粗粒度行列乱数の入力幅 | `2` | `count` | `0〜20` | — | 粗粒度行列ランダム項へ掛ける乱数幅。 | coarse-team, step, review, random | いいえ |
| `coarse.team.step.queuePressure.perAiDependency` | 粗粒度行列圧力の AI 依存度係数 | `0.04` | `multiplier` | `0〜1` | — | AI 依存度を行列圧力へ変換する係数。 | coarse-team, step, review, ai | いいえ |
| `coarse.team.step.queuePressure.perEngineer` | 粗粒度行列圧力の人数係数 | `0.35` | `multiplier` | `0〜2` | — | エンジニア人数を行列圧力へ変換する係数。 | coarse-team, step, review | いいえ |
| `coarse.team.step.queuePressure.perReviewCapacity` | 粗粒度行列圧力の Review 容量係数 | `0.05` | `multiplier` | `0〜1` | — | Review 容量を行列圧力から減算する係数。 | coarse-team, step, review | いいえ |
| `coarse.team.step.queueRelief.perAdjustment` | レバーによる行列緩和係数 | `0.2` | `multiplier` | `0〜5` | — | 負の行列差分を粗粒度行列圧力へ反映する係数。 | coarse-team, step, review, adjustment | いいえ |
| `coarse.team.step.review.multiplierMaximum` | 粗粒度 Review 倍率の上限 | `1.8` | `multiplier` | `0〜5` | `coarse.team.step.review.multiplierMinimum` ≤ `coarse.team.step.review.multiplierMaximum` | 実行モディファイアの Review 倍率へ適用する上限。 | coarse-team, step, review, boundary | いいえ |
| `coarse.team.step.review.multiplierMinimum` | 粗粒度 Review 倍率の下限 | `0.4` | `multiplier` | `0〜5` | `coarse.team.step.review.multiplierMinimum` ≤ `coarse.team.step.review.multiplierMaximum` | 実行モディファイアの Review 倍率へ適用する下限。 | coarse-team, step, review, boundary | いいえ |
| `coarse.team.step.reviewCapacity.multiplierMaximum` | 粗粒度 Review 容量倍率の上限 | `2` | `multiplier` | `0〜5` | `coarse.team.step.reviewCapacity.multiplierMinimum` ≤ `coarse.team.step.reviewCapacity.multiplierMaximum` | 実行モディファイアの Review 容量倍率へ適用する上限。 | coarse-team, step, review, capacity, boundary | いいえ |
| `coarse.team.step.reviewCapacity.multiplierMinimum` | 粗粒度 Review 容量倍率の下限 | `0.5` | `multiplier` | `0〜5` | `coarse.team.step.reviewCapacity.multiplierMinimum` ≤ `coarse.team.step.reviewCapacity.multiplierMaximum` | 実行モディファイアの Review 容量倍率へ適用する下限。 | coarse-team, step, review, capacity, boundary | いいえ |
| `coarse.team.step.reworkRateAdd.maximum` | 粗粒度 Rework 率加算の上限 | `0.5` | `multiplier` | `-0.5〜0.5` | `coarse.team.step.reworkRateAdd.minimum` ≤ `coarse.team.step.reworkRateAdd.maximum` | 実行モディファイアの Rework 率加算へ適用する上限。 | coarse-team, step, rework, boundary | いいえ |
| `coarse.team.step.reworkRateAdd.minimum` | 粗粒度 Rework 率加算の下限 | `-0.5` | `multiplier` | `-0.5〜0.5` | `coarse.team.step.reworkRateAdd.minimum` ≤ `coarse.team.step.reworkRateAdd.maximum` | 実行モディファイアの Rework 率加算へ適用する下限。 | coarse-team, step, rework, boundary | いいえ |
| `coarse.team.step.reworkRelief.perRate` | Rework 率による行列緩和係数 | `20` | `multiplier` | `0〜100` | — | Rework 率加算を行列圧力へ変換する係数。 | coarse-team, step, review, rework | いいえ |
| `coarse.team.step.seniorHp.highQueueDrain` | 高行列時の粗粒度シニア HP 消費 | `2` | `points` | `0〜100（整数）` | — | 高行列帯で適用する基礎シニア HP 消費。 | coarse-team, step, senior-hp | いいえ |
| `coarse.team.step.seniorHp.highQueueMinimum` | 粗粒度シニア HP 消耗の高行列境界 | `6` | `count` | `0〜100（整数）` | — | この行列を超えるとシニア HP 消費を高くする。 | coarse-team, step, senior-hp, review, boundary | いいえ |
| `coarse.team.step.seniorHp.maximum` | 粗粒度シニア HP の上限 | `100` | `percent` | `0〜100（整数）` | `coarse.team.step.seniorHp.minimum` ≤ `coarse.team.step.seniorHp.maximum` | 粗粒度進行後のシニア HP へ適用する上限。 | coarse-team, step, senior-hp, boundary | いいえ |
| `coarse.team.step.seniorHp.midQueueDrain` | 中行列時の粗粒度シニア HP 消費 | `1` | `points` | `0〜100（整数）` | — | 中行列帯で適用する基礎シニア HP 消費。 | coarse-team, step, senior-hp | いいえ |
| `coarse.team.step.seniorHp.midQueueMinimum` | 粗粒度シニア HP 消耗の中行列境界 | `3` | `count` | `0〜100（整数）` | — | この行列を超えるとシニア HP 消費を適用する。 | coarse-team, step, senior-hp, review, boundary | いいえ |
| `coarse.team.step.seniorHp.minimum` | 粗粒度シニア HP の下限 | `1` | `percent` | `0〜100（整数）` | `coarse.team.step.seniorHp.minimum` ≤ `coarse.team.step.seniorHp.maximum` | 粗粒度進行後のシニア HP へ適用する下限。 | coarse-team, step, senior-hp, boundary | いいえ |
| `coarse.team.step.seniorHp.recoveryRate` | 粗粒度シニア HP 回復率 | `0.05` | `ratio` | `0〜1` | — | 粗粒度ステップで不足 HP へ掛ける回復率。 | coarse-team, step, senior-hp | いいえ |
| `coarse.team.step.seniorHpCost.multiplierMaximum` | 粗粒度シニア HP 消費倍率の上限 | `3` | `multiplier` | `0〜5` | `coarse.team.step.seniorHpCost.multiplierMinimum` ≤ `coarse.team.step.seniorHpCost.multiplierMaximum` | 実行モディファイアのシニア HP 消費倍率へ適用する上限。 | coarse-team, step, senior-hp, boundary | いいえ |
| `coarse.team.step.seniorHpCost.multiplierMinimum` | 粗粒度シニア HP 消費倍率の下限 | `0.3` | `multiplier` | `0〜5` | `coarse.team.step.seniorHpCost.multiplierMinimum` ≤ `coarse.team.step.seniorHpCost.multiplierMaximum` | 実行モディファイアのシニア HP 消費倍率へ適用する下限。 | coarse-team, step, senior-hp, boundary | いいえ |
| `coarse.team.step.shipping.base` | 粗粒度出荷の基礎値 | `8` | `points` | `0〜100` | — | チーム粗粒度出荷の基礎値。 | coarse-team, step, shipping | いいえ |
| `coarse.team.step.shipping.minimum` | 粗粒度出荷増分の下限 | `4` | `points` | `0〜100` | — | 稼働チームの粗粒度出荷増分へ適用する下限。 | coarse-team, step, shipping, boundary | いいえ |
| `coarse.team.step.shipping.multiplierMinimum` | 粗粒度出荷倍率の下限 | `0.2` | `multiplier` | `0〜5` | — | 実行モディファイアの出荷倍率へ適用する下限。 | coarse-team, step, shipping, boundary | いいえ |
| `coarse.team.step.shipping.perAiLiteracy` | 粗粒度出荷の AI リテラシー係数 | `0.08` | `multiplier` | `0〜2` | — | AI リテラシー 1 ポイントあたりの粗粒度出荷加算。 | coarse-team, step, shipping, ai | いいえ |
| `coarse.team.step.shipping.perEngineer` | 粗粒度出荷の人数係数 | `2.5` | `points` | `0〜50` | — | エンジニア 1 人あたりの粗粒度出荷加算。 | coarse-team, step, shipping | いいえ |
| `coarse.team.step.shipping.randomBase` | 粗粒度出荷の乱数基礎倍率 | `0.75` | `multiplier` | `0〜2` | — | 粗粒度出荷の一様乱数倍率の基礎値。 | coarse-team, step, shipping, random | いいえ |
| `coarse.team.step.shipping.randomRange` | 粗粒度出荷の乱数倍率幅 | `0.5` | `multiplier` | `0〜2` | — | 粗粒度出荷の一様乱数倍率の幅。 | coarse-team, step, shipping, random | いいえ |
| `coarse.team.step.shipping.techDebtPenalty` | 粗粒度出荷の負債係数 | `0.02` | `multiplier` | `0〜1` | — | 技術的負債 1 ポイントあたりの粗粒度出荷減算。 | coarse-team, step, shipping, tech-debt | いいえ |
| `coarse.team.step.techDebt.aiDependencyWeight` | 粗粒度負債の AI 依存度係数 | `0.03` | `multiplier` | `0〜1` | — | AI 依存度を粗粒度技術的負債増分へ変換する係数。 | coarse-team, step, tech-debt, ai | いいえ |
| `coarse.team.step.techDebt.aiLiteracyWeight` | 粗粒度負債の AI リテラシー係数 | `0.02` | `multiplier` | `0〜1` | — | AI リテラシーを粗粒度技術的負債減少へ変換する係数。 | coarse-team, step, tech-debt, ai | いいえ |
| `coarse.team.step.techDebt.reliefMultiplier` | 負債差分による技術的負債緩和係数 | `0.05` | `multiplier` | `0〜2` | — | 負の負債差分を粗粒度負債増分から減算する係数。 | coarse-team, step, tech-debt, adjustment | いいえ |
| `member.formation.ai.incidentBase` | AI配布時Incident基礎加算 | `0.05` | `multiplier` | `0〜1` | — | AIを配布したコーダーへ加えるIncident倍率の基礎加算。 | member, formation, ai, incident | いいえ |
| `member.formation.ai.incidentMasteryWeight` | AI習熟のIncident低減係数 | `0.1` | `multiplier` | `0〜1` | — | AI習熟がAI配布時のIncident倍率を低減する係数。 | member, formation, ai, incident | いいえ |
| `member.formation.ai.masteryMaximum` | AI習熟正規化倍率の上限 | `1.2` | `multiplier` | `0〜3` | — | AI習熟を正規化した値の上限。 | member, formation, ai, boundary | いいえ |
| `member.formation.ai.masteryNormalization` | AI習熟正規化基準 | `100` | `points` | `1〜200（整数）` | — | 有効AI習熟をAI配布効果へ換算する基準値。 | member, formation, ai | いいえ |
| `member.formation.ai.reworkBase` | AI配布時Rework基礎加算 | `0.05` | `multiplier` | `0〜1` | — | AIを配布したコーダーへ加えるRework率の基礎加算。 | member, formation, ai, rework | いいえ |
| `member.formation.ai.reworkMasteryWeight` | AI習熟のRework低減係数 | `0.14` | `multiplier` | `0〜1` | — | AI習熟がAI配布時のRework率を低減する係数。 | member, formation, ai, rework | いいえ |
| `member.formation.coding.powerDivisor` | Coding実装力換算除数 | `230` | `count` | `1〜1000（整数）` | — | 実装力をCoding速度倍率へ換算する除数。 | member, formation, coding | いいえ |
| `member.formation.coding.speedBase` | Coding速度基礎倍率 | `0.7` | `multiplier` | `0〜3` | — | コーダーの実装力を加算する前のCoding速度倍率。 | member, formation, coding | いいえ |
| `member.formation.coding.speedMaximum` | Coding速度倍率の上限 | `1.8` | `multiplier` | `0〜3` | `member.formation.coding.speedMinimum` ≤ `member.formation.coding.speedMaximum` | Coding速度倍率の上限。 | member, formation, coding, boundary | いいえ |
| `member.formation.coding.speedMinimum` | Coding速度倍率の下限 | `0.6` | `multiplier` | `0〜3` | `member.formation.coding.speedMinimum` ≤ `member.formation.coding.speedMaximum` | コーダーがいるときのCoding速度倍率の下限。 | member, formation, coding, boundary | いいえ |
| `member.formation.codingSlotBonus.maximum` | Coding並列枠ボーナスの上限 | `3` | `count` | `0〜20（整数）` | `member.formation.codingSlotBonus.minimum` ≤ `member.formation.codingSlotBonus.maximum` | コーダー人数から得るCoding並列枠ボーナスの上限。 | member, formation, coding, boundary | いいえ |
| `member.formation.codingSlotBonus.minimum` | Coding並列枠ボーナスの下限 | `0` | `count` | `0〜20（整数）` | `member.formation.codingSlotBonus.minimum` ≤ `member.formation.codingSlotBonus.maximum` | コーダー人数から得るCoding並列枠ボーナスの下限。 | member, formation, coding, boundary | いいえ |
| `member.formation.focusBonus.maximum` | シニアFocusボーナスの上限 | `2` | `count` | `0〜20（整数）` | — | 稼働シニア人数から得るFocusボーナスの上限。 | member, formation, focus, boundary | いいえ |
| `member.formation.incidentRate.maximum` | 編成Incident倍率の上限 | `1.6` | `multiplier` | `0〜3` | `member.formation.incidentRate.minimum` ≤ `member.formation.incidentRate.maximum` | 編成から得るIncident倍率をclampする上限。 | member, formation, incident, boundary | いいえ |
| `member.formation.incidentRate.minimum` | 編成Incident倍率の下限 | `0.6` | `multiplier` | `0〜3` | `member.formation.incidentRate.minimum` ≤ `member.formation.incidentRate.maximum` | 編成から得るIncident倍率をclampする下限。 | member, formation, incident, boundary | いいえ |
| `member.formation.noCoder.codingSpeed` | コーダー不在時Coding倍率 | `0.15` | `multiplier` | `0〜1` | — | 稼働コーダーがいないときのCoding速度倍率。 | member, formation, coding, boundary | いいえ |
| `member.formation.noCoder.slotPenalty` | コーダー不在時並列枠ペナルティ | `-99` | `count` | `-200〜0（整数）` | — | コーダー不在時にCoding並列枠へ加えるペナルティ。 | member, formation, coding, boundary | いいえ |
| `member.formation.review.efficiencyBase` | Review効率基礎倍率 | `0.7` | `multiplier` | `0〜3` | — | レビュアーのレビュー力を加算する前のReview効率倍率。 | member, formation, review | いいえ |
| `member.formation.review.efficiencyMaximum` | Review効率倍率の上限 | `1.8` | `multiplier` | `0〜3` | `member.formation.review.efficiencyMinimum` ≤ `member.formation.review.efficiencyMaximum` | Review効率倍率の上限。 | member, formation, review, boundary | いいえ |
| `member.formation.review.efficiencyMinimum` | Review効率倍率の下限 | `0.55` | `multiplier` | `0〜3` | `member.formation.review.efficiencyMinimum` ≤ `member.formation.review.efficiencyMaximum` | Review効率倍率の下限。 | member, formation, review, boundary | いいえ |
| `member.formation.review.powerDivisor` | Review力換算除数 | `200` | `count` | `1〜1000（整数）` | — | レビュー力をReview効率倍率へ換算する除数。 | member, formation, review | いいえ |
| `member.formation.reviewCapacity.base` | Review容量基礎倍率 | `0.8` | `multiplier` | `0〜3` | — | レビュアー人数を加算する前のReview容量倍率。 | member, formation, review | いいえ |
| `member.formation.reviewCapacity.maximum` | Review容量倍率の上限 | `1.6` | `multiplier` | `0〜3` | `member.formation.reviewCapacity.minimum` ≤ `member.formation.reviewCapacity.maximum` | Review容量倍率の上限。 | member, formation, review, boundary | いいえ |
| `member.formation.reviewCapacity.minimum` | Review容量倍率の下限 | `0.8` | `multiplier` | `0〜3` | `member.formation.reviewCapacity.minimum` ≤ `member.formation.reviewCapacity.maximum` | Review容量倍率の下限。 | member, formation, review, boundary | いいえ |
| `member.formation.reviewCapacity.perReviewer` | レビュアーごとのReview容量 | `0.18` | `multiplier` | `0〜1` | — | レビュアー1人ごとに加えるReview容量倍率。 | member, formation, review | いいえ |
| `member.formation.reworkRate.maximum` | 編成Rework率補正の上限 | `0.3` | `multiplier` | `-1〜1` | `member.formation.reworkRate.minimum` ≤ `member.formation.reworkRate.maximum` | 編成から得るRework率補正をclampする上限。 | member, formation, rework, boundary | いいえ |
| `member.formation.reworkRate.minimum` | 編成Rework率補正の下限 | `-0.3` | `multiplier` | `-1〜1` | `member.formation.reworkRate.minimum` ≤ `member.formation.reworkRate.maximum` | 編成から得るRework率補正をclampする下限。 | member, formation, rework, boundary | いいえ |
| `member.growth.learning.junior` | ジュニア学習倍率 | `1.3` | `multiplier` | `0〜3` | — | ジュニアがスプリントで得る経験値へ掛ける学習倍率。 | member, growth | いいえ |
| `member.growth.learning.middle` | ミドル学習倍率 | `1` | `multiplier` | `0〜3` | — | ミドルがスプリントで得る経験値へ掛ける学習倍率。 | member, growth | いいえ |
| `member.growth.learning.senior` | シニア学習倍率 | `0.7` | `multiplier` | `0〜3` | — | シニアがスプリントで得る経験値へ掛ける学習倍率。 | member, growth | いいえ |
| `member.growth.levelUp.aiMastery` | レベルアップAI習熟増分 | `2` | `points` | `0〜20（整数）` | — | レベルアップ1回で増えるAI習熟。 | member, growth, ability, ai | いいえ |
| `member.growth.levelUp.implementation` | レベルアップ実装力増分 | `3` | `points` | `0〜20（整数）` | — | レベルアップ1回で増える実装力。 | member, growth, ability | いいえ |
| `member.growth.levelUp.review` | レベルアップレビュー力増分 | `3` | `points` | `0〜20（整数）` | — | レベルアップ1回で増えるレビュー力。 | member, growth, ability | いいえ |
| `member.growth.promotion.middleLevel` | ミドル昇格レベル | `4` | `count` | `1〜100（整数）` | `member.growth.promotion.middleLevel` < `member.growth.promotion.seniorLevel` | ジュニアからミドルへ昇格できるレベル。 | member, growth, promotion | いいえ |
| `member.growth.promotion.seniorLevel` | シニア昇格レベル | `8` | `count` | `1〜100（整数）` | `member.growth.promotion.middleLevel` < `member.growth.promotion.seniorLevel` | ミドルからシニアへ昇格できるレベル。 | member, growth, promotion | いいえ |
| `member.growth.staminaMaxPerLevel` | レベルごとのスタミナ上限増分 | `2` | `points` | `0〜20（整数）` | — | レベル1からのレベル差1ごとに加えるスタミナ上限。 | member, growth, stamina | いいえ |
| `member.growth.xp.gainBase` | スプリントXP基礎値 | `18` | `points` | `0〜100` | — | 完了件数による加算前のスプリントXP。 | member, growth, xp | いいえ |
| `member.growth.xp.gainMaximum` | スプリントXP上限 | `70` | `points` | `0〜200` | `member.growth.xp.gainMinimum` ≤ `member.growth.xp.gainMaximum` | スプリントXPをclampする上限。 | member, growth, xp, boundary | いいえ |
| `member.growth.xp.gainMinimum` | スプリントXP下限 | `18` | `points` | `0〜100` | `member.growth.xp.gainMinimum` ≤ `member.growth.xp.gainMaximum` | スプリントXPをclampする下限。 | member, growth, xp, boundary | いいえ |
| `member.growth.xp.gainPerDone` | 完了件数ごとのXP | `1.2` | `points` | `0〜10` | — | スプリント完了件数1件ごとに加えるXP。 | member, growth, xp | いいえ |
| `member.growth.xp.levelBase` | レベル1の必要XP | `80` | `points` | `1〜1000（整数）` | — | レベル1から次のレベルへ進むために必要な基礎XP。 | member, growth, xp | いいえ |
| `member.growth.xp.levelStep` | レベルごとの必要XP増分 | `30` | `points` | `0〜500（整数）` | — | 必要XPをレベルごとに増やす固定XP。 | member, growth, xp | いいえ |
| `member.leave.maximumProbability` | 休職最大確率 | `0.5` | `probability` | `0〜1` | — | スタミナ0のときの休職確率。 | member, leave | いいえ |
| `member.leave.threshold` | 休職判定スタミナ閾値 | `14` | `points` | `1〜100（整数）` | — | このスタミナ以下のメンバーに休職判定を行う。 | member, leave, stamina, boundary | いいえ |
| `member.load.reviewHp.minimum` | Review HP負荷倍率の下限 | `0.65` | `multiplier` | `0〜1` | — | レビュアー人数によるReview HP負荷倍率の下限。 | member, load, review, senior-hp, boundary | いいえ |
| `member.load.reviewHp.reliefPerReviewer` | レビュアーごとのHP負荷緩和 | `0.15` | `multiplier` | `0〜1` | — | レビュアー1人増加ごとのReview HP単価の緩和係数。 | member, load, review, senior-hp | いいえ |
| `member.load.seniorHp.minimum` | シニアHP負荷倍率の下限 | `0.75` | `multiplier` | `0〜1` | — | 稼働人数によるシニアHP負荷倍率の下限。 | member, load, senior-hp, boundary | いいえ |
| `member.load.seniorHp.reliefPerMember` | 稼働人数ごとのシニアHP負荷緩和 | `0.08` | `multiplier` | `0〜1` | — | 基準人数を超えた稼働人数1人ごとのシニアHP負荷緩和係数。 | member, load, senior-hp | いいえ |
| `member.load.staminaShare.baseline` | スタミナ分散の基準人数 | `3` | `count` | `1〜20（整数）` | — | 人数によるスタミナ消費分散の基準稼働人数。 | member, load, stamina | いいえ |
| `member.load.staminaShare.minimum` | スタミナ分散倍率の下限 | `0.5` | `multiplier` | `0〜1` | — | 人数増加によるスタミナ消費緩和倍率の下限。 | member, load, stamina, boundary | いいえ |
| `member.rank.multiplier.junior` | ジュニア能力寄与倍率 | `0.82` | `multiplier` | `0〜3` | — | ジュニアの実装力・レビュー力・AI習熟へ掛けるランク倍率。 | member, rank, ability | いいえ |
| `member.rank.multiplier.middle` | ミドル能力寄与倍率 | `1` | `multiplier` | `0〜3` | — | ミドルの実装力・レビュー力・AI習熟へ掛けるランク倍率。 | member, rank, ability | いいえ |
| `member.rank.multiplier.senior` | シニア能力寄与倍率 | `1.25` | `multiplier` | `0〜3` | — | シニアの実装力・レビュー力・AI習熟へ掛けるランク倍率。 | member, rank, ability | いいえ |
| `member.recovery.betweenSprints` | スプリント間スタミナ回復 | `16` | `points` | `0〜100（整数）` | — | スプリント完了後に回復する基礎スタミナ。 | member, recovery, stamina | いいえ |
| `member.recovery.rest` | 休息時スタミナ回復 | `45` | `points` | `0〜200（整数）` | — | 休息のheal選択で回復する基礎スタミナ。 | member, recovery, stamina, rest | いいえ |
| `member.recruit.cost` | 採用費 | `25` | `currency` | `0〜1000（整数）` | — | メンバー1人を採用するための予算コスト。 | member, recruit, economy | いいえ |
| `member.recruit.rosterCapacity` | ロスター人数上限 | `6` | `count` | `3〜20（整数）` | — | 個体ロスターへ在籍できるメンバー人数の上限。 | member, recruit, roster, boundary | いいえ |
| `member.reorg.minimumActive` | 再編後の最低稼働人数 | `2` | `count` | `0〜20（整数）` | — | 組織再編でメンバーを離脱させずに維持する最低稼働人数。 | member, reorg, boundary | いいえ |
| `member.return.leaveRecoveryMultiplier` | 休職中スタミナ回復倍率 | `1.25` | `multiplier` | `1〜3` | — | 休職中のメンバーへ掛けるスタミナ回復倍率。 | member, return, stamina | いいえ |
| `member.return.ratio` | 復職スタミナ割合 | `0.4` | `probability` | `0〜1` | — | 休職者が復職するために必要なスタミナ上限に対する割合。 | member, return, stamina, boundary | いいえ |
| `member.stamina.drain.aiRelief` | AI配布時スタミナ消費倍率 | `0.85` | `multiplier` | `0〜1` | — | AIを配布したCoding担当へ掛けるスタミナ消費倍率。 | member, stamina, ai | いいえ |
| `member.stamina.drain.base` | スプリント基礎スタミナ消費 | `22` | `points` | `0〜100（整数）` | — | スプリント1回あたりの基礎スタミナ消費。 | member, stamina | いいえ |
| `member.stamina.drain.coding` | Codingスタミナ消費倍率 | `1` | `multiplier` | `0〜3` | — | Coding担当へ掛けるスタミナ消費倍率。 | member, stamina, coding | いいえ |
| `member.stamina.drain.review` | Reviewスタミナ消費倍率 | `1.25` | `multiplier` | `0〜3` | — | Review担当へ掛けるスタミナ消費倍率。 | member, stamina, review | いいえ |
| `member.stamina.max.junior` | ジュニア基礎スタミナ上限 | `70` | `points` | `1〜200（整数）` | — | レベル1ジュニアの基礎スタミナ上限。 | member, stamina | いいえ |
| `member.stamina.max.middle` | ミドル基礎スタミナ上限 | `85` | `points` | `1〜200（整数）` | — | レベル1ミドルの基礎スタミナ上限。 | member, stamina | いいえ |
| `member.stamina.max.senior` | シニア基礎スタミナ上限 | `95` | `points` | `1〜200（整数）` | — | レベル1シニアの基礎スタミナ上限。 | member, stamina | いいえ |
| `outcome.diagnosis.aiOverproduction.aiPctMin` | AI Overproduction の AI 利用率下限 | `0.5` | `ratio` | `0〜1` | — | AI Overproduction 診断に必要な AI 利用率の下限。 | outcome, diagnosis, ai, threshold | いいえ |
| `outcome.diagnosis.aiOverproduction.reworkRatioMin` | AI Overproduction の手戻り率下限 | `0.2` | `ratio` | `0〜1` | — | AI Overproduction 診断に必要な手戻り率の下限。 | outcome, diagnosis, ai, threshold | いいえ |
| `outcome.diagnosis.documentation.documentationMin` | Documentation Kingdom の文書化下限 | `55` | `points` | `0〜100（整数）` | — | Documentation Kingdom 診断に必要な文書化の下限。 | outcome, diagnosis, documentation, threshold | いいえ |
| `outcome.diagnosis.documentation.reworkRatioMax` | Documentation Kingdom の手戻り率上限 | `0.18` | `ratio` | `0〜1` | — | Documentation Kingdom 診断に許容する手戻り率の上限（未満）。 | outcome, diagnosis, documentation, threshold | いいえ |
| `outcome.diagnosis.documentation.testCoverageMin` | Documentation Kingdom のテストカバレッジ下限 | `65` | `points` | `0〜100（整数）` | — | Documentation Kingdom 診断に必要なテストカバレッジの下限。 | outcome, diagnosis, documentation, threshold | いいえ |
| `outcome.diagnosis.quarter.aiDependencyMin` | 四半期 AI 過信診断の依存度下限 | `60` | `points` | `0〜100（整数）` | — | 四半期未達理由へ AI 過信を追加する AI 依存度の下限。 | outcome, diagnosis, quarter, ai, threshold | いいえ |
| `outcome.diagnosis.quarter.aiReworkRatioMin` | 四半期 AI 過信診断の手戻り率下限 | `0.3` | `ratio` | `0〜1` | — | 四半期未達理由へ AI 過信を追加する手戻り率の下限（超過判定）。 | outcome, diagnosis, quarter, ai, threshold | いいえ |
| `outcome.diagnosis.quarter.reviewQueueMin` | 四半期レビュー詰まり診断の Review ピーク下限 | `32` | `count` | `0〜200（整数）` | — | 四半期未達理由へレビュー詰まりを追加する Review ピークの下限。 | outcome, diagnosis, quarter, review, threshold | いいえ |
| `outcome.diagnosis.reviewHell.reworkRatioMax` | Review Hell の手戻り率上限 | `0.3` | `ratio` | `0〜1` | — | Review Hell 診断に許容する手戻り率の上限（未満）。 | outcome, diagnosis, review, threshold | いいえ |
| `outcome.diagnosis.reviewQueueMin` | 診断の Review ピーク下限 | `12` | `count` | `0〜200（整数）` | — | Senior Sacrifice と AI Overproduction の Review ピーク下限。 | outcome, diagnosis, review, threshold | いいえ |
| `outcome.diagnosis.reworkSpiral.reworkRatioMin` | Rework Spiral の手戻り率下限 | `0.32` | `ratio` | `0〜1` | — | Rework Spiral 診断に必要な手戻り率の下限。 | outcome, diagnosis, rework, threshold | いいえ |
| `outcome.diagnosis.seniorSacrifice.seniorHpMax` | Senior Sacrifice のシニア HP 上限 | `30` | `points` | `0〜100（整数）` | — | Senior Sacrifice 診断に必要なシニア HP の上限（未満）。 | outcome, diagnosis, senior, threshold | いいえ |
| `outcome.kpi.exceededHigherMultiplier` | 上限側 KPI exceeded 倍率 | `1.15` | `multiplier` | `1〜3` | `outcome.kpi.exceededLowerMultiplier` ≤ `outcome.kpi.exceededHigherMultiplier` | 高いほど良い KPI が exceeded になる目標倍率。 | outcome, kpi, threshold | いいえ |
| `outcome.kpi.exceededLowerMultiplier` | 下限側 KPI exceeded 倍率 | `0.75` | `multiplier` | `0〜1` | `outcome.kpi.exceededLowerMultiplier` ≤ `outcome.kpi.exceededHigherMultiplier` | 低いほど良い KPI が exceeded になる目標倍率。 | outcome, kpi, threshold | いいえ |
| `outcome.lose.aiDependencyCap` | AI 依存敗北上限 | `95` | `points` | `0〜100（整数）` | — | AI 依存度がこの値以上で AI リテラシー条件を満たすと敗北。 | outcome, lose, ai, threshold | いいえ |
| `outcome.lose.aiLiteracyUnsafeMax` | AI リテラシー危険上限 | `30` | `points` | `0〜100（整数）` | — | AI 依存敗北を成立させる AI リテラシー上限。 | outcome, lose, ai, threshold | いいえ |
| `outcome.lose.budgetMax` | 予算敗北上限 | `0` | `currency` | `0〜1000（整数）` | — | 予算がこの値以下なら即時敗北。 | outcome, lose, threshold | いいえ |
| `outcome.lose.consecutiveIncidentSprintCap` | 連続 Incident スプリント敗北上限 | `6` | `count` | `0〜100（整数）` | — | 延焼を伴う Incident の連続スプリント数がこの値以上なら敗北。 | outcome, lose, incident, threshold | いいえ |
| `outcome.lose.moraleMax` | 士気敗北上限 | `1` | `points` | `0〜100（整数）` | — | 士気がこの値以下なら即時敗北。 | outcome, lose, threshold | いいえ |
| `outcome.lose.reviewFreezePeak` | Review freeze 敗北ピーク | `48` | `count` | `0〜200（整数）` | Math.round(`outcome.lose.reviewFreezePeak` × `outcome.warning.reviewFreeze.watchRatio`) < `outcome.lose.reviewFreezePeak` - `outcome.warning.reviewFreeze.dangerOffset` < `outcome.lose.reviewFreezePeak` | Review 待ち行列ピークがこの値以上なら即時敗北。 | outcome, lose, review, threshold | いいえ |
| `outcome.lose.seniorHpMax` | シニア HP 敗北上限 | `1` | `points` | `0〜100（整数）` | — | シニア HP がこの値以下なら即時敗北。 | outcome, lose, threshold | いいえ |
| `outcome.lose.techDebtCap` | Tech Debt 敗北上限 | `90` | `points` | `0〜100（整数）` | — | Tech Debt がこの値以上なら即時敗北。 | outcome, lose, threshold | いいえ |
| `outcome.quarter.adjustment.minimumTrust` | 目標修正後の信頼下限 | `5` | `points` | `0〜100（整数）` | — | 目標修正後に各ステークホルダーへ許容する最低信頼。 | outcome, quarter, adjustment, threshold | いいえ |
| `outcome.quarter.crisis.budgetMax` | 四半期危機の予算上限 | `5` | `currency` | `0〜1000（整数）` | — | 予算がこの値以下なら missed_crisis。 | outcome, quarter, crisis, threshold | いいえ |
| `outcome.quarter.crisis.missedKpiMin` | 四半期危機の未達 KPI 数下限 | `4` | `count` | `0〜20（整数）` | — | 未達 KPI 数がこの値以上なら missed_crisis。 | outcome, quarter, crisis, threshold | いいえ |
| `outcome.quarter.crisis.trustMax` | 四半期危機の信頼上限 | `15` | `points` | `0〜100（整数）` | `outcome.quarter.shutdown.trustMax` < `outcome.quarter.crisis.trustMax`<br>`outcome.quarter.crisis.trustMax` < `outcome.quarter.reorg.trustMax` | 最小信頼がこの値以下なら missed_crisis。 | outcome, quarter, crisis, threshold | いいえ |
| `outcome.quarter.delivery.baselineSprintFloor` | 通常スプリント Delivery 床 | `60` | `points` | `0〜1000（整数）` | — | ボス種別によらない通常スプリントの Delivery 基準値。 | outcome, quarter, delivery | いいえ |
| `outcome.quarter.delivery.minimumTargetScale` | 四半期 Delivery 目標下限係数 | `30` | `multiplier` | `0〜100（整数）` | — | 新規四半期 Delivery 目標の最低値へ適用する四半期スケール係数。 | outcome, quarter, delivery, threshold | いいえ |
| `outcome.quarter.delivery.priorDecay` | prior Delivery 減衰率 | `0.95` | `ratio` | `0〜1` | — | priorGoal を次四半期へ引き継ぐときの Delivery 減衰率。 | outcome, quarter, delivery | いいえ |
| `outcome.quarter.delivery.priorMinimumFloorFactor` | prior Delivery 下限係数 | `0.7` | `ratio` | `0〜1` | — | priorGoal 引き継ぎ時の Delivery 下限へ適用する係数。 | outcome, quarter, delivery, threshold | いいえ |
| `outcome.quarter.delivery.throughputMultiplier` | 四半期 Delivery スループット倍率 | `5` | `multiplier` | `0〜20` | — | 1 スプリントの Delivery 床を四半期目標へ換算する倍率。 | outcome, quarter, delivery | いいえ |
| `outcome.quarter.goal.defaultIncidentLimit` | 四半期 Incident 既定上限 | `6` | `count` | `0〜100（整数）` | — | ボス定義に Incident 条件がない場合の四半期目標。 | outcome, quarter, kpi | いいえ |
| `outcome.quarter.goal.defaultMorale` | 四半期 Morale 既定目標 | `40` | `points` | `0〜100（整数）` | — | ボス定義に Morale 条件がない場合の四半期目標。 | outcome, quarter, kpi | いいえ |
| `outcome.quarter.goal.defaultQuality` | 四半期 Quality 既定目標 | `45` | `points` | `0〜100（整数）` | — | ボス定義に Quality 条件がない場合の四半期目標。 | outcome, quarter, kpi | いいえ |
| `outcome.quarter.goal.defaultTechDebtLimit` | 四半期 Tech Debt 既定上限 | `55` | `points` | `0〜100（整数）` | — | ボス定義に Tech Debt 条件がない場合の四半期目標。 | outcome, quarter, kpi | いいえ |
| `outcome.quarter.goal.incidentHeadroom` | 四半期 Incident 目標余裕 | `3` | `count` | `0〜100（整数）` | — | ボス定義の最大延焼値へ加える四半期目標の余裕。 | outcome, quarter, kpi | いいえ |
| `outcome.quarter.goal.multiplier.easy` | Easy 四半期 Delivery 目標倍率 | `2.7` | `multiplier` | `0〜10` | — | Easy の四半期 Delivery 目標倍率。 | outcome, quarter, difficulty, delivery | いいえ |
| `outcome.quarter.goal.multiplier.hard` | Hard 四半期 Delivery 目標倍率 | `1.75` | `multiplier` | `0〜10` | — | Hard の四半期 Delivery 目標倍率。 | outcome, quarter, difficulty, delivery | いいえ |
| `outcome.quarter.goal.multiplier.nightmare` | Nightmare 四半期 Delivery 目標倍率 | `1.55` | `multiplier` | `0〜10` | — | Nightmare の四半期 Delivery 目標倍率。 | outcome, quarter, difficulty, delivery | いいえ |
| `outcome.quarter.goal.multiplier.normal` | Normal 四半期 Delivery 目標倍率 | `2.25` | `multiplier` | `0〜10` | — | Normal の四半期 Delivery 目標倍率。 | outcome, quarter, difficulty, delivery | いいえ |
| `outcome.quarter.initialTrust.easy` | Easy 初期信頼 | `70` | `points` | `0〜100（整数）` | — | Easy の経営・顧客・チーム信頼の基礎値。 | outcome, quarter, trust, difficulty | いいえ |
| `outcome.quarter.initialTrust.hard` | Hard 初期信頼 | `50` | `points` | `0〜100（整数）` | — | Hard の経営・顧客・チーム信頼の基礎値。 | outcome, quarter, trust, difficulty | いいえ |
| `outcome.quarter.initialTrust.nightmare` | Nightmare 初期信頼 | `45` | `points` | `0〜100（整数）` | — | Nightmare の経営・顧客・チーム信頼の基礎値。 | outcome, quarter, trust, difficulty | いいえ |
| `outcome.quarter.initialTrust.normal` | Normal 初期信頼 | `60` | `points` | `0〜100（整数）` | — | Normal の経営・顧客・チーム信頼の基礎値。 | outcome, quarter, trust, difficulty | いいえ |
| `outcome.quarter.initialTrust.teamBonus` | 初期チーム信頼加算 | `5` | `points` | `0〜100（整数）` | — | 初期チーム信頼へ加える基礎値からの加算。 | outcome, quarter, trust | いいえ |
| `outcome.quarter.reorg.minQuarter` | 再編判定の最小四半期 | `2` | `count` | `1〜20（整数）` | — | 未達 KPI 数だけで再編判定を行う最小四半期番号。 | outcome, quarter, reorg, threshold | いいえ |
| `outcome.quarter.reorg.missedKpiMin` | 再編判定の未達 KPI 数下限 | `3` | `count` | `0〜20（整数）` | — | 四半期番号条件と組み合わせる未達 KPI 数の下限。 | outcome, quarter, reorg, threshold | いいえ |
| `outcome.quarter.reorg.seniorHpRecovery` | 再編時シニア HP 回復量 | `20` | `points` | `0〜100（整数）` | — | 再編リセットで回復するシニア HP。 | outcome, quarter, reorg, recovery | いいえ |
| `outcome.quarter.reorg.techDebtRecovery` | 再編時 Tech Debt 回復量 | `8` | `points` | `0〜100（整数）` | — | 再編リセットで減少する Tech Debt の正の回復量。 | outcome, quarter, reorg, recovery | いいえ |
| `outcome.quarter.reorg.trustMax` | 再編判定の信頼上限 | `20` | `points` | `0〜100（整数）` | `outcome.quarter.crisis.trustMax` < `outcome.quarter.reorg.trustMax` | 未達 KPI 数と組み合わせる最小信頼の上限。 | outcome, quarter, reorg, threshold | いいえ |
| `outcome.quarter.reorg.trustMissedKpiMin` | 信頼再編の未達 KPI 数下限 | `2` | `count` | `0〜20（整数）` | — | 信頼条件と組み合わせる未達 KPI 数の下限。 | outcome, quarter, reorg, threshold | いいえ |
| `outcome.quarter.shutdown.budgetMax` | 四半期 shutdown 予算上限 | `0` | `currency` | `0〜1000（整数）` | — | 士気条件と組み合わせる shutdown 予算上限。 | outcome, quarter, shutdown, threshold | いいえ |
| `outcome.quarter.shutdown.budgetMoraleMax` | 予算枯渇時 shutdown 士気上限 | `15` | `points` | `0〜100（整数）` | — | 予算枯渇と組み合わせる shutdown 士気上限。 | outcome, quarter, shutdown, threshold | いいえ |
| `outcome.quarter.shutdown.missedKpiMin` | shutdown 未達 KPI 数下限 | `2` | `count` | `0〜20（整数）` | — | シニア HP 条件と組み合わせる未達 KPI 数の下限。 | outcome, quarter, shutdown, threshold | いいえ |
| `outcome.quarter.shutdown.seniorHpMax` | 未達時 shutdown シニア HP 上限 | `5` | `points` | `0〜100（整数）` | — | 未達 KPI 数と組み合わせる shutdown シニア HP 上限。 | outcome, quarter, shutdown, threshold | いいえ |
| `outcome.quarter.shutdown.trustMax` | 四半期 shutdown 信頼上限 | `10` | `points` | `0〜100（整数）` | `outcome.quarter.shutdown.trustMax` < `outcome.quarter.crisis.trustMax` | 最小信頼がこの値以下なら shutdown。 | outcome, quarter, shutdown, threshold | いいえ |
| `outcome.warning.reviewFreeze.dangerOffset` | Review freeze 危険オフセット | `4` | `count` | `0〜100（整数）` | Math.round(`outcome.lose.reviewFreezePeak` × `outcome.warning.reviewFreeze.watchRatio`) < `outcome.lose.reviewFreezePeak` - `outcome.warning.reviewFreeze.dangerOffset` < `outcome.lose.reviewFreezePeak` | Review freeze 敗北ピークから HUD 危険帯を前倒しする値。 | outcome, warning, review, threshold | いいえ |
| `outcome.warning.reviewFreeze.watchRatio` | Review freeze 警告比率 | `0.75` | `ratio` | `0〜1` | Math.round(`outcome.lose.reviewFreezePeak` × `outcome.warning.reviewFreeze.watchRatio`) < `outcome.lose.reviewFreezePeak` - `outcome.warning.reviewFreeze.dangerOffset` < `outcome.lose.reviewFreezePeak` | Review freeze 敗北ピークに対する HUD・danger report 警告比率。 | outcome, warning, review, threshold | いいえ |
| `outcome.win.aiSuccess.aiPctMin` | AI 成功勝利の AI 利用率下限 | `0.55` | `ratio` | `0〜1` | — | AI 成功勝利に必要な AI 利用率の下限。 | outcome, win, ai, threshold | いいえ |
| `outcome.win.aiSuccess.literacyMin` | AI 成功勝利の Literacy 下限 | `40` | `points` | `0〜100（整数）` | — | AI 成功勝利に必要な AI Literacy の下限。 | outcome, win, ai, threshold | いいえ |
| `outcome.win.aiSuccess.reworkMax` | AI 成功勝利の手戻り率上限 | `0.22` | `ratio` | `0〜1` | — | AI 成功勝利に許容する手戻り率の上限（未満）。 | outcome, win, ai, threshold | いいえ |
| `outcome.win.aiSuccess.securityMin` | AI 成功勝利の Security 下限 | `50` | `points` | `0〜100（整数）` | — | AI 成功勝利に必要な Security の下限。 | outcome, win, ai, threshold | いいえ |
| `outcome.win.chaos.deliveredMin` | カオス勝利の Delivery 下限 | `250` | `points` | `0〜10000（整数）` | — | 残差カオス勝利に必要な累計 Delivery。 | outcome, win, chaos, threshold | いいえ |
| `outcome.win.chaos.incidentsMin` | カオス勝利の Incident 下限 | `20` | `count` | `0〜200（整数）` | — | 残差カオス勝利に必要な累計 Incident 数。 | outcome, win, chaos, threshold | いいえ |
| `outcome.win.chaosNeglect.deliveredMin` | セキュリティ軽視カオスの Delivery 下限 | `180` | `points` | `0〜10000（整数）` | — | セキュリティ軽視カオス勝利に必要な累計 Delivery。 | outcome, win, chaos, threshold | いいえ |
| `outcome.win.chaosNeglect.incidentsMin` | セキュリティ軽視カオスの Incident 下限 | `16` | `count` | `0〜200（整数）` | — | セキュリティ軽視カオス勝利に必要な累計 Incident 数。 | outcome, win, chaos, threshold | いいえ |
| `outcome.win.chaosNeglect.securityMax` | セキュリティ軽視カオスの Security 上限 | `50` | `points` | `0〜100（整数）` | — | セキュリティ軽視カオス勝利に必要な Security の上限（未満）。 | outcome, win, chaos, threshold | いいえ |
| `outcome.win.documentation.moraleMin` | Documentation Kingdom の Morale 下限 | `60` | `points` | `0〜100（整数）` | — | Documentation Kingdom を健全勝利へ分類する Morale の下限。 | outcome, win, documentation, threshold | いいえ |
| `outcome.win.documentation.qualityMin` | Documentation Kingdom の Quality 下限 | `55` | `points` | `0〜100（整数）` | — | Documentation Kingdom を健全勝利へ分類する Quality の下限。 | outcome, win, documentation, threshold | いいえ |
| `outcome.win.documentation.reworkMax` | Documentation Kingdom の手戻り率上限 | `0.22` | `ratio` | `0〜1` | — | Documentation Kingdom を健全勝利へ分類する手戻り率の上限（未満）。 | outcome, win, documentation, threshold | いいえ |
| `outcome.win.happiness.moraleMin` | 幸福勝利の Morale 下限 | `70` | `points` | `0〜100（整数）` | — | 幸福勝利に必要な Morale の下限。 | outcome, win, happiness, threshold | いいえ |
| `outcome.win.happiness.seniorHpMin` | 幸福勝利のシニア HP 下限 | `45` | `points` | `0〜100（整数）` | — | 幸福勝利に必要なシニア HP の下限。 | outcome, win, happiness, threshold | いいえ |
| `outcome.win.healthy.moraleMin` | 健全勝利の Morale 下限 | `65` | `points` | `0〜100（整数）` | — | 健全勝利に必要な Morale の下限。 | outcome, win, healthy, threshold | いいえ |
| `outcome.win.healthy.qualityMin` | 健全勝利の Quality 下限 | `65` | `points` | `0〜100（整数）` | — | 健全勝利に必要な Quality の下限。 | outcome, win, healthy, threshold | いいえ |
| `outcome.win.healthy.securityMin` | 健全勝利の Security 下限 | `85` | `points` | `0〜100（整数）` | — | Security 重視の健全勝利に必要な Security の下限。 | outcome, win, healthy, threshold | いいえ |
| `outcome.win.healthyFallback.reworkMax` | 品質系健全勝利の手戻り率上限 | `0.2` | `ratio` | `0〜1` | — | 品質系の健全勝利へ分類する手戻り率の上限（未満）。 | outcome, win, healthy, threshold | いいえ |
| `outcome.win.management.budgetMin` | 経営勝利の予算下限 | `50` | `currency` | `0〜1000（整数）` | — | 経営勝利に必要な残予算の下限。 | outcome, win, management, threshold | いいえ |
| `outcome.win.noDamage.moraleMin` | ノーダメージ勝利の Morale 下限 | `70` | `points` | `0〜100（整数）` | — | ノーダメージ勝利に必要な Morale の下限。 | outcome, win, no-damage, threshold | いいえ |
| `outcome.win.noDamage.qualityMin` | ノーダメージ勝利の Quality 下限 | `70` | `points` | `0〜100（整数）` | — | ノーダメージ勝利に必要な Quality の下限。 | outcome, win, no-damage, threshold | いいえ |
| `outcome.win.noDamage.reworkMax` | ノーダメージ勝利の手戻り率上限 | `0.15` | `ratio` | `0〜1` | — | ノーダメージ勝利に許容する手戻り率の上限（未満）。 | outcome, win, no-damage, threshold | いいえ |
| `outcome.win.noDamage.seniorHpMin` | ノーダメージ勝利のシニア HP 下限 | `60` | `points` | `0〜100（整数）` | — | ノーダメージ勝利に必要なシニア HP の下限。 | outcome, win, no-damage, threshold | いいえ |
| `outcome.win.noDamage.spreadMax` | ノーダメージ勝利の延焼上限 | `0` | `count` | `0〜200（整数）` | — | ノーダメージ勝利に許容する延焼数の上限。 | outcome, win, no-damage, threshold | いいえ |
| `outcome.win.reviewQueuePeakMax` | 健全系勝利の Review ピーク上限 | `16` | `count` | `0〜200（整数）` | — | AI 成功・品質系健全勝利に許容する Review ピークの上限（未満）。 | outcome, win, review, threshold | いいえ |
| `pacing.recovery.betweenSprint` | スプリント間シニアHP回復率 | `0.5` | `ratio` | `0〜1` | — | スプリント間にシニアHPの満タンまでの差分へ掛ける回復率。 | pacing, execution, recovery | いいえ |
| `pacing.simulation.fixedStepMs` | シミュレーション固定ステップ | `100` | `milliseconds` | `1〜1000（整数）` | — | シミュレーションが1 tick進む固定時間。UIの1 tick入力と共有する。 | pacing, execution, simulation | いいえ |
| `pacing.target.betweenSprintWallMs` | スプリント間標準操作時間 | `30000` | `milliseconds` | `0〜3600000（整数）` | — | スプリント間の標準操作時間として回帰検知へ加算する値。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.bossWall.maxMs` | ボス壁時計代表上限 | `180000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.bossWall.minMs` ≤ `pacing.target.bossWall.maxMs` | ボススプリントの1x壁時計代表帯の上限。 | pacing, validation, target-band, boss, wall-clock | いいえ |
| `pacing.target.bossWall.minMs` | ボス壁時計代表下限 | `90000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.bossWall.minMs` ≤ `pacing.target.bossWall.maxMs` | ボススプリントの1x壁時計代表帯の下限。 | pacing, validation, target-band, boss, wall-clock | いいえ |
| `pacing.target.interventionPerSprint.max` | 1スプリント介入回数上限 | `8` | `count` | `0〜100（整数）` | `pacing.target.interventionPerSprint.min` ≤ `pacing.target.interventionPerSprint.max` | 1スプリントあたりの介入回数期待帯の上限。 | pacing, validation, target-band, intervention | いいえ |
| `pacing.target.interventionPerSprint.min` | 1スプリント介入回数下限 | `3` | `count` | `0〜100（整数）` | `pacing.target.interventionPerSprint.min` ≤ `pacing.target.interventionPerSprint.max` | 1スプリントあたりの介入回数期待帯の下限。 | pacing, validation, target-band, intervention | いいえ |
| `pacing.target.quarterReviewWallMs` | 四半期レビュー標準操作時間 | `45000` | `milliseconds` | `0〜3600000（整数）` | — | 四半期レビューの標準操作時間として回帰検知へ加算する値。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.quarterWall.maxMs` | 四半期壁時計代表上限 | `900000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.quarterWall.minMs` ≤ `pacing.target.quarterWall.maxMs` | 1四半期の1x壁時計代表帯の上限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.quarterWall.minMs` | 四半期壁時計代表下限 | `600000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.quarterWall.minMs` ≤ `pacing.target.quarterWall.maxMs` | 1四半期の1x壁時計代表帯の下限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.runWall.maxMs` | ラン壁時計代表上限 | `2700000` | `milliseconds` | `0〜7200000（整数）` | `pacing.target.runWall.minMs` ≤ `pacing.target.runWall.maxMs` | 1ランの1x壁時計代表帯の上限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.runWall.minMs` | ラン壁時計代表下限 | `900000` | `milliseconds` | `0〜7200000（整数）` | `pacing.target.runWall.minMs` ≤ `pacing.target.runWall.maxMs` | 1ランの1x壁時計代表帯の下限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.sprintWall.absoluteMinMs` | 通常スプリント壁時計絶対下限 | `30000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.sprintWall.absoluteMinMs` ≤ `pacing.target.sprintWall.minTypicalMs` | 通常スプリントの1x壁時計換算に対する検証用の絶対下限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.sprintWall.maxTypicalMs` | 通常スプリント壁時計代表上限 | `120000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.sprintWall.minTypicalMs` ≤ `pacing.target.sprintWall.maxTypicalMs` | 通常・eliteスプリントの1x壁時計代表帯の上限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.target.sprintWall.minTypicalMs` | 通常スプリント壁時計代表下限 | `60000` | `milliseconds` | `0〜3600000（整数）` | `pacing.target.sprintWall.absoluteMinMs` ≤ `pacing.target.sprintWall.minTypicalMs`<br>`pacing.target.sprintWall.minTypicalMs` ≤ `pacing.target.sprintWall.maxTypicalMs` | 通常・eliteスプリントの1x壁時計代表帯の下限。 | pacing, validation, target-band, wall-clock | いいえ |
| `pacing.task.bossFloor.easy` | Easyボスタスク床 | `68` | `count` | `1〜1000（整数）` | — | Easyのボススプリントへ適用するタスク数の床。 | pacing, execution, boss, task-floor, difficulty-easy | いいえ |
| `pacing.task.bossFloor.hard` | Hardボスタスク床 | `52` | `count` | `1〜1000（整数）` | — | Hardのボススプリントへ適用するタスク数の床。 | pacing, execution, boss, task-floor, difficulty-hard | いいえ |
| `pacing.task.bossFloor.nightmare` | Nightmareボスタスク床 | `56` | `count` | `1〜1000（整数）` | — | Nightmareのボススプリントへ適用するタスク数の床。 | pacing, execution, boss, task-floor, difficulty-nightmare | いいえ |
| `pacing.task.bossFloor.normal` | Normalボスタスク床 | `58` | `count` | `1〜1000（整数）` | — | Normalのボススプリントへ適用するタスク数の床。 | pacing, execution, boss, task-floor, difficulty-normal | いいえ |
| `pacing.task.eliteMultiplier.easy` | Easy eliteタスク倍率 | `1.24` | `multiplier` | `0〜5` | — | Easyのeliteスプリントへ通常タスク床の後に掛ける倍率。 | pacing, execution, elite, difficulty-easy | いいえ |
| `pacing.task.eliteMultiplier.hard` | Hard eliteタスク倍率 | `1.09` | `multiplier` | `0〜5` | — | Hardのeliteスプリントへ通常タスク床の後に掛ける倍率。 | pacing, execution, elite, difficulty-hard | いいえ |
| `pacing.task.eliteMultiplier.nightmare` | Nightmare eliteタスク倍率 | `1.15` | `multiplier` | `0〜5` | — | Nightmareのeliteスプリントへ通常タスク床の後に掛ける倍率。 | pacing, execution, elite, difficulty-nightmare | いいえ |
| `pacing.task.eliteMultiplier.normal` | Normal eliteタスク倍率 | `1.12` | `multiplier` | `0〜5` | — | Normalのeliteスプリントへ通常タスク床の後に掛ける倍率。 | pacing, execution, elite, difficulty-normal | いいえ |
| `pacing.task.normalFloor.easy` | Easy通常タスク床 | `58` | `count` | `1〜1000（整数）` | — | Easyの通常・eliteスプリントへ適用する通常タスク数の床。 | pacing, execution, task-floor, difficulty-easy | いいえ |
| `pacing.task.normalFloor.hard` | Hard通常タスク床 | `42` | `count` | `1〜1000（整数）` | — | Hardの通常・eliteスプリントへ適用する通常タスク数の床。 | pacing, execution, task-floor, difficulty-hard | いいえ |
| `pacing.task.normalFloor.nightmare` | Nightmare通常タスク床 | `32` | `count` | `1〜1000（整数）` | — | Nightmareの通常・eliteスプリントへ適用する通常タスク数の床。 | pacing, execution, task-floor, difficulty-nightmare | いいえ |
| `pacing.task.normalFloor.normal` | Normal通常タスク床 | `50` | `count` | `1〜1000（整数）` | — | Normalの通常・eliteスプリントへ適用する通常タスク数の床。 | pacing, execution, task-floor, difficulty-normal | いいえ |
| `pacing.tick.boss.maximum` | ボス最大tick | `229` | `ticks` | `1〜10000（整数）` | `pacing.tick.boss.minComplete` < `pacing.tick.boss.maximum` | ボススプリントに適用する最大tick。 | pacing, execution, tick-boundary, boss | いいえ |
| `pacing.tick.boss.minComplete` | ボス最小完了tick | `115` | `ticks` | `0〜10000（整数）` | `pacing.tick.sprint.minComplete` < `pacing.tick.boss.minComplete`<br>`pacing.tick.boss.minComplete` < `pacing.tick.boss.maximum` | ボススプリントに適用する完了tickの下限。 | pacing, execution, tick-boundary, boss | いいえ |
| `pacing.tick.sprint.minComplete` | 通常スプリント最小完了tick | `77` | `ticks` | `0〜10000（整数）` | `pacing.tick.sprint.minComplete` < `pacing.tick.boss.minComplete` | 通常・eliteスプリントに適用する完了tickの下限。 | pacing, execution, tick-boundary, sprint | いいえ |
| `pacing.wallClock.msPerTick1x` | 1x tick壁時計時間 | `780` | `milliseconds` | `1〜60000（整数）` | — | 1x再生時に1 tickへ対応する壁時計時間。 | pacing, execution, wall-clock | いいえ |
| `process.ai.adoption` | AI 導入時の既定採用率 | `0.85` | `probability` | `0〜1` | — | AI 導入済みの組織で、各タスクが AI 支援を使う既定確率。 | process, ai | いいえ |
| `process.ai.deliveryValue.literacyWeight` | AI 出荷価値のリテラシー係数 | `0.85` | `multiplier` | `0〜2` | — | AI 支援タスクの出荷価値へ AI リテラシーに応じて加える係数。 | process, ai, delivery | いいえ |
| `process.ai.dependency.perTask` | AI 支援タスクごとの依存度増分 | `2.2` | `percent` | `0〜20` | — | AI 支援を割り当てたタスク 1 件ごとに増える AI 依存度。 | process, ai, dependency | いいえ |
| `process.ai.dependency.whenDisabled` | AI 無効時の初期依存度 | `3` | `percent` | `0〜100` | — | AI を導入しない組織に残る初期 AI 依存度。 | process, ai, dependency, organization | いいえ |
| `process.coding.aiSpeedup` | AI Coding 高速化倍率 | `2.6` | `multiplier` | `1〜5` | — | AI 支援タスクの Coding 所要 tick を短縮する倍率。 | process, coding, ai | いいえ |
| `process.coding.baseTicks` | Coding 基礎所要 tick | `7` | `ticks` | `1〜30（整数）` | — | 標準規模かつ AI 支援なしのタスクを実装する基礎所要 tick。 | process, coding | いいえ |
| `process.coding.sizeFactor.complex` | 複雑タスクの Coding 所要倍率 | `1.7` | `multiplier` | `0.1〜3` | — | 複雑タスクへ掛ける Coding 基礎所要 tick の倍率。 | process, coding, task | いいえ |
| `process.coding.sizeFactor.normal` | 通常タスクの Coding 所要倍率 | `1` | `multiplier` | `0.1〜3` | — | 通常タスクへ掛ける Coding 基礎所要 tick の倍率。 | process, coding, task | いいえ |
| `process.coding.sizeFactor.routine` | 定型タスクの Coding 所要倍率 | `0.7` | `multiplier` | `0.1〜3` | — | 定型タスクへ掛ける Coding 基礎所要 tick の倍率。 | process, coding, task | いいえ |
| `process.combo.bonusCap` | コンボ出荷ボーナスの上限 | `1.5` | `multiplier` | `0〜10` | — | コンボ出荷倍率へ上乗せできる最大量。 | process, combo, delivery | いいえ |
| `process.combo.bonusPer` | コンボ 1 段ごとの出荷ボーナス | `0.1` | `multiplier` | `0〜1` | — | コンボ 1 段ごとに出荷倍率へ加える量。 | process, combo, delivery | いいえ |
| `process.combo.minimumCount` | コンボ段数の下限 | `0` | `count` | `0〜100（整数）` | — | コンボ出荷倍率の計算に使うコンボ段数の下限。 | process, combo, boundary | いいえ |
| `process.delivery.highValueMultiplier` | 高価値タスクの出荷倍率 | `3` | `multiplier` | `0〜10` | — | 高価値タスクの基礎出荷ポイントへ掛ける倍率。 | process, delivery, task | いいえ |
| `process.delivery.taskValue.complex` | 複雑タスクの基礎出荷ポイント | `8` | `points` | `0〜100` | — | 複雑タスクを完了したときの基礎出荷ポイント。 | process, delivery, task | いいえ |
| `process.delivery.taskValue.normal` | 通常タスクの基礎出荷ポイント | `5` | `points` | `1〜100` | — | 通常タスクを完了したときの基礎出荷ポイント。 | process, delivery, task | いいえ |
| `process.delivery.taskValue.routine` | 定型タスクの基礎出荷ポイント | `3` | `points` | `0〜100` | — | 定型タスクを完了したときの基礎出荷ポイント。 | process, delivery, task | いいえ |
| `process.incident.aiLowLiteracyWeight` | AI 低リテラシー Incident 係数 | `0.05` | `multiplier` | `0〜1` | — | AI 支援タスクで AI リテラシー不足が Incident 確率へ加える係数。 | process, incident, ai | いいえ |
| `process.incident.autoContainHpCost` | Incident 自動鎮火 HP コスト | `12` | `points` | `0〜100` | — | 時間切れの Incident を自動鎮火するシニア HP コスト。 | process, incident, burning, senior-hp | いいえ |
| `process.incident.baseProbability` | Incident 基礎確率 | `0.02` | `probability` | `0〜1` | — | テストカバレッジや AI 補正を加える前の Incident 確率。 | process, incident | いいえ |
| `process.incident.burnTicks` | Incident 炎上猶予 tick | `35` | `ticks` | `1〜300（整数）` | — | 点火から自動鎮火または延焼までの猶予 tick。 | process, incident, burning | いいえ |
| `process.incident.burning.regenMultiplier` | 炎上中シニア HP 回復倍率 | `0.5` | `multiplier` | `0〜1` | — | Incident が燃えている間に掛けるシニア HP 自然回復の倍率。 | process, incident, burning, senior-hp | いいえ |
| `process.incident.burning.reviewSlowdown` | 炎上中 Review 処理量倍率 | `0.65` | `multiplier` | `0〜1` | — | Incident が燃えている間に掛ける Review 処理量の倍率。 | process, incident, burning, review | いいえ |
| `process.incident.customerTrust.minimumCount` | 顧客信頼計算の最小 Incident 数 | `0` | `count` | `0〜100（整数）` | — | Incident 数と延焼数を顧客信頼計算へ入れる際の下限。 | process, incident, customer-trust, boundary | いいえ |
| `process.incident.customerTrust.perIncidentRaw` | Incident ごとの顧客信頼 raw | `0.5` | `points` | `0〜20` | — | 延焼発生時に Incident 1 件ごとに積む顧客信頼 raw。 | process, incident, security, customer-trust | いいえ |
| `process.incident.customerTrust.perSpreadRaw` | 延焼ごとの顧客信頼 raw | `2` | `points` | `0〜20` | — | Security 脆弱度が最大のとき延焼 1 件で積む顧客信頼 raw。 | process, incident, security, customer-trust | いいえ |
| `process.incident.customerTrust.rawThreshold` | 顧客信頼 raw の反映閾値 | `0.5` | `points` | `0〜20` | — | 蓄積した顧客信頼 raw がこの値未満なら信頼を変化させない。 | process, incident, security, customer-trust, boundary | いいえ |
| `process.incident.maximum` | Incident 確率の上限 | `0.4` | `probability` | `0〜1` | `process.incident.minimum` ≤ `process.incident.maximum` | Incident 確率を clamp する上限。 | process, incident, boundary | いいえ |
| `process.incident.minimum` | Incident 確率の下限 | `0.01` | `probability` | `0〜1` | `process.incident.minimum` ≤ `process.incident.maximum` | Incident 確率を clamp する下限。 | process, incident, boundary | いいえ |
| `process.incident.spread.debt` | 延焼ごとの技術的負債 | `6` | `points` | `0〜100` | — | Incident が延焼した 1 件ごとに増える技術的負債。 | process, incident, burning, debt | いいえ |
| `process.incident.spread.moraleCost` | 延焼ごとの士気低下 | `5` | `points` | `0〜100` | — | Incident が延焼した 1 件ごとに失う士気。 | process, incident, burning, morale | いいえ |
| `process.incident.testCoverageWeight` | Incident のテストカバレッジ係数 | `0.1` | `multiplier` | `0〜1` | — | 不足したテストカバレッジが Incident 確率へ加える係数。 | process, incident, quality | いいえ |
| `process.overtime.codingMultiplier` | 残業号令中の Coding 倍率 | `1.4` | `multiplier` | `0〜5` | — | 残業号令の発動中に Coding 処理量へ掛ける倍率。 | process, overtime, coding, intervention | いいえ |
| `process.overtime.reviewMultiplier` | 残業号令中の Review 倍率 | `1.6` | `multiplier` | `0〜5` | — | 残業号令の発動中に Review 処理量へ掛ける倍率。 | process, overtime, review, intervention | いいえ |
| `process.review.basePerTick` | Review 基礎処理量 | `0.9` | `count` | `0〜5` | — | 満 HP のシニアが 1 tick に処理する基礎 PR 数。 | process, review | いいえ |
| `process.review.hpCost` | Review ごとのシニア HP 消費 | `1.6` | `points` | `0〜20` | — | Review を 1 件処理したときに消費するシニア HP。 | process, review, senior-hp | いいえ |
| `process.review.hpEfficiency.floor` | Review HP 効率の下限 | `0.3` | `multiplier` | `0.01〜1` | `process.review.hpEfficiency.floor` + `process.review.hpEfficiency.range` = 1 | シニア HP が 0 のときも残る Review 処理量の倍率。 | process, review, senior-hp | いいえ |
| `process.review.hpEfficiency.range` | Review HP 効率の変動幅 | `0.7` | `multiplier` | `0〜1` | `process.review.hpEfficiency.floor` + `process.review.hpEfficiency.range` = 1 | シニア HP に応じて Review 処理量へ加わる倍率の幅。 | process, review, senior-hp | いいえ |
| `process.review.hpRegen` | シニア HP 自然回復量 | `0.7` | `points` | `0〜20` | — | 炎上していない tick ごとに回復するシニア HP。 | process, review, senior-hp | いいえ |
| `process.rework.aiAssistedAdd` | AI 支援タスクの Rework 加算 | `0.05` | `probability` | `0〜1` | — | AI 支援タスクだけに加える Rework 確率。 | process, rework, ai | いいえ |
| `process.rework.aiDependencyWeight` | Rework の AI 依存度係数 | `0.32` | `multiplier` | `0〜1` | — | AI 依存度が Rework 確率へ加える係数。 | process, rework, ai, dependency | いいえ |
| `process.rework.aiLiteracyWeight` | Rework の AI リテラシー低減係数 | `0.18` | `multiplier` | `0〜1` | — | AI リテラシーが Rework 確率を低減する係数。 | process, rework, ai | いいえ |
| `process.rework.attemptDecay` | Rework 試行ごとの減衰倍率 | `0.5` | `multiplier` | `0〜1` | — | 再修正回数ごとに Rework 確率へ掛ける減衰倍率。 | process, rework | いいえ |
| `process.rework.baseProbability` | Rework 基礎確率 | `0.05` | `probability` | `0〜1` | — | 組織状態やタスク補正を加える前の Rework 確率。 | process, rework | いいえ |
| `process.rework.maxAttempts` | Rework 最大回数 | `3` | `count` | `0〜20（整数）` | — | 通常の Rework 判定を行うタスクごとの最大回数。 | process, rework | いいえ |
| `process.rework.maximum` | Rework 確率の上限 | `0.75` | `probability` | `0〜1` | `process.rework.minimum` ≤ `process.rework.maximum` | Rework 確率を clamp する上限。 | process, rework, boundary | いいえ |
| `process.rework.minimum` | Rework 確率の下限 | `0.02` | `probability` | `0〜1` | `process.rework.minimum` ≤ `process.rework.maximum` | Rework 確率を clamp する下限。 | process, rework, boundary | いいえ |
| `process.rework.qualityWeight` | Rework の品質低減係数 | `0.14` | `multiplier` | `0〜1` | — | 品質が Rework 確率を低減する係数。 | process, rework, quality | いいえ |
| `process.rework.splitReduction` | PR 分割時の Rework 低下量 | `0.16` | `probability` | `0〜1` | — | 分割したタスクの Rework 確率から引く量。 | process, rework, assignment | いいえ |
| `process.rework.ticks` | Rework 所要 tick | `4` | `ticks` | `1〜30（整数）` | — | 手戻りタスクを修正して Review へ戻すまでに要する tick。 | process, rework | いいえ |
| `process.security.fragility.maximum` | Security 脆弱度の上限 | `1` | `multiplier` | `0〜1` | `process.security.fragility.minimum` ≤ `process.security.fragility.maximum` | Security 脆弱度を clamp する上限。 | process, security, boundary | いいえ |
| `process.security.fragility.minimum` | Security 脆弱度の下限 | `0` | `multiplier` | `0〜0` | `process.security.fragility.minimum` ≤ `process.security.fragility.maximum` | Security 脆弱度を clamp する下限。 | process, security, boundary | いいえ |
| `process.security.fragility.threshold` | Security 脆弱度の無効化水準 | `50` | `percent` | `1〜100` | — | この Security 水準以上では脆弱度を 0 とする境界。 | process, security, boundary | いいえ |
| `process.security.incidentRateBonus` | Security 脆弱度の Incident 加算 | `0.05` | `probability` | `0〜1` | — | Security 脆弱度が最大のとき Incident 基礎率へ加える量。 | process, security, incident | いいえ |
| `process.security.level.maximum` | Security 水準の上限 | `100` | `percent` | `0〜100（整数）` | `process.security.level.minimum` ≤ `process.security.level.maximum`<br>`process.security.rivalLevel.minimum` ≤ `process.security.level.maximum` | Security 水準を clamp する上限。 | process, security, boundary | いいえ |
| `process.security.level.minimum` | Security 水準の下限 | `0` | `percent` | `0〜100（整数）` | `process.security.level.minimum` ≤ `process.security.level.maximum` | Security 水準を clamp する下限。 | process, security, boundary | いいえ |
| `process.security.rivalLevel.minimum` | 追加チーム Security 水準の下限 | `20` | `percent` | `0〜100（整数）` | `process.security.rivalLevel.minimum` ≤ `process.security.level.maximum` | 採用・組織再編で追加するチームの Security 水準に保つ従来の下限。 | process, security, team, boundary | いいえ |
| `process.security.spreadMultiplierAdd` | Security 脆弱度の延焼コスト倍率加算 | `0.6` | `multiplier` | `0〜5` | — | Security 脆弱度が最大のとき延焼コスト倍率へ加える量。 | process, security, incident, burning | いいえ |
| `process.stability.comboCap` | 運用安定中のコンボ基準段数 | `8` | `count` | `0〜100（整数）` | — | 運用安定中に通常の連続出荷ボーナスを保つ最大コンボ段数。 | process, stability, combo | いいえ |
| `process.stability.comboTailMultiplier` | 運用安定中のコンボ超過倍率 | `0.5` | `multiplier` | `0〜1` | — | 運用安定中に基準を超えたコンボ上振れへ掛ける倍率。 | process, stability, combo | いいえ |
| `process.stability.highValueComboThreshold` | 運用安定中の高価値抑制コンボ閾値 | `8` | `count` | `0〜100（整数）` | — | 運用安定中に高価値タスクの出荷を抑え始めるコンボ段数。 | process, stability, combo, delivery | いいえ |
| `process.stability.highValueMultiplier` | 運用安定中の高価値出荷倍率 | `0.7` | `multiplier` | `0〜1` | — | 高価値抑制コンボ閾値を超えたときの出荷価値倍率。 | process, stability, combo, delivery | いいえ |
| `process.stability.reworkMultiplier` | 運用安定中の Rework 倍率 | `0.4` | `multiplier` | `0〜1` | — | 運用安定中に Rework 確率へ掛ける倍率。 | process, stability, rework | いいえ |
| `process.stability.ticks` | 運用安定の持続 tick | `180` | `ticks` | `0〜1000（整数）` | — | 安全側の介入後に工程が安定する期間。 | process, stability, intervention | いいえ |
| `run.draft.mulliganCost` | ドラフト引き直し費用 | `8` | `currency` | `0〜1000（整数）` | — | ドラフト候補を一度だけ引き直すために消費する予算。 | run, draft, shop, currency | いいえ |
| `run.event.decisionBeatChance` | decision ビート率 | `0.55` | `probability` | `0〜1` | — | 各ビートで decision イベントを先に抽選する確率。 | run, event, probability | いいえ |
| `run.event.softOutcome.loseThreshold` | soft 結果の敗北閾値 | `1` | `points` | `1〜1（整数）` | `run.event.softOutcome.loseThreshold` < `run.event.softOutcome.survivalFloor` | soft 結果適用後に直後の敗北判定を避けるために使う、HP・士気の敗北閾値。 | run, event, soft-outcome, threshold | いいえ |
| `run.event.softOutcome.survivalFloor` | soft 結果の生存床 | `2` | `points` | `0〜100（整数）` | `run.event.softOutcome.loseThreshold` < `run.event.softOutcome.survivalFloor` | soft 結果適用後に HP・士気を戻す最小値。敗北閾値より大きくする。 | run, event, soft-outcome, threshold | いいえ |
| `run.evolution.points.base` | 進化ポイント基礎値 | `1` | `points` | `0〜100（整数）` | — | 通常スプリント完了時に付与する進化ポイントの基礎値。 | run, evolution, points | いいえ |
| `run.evolution.points.deliveredDivisor` | 進化ポイントの出荷除数 | `40` | `points` | `1〜1000（整数）` | — | 出荷量を整数除算して進化ポイントへ加算する際の除数。 | run, evolution, points, delivery | いいえ |
| `run.evolution.points.eliteBonus` | elite 進化ポイント加算 | `1` | `points` | `0〜100（整数）` | — | elite スプリント完了時に基礎値へ加える進化ポイント。 | run, evolution, points, elite | いいえ |
| `run.infrastructure.baseCostPerDependency` | インフラ基本単価 | `0.22` | `currency` | `0〜10` | — | AI 依存度 1 単位あたりのインフラ／モデル利用基本単価。 | run, infrastructure, currency | いいえ |
| `run.infrastructure.minimumBillableRaw` | インフラ最低課金 raw 閾値 | `1` | `currency` | `0〜100` | — | raw コストがこの値未満なら無料、それ以外は切り上げて課金する境界。 | run, infrastructure, currency, threshold | いいえ |
| `run.quarter.sprintsPerQuarter` | 四半期スプリント数 | `6` | `count` | `1〜20（整数）` | — | 1 四半期に配置するスプリント数。最終スプリントはボスになる。 | run, quarter, progression | いいえ |
| `run.rest.focusMaxAdd` | 休息の集中力上限加算 | `2` | `points` | `0〜100（整数）` | — | 休息でカードを upgrade したときに次スプリントへ加える集中力上限。 | run, rest, focus | いいえ |
| `run.rest.moraleHeal` | 休息の士気回復量 | `10` | `points` | `0〜100（整数）` | — | 休息で heal を選んだときに回復する組織士気。 | run, rest, morale | いいえ |
| `run.rest.reworkReduction` | 休息の手戻り削減量 | `0.08` | `ratio` | `0〜1` | — | 休息で repay を選んだときに次スプリントへ加える手戻り率の削減量。 | run, rest, rework | いいえ |
| `run.rest.seniorHpHeal` | 休息のシニア HP 回復量 | `40` | `points` | `0〜100（整数）` | — | 休息で heal を選んだときに回復するシニア HP の基礎値。 | run, rest, senior-hp | いいえ |
| `run.rest.techDebtRepay` | 休息の技術的負債返済量 | `30` | `points` | `0〜1000（整数）` | — | 休息で repay を選んだときに減らす技術的負債。 | run, rest, tech-debt | いいえ |
| `run.shop.discountMaximum` | ショップ割引上限 | `0.8` | `ratio` | `0〜1` | — | レリックのパッシブを合算したショップ割引率の上限。 | run, shop, discount | いいえ |
| `run.shop.minimumPrice` | ショップ最低価格 | `1` | `currency` | `1〜100（整数）` | — | 割引後のカード・レリック価格に適用する下限。 | run, shop, currency, threshold | いいえ |
| `run.shop.relicCost` | レリック価格 | `12` | `currency` | `0〜1000（整数）` | — | ショップで提示するレリックの割引前価格。 | run, shop, relic, currency | いいえ |
| `run.shop.relicSlots` | レリック枠 | `6` | `count` | `0〜20（整数）` | — | レリックを保持できる既定の枠数。 | run, shop, relic | いいえ |
| `sprint.completion.moraleGain` | 出荷完了時の士気増分 | `0.5` | `points` | `0〜10` | — | Review から通常出荷したときに増える士気。強制出荷では適用しない。 | sprint, completion, morale | いいえ |
| `sprint.grade.penalty.hpLossFree` | 評価のシニアHP損失無視幅 | `20` | `points` | `0〜100（整数）` | — | この値までのシニアHP損失は評価ペナルティに含めない。 | sprint, grade, senior | いいえ |
| `sprint.grade.penalty.hpLossMultiplier` | 評価のシニアHP超過ペナルティ係数 | `0.7` | `multiplier` | `0〜5` | — | 無視幅を超えたシニアHP損失へ掛ける評価ペナルティ係数。 | sprint, grade, senior | いいえ |
| `sprint.grade.penalty.incident` | 評価の Incident ペナルティ | `6` | `points` | `0〜50（整数）` | — | スプリント評価の健全比から差し引く、Incident 1 件あたりのペナルティ。 | sprint, grade, incident | いいえ |
| `sprint.grade.penalty.rework` | 評価の Rework ペナルティ | `5` | `points` | `0〜50（整数）` | — | スプリント評価の健全比から差し引く、Rework 1 件あたりのペナルティ。 | sprint, grade, rework | いいえ |
| `sprint.grade.penalty.spread` | 評価の延焼ペナルティ | `10` | `points` | `0〜50（整数）` | — | スプリント評価の健全比から差し引く、延焼 1 回あたりのペナルティ。 | sprint, grade, incident | いいえ |
| `sprint.grade.stabilizingBonusCap` | 安定介入ボーナスの上限 | `0.015` | `ratio` | `0〜1` | `sprint.grade.stabilizingBonusPerGrant` ≤ `sprint.grade.stabilizingBonusCap` | 介入連打だけで評価 S へ届かないよう、安定ボーナスをこの値で上限する。 | sprint, grade, action | いいえ |
| `sprint.grade.stabilizingBonusPerGrant` | 安定介入1回あたりの評価ボーナス | `0.0045` | `ratio` | `0〜1` | `sprint.grade.stabilizingBonusPerGrant` ≤ `sprint.grade.stabilizingBonusCap` | 実際に運用安定を付与した介入1回あたり、健全比へ加えるボーナス。 | sprint, grade, action | いいえ |
| `sprint.grade.threshold.A` | 評価 A の健全比境界 | `0.8` | `ratio` | `0〜1` | `sprint.grade.threshold.B` < `sprint.grade.threshold.A`<br>`sprint.grade.threshold.A` < `sprint.grade.threshold.S` | 健全比がこの値以上、S 未満なら評価 A。 | sprint, grade | いいえ |
| `sprint.grade.threshold.B` | 評価 B の健全比境界 | `0.62` | `ratio` | `0〜1` | `sprint.grade.threshold.C` < `sprint.grade.threshold.B`<br>`sprint.grade.threshold.B` < `sprint.grade.threshold.A` | 健全比がこの値以上、A 未満なら評価 B。 | sprint, grade | いいえ |
| `sprint.grade.threshold.C` | 評価 C の健全比境界 | `0.4` | `ratio` | `0〜1` | `sprint.grade.threshold.C` < `sprint.grade.threshold.B` | 健全比がこの値以上、B 未満なら評価 C。未満は D。 | sprint, grade | いいえ |
| `sprint.grade.threshold.S` | 評価 S の健全比境界 | `0.955` | `ratio` | `0〜1` | `sprint.grade.threshold.A` < `sprint.grade.threshold.S` | 健全比がこの値以上なら評価 S。 | sprint, grade | いいえ |
| `sprint.task.highValueRate` | 高価値タスクの出現率 | `0.12` | `probability` | `0〜1` | — | 新規タスクが高価値になる確率。出荷倍率そのものは工程モデル側の値を使う。 | sprint, task, delivery | いいえ |
| `sprint.task.kindWeight.complex` | 複雑タスクの出現比 | `0.25` | `probability` | `0〜1` | — | スプリント開始時に複雑タスクを抽選する重み。 | sprint, task, distribution | いいえ |
| `sprint.task.kindWeight.normal` | 通常タスクの出現比 | `0.45` | `probability` | `0〜1` | — | スプリント開始時に通常タスクを抽選する重み。 | sprint, task, distribution | いいえ |
| `sprint.task.kindWeight.routine` | 定型タスクの出現比 | `0.3` | `probability` | `0〜1` | — | スプリント開始時に定型タスクを抽選する重み。粗粒度の定型速度補正にも使う。 | sprint, task, distribution, coarse | いいえ |
| `sprint.title.comboMasterMin` | コンボ職人の最大コンボ | `15` | `count` | `1〜50（整数）` | — | 最大コンボがこの値以上、かつ Rework 比が対応上限未満なら称号「コンボ職人」。 | sprint, title, combo | いいえ |
| `sprint.title.comboMasterReworkMax` | コンボ職人のRework比上限 | `0.15` | `ratio` | `0〜1` | — | Rework 比がこの値未満、かつ最大コンボが対応閾値以上なら称号「コンボ職人」。 | sprint, title, combo, rework | いいえ |
| `sprint.title.firefighterContains` | 火消しの達人の鎮火回数 | `3` | `count` | `1〜20（整数）` | — | コンボを壊さない鎮火回数がこの値以上なら称号「火消しの達人」の候補。 | sprint, title, incident | いいえ |
| `sprint.title.firefighterIncidents` | 火消しの達人のIncident件数 | `3` | `count` | `1〜20（整数）` | — | Incident 件数がこの値以上、かつ延焼なしなら称号「火消しの達人」。 | sprint, title, incident | いいえ |
| `sprint.title.healthyIncidentMax` | 健全な加速者のIncident上限 | `1` | `count` | `0〜20（整数）` | — | AI 利用ありで Incident 件数がこの値以下、かつ Rework が対応上限以下なら称号「健全な加速者」。 | sprint, title, incident, ai | いいえ |
| `sprint.title.healthyReworkMax` | 健全な加速者のRework上限 | `2` | `count` | `0〜20（整数）` | — | AI 利用ありで Rework 件数がこの値以下、かつ Incident が対応上限以下なら称号「健全な加速者」。 | sprint, title, rework, ai | いいえ |
| `sprint.title.noOvertimeHpLossMax` | ノー残業の勇者のHP損失上限 | `35` | `points` | `0〜100（整数）` | — | AI 未使用でシニアHP損失がこの値未満なら称号「ノー残業の勇者」の候補。 | sprint, title, senior | いいえ |
| `sprint.title.noOvertimeIncidentMax` | ノー残業の勇者のIncident上限 | `2` | `count` | `0〜20（整数）` | — | AI 未使用で Incident 件数がこの値以下なら称号「ノー残業の勇者」の候補。 | sprint, title, incident | いいえ |
| `sprint.title.noOvertimeReworkMax` | ノー残業の勇者のRework比上限 | `0.2` | `ratio` | `0〜1` | — | AI 未使用で Rework 比がこの値未満なら称号「ノー残業の勇者」の候補。 | sprint, title, rework | いいえ |
| `sprint.title.reviewHellAiPct` | PRを増やす者のAI利用率 | `50` | `percent` | `0〜100（整数）` | — | AI 利用率がこの値以上、かつ Review 待ち最大件数が対応閾値以上なら称号「PRを増やす者」。 | sprint, title, review, ai | いいえ |
| `sprint.title.reviewHellQueueMax` | PRを増やす者のReview滞留 | `12` | `count` | `1〜50（整数）` | — | Review 待ち最大件数がこの値以上、かつ AI 利用率が対応閾値以上なら称号「PRを増やす者」。 | sprint, title, review, ai | いいえ |
| `sprint.title.reworkArtisanRatio` | Rework職人の手戻り比 | `0.35` | `ratio` | `0〜1` | — | 完了件数に対する Rework 比がこの値以上なら称号「Rework職人」。 | sprint, title, rework | いいえ |
| `sprint.title.seniorBurnoutHpLoss` | シニア過労メーカーのHP損失 | `55` | `points` | `1〜100（整数）` | — | シニアHP損失がこの値以上なら称号「シニア過労メーカー」。 | sprint, title, senior | いいえ |
| `sprint.title.spreadMinimum` | 静かな崩壊の延焼回数 | `2` | `count` | `1〜20（整数）` | — | 延焼回数がこの値以上なら称号「静かな崩壊」。 | sprint, title, incident | いいえ |
| `sprint.title.unstableIncidents` | 爆速だが不安定のIncident件数 | `3` | `count` | `1〜20（整数）` | — | AI 利用ありで Incident 件数がこの値以上なら称号「爆速だが不安定」。 | sprint, title, incident, ai | いいえ |
