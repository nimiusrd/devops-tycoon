# ランループ再設計: ノード選択廃止 → 四半期トラック＋イベント判定

[mockup-parity.md §3.5-A](./mockup-parity.md) の課題を詰めた設計。**分岐ノードマップを廃止**し、
四半期を**固定トラック**として進めながら、スプリントの合間に**イベント判定（混合）**を起こす。
リスク/リターンは「四半期目標（Phase 8）への進捗＝リターン」「渋滞・炎上・信頼・負債＝リスク」に
紐づけ、安全策にも必ず代償を持たせる。

> 決定事項（合意済み）:
>
> 1. **ビート構成 = 混合**（自動適用の「判定イベント」＋リスク/リターンの「選択イベント」を確率で出し分け）
> 2. **重み付け = 組織状態依存**（技術的負債↑→障害、AI依存度↑→誤生成、シニアHP↓→レビュー停止…）
> 3. **高負荷スプリント/ショップ/休息 = 選択イベントに統合**（固定ノードではなく決断として提示）

この設計は SPEC 第3・4.4・9・10 章を変更する（変更案は本ファイル末尾 §8）。

---

## 1. なぜ変えるか（課題の再掲）

- 現状はメイン画面の大半を**分岐ノードマップ**が占め、各層でノードを選ぶ。
- だが選択に**明確なリターンが無い**ため、結局**リスクの無いルート（通常スプリント）を選ぶだけ**になり、
  意思決定が形骸化。プレイヤーが状況を**コントロールしすぎ**ている。
- Slay the Spire は「リターンのためにリスクを取る」設計。ここでもリスク/リターンを核に戻す。

## 2. 新しい基本ループ

四半期 = **固定長のスプリント列**（`SPRINTS_PER_QUARTER`、既定 8、最終がボス）。ルート選択は無い。
スプリントの**合間**に毎回ビート（イベント判定）が挟まる。

```text
[四半期開始]
   → Sprint 1（通常）
   → Result → Draft → Evolution
   → ★Beat 1（イベント判定: 判定 or 選択）
   → Sprint 2 …（Beat が elite/shop/rest を生むことがある）
   → … → ★Beat (N-1)
   → Sprint N（= ボススプリント）
   → 四半期レビュー（Phase 8）→ 継続なら次四半期の Sprint 1 へ
```

- 第1スプリントの前にビートは無い（いきなり始まる）。以後、各スプリントの前にビートが 1 回。
- ボスは固定でトラック最終スプリント。「どのルートでボスに着くか」ではなく「何スプリントで山場が来るか」が確定。
- リターン = 四半期目標への進捗＋メタ。リスク = 渋滞/炎上/技術的負債/シニアHP/信頼。**目標があるから安全策だけでは
  届かず、攻めの選択を迫られる**——これが StS 的リスク/リターンの源泉。

## 3. ビート（スプリント間イベント）

各ビートで seed 付き PRNG が**重み付き抽選**で 1 イベントを引く。種別は 2 つ:

### 3.1 判定イベント（judgment / 選択なし・自動適用）

- 組織状態依存の確率事象が起き、効果が即適用される（プレイヤーの決断なし＝「制御できない」緊張感）。
- 例（SPEC 第9.1〜9.3 由来）:
  - 技術的負債↑: 「"動いているように見える"障害が本番で発覚」→ Incident 種・Quality−
  - AI依存度↑ / AIリテラシー↓: 「巨大 AI 生成 PR が投下」→ 次スプリントのレビュー負荷+ / 「存在しない API を使った」→ Rework+
  - シニアHP↓: 「シニアがレビューで燃え尽きた」→ SeniorHP 大幅−（レビュー停止に近づく）
  - 健全（TestCoverage↑/Docs↑）: 「CI 改善で手戻り激減」「ドキュメントが AI に刺さった」→ 好転
- 一部の判定は**ハード敗北条件**に触れうる（例: レビュー停止 → `reviewFreeze`）。その場合 `beat --LOST--> lost`。

### 3.2 選択イベント（decision / リスク/リターンの 2〜3 択）

- ルート選択ではなく**その場の決断**。各選択肢に**リスクとリターンの両方**。**断る/安全側にも必ず代償**
  （リターン無し＝目標から遅れる、または信頼・士気の微減）。
- 旧 elite/shop/rest をここへ統合:

| 旧ノード | 選択イベント例 | 取る（リスク/リターン） | 見送る（代償） |
| --- | --- | --- | --- |
| 高負荷(elite) | 大型案件を前倒しする？ | 次スプリントを高負荷化（大出荷／渋滞・炎上リスク） | 通常スプリント（出荷控えめ＝目標遅れ） |
| ショップ($) | 予算で補強する？ | ショップを開く（カード購入/強化・採用） | 予算温存（補強機会を逃す） |
| 休息(☾) | 一息つく？ | SeniorHP回復 / カード強化 / 負債返済 | 攻め続ける（出荷機会を取りに行く＝回復しない） |

