# バランスパラメータ一覧

> **このファイルは自動生成です。直接編集しないでください。**
> 更新するには `npm run balance:docs` を実行してください。

| ID | ラベル | 現在値 | 単位 | 許容範囲 | 説明 | タグ | 派生値 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `process.ai.adoption` | AI 導入時の既定採用率 | `0.85` | `probability` | `0〜1` | AI 導入済みの組織で、各タスクが AI 支援を使う既定確率。 | process, ai | いいえ |
| `process.ai.deliveryValue.literacyWeight` | AI 出荷価値のリテラシー係数 | `0.85` | `multiplier` | `0〜2` | AI 支援タスクの出荷価値へ AI リテラシーに応じて加える係数。 | process, ai, delivery | いいえ |
| `process.ai.dependency.perTask` | AI 支援タスクごとの依存度増分 | `2.2` | `percent` | `0〜20` | AI 支援を割り当てたタスク 1 件ごとに増える AI 依存度。 | process, ai, dependency | いいえ |
| `process.ai.dependency.whenDisabled` | AI 無効時の初期依存度 | `3` | `percent` | `0〜100` | AI を導入しない組織に残る初期 AI 依存度。 | process, ai, dependency, organization | いいえ |
| `process.coding.aiSpeedup` | AI Coding 高速化倍率 | `2.6` | `multiplier` | `1〜5` | AI 支援タスクの Coding 所要 tick を短縮する倍率。 | process, coding, ai | いいえ |
| `process.coding.baseTicks` | Coding 基礎所要 tick | `7` | `ticks` | `1〜30（整数）` | 標準規模かつ AI 支援なしのタスクを実装する基礎所要 tick。 | process, coding | いいえ |
| `process.coding.sizeFactor.complex` | 複雑タスクの Coding 所要倍率 | `1.7` | `multiplier` | `0.1〜3` | 複雑タスクへ掛ける Coding 基礎所要 tick の倍率。 | process, coding, task | いいえ |
| `process.coding.sizeFactor.normal` | 通常タスクの Coding 所要倍率 | `1` | `multiplier` | `0.1〜3` | 通常タスクへ掛ける Coding 基礎所要 tick の倍率。 | process, coding, task | いいえ |
| `process.coding.sizeFactor.routine` | 定型タスクの Coding 所要倍率 | `0.7` | `multiplier` | `0.1〜3` | 定型タスクへ掛ける Coding 基礎所要 tick の倍率。 | process, coding, task | いいえ |
| `process.combo.bonusCap` | コンボ出荷ボーナスの上限 | `1.5` | `multiplier` | `0〜10` | コンボ出荷倍率へ上乗せできる最大量。 | process, combo, delivery | いいえ |
| `process.combo.bonusPer` | コンボ 1 段ごとの出荷ボーナス | `0.1` | `multiplier` | `0〜1` | コンボ 1 段ごとに出荷倍率へ加える量。 | process, combo, delivery | いいえ |
| `process.combo.minimumCount` | コンボ段数の下限 | `0` | `count` | `0〜100` | コンボ出荷倍率の計算に使うコンボ段数の下限。 | process, combo, boundary | いいえ |
| `process.delivery.highValueMultiplier` | 高価値タスクの出荷倍率 | `3` | `multiplier` | `0〜10` | 高価値タスクの基礎出荷ポイントへ掛ける倍率。 | process, delivery, task | いいえ |
| `process.delivery.taskValue.complex` | 複雑タスクの基礎出荷ポイント | `8` | `points` | `0〜100` | 複雑タスクを完了したときの基礎出荷ポイント。 | process, delivery, task | いいえ |
| `process.delivery.taskValue.normal` | 通常タスクの基礎出荷ポイント | `5` | `points` | `1〜100` | 通常タスクを完了したときの基礎出荷ポイント。 | process, delivery, task | いいえ |
| `process.delivery.taskValue.routine` | 定型タスクの基礎出荷ポイント | `3` | `points` | `0〜100` | 定型タスクを完了したときの基礎出荷ポイント。 | process, delivery, task | いいえ |
| `process.incident.aiLowLiteracyWeight` | AI 低リテラシー Incident 係数 | `0.05` | `multiplier` | `0〜1` | AI 支援タスクで AI リテラシー不足が Incident 確率へ加える係数。 | process, incident, ai | いいえ |
| `process.incident.autoContainHpCost` | Incident 自動鎮火 HP コスト | `12` | `points` | `0〜100` | 時間切れの Incident を自動鎮火するシニア HP コスト。 | process, incident, burning, senior-hp | いいえ |
| `process.incident.baseProbability` | Incident 基礎確率 | `0.02` | `probability` | `0〜1` | テストカバレッジや AI 補正を加える前の Incident 確率。 | process, incident | いいえ |
| `process.incident.burnTicks` | Incident 炎上猶予 tick | `35` | `ticks` | `1〜300（整数）` | 点火から自動鎮火または延焼までの猶予 tick。 | process, incident, burning | いいえ |
| `process.incident.burning.regenMultiplier` | 炎上中シニア HP 回復倍率 | `0.5` | `multiplier` | `0〜1` | Incident が燃えている間に掛けるシニア HP 自然回復の倍率。 | process, incident, burning, senior-hp | いいえ |
| `process.incident.burning.reviewSlowdown` | 炎上中 Review 処理量倍率 | `0.65` | `multiplier` | `0〜1` | Incident が燃えている間に掛ける Review 処理量の倍率。 | process, incident, burning, review | いいえ |
| `process.incident.customerTrust.minimumCount` | 顧客信頼計算の最小 Incident 数 | `0` | `count` | `0〜100（整数）` | Incident 数と延焼数を顧客信頼計算へ入れる際の下限。 | process, incident, customer-trust, boundary | いいえ |
| `process.incident.customerTrust.perIncidentRaw` | Incident ごとの顧客信頼 raw | `0.5` | `points` | `0〜20` | 延焼発生時に Incident 1 件ごとに積む顧客信頼 raw。 | process, incident, security, customer-trust | いいえ |
| `process.incident.customerTrust.perSpreadRaw` | 延焼ごとの顧客信頼 raw | `2` | `points` | `0〜20` | Security 脆弱度が最大のとき延焼 1 件で積む顧客信頼 raw。 | process, incident, security, customer-trust | いいえ |
| `process.incident.customerTrust.rawThreshold` | 顧客信頼 raw の反映閾値 | `0.5` | `points` | `0〜20` | 蓄積した顧客信頼 raw がこの値未満なら信頼を変化させない。 | process, incident, security, customer-trust, boundary | いいえ |
| `process.incident.maximum` | Incident 確率の上限 | `0.4` | `probability` | `0〜1` | Incident 確率を clamp する上限。 | process, incident, boundary | いいえ |
| `process.incident.minimum` | Incident 確率の下限 | `0.01` | `probability` | `0〜1` | Incident 確率を clamp する下限。 | process, incident, boundary | いいえ |
| `process.incident.spread.debt` | 延焼ごとの技術的負債 | `6` | `points` | `0〜100` | Incident が延焼した 1 件ごとに増える技術的負債。 | process, incident, burning, debt | いいえ |
| `process.incident.spread.moraleCost` | 延焼ごとの士気低下 | `5` | `points` | `0〜100` | Incident が延焼した 1 件ごとに失う士気。 | process, incident, burning, morale | いいえ |
| `process.incident.testCoverageWeight` | Incident のテストカバレッジ係数 | `0.1` | `multiplier` | `0〜1` | 不足したテストカバレッジが Incident 確率へ加える係数。 | process, incident, quality | いいえ |
| `process.overtime.codingMultiplier` | 残業号令中の Coding 倍率 | `1.4` | `multiplier` | `0〜5` | 残業号令の発動中に Coding 処理量へ掛ける倍率。 | process, overtime, coding, intervention | いいえ |
| `process.overtime.reviewMultiplier` | 残業号令中の Review 倍率 | `1.6` | `multiplier` | `0〜5` | 残業号令の発動中に Review 処理量へ掛ける倍率。 | process, overtime, review, intervention | いいえ |
| `process.review.basePerTick` | Review 基礎処理量 | `0.9` | `count` | `0〜5` | 満 HP のシニアが 1 tick に処理する基礎 PR 数。 | process, review | いいえ |
| `process.review.hpCost` | Review ごとのシニア HP 消費 | `1.6` | `points` | `0〜20` | Review を 1 件処理したときに消費するシニア HP。 | process, review, senior-hp | いいえ |
| `process.review.hpEfficiency.floor` | Review HP 効率の下限 | `0.3` | `multiplier` | `0〜1` | シニア HP が 0 のときも残る Review 処理量の倍率。 | process, review, senior-hp | いいえ |
| `process.review.hpEfficiency.range` | Review HP 効率の変動幅 | `0.7` | `multiplier` | `0〜1` | シニア HP に応じて Review 処理量へ加わる倍率の幅。 | process, review, senior-hp | いいえ |
| `process.review.hpRegen` | シニア HP 自然回復量 | `0.7` | `points` | `0〜20` | 炎上していない tick ごとに回復するシニア HP。 | process, review, senior-hp | いいえ |
| `process.rework.aiAssistedAdd` | AI 支援タスクの Rework 加算 | `0.05` | `probability` | `0〜1` | AI 支援タスクだけに加える Rework 確率。 | process, rework, ai | いいえ |
| `process.rework.aiDependencyWeight` | Rework の AI 依存度係数 | `0.32` | `multiplier` | `0〜1` | AI 依存度が Rework 確率へ加える係数。 | process, rework, ai, dependency | いいえ |
| `process.rework.aiLiteracyWeight` | Rework の AI リテラシー低減係数 | `0.18` | `multiplier` | `0〜1` | AI リテラシーが Rework 確率を低減する係数。 | process, rework, ai | いいえ |
| `process.rework.attemptDecay` | Rework 試行ごとの減衰倍率 | `0.5` | `multiplier` | `0〜1` | 再修正回数ごとに Rework 確率へ掛ける減衰倍率。 | process, rework | いいえ |
| `process.rework.baseProbability` | Rework 基礎確率 | `0.05` | `probability` | `0〜1` | 組織状態やタスク補正を加える前の Rework 確率。 | process, rework | いいえ |
| `process.rework.maxAttempts` | Rework 最大回数 | `3` | `count` | `0〜20（整数）` | 通常の Rework 判定を行うタスクごとの最大回数。 | process, rework | いいえ |
| `process.rework.maximum` | Rework 確率の上限 | `0.75` | `probability` | `0〜1` | Rework 確率を clamp する上限。 | process, rework, boundary | いいえ |
| `process.rework.minimum` | Rework 確率の下限 | `0.02` | `probability` | `0〜1` | Rework 確率を clamp する下限。 | process, rework, boundary | いいえ |
| `process.rework.qualityWeight` | Rework の品質低減係数 | `0.14` | `multiplier` | `0〜1` | 品質が Rework 確率を低減する係数。 | process, rework, quality | いいえ |
| `process.rework.splitReduction` | PR 分割時の Rework 低下量 | `0.16` | `probability` | `0〜1` | 分割したタスクの Rework 確率から引く量。 | process, rework, assignment | いいえ |
| `process.rework.ticks` | Rework 所要 tick | `4` | `ticks` | `1〜30（整数）` | 手戻りタスクを修正して Review へ戻すまでに要する tick。 | process, rework | いいえ |
| `process.security.fragility.maximum` | Security 脆弱度の上限 | `1` | `multiplier` | `0〜1` | Security 脆弱度を clamp する上限。 | process, security, boundary | いいえ |
| `process.security.fragility.minimum` | Security 脆弱度の下限 | `0` | `multiplier` | `0〜0` | Security 脆弱度を clamp する下限。 | process, security, boundary | いいえ |
| `process.security.fragility.threshold` | Security 脆弱度の無効化水準 | `50` | `percent` | `1〜100` | この Security 水準以上では脆弱度を 0 とする境界。 | process, security, boundary | いいえ |
| `process.security.incidentRateBonus` | Security 脆弱度の Incident 加算 | `0.05` | `probability` | `0〜1` | Security 脆弱度が最大のとき Incident 基礎率へ加える量。 | process, security, incident | いいえ |
| `process.security.level.maximum` | Security 水準の上限 | `100` | `percent` | `0〜100` | Security 水準を clamp する上限。 | process, security, boundary | いいえ |
| `process.security.level.minimum` | Security 水準の下限 | `0` | `percent` | `0〜100` | Security 水準を clamp する下限。 | process, security, boundary | いいえ |
| `process.security.spreadMultiplierAdd` | Security 脆弱度の延焼コスト倍率加算 | `0.6` | `multiplier` | `0〜5` | Security 脆弱度が最大のとき延焼コスト倍率へ加える量。 | process, security, incident, burning | いいえ |
| `process.stability.comboCap` | 運用安定中のコンボ基準段数 | `8` | `count` | `0〜100` | 運用安定中に通常の連続出荷ボーナスを保つ最大コンボ段数。 | process, stability, combo | いいえ |
| `process.stability.comboTailMultiplier` | 運用安定中のコンボ超過倍率 | `0.5` | `multiplier` | `0〜1` | 運用安定中に基準を超えたコンボ上振れへ掛ける倍率。 | process, stability, combo | いいえ |
| `process.stability.highValueComboThreshold` | 運用安定中の高価値抑制コンボ閾値 | `8` | `count` | `0〜100` | 運用安定中に高価値タスクの出荷を抑え始めるコンボ段数。 | process, stability, combo, delivery | いいえ |
| `process.stability.highValueMultiplier` | 運用安定中の高価値出荷倍率 | `0.7` | `multiplier` | `0〜1` | 高価値抑制コンボ閾値を超えたときの出荷価値倍率。 | process, stability, combo, delivery | いいえ |
| `process.stability.reworkMultiplier` | 運用安定中の Rework 倍率 | `0.4` | `multiplier` | `0〜1` | 運用安定中に Rework 確率へ掛ける倍率。 | process, stability, rework | いいえ |
| `process.stability.ticks` | 運用安定の持続 tick | `180` | `ticks` | `0〜1000（整数）` | 安全側の介入後に工程が安定する期間。 | process, stability, intervention | いいえ |
