# Content Catalog

<!-- このファイルは `npm run balance:docs` で生成されます。手動編集しないでください。 -->

実行結果に影響するコンテンツ定義の射影です。表示用の名称・説明・色・アイコンは含みません。

## rarityWeights

### common

```json
6
```

### rare

```json
3
```

### legendary

```json
1
```

## cards

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | copilot | {"base":{"aiDependencyAdd":5,"codingSpeedMul":1.15,"routineSpeedMul":1.3,"securityAdd":-5},"cost":1,"focusCost":2,"rarity":"common"} |
| 1 | claude-code | {"base":{"codingSpeedMul":1.2,"reviewEfficiencyMul":0.9,"reworkRateAdd":-0.05,"securityAdd":-4},"cost":4,"focusCost":3,"rarity":"rare"} |
| 2 | devin | {"base":{"aiDependencyAdd":8,"codingSpeedMul":1.25,"reworkRateAdd":0.06,"securityAdd":-8},"cost":35,"focusCost":4,"rarity":"legendary"} |
| 3 | auto-test | {"base":{"codingSpeedMul":0.95,"incidentRateMul":0.8,"qualityAdd":10,"reworkRateAdd":-0.15,"securityAdd":8},"cost":18,"focusCost":3,"rarity":"common"} |
| 4 | pr-size-limit | {"base":{"reviewEfficiencyMul":1.15,"reworkRateAdd":-0.05},"cost":8,"focusCost":2,"rarity":"common"} |
| 5 | ai-guideline | {"base":{"aiDependencyAdd":-18,"aiLiteracyAdd":20,"infraCostMul":0.75,"reworkRateAdd":-0.08},"cost":12,"focusCost":3,"rarity":"rare"} |
| 6 | docs | {"base":{"codingSpeedMul":0.92,"incidentRateMul":0.9,"qualityAdd":5,"securityAdd":5},"cost":15,"focusCost":2,"rarity":"common"} |
| 7 | hire-senior | {"base":{"qualityAdd":12,"reviewCapacityMul":1.3},"cost":40,"focusCost":4,"rarity":"rare"} |
| 8 | review-bot | {"base":{"reviewEfficiencyMul":1.2},"cost":22,"focusCost":3,"rarity":"rare"} |
| 9 | static-analysis | {"base":{"codingSpeedMul":0.97,"qualityAdd":6,"reworkRateAdd":-0.08,"securityAdd":4},"cost":12,"focusCost":2,"rarity":"common"} |
| 10 | feature-flags | {"base":{"codingSpeedMul":1.05,"incidentRateMul":0.85},"cost":1,"focusCost":2,"rarity":"common"} |
| 11 | code-owners | {"base":{"reviewEfficiencyMul":1.18,"reworkRateAdd":-0.04},"cost":16,"focusCost":3,"rarity":"rare"} |
| 12 | pair-programming | {"base":{"codingSpeedMul":0.93,"qualityAdd":4,"reworkRateAdd":-0.07},"cost":10,"focusCost":2,"rarity":"common"} |