- 既存の汎用選択イベント（緊急デモ等、第9.4）もそのまま decision として出る。

### 3.3 判定 vs 選択の出し分け（混合）

- 各ビートで `DECISION_BEAT_CHANCE`（既定 0.55、tunable）で選択イベント、そうでなければ判定イベント。
- 直前スプリントが高負荷だった／目標から遅れている等で重みを動的調整してもよい（後続チューニング）。

## 4. 組織状態による重み付け（決定論）

各イベント定義に**重みのベース**と**トリガ係数**を持たせ、現在の組織状態で重みをスケールする純関数
`weightedEventPool(org, totals, pool)` を用意する（GPU 不要・Vitest 検証）。

```ts
// data 側（宣言的）
interface EventDef {
  // …既存（id/title/prompt/tone/choices）
  kind: 'judgment' | 'decision';
  weight: number;                 // ベース重み
  triggers?: Partial<Record<EventSignal, number>>; // 信号→重み倍率
  // judgment は choices 長 1（自動適用）。decision は 2〜3。
  // elite/shop/rest 連結は choices[i].outcome.leadsTo で表す。
}

type EventSignal =
  | 'techDebtHigh' | 'aiDependencyHigh' | 'aiLiteracyLow'
  | 'seniorHpLow'  | 'moraleLow' | 'qualityLow'
  | 'testCoverageHigh' | 'documentationHigh';
```

```ts
// sim 側（純関数・決定論）
// signal は org/totals から 0..1 の強度で算出（例: techDebtHigh = clamp(techDebt/上限)）。
// weight_eff = base * Π(1 + triggers[sig] * signalStrength[sig])
// 引きは seed 付き PRNG（key: `${seed}:beat:q${q}:s${idx}`）。
```

- これにより「**組織の制約が次の事故を生む**」が機構として成立（SPEC 第19・20 章のメッセージを体験化）。
- 健全な状態は good 寄り、荒れた状態は bad/ネタ寄りに自然と偏る（StS 的「ビルドの穴を突かれる」感）。

## 5. 状態・フェーズ・契約の変更

### 5.1 フェーズマシン（`runMachine`）

`map` を廃し `beat` を追加。

```text
title --START--> sprint(1)
sprint --SPRINT_DONE--> result | --BOSS_REVIEW--> quarterReview | --LOST--> lost
result --ACK--> draft --NEXT--> evolution --FINISH--> beat
beat  --ENTER_SPRINT--> sprint   // 判定適用後 / 非shop・rest の選択後（通常 or 高負荷）
      --ENTER_SHOP--> shop        // 「予算で補強」を取った
      --ENTER_REST--> rest        // 「一息つく」を取った
      --LOST--> lost              // 判定がハード敗北を引いた
shop --RESOLVE--> sprint          // 買い物後は次スプリントへ（マップへ戻らない）
rest --RESOLVE--> sprint
quarterReview --REVIEW_WON--> won | --REVIEW_CONTINUE--> sprint(次Q 1) | --REVIEW_LOST--> lost
```

- `event` フェーズは `beat` に統合（判定/選択の提示は `beat` が担う）。`shop`/`rest` は beat の選択から到達する
  サブ画面として存続（既存 UI 流用）。

### 5.2 `RunState`（データモデル）

- **削除**: `map`/`position`/`visited`/`available`、型 `MapNode`/`RunMap`、`map.ts`。
- **追加**: `sprintIndexInQuarter`（1..N）、`sprintsPerQuarter`（N）、`beat`（提示中イベント: `{ eventId, kind }`）。
- **追加（スプリント種別の保持）**: 旧来は `MapNode.type` が通常/高負荷/ボスを表し、エンジンは
  これでタスク倍率（高負荷）と進化ポイント加算を決めていた（`engine.ts` の `beginSprint` /
  リザルト処理）。マップ撤去でこの情報が消えないよう、**`pendingSprintKind`**（次スプリントの種別。
  ビートの「高負荷案件を受ける」選択や、トラック最終＝`boss` で決まる）と **`currentSprintKind`**
  （進行中スプリントの種別。完了時の評価・進化ポイントまで保持）を `'normal' | 'elite' | 'boss'` で持つ。
  既定は `normal`、トラック最終インデックスは `boss`、高負荷案件を受けたら `elite`。
