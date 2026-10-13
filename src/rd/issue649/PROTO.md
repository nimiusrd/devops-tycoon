# Issue #649 Phase 1: 大規模障害の役割分担（隔離 R&D）

対象: [#649](https://github.com/nimiusrd/devops-tycoon/issues/649) / 親 #548 / 元案 101。
範囲: 凍結候補値はそのまま。再発だけ seed 由来の一様乱数 `u` に変更し、`--full` で比較する。
本番コード・通常ラン・`RunEngine`・勝敗・保存・ruleset へは接続しない。

## 隔離

- 置き場は `src/rd/issue649/` と `scripts/compare-649.mjs` だけ。
- ライブ定数は複製して `params.mjs` の `COPIED_FROM_LIVE` に置く。`src/data` / `src/sim` / `src/prototypes` は import しない。
- UI / Pixi / E2E / gallery は対象外。

## 単一決定指標

採否に使う値は **`netOutcome`** だけ。

```
netOutcome = shippedAfterTrust - totalDowntime * downtimeCostPerTick - switchCost
shippedAfterTrust = rawShipped * (1 - effectiveTrustDrop)
```

`totalDowntime` を単一指標にしない。復旧量が人数に比例するとき、2 件目の復旧時間を足しても `2W/3 < W` なので、停止時間だけでは条件 A も B も all-on-recovery が勝つ。説明担当は信頼だけを動かすため、停止時間には乗らない。`netOutcome` だけが復旧・再発・信頼・未配置の通常成果・交代費用を一つの比較に載せる。

復旧時間・再発の成否・信頼低下は説明用に別掲する。現行ボス判定（`maxSpread: 2`, `minSprintDelivered: 40`）への接続は Phase 2 以降の設計メモとし、本実験の合否には使わない。

## 盤面

- 決定論。比較 seed は `RI-649-a` .. `RI-649-e`。職員は starter 3 名の ID を複製し、能力は同一。
- 条件は 2 つだけ: A 低再発 (`baseRecurrence = 0.20`)、B 高再発 (`0.90`)。
- 役割枠は復旧・調査・説明の 3 つ。同一人物の二重割当は禁止し、後勝ちせず違反件数に加算して無視する。
- 方針は 3 つ: all-on-recovery（3/0/0）、1/1/1 split（1/1/1）、investigation-first（開始 1/2/0、調査完了後に調査 1 人を復旧へ交代）。

## 力学

- 復旧: 割当人数 × `recoveryPower` で 1 件の残工数を減らす。0 人でも `baselineRecoveryRate = 1` の通常対応が残る。
- 調査: 再発率を人数 × `0.45` 下げる。調査工数 `4` を割り切った tick で完了し、残った調査担当は未配置になって通常成果を出す。
- 説明: 1 件あたりの信頼低下を人数 × `0.15` 下げる。停止中はずっと枠を占める。
- 再発: seed ごとに `u ~ Uniform[0, 1)` を 1 回だけ引く（FNV-1a + mulberry32 の複製。ライブ RNG は import しない）。同一 seed・同一条件の 3 方針は同じ `u` を共有し、`u < recurrenceChance` なら 2 件目が発生する。2 件目は、その時点の復旧人数で同じ工数をもう一度足す。
- 信頼: 件数が増えると低下が加算され、障害後の出荷（既出荷 + 残 horizon の通常成果 + 未配置成果）を減らす。
- 交代費用: 初期割当は無料。investigation-first の 1 回だけ `switchCost = 2`。
- 未配置: 通常成果 `2` / 人 / tick（試作の別仕事を複製）。

`recurrenceThreshold = 0.5` は提案値として残すが、判定には使わない。

## 凍結候補値

ライブ複製（式には入れない）:

| 複製元 | 値 |
| --- | --- |
| `bosses.major-incident.incidentMul` | 1.1 |
| `bosses.major-incident.clear.maxSpread` | 2 |
| `bosses.major-incident.clear.minSprintDelivered` | 40 |
| `process.incident.baseProbability` | 0.02 |
| `process.incident.maximum` | 0.4 |
| `process.incident.burnTicks` | 35 |
| `process.incident.spread.debt` | 6 |
| `process.incident.spread.moraleCost` | 5 |
| `process.incident.customerTrust.perSpreadRaw` | 2 |
| `process.incident.customerTrust.perIncidentRaw` | 0.5 |
| `sprint.grade.penalty.incident` | 6 |
| `sprint.grade.penalty.spread` | 10 |
| starter 職員 ID | `starter-coder`, `starter-ai-junior`, `starter-reviewer` |
| 試作 別仕事 / 調査 tick / 既出荷 | 2 / 2 / 20 |

実験候補（式の正本）:

| 名前 | 値 |
| --- | --- |
| seed（提案値。比較は `RI-649-a`..`e`） | 649 |
| staffIds | 上記 3 ID（能力同一） |
| horizonTicks | 24 |
| baseRecoveryWork | 12 |
| recoveryPower | 1 |
| baselineRecoveryRate | 1 |
| investigationWork | 4 |
| investigationRecurrenceReduction | 0.45 |
| communicationTrustReduction | 0.15 |
| baseTrustDrop | 0.35 |
| recurrenceThreshold | 0.5 |
| normalWorkPerTick | 2 |
| alreadyShipped | 40 |
| downtimeCostPerTick | 6 |
| switchCost | 2 |
| condition A / B baseRecurrence | 0.20 / 0.90 |
| decisionMetric | `netOutcome` |

## 手計算予測（閾値判定だった Phase 1 時点。比較結果は `results/`）

閉じた式:

```
recoveryRate = recoveryCount > 0 ? recoveryCount : 1
T = 12 / recoveryRate
investigationTicks = investigationCount > 0 ? 4 / investigationCount : 0

investigation-first のみ:
  前半 2 tick は復旧 1、調査完了後に復旧 2。残工数 10 を率 2 で 5 tick。T = 7。
  交代 1 回。未配置 1 人が残停止 tick で通常成果。

p = clamp(baseRecurrence - 0.45 * investigationCount, 0, 1)
u = uniform01(seed)  // seed につき 1 回。方針間で共有
recurred = u < p
downtime = T + (recurred ? T_after_switch : 0)
trust = min(1, max(0, 0.35 - 0.15 * communicationCount) * incidents)
raw = 40 + 3 * 2 * (24 - downtime) + unassignedValue
net = raw * (1 - trust) - 6 * downtime - 2 * switches
```

| 条件 | 方針 | 復旧 T | 再発 p | 再発 | 停止 | 信頼 | 出荷(信頼後) | 停止費用 | 交代 | netOutcome |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | all-on-recovery | 4 | 0.20 | 否 | 4 | 0.35 | 104 | 24 | 0 | **80** |
| A | split | 12 | 0.00 | 否 | 12 | 0.20 | 102.4 | 72 | 0 | 30.4 |
| A | investigation-first | 7 | 0.00 | 否 | 7 | 0.35 | 98.8 | 42 | 2 | 54.8 |
| B | all-on-recovery | 4 | 0.90 | 是 | 8 | 0.70 | 40.8 | 48 | 0 | -7.2 |
| B | split | 12 | 0.45 | 否 | 12 | 0.20 | 102.4 | 72 | 0 | 30.4 |
| B | investigation-first | 7 | 0.00 | 否 | 7 | 0.35 | 98.8 | 42 | 2 | **54.8** |

手計算の勝者: **A は all-on-recovery（80）**、**B は investigation-first（54.8）**。同じ勝者にはなっていない。

A の内訳: 再発しないので復旧 3 人の 4 tick が残り出荷を残し、信頼 0.35 でも差引 80。分担は復旧が遅く、調査先行は交代費と説明不足で 54.8。

B の内訳: 復旧全振りは 2 件目が起き、停止 8 + 信頼 0.70 で −7.2。split は調査 1 で再発を閾値未満にし、説明で信頼 0.20、差引 30.4。investigation-first は調査 2 で再発を消し、交代後の復旧 2 で停止 7 に縮めて 54.8。

停止時間だけを見ると A は 4 / 12 / 7、B は 8 / 12 / 7 で、**両条件とも all-on-recovery が最短**になる。指標を downtime にすると勝者が揃う、と明記する。数値を後から合わせて隠していない。

## スクリプト

```
node scripts/compare-649.mjs
node scripts/compare-649.mjs --full
```

引数なしは自明ケースと二重割当検査。`--full` は 5 seed × 2 条件 × 3 方針を `src/rd/issue649/results/` に書く。

本比較の表と JSON は `src/rd/issue649/results/`。

## 現行ボス判定との接続メモ

- `minSprintDelivered: 40` を既出荷の床として複製した。本番の出荷下限そのものではない。
- `maxSpread: 2` は 2 件目再発の着想元。延焼カウンタや Review 復帰には接続しない。
- `incidentMul: 1.1` は複製のみ。Phase 1 の再発率には掛けていない。
- 採否は本 Issue に残す。本番導入は別単位。