## events

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | urgent-demo | {"choices":[{"leadsTo":"sprint","outcome":{"delivered":30,"morale":-15,"seniorHp":-10}},{"leadsTo":"sprint","outcome":{"delivered":10,"techDebt":5}},{"leadsTo":"sprint","outcome":{"grantRelic":"expectation-mgmt","trust":{"management":-8}}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1} |
| 1 | ai-test-gen | {"choices":[{"leadsTo":"sprint","outcome":{"seniorHp":-6,"testCoverage":12}},{"leadsTo":"sprint","outcome":{"techDebt":4,"testCoverage":6}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1} |
| 2 | giant-pr | {"choices":[{"leadsTo":"sprint","outcome":{"quality":4,"seniorHp":-14}},{"leadsTo":"sprint","outcome":{"grantRelic":"small-pr","morale":-6}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1} |
| 3 | junior-awaken | {"choices":[{"leadsTo":"sprint","outcome":{"aiLiteracy":12,"morale":8}},{"leadsTo":"sprint","outcome":{"aiLiteracy":8,"grantCard":"ai-guideline"}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1} |
| 4 | kpi-trap | {"choices":[{"leadsTo":"sprint","outcome":{"aiDependency":12,"delivered":20,"quality":-6}},{"leadsTo":"sprint","outcome":{"grantRelic":"primary-source","morale":6}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1} |
| 5 | postmortem-culture | {"choices":[{"leadsTo":"sprint","outcome":{"budget":-10,"grantRelic":"postmortem"}},{"leadsTo":"sprint","outcome":{"budget":8}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1} |
| 6 | emoji-policy-summit | {"choices":[{"leadsTo":"sprint","outcome":{"morale":3,"quality":2}},{"leadsTo":"sprint","outcome":{"morale":6,"techDebt":2}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":0.7} |
| 7 | standup-acronym-storm | {"choices":[{"leadsTo":"sprint","outcome":{"aiLiteracy":2,"quality":2}},{"leadsTo":"sprint","outcome":{"morale":4,"techDebt":2}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":0.55} |
| 8 | elite-offer | {"choices":[{"leadsTo":"sprint-elite","outcome":{}},{"leadsTo":"sprint","outcome":{"trust":{"management":-4}}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":2} |
| 9 | shop-offer | {"choices":[{"leadsTo":"shop","outcome":{}},{"leadsTo":"sprint","outcome":{}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":2} |
| 10 | rest-offer | {"choices":[{"leadsTo":"rest","outcome":{"nextSprint":{"taskCountMul":0.7}}},{"leadsTo":"sprint","outcome":{}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":2} |
| 11 | recruit-offer | {"choices":[{"leadsTo":"recruit","outcome":{}},{"leadsTo":"sprint","outcome":{"morale":-4}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":2} |
| 12 | urgent-hire | {"choices":[{"leadsTo":"sprint","outcome":{"grantRecruit":true,"onRecruitFail":{"trust":{"team":-4}}}},{"leadsTo":"sprint","outcome":{"trust":{"team":-4}}}],"kind":"decision","maxSignal":{},"minSignal":{},"triggers":{},"weight":1.5} |
| 13 | debt-incident | {"choices":[{"leadsTo":"sprint","outcome":{"morale":-4,"quality":-8,"techDebt":6}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{"techDebtHigh":3},"weight":0.6} |
| 14 | giant-ai-pr-judgment | {"choices":[{"leadsTo":"sprint","outcome":{"nextSprint":{"reviewLoadAdd":4},"seniorHp":-6}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{"aiDependencyHigh":3},"weight":0.6} |
| 15 | hallucinated-api | {"choices":[{"leadsTo":"sprint","outcome":{"nextSprint":{"reworkRateAdd":0.15},"quality":-4}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{"aiLiteracyLow":3},"weight":0.5} |
| 16 | senior-burnout | {"choices":[{"leadsTo":"sprint","outcome":{"morale":-6,"seniorHp":-28}}],"kind":"judgment","maxSignal":{},"minSignal":{"seniorHpLow":0.35},"triggers":{"seniorHpLow":3},"weight":0.5} |
| 17 | review-freeze | {"choices":[{"leadsTo":"sprint","outcome":{"morale":-3,"preserveAboveLose":true,"seniorHp":-10}}],"kind":"judgment","maxSignal":{},"minSignal":{"seniorHpLow":0.55},"triggers":{"seniorHpLow":4},"weight":0.25} |
| 18 | ci-improved | {"choices":[{"leadsTo":"sprint","outcome":{"quality":6,"testCoverage":4}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{"testCoverageHigh":2},"weight":0.5} |
| 19 | docs-hit-ai | {"choices":[{"leadsTo":"sprint","outcome":{"aiLiteracy":6,"delivered":8}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{"documentationHigh":2},"weight":0.5} |
| 20 | readme-haiku | {"choices":[{"leadsTo":"sprint","outcome":{"aiLiteracy":2,"morale":4}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{},"weight":0.35} |
| 21 | meeting-title-refactor | {"choices":[{"leadsTo":"sprint","outcome":{"morale":2,"quality":1}}],"kind":"judgment","maxSignal":{},"minSignal":{},"triggers":{},"weight":0.3} |

## difficulties

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | easy | {"aiDependencyPerTask":2.2,"bossTargetMul":0.85,"globalEffects":{"reviewEfficiencyMul":1.05,"reworkRateAdd":-0.04,"seniorHpCostMul":0.76},"org":{"aiDependencyBase":25,"aiLiteracy":60,"documentation":65,"morale":75,"quality":70,"securityLevel":70,"seniorHp":100,"testCoverage":70},"startBudget":60,"taskCountMul":1.85} |
| 1 | normal | {"aiDependencyPerTask":2.2,"bossTargetMul":1,"globalEffects":{"seniorHpCostMul":0.8},"org":{"aiDependencyBase":35,"aiLiteracy":45,"documentation":52,"morale":70,"quality":62,"securityLevel":60,"seniorHp":100,"testCoverage":58},"startBudget":45,"taskCountMul":1.65} |
| 2 | hard | {"aiDependencyPerTask":2.2,"bossTargetMul":1.15,"globalEffects":{"reviewEfficiencyMul":0.92,"reworkRateAdd":0.05},"org":{"aiDependencyBase":45,"aiLiteracy":35,"documentation":30,"morale":60,"quality":45,"securityLevel":60,"seniorHp":90,"testCoverage":35},"startBudget":35,"taskCountMul":1.4} |
| 3 | nightmare | {"aiDependencyPerTask":0.8,"bossTargetMul":1.3,"globalEffects":{"incidentRateMul":1.25,"reviewEfficiencyMul":0.85,"reworkRateAdd":0.1},"org":{"aiDependencyBase":42,"aiLiteracy":25,"documentation":15,"morale":55,"quality":35,"securityLevel":55,"seniorHp":80,"testCoverage":20},"startBudget":25,"taskCountMul":1} |

## trials

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | low-focus | {"aiDependencyDriftPerSprint":0,"budgetMul":1,"effects":{},"focusDelta":-1,"frontierModelCostPerDependency":0,"scoreMul":1.15} |
| 1 | half-budget | {"aiDependencyDriftPerSprint":0,"budgetMul":0.5,"effects":{},"focusDelta":0,"frontierModelCostPerDependency":0,"scoreMul":1.15} |
| 2 | flammable | {"aiDependencyDriftPerSprint":0,"budgetMul":1,"effects":{"incidentRateMul":1.3},"focusDelta":0,"frontierModelCostPerDependency":0,"scoreMul":1.2} |
| 3 | review-cap | {"aiDependencyDriftPerSprint":0,"budgetMul":1,"effects":{"reviewEfficiencyMul":0.85},"focusDelta":0,"frontierModelCostPerDependency":0,"scoreMul":1.2} |
| 4 | frontier-dependency | {"aiDependencyDriftPerSprint":5,"budgetMul":1,"effects":{},"focusDelta":0,"frontierModelCostPerDependency":0.04,"scoreMul":1.25} |

## bosses

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | big-release | {"clear":{"minSprintDelivered":90},"incidentMul":1,"taskCountMul":1} |
| 1 | major-incident | {"clear":{"maxSpread":2,"minSprintDelivered":40},"incidentMul":1.1,"taskCountMul":1} |
| 2 | security-audit | {"clear":{"maxTechDebt":40,"minQuality":50},"incidentMul":1,"taskCountMul":1} |
| 3 | exec-review | {"clear":{"minAiPct":40,"minMorale":45,"minQuality":45},"incidentMul":1,"taskCountMul":1} |

## relics

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | psych-safety | {"effects":{},"passives":{"moraleDamageMul":0.6}} |
| 1 | postmortem | {"effects":{"incidentRateMul":0.9,"securityAdd":6,"testCoverageAdd":8},"passives":{}} |
| 2 | doc-driven | {"effects":{"qualityAdd":6,"reworkRateAdd":-0.08},"passives":{}} |
| 3 | small-pr | {"effects":{"reviewEfficiencyMul":1.15},"passives":{}} |
| 4 | strong-ci | {"effects":{"reworkRateAdd":-0.12},"passives":{}} |
| 5 | flow-first | {"effects":{"reviewCapacityMul":1.2},"passives":{"restHealBonus":10}} |
| 6 | no-friday-deploy | {"effects":{"incidentRateMul":0.85,"securityAdd":4},"passives":{}} |
| 7 | primary-source | {"effects":{"qualityAdd":6,"testCoverageAdd":6},"passives":{}} |
| 8 | budget-discipline | {"effects":{"infraCostMul":0.8},"passives":{"shopDiscount":0.2}} |
| 9 | expectation-mgmt | {"effects":{},"passives":{"moraleDamageMul":0.75}} |

## traits

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | aiArtisan | {"modifiers":{"aiReworkAdd":-0.06}} |
| 1 | burnoutProne | {"modifiers":{"staminaMaxMul":0.72}} |
| 2 | docMaster | {"modifiers":{"docPerSprint":3}} |
| 3 | juniorStar | {"modifiers":{"xpMul":1.6}} |
| 4 | megaPrMaker | {"modifiers":{"implMul":1.25,"reviewLoadMul":0.9}} |
| 5 | reviewDemon | {"modifiers":{"reviewMul":1.3,"staminaDrainMul":1.35}} |

## evolution

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | dev-1 | {"codingSlotBonus":0,"cost":1,"effects":{"codingSpeedMul":1.12,"securityAdd":-4},"focusBonus":0,"requires":null} |
| 1 | dev-2 | {"codingSlotBonus":1,"cost":3,"effects":{},"focusBonus":0,"requires":"dev-1"} |
| 2 | dev-3 | {"codingSlotBonus":0,"cost":10,"effects":{"routineSpeedMul":1.3,"securityAdd":-6},"focusBonus":0,"requires":"dev-2"} |
| 3 | review-1 | {"codingSlotBonus":0,"cost":1,"effects":{"reviewCapacityMul":1.2},"focusBonus":0,"requires":null} |
| 4 | review-2 | {"codingSlotBonus":0,"cost":3,"effects":{"reviewEfficiencyMul":1.18},"focusBonus":0,"requires":"review-1"} |
| 5 | review-3 | {"codingSlotBonus":0,"cost":10,"effects":{"reviewCapacityMul":1.2},"focusBonus":0,"requires":"review-2"} |
| 6 | quality-1 | {"codingSlotBonus":0,"cost":1,"effects":{"securityAdd":6,"testCoverageAdd":12},"focusBonus":0,"requires":null} |
| 7 | quality-2 | {"codingSlotBonus":0,"cost":4,"effects":{"incidentRateMul":0.82,"securityAdd":8},"focusBonus":0,"requires":"quality-1"} |
| 8 | quality-3 | {"codingSlotBonus":0,"cost":14,"effects":{"qualityAdd":8,"reworkRateAdd":-0.1,"securityAdd":10},"focusBonus":0,"requires":"quality-2"} |
| 9 | ai-1 | {"codingSlotBonus":0,"cost":4,"effects":{"reworkRateAdd":-0.1},"focusBonus":0,"requires":null} |
| 10 | ai-2 | {"codingSlotBonus":0,"cost":9,"effects":{"aiLiteracyAdd":18,"infraCostMul":0.75},"focusBonus":0,"requires":"ai-1"} |
| 11 | ai-3 | {"codingSlotBonus":0,"cost":16,"effects":{"codingSpeedMul":1.2,"infraCostMul":0.7,"securityAdd":-6},"focusBonus":0,"requires":"ai-2"} |
| 12 | culture-1 | {"codingSlotBonus":0,"cost":4,"effects":{},"focusBonus":2,"requires":null} |
| 13 | culture-2 | {"codingSlotBonus":0,"cost":9,"effects":{"qualityAdd":10},"focusBonus":0,"requires":"culture-1"} |
| 14 | culture-3 | {"codingSlotBonus":0,"cost":14,"effects":{},"focusBonus":3,"requires":"culture-2"} |

## goalAdjustments

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | cut_scope | {"budgetDelta":0,"goalEffects":{"deliveryMul":0.8},"negotiator":"customers","nextBudgetCapDelta":null,"nextQuarterEffects":{},"orgEffects":{},"pauseAiDebuff":false,"reorgReset":false,"trustDelta":{"customers":-15}} |
| 1 | extend_deadline | {"budgetDelta":-10,"goalEffects":{"deliveryMul":0.9,"moraleAdd":5,"qualityAdd":5},"negotiator":"management","nextBudgetCapDelta":null,"nextQuarterEffects":{"reviewEfficiencyMul":1.1,"reworkRateAdd":-0.08,"seniorHpDelta":5},"orgEffects":{},"pauseAiDebuff":false,"reorgReset":false,"trustDelta":{"management":-12}} |
| 2 | quality_pivot | {"budgetDelta":0,"goalEffects":{"deliveryMul":0.85,"incidentLimitAdd":3,"techDebtLimitAdd":15},"negotiator":"customers","nextBudgetCapDelta":null,"nextQuarterEffects":{"codingSpeedMul":0.92,"incidentRateMul":0.75,"qualityAdd":4,"techDebtDelta":-4},"orgEffects":{"deliveryScoreMul":0.9,"techDebtDelta":-8},"pauseAiDebuff":false,"reorgReset":false,"trustDelta":{"customers":-5}} |
| 3 | request_budget | {"budgetDelta":20,"goalEffects":{"deliveryAdd":300},"negotiator":"management","nextBudgetCapDelta":-15,"nextQuarterEffects":{"codingSpeedMul":1.08,"reviewCapacityMul":1.15},"orgEffects":{},"pauseAiDebuff":false,"reorgReset":false,"trustDelta":{"management":-5}} |
| 4 | pause_ai_rollout | {"budgetDelta":0,"goalEffects":{"aiAdoptionAdd":-15,"deliveryMul":0.92},"negotiator":"management","nextBudgetCapDelta":null,"nextQuarterEffects":{"incidentRateMul":0.7,"reworkRateAdd":-0.1,"seniorHpDelta":3},"orgEffects":{},"pauseAiDebuff":true,"reorgReset":false,"trustDelta":{"management":-8}} |
| 5 | reorg_teams | {"budgetDelta":-5,"goalEffects":{"moraleAdd":-5},"negotiator":"team","nextBudgetCapDelta":null,"nextQuarterEffects":{"reviewEfficiencyMul":1.2,"seniorHpDelta":3,"techDebtDelta":-2},"orgEffects":{"moraleDelta":-10,"seniorHpDelta":25,"techDebtDelta":-5},"pauseAiDebuff":false,"reorgReset":true,"trustDelta":{"team":-20}} |
| 6 | stakeholder_care | {"budgetDelta":-12,"goalEffects":{"deliveryAdd":80},"negotiator":"all","nextBudgetCapDelta":null,"nextQuarterEffects":{"codingSpeedMul":0.97},"orgEffects":{},"pauseAiDebuff":false,"reorgReset":false,"trustDelta":{"customers":10,"management":12,"team":8}} |

## levers

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | recruitDraft | {"cost":40,"effect":{"extraTeams":1,"moraleDelta":-3},"scope":"company"} |
| 1 | aiGuideline | {"cost":25,"effect":{"aiDependencyDelta":-16,"infraBoost":6},"scope":"company"} |
| 2 | infraInvest | {"cost":35,"effect":{"infraBoost":12,"reviewQueueDelta":-3},"scope":"company"} |
| 3 | standardize | {"cost":30,"effect":{"infraBoost":10,"techDebtDelta":-20},"scope":"company"} |
| 4 | firefighters | {"cost":20,"effect":{"incidentDelta":-2,"moraleDelta":4},"scope":"company"} |
| 5 | reorg | {"cost":45,"effect":{"extraTeams":1,"moraleDelta":-6,"reviewQueueDelta":-2},"scope":"company"} |
| 6 | reviewReinforce | {"cost":12,"effect":{"reviewQueueDelta":-4},"scope":"department"} |
| 7 | prSizeLimit | {"cost":10,"effect":{"reviewQueueDelta":-2,"techDebtDelta":-6},"scope":"department"} |
| 8 | aiThrottleDept | {"cost":8,"effect":{"aiDependencyDelta":-12},"scope":"department"} |
| 9 | seniorHiring | {"cost":18,"effect":{"moraleDelta":3,"reviewQueueDelta":-3},"scope":"department"} |
| 10 | dependencyCleanup | {"cost":14,"effect":{"incidentDelta":-1,"techDebtDelta":-12},"scope":"department"} |
| 11 | deptFreeze | {"cost":6,"effect":{"incidentDelta":-2,"moraleDelta":-4,"reviewQueueDelta":-2},"scope":"department"} |
| 12 | teamReviewHelp | {"cost":6,"effect":{"reviewQueueDelta":-5},"scope":"team"} |
| 13 | teamAiThrottle | {"cost":5,"effect":{"aiDependencyDelta":-16},"scope":"team"} |
| 14 | teamFirefight | {"cost":8,"effect":{"incidentDelta":-2,"moraleDelta":3},"scope":"team"} |

## members

### namePool

```json
["アオイ","ハルキ","ミナ","ソウタ","リン","カエデ","ユウ","ナギ","ツバサ","ヒナタ","レン","サキ"]
```

### defaultAiArchetypeId

```json
"starter-ai-junior"
```

### starter

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | starter-coder | {"preferred":"coding","rank":"middle","stats":{"aiMastery":50,"implementation":58,"review":40},"traits":[]} |
| 1 | starter-ai-junior | {"preferred":"coding","rank":"junior","stats":{"aiMastery":62,"implementation":48,"review":32},"traits":["aiArtisan"]} |
| 2 | starter-reviewer | {"preferred":"review","rank":"senior","stats":{"aiMastery":48,"implementation":46,"review":64},"traits":["reviewDemon"]} |

### recruit

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | recruit-ai-prodigy | {"preferred":"coding","rank":"junior","stats":{"aiMastery":66,"implementation":42,"review":30},"traits":["aiArtisan","juniorStar"]} |
| 1 | recruit-doc | {"preferred":"review","rank":"junior","stats":{"aiMastery":40,"implementation":40,"review":44},"traits":["docMaster"]} |
| 2 | recruit-mega | {"preferred":"coding","rank":"middle","stats":{"aiMastery":44,"implementation":60,"review":28},"traits":["megaPrMaker"]} |
| 3 | recruit-rookie | {"preferred":"coding","rank":"junior","stats":{"aiMastery":46,"implementation":38,"review":38},"traits":["juniorStar","burnoutProne"]} |

## unlocks

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | unlock-claude-code | {"contentId":"claude-code","cost":25,"kind":"card","requires":null} |
| 1 | unlock-devin | {"contentId":"devin","cost":50,"kind":"card","requires":"review-exceeded"} |
| 2 | unlock-hire-senior | {"contentId":"hire-senior","cost":40,"kind":"card","requires":"review-survivor"} |
| 3 | unlock-review-bot | {"contentId":"review-bot","cost":30,"kind":"card","requires":null} |
| 4 | unlock-psych-safety | {"contentId":"psych-safety","cost":35,"kind":"relic","requires":null} |
| 5 | unlock-doc-driven | {"contentId":"doc-driven","cost":30,"kind":"relic","requires":null} |
| 6 | unlock-strong-ci | {"contentId":"strong-ci","cost":35,"kind":"relic","requires":null} |
| 7 | unlock-flow-first | {"contentId":"flow-first","cost":30,"kind":"relic","requires":null} |
| 8 | unlock-no-friday-deploy | {"contentId":"no-friday-deploy","cost":25,"kind":"relic","requires":null} |
| 9 | unlock-budget-discipline | {"contentId":"budget-discipline","cost":30,"kind":"relic","requires":null} |

## departments

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | product | {"teamCount":4} |
| 1 | platform | {"teamCount":3} |
| 2 | newbiz | {"teamCount":3} |

## actions

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | interruptReview | {"stabilizesFlow":true} |
| 1 | splitPr | {"stabilizesFlow":true} |
| 2 | firefight | {"stabilizesFlow":true} |
| 3 | assignTask | {"stabilizesFlow":true} |
| 4 | aiThrottle | {"stabilizesFlow":true} |
| 5 | pairReview | {"stabilizesFlow":true} |
| 6 | overtime | {"stabilizesFlow":false} |
| 7 | andon | {"stabilizesFlow":true} |

## startingScenarios

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | default | {"globalEffects":{},"org":{"aiDependencyBase":35,"aiLiteracy":45,"documentation":50,"morale":70,"quality":60,"securityLevel":60,"seniorHp":100,"testCoverage":55},"orgDelta":{},"sprint":{"codingSlots":6,"focusMax":12,"maxTicks":1500,"taskCount":28}} |
| 1 | copilot | {"globalEffects":{"codingSpeedMul":1.06,"routineSpeedMul":1.12},"org":{"aiDependencyBase":35,"aiLiteracy":45,"documentation":50,"morale":70,"quality":60,"securityLevel":60,"seniorHp":100,"testCoverage":55},"orgDelta":{"aiDependencyBase":8,"securityLevel":-5},"sprint":{"codingSlots":6,"focusMax":12,"maxTicks":1500,"taskCount":28}} |
| 2 | claude-code | {"globalEffects":{"codingSpeedMul":1.08,"reviewEfficiencyMul":0.94,"reworkRateAdd":-0.02},"org":{"aiDependencyBase":35,"aiLiteracy":45,"documentation":50,"morale":70,"quality":60,"securityLevel":60,"seniorHp":100,"testCoverage":55},"orgDelta":{"aiLiteracy":8,"quality":5,"securityLevel":-3},"sprint":{"codingSlots":6,"focusMax":12,"maxTicks":1500,"taskCount":28}} |
| 3 | devin | {"globalEffects":{"codingSpeedMul":1.1,"reworkRateAdd":0.03},"org":{"aiDependencyBase":35,"aiLiteracy":45,"documentation":50,"morale":70,"quality":60,"securityLevel":60,"seniorHp":100,"testCoverage":55},"orgDelta":{"aiDependencyBase":10,"documentation":-8,"securityLevel":-6},"sprint":{"codingSlots":6,"focusMax":12,"maxTicks":1500,"taskCount":28}} |

## achievements

| Order | ID | Execution |
| ---: | --- | --- |
| 0 | first-clear | {} |
| 1 | no-damage | {} |
| 2 | combo-master | {} |
| 3 | all-bosses | {} |
| 4 | nightmare-clear | {} |
| 5 | review-exceeded | {} |
| 6 | review-survivor | {} |

## difficultyOrder

```json
["easy","normal","hard","nightmare"]
```

## defaultScenarioId

```json
"default"
```

## daily

### difficulty

```json
"normal"
```

### trials

| Order | ID | Execution |
| ---: | --- | --- |