- `bossId` は維持（その四半期のボス。トラック最終スプリントで使う）。`eventId`/`shop` は流用。
- **`beginSprint` は `currentSprintKind`（= 直前に確定した `pendingSprintKind`）を読む**ように変え、
  `MapNode` 依存（`node.type`）を置き換える。`elite` はタスク倍率＋進化ポイント加算、`boss` は
  ボスルールと `BOSS_REVIEW` 遷移に対応させる。

### 5.3 公開契約（`window.game` / `GameHandle`）

- **削除**: `enterNode(id)`。
- **追加**: `resolveBeat(choiceIndex?)`（判定は引数なし、選択は index）。必要なら `getBeat()`。
  選択が「高負荷案件を受ける」なら `pendingSprintKind='elite'` を立て、次の `beginSprint` で消費する。
- 型定義（`src/game.ts`）・E2E 型・architecture §4.1 を同時更新。**破壊的変更**なので E2E/smoke を更新する。

### 5.4 UI

- **削除**: `RunMapScreen`。
- **追加**: `BeatScreen`（判定結果カード／選択肢を提示。「予算補強」「一息つく」は既存 `ShopScreen`/`RestScreen` へ）。
- 進行表示は**線形トラック**（Sprint i / N、次が山場か）に変更。`RunBar`/パンくず更新。

## 6. 決定論・テスト（第22.3 / 22.5）

- すべての抽選は seed 付き PRNG（key: 四半期番号＋スプリント index）。デイリーラン/リプレイ/再現が保てる。
- **Vitest**:
  - 重み付け: 技術的負債↑で debt/incident 系の確率が上がる（同一 org で決定論）。
  - 混合比: `DECISION_BEAT_CHANCE` 付近の出し分け。
  - 連結: 高負荷選択→次スプリント elite 化／予算補強→shop／一息→rest の遷移。
  - スプリント種別の保持: 高負荷案件を受ける→`pendingSprintKind='elite'`→`beginSprint` で
    タスク倍率＋進化ポイント加算が効く（完了時まで `currentSprintKind` が保持される）。
  - ボス到達: N スプリントでボス（`currentSprintKind='boss'`）→四半期レビュー。
  - ハード敗北: 判定でレビュー停止→`lost`。
- **Playwright**: ラン開始→スプリント→ビート（選択）→次スプリント→…→ボス→四半期レビューの通し。
  `enterNode` を使うテストは `resolveBeat` ベースへ更新。

## 7. 段階的移行（リスクを抑える）

1. **データ層**: `EventDef` に `kind`/`weight`/`triggers` を追加、判定イベントを拡充（純データ＋純関数の重み付け）。
2. **sim 層**: `advanceBeat`/`resolveBeat`/`weightedEventPool` を追加、`map.ts`・`enterNode` を撤去。`RunState` 改修。
3. **state 層**: `runMachine` の `map`→`beat`。
4. **UI 層**: `BeatScreen` 追加、`RunMapScreen` 撤去、進行表示を線形化。
5. **契約/テスト**: `game.ts`・E2E 型・smoke/run スペックを `resolveBeat` へ。
6. **SPEC**: §8 の変更を反映。

各段で `npm test` / `build` 緑を維持。`mockup-parity.md §3.5-A` を「詰め済み（本ファイル）」へ更新。

## 8. SPEC.md 変更案（要点）

- **第3章 基本ループ**: 「マップ進行（分岐ルート）」を「**固定トラック＋スプリント間イベント判定**」に置換。
  ループ図から分岐マップを除き、Sprint→（Result/Draft/Evolution）→**Beat**→Sprint… を明示。
- **第4.4 ランマップ画面**: 「**スプリント間イベント画面（判定/選択）**」に改題。ノード表（通常/高負荷/イベント/
  ショップ/休息/ボス）は、**イベントの種別**（判定／選択、及び選択に統合された高負荷/予算補強/一息）に再構成。
  「ルート選択そのものが読み合い」→「**各イベントの決断が読み合い**（安全側にも代償）」に趣旨変更。
- **第9章 ランダムイベント**: 位置づけを「合間の演出」から「**周回進行の中核エンジン**」へ格上げ。9.1〜9.3 を
  **判定イベント**、9.4 を**選択イベント**として整理し、**組織状態による重み付け**（第4節）を明記。
- **第10章 ボス**: 「分岐マップの最終層」→「**固定トラックの最終スプリント**」に。到達構造の記述を更新。
- **第19・20章**: 「組織の制約が次の事故を生む」をイベント重み付けとして体験できる点を補強（既存メッセージと整合）。

> SPEC は企画の正本なので、本ファイル（実装設計）と二重管理にならないよう、SPEC は方針・体験の記述、
> 本ファイルは実装仕様、と役割を分ける。
