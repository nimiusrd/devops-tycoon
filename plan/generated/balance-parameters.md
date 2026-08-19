# バランスパラメータ一覧

> **このファイルは自動生成です。直接編集しないでください。**
> 更新するには `npm run balance:docs` を実行してください。

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
