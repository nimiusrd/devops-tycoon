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
   → ★Setup（編成: メンバー配置・AI配布。第1スプリント前の準備）
   → Sprint 1（通常）
   → Result → Draft → Evolution
   → ★Beat 1（イベント判定: 判定 or 選択。編成も開ける）
   → Sprint 2 …（Beat が elite/shop/rest を生むことがある）
   → … → ★Beat (N-1)（=ボス直前。高負荷案件は出さない＝boss 優先）
   → Sprint N（= ボススプリント）
   → 四半期レビュー（Phase 8）→ 継続なら次四半期の Setup へ
```

- **第1スプリントの前に Setup フェーズを置く**。`assignMember`/`setMemberAi` は `phase === 'sprint'` では
  no-op なので、開始直後に盤面が走ると初回だけ常にデフォルト編成で固定されてしまう（現行 UI ではマップ滞在中に
  調整できていた）。これを防ぐため、ラン開始は `title → setup → sprint(1)` とし、Setup で編成を開けるようにする。
  2 スプリント目以降は各 Beat 中に編成を開ける（Beat が準備フェーズを兼ねる）。
- ボスは固定でトラック最終スプリント。「どのルートでボスに着くか」ではなく「何スプリントで山場が来るか」が確定。
- **ボス直前の Beat (N-1) では「高負荷案件（elite）」を出さない**。最終スプリントは必ず `boss`。
  種別の決定が二重化しないよう、**`pendingSprintKind` は `boss`（トラック最終インデックス）を最優先**とし、
  最終ビートの選択肢から elite を除外する（§5.2・§6 でテスト）。
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
  現行 `evaluateLose` は totals 由来でしか敗北判定しないため、判定イベント側は `EventOutcome.forceLose`
  （§4）で明示的に敗北遷移させる。
- **「次スプリント限定の一時効果」を持つイベントの保持先**: 「巨大 AI 生成 PR → 次スプリントのレビュー負荷+」
  「誤生成 → 次スプリントの Rework+」のような**一回限り**の効果は、org の恒久変化に混ぜず
  `pendingSprintModifiers`（§5.2）に積み、次の `beginSprint` で消費して即クリアする。現行 `EventOutcome` は
  org・予算・付与物しか持たないため、`EventOutcome.nextSprint`（後述）を追加して表す。

### 3.2 選択イベント（decision / リスク/リターンの 2〜3 択）

- ルート選択ではなく**その場の決断**。各選択肢に**リスクとリターンの両方**。**断る/安全側にも必ず代償**
  ——出荷を取らない＝四半期目標（`RunTotals.delivered`）から遅れる、加えて `EventOutcome.trust` による
  経営/顧客/チーム信頼の低下など、**実際に状態へ効く代償**を必ず持たせる（SPEC 9.4 の C 例＝経営信頼低下）。
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
  // 既存 EVENT_DEFS を無改修で通すため optional＋デフォルト（追加のみの段を壊さない。§7 step1）。
  kind?: 'judgment' | 'decision';   // 既定: choices 長 1 → 'judgment'、2 以上 → 'decision'
  weight?: number;                  // 既定: 1
  triggers?: Partial<Record<EventSignal, number>>; // 信号→重み倍率
}

interface EventChoice {
  // …既存（label/description/outcome）
  // 画面遷移を伴う選択の遷移先（旧 shop/rest/elite の統合）。
  // 既定（未指定）は通常スプリントへ進む。resolveBeat はこれで分岐する。
  leadsTo?: 'sprint' | 'sprint-elite' | 'shop' | 'rest';
}

interface EventOutcome {
  // …既存（delivered/morale/seniorHp/techDebt/budget/quality/…/grantRelic/grantCard）
  // 次スプリント限定の一時効果（一回消費。org の恒久変化とは別軸）。
  nextSprint?: SprintModifierDelta; // 例: reviewLoadAdd / reworkRateAdd / taskCountMul
  // ステークホルダー信頼の増減（SPEC 9.4 の「経営信頼低下」等を表す。安全側の代償に必須）。
  trust?: Partial<StakeholderTrust>; // { management?, customers?, team? }（負で低下）
  // 判定イベントが直接ハード敗北を起こす場合の理由（例: 'reviewFreeze'）。
  forceLose?: LoseReason;
}

type EventSignal =
  | 'techDebtHigh' | 'aiDependencyHigh' | 'aiLiteracyLow'
  | 'seniorHpLow'  | 'moraleLow' | 'qualityLow'
  | 'testCoverageHigh' | 'documentationHigh';
```

**`applyEventOutcome` の拡張（現行は org・予算・付与物のみ）**:

- **`delivered` を `RunTotals.delivered` にも加算する**（現行は `org.deliveryScore` だけ）。四半期レビューは
  `RunTotals.delivered` を見るため、ここを通さないとイベント出荷が Phase 8 の Delivery 目標に効かず、
  「出荷+30 を取る＝目標前進」「出荷0 の安全側＝目標から遅れる」というリスク/リターンが成立しない（#5）。
- **`trust` を `RunState.stakeholderTrust` へ適用**する（安全側の信頼低下を機械的な代償にする。#1）。
- **`forceLose` があれば即 `lost` へ**（`loseReason` を設定）。現行 `evaluateLose` は `reviewFreeze` を
  `totals.reviewQueuePeak` でしか判定しないため、レビュー停止を表す判定イベントは `forceLose` で明示的に
  敗北遷移させる（または同時に `reviewQueuePeak` を上限へ押し上げる）。これでハード敗北テストが書ける（#7）。
- `nextSprint` は `pendingSprintModifiers` へ積む（§5.2）。

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
title --START--> setup            // ラン開始直後は編成（Setup）。いきなり盤面を走らせない
setup --BEGIN--> sprint(1)        // 編成確定後に第1スプリント開始
sprint --SPRINT_DONE--> result | --BOSS_REVIEW--> quarterReview | --LOST--> lost
result --ACK--> draft --NEXT--> evolution --FINISH--> beat
beat  --ENTER_SPRINT--> sprint   // 判定適用後 / 非shop・rest の選択後（通常 or 高負荷）
      --ENTER_SHOP--> shop        // 「予算で補強」を取った
      --ENTER_REST--> rest        // 「一息つく」を取った
      --LOST--> lost              // 判定がハード敗北を引いた
shop --RESOLVE--> setup-pre        // 買い物後は編成可能な準備へ（採用メンバーを即配置できる）
rest --RESOLVE--> setup-pre        // 休息後も同様（recruit したメンバーを次スプリント前に配置）
setup-pre --BEGIN--> sprint        // 編成確定で次スプリント開始
quarterReview --REVIEW_WON--> won | --REVIEW_CONTINUE--> setup(次Q) | --REVIEW_LOST--> lost
```

- `event` フェーズは `beat` に統合（判定/選択の提示は `beat` が担う）。`shop`/`rest` は beat の選択から到達する
  サブ画面として存続（既存 UI 流用）。
- `setup` は新フェーズ（第1スプリント前の編成）。`setup`/`beat`/`shop`/`rest`/`setup-pre` では
  `assignMember`/`setMemberAi` を許可し、`sprint` 中は従来どおり no-op。
- **shop/rest の後に編成の隙間を残す**（`setup-pre`）。休息の `recruit` や予算補強の採用で増えたメンバーを、
  **次スプリント前に配置・AI配布できる**ようにする。これが無いと新規採用が 1 スプリント遅れて効き、shop/rest の
  価値が意図せず下がる（現行は休息後にマップへ戻り即投入できていた）。実装簡略化のため `setup-pre` は `setup` の
  再利用（同一画面・別入口）でよい。次四半期も `quarterReview --REVIEW_CONTINUE--> setup` で編成機会を保つ。

### 5.2 `RunState`（データモデル）

- **削除**: `map`/`position`/`visited`/`available`、型 `MapNode`/`RunMap`、`map.ts`。
- **追加**: `sprintIndexInQuarter`（1..N）、`sprintsPerQuarter`（N）、`beat`（提示中イベント: `{ eventId, kind }`）。
- **追加（スプリント種別の保持）**: 旧来は `MapNode.type` が通常/高負荷/ボスを表し、エンジンは
  これでタスク倍率（高負荷）と進化ポイント加算を決めていた（`engine.ts` の `beginSprint` /
  リザルト処理）。マップ撤去でこの情報が消えないよう、**`pendingSprintKind`**（次スプリントの種別。
  ビートの「高負荷案件を受ける」選択や、トラック最終＝`boss` で決まる）と **`currentSprintKind`**
  （進行中スプリントの種別。完了時の評価・進化ポイントまで保持）を `'normal' | 'elite' | 'boss'` で持つ。
  既定は `normal`、高負荷案件を受けたら `elite`。
  **`boss` 最優先ルール**: 次スプリントがトラック最終インデックスなら、ビートの選択に関わらず
  `pendingSprintKind='boss'` を強制し、その最終ビートでは「高負荷案件（elite）」の選択肢を提示しない。
  これで「elite を立てたのに boss にもなる」二重決定や、ボス/四半期レビューのスキップを防ぐ（§6 でテスト）。
- **追加（次スプリント限定の一時効果）**: `pendingSprintModifiers`（判定/選択が `EventOutcome.nextSprint` で
  積む一回限りの効果。例: レビュー負荷+ / Rework率+ / タスク数倍率）。`beginSprint` が消費して**即クリア**し、
  org の恒久変化とは別軸にする。既定は空（無効果）。
- `bossId` は維持（その四半期のボス。トラック最終スプリントで使う）。`eventId`/`shop` は流用。
- **`beginSprint` は `currentSprintKind`（= 直前に確定した `pendingSprintKind`）と `pendingSprintModifiers` を読む**
  ように変え、`MapNode` 依存（`node.type`）を置き換える。`elite` はタスク倍率＋進化ポイント加算、`boss` は
  ボスルールと `BOSS_REVIEW` 遷移、`pendingSprintModifiers` は当該スプリントのみ反映して消費する。

### 5.3 公開契約（`window.game` / `GameHandle`）

UI は `useRun.ts` 経由で `GameHandle` だけを触る。新フローを動かすには、**まず追加 API を増やし**
（`build`/`test` を保ったまま）、`enterNode` の撤去だけを最後に行う（§7 の段階に合わせる）。

- **追加（撤去より前の段で）**:
  - `resolveBeat(choiceIndex?)`: 判定は引数なし、選択は index。選択の `leadsTo` で sprint(通常/高負荷)/shop/rest へ分岐。
    「高負荷案件を受ける」なら `pendingSprintKind='elite'` を立て、次の `beginSprint` で消費する。必要なら `getBeat()`。
  - `beginSetupSprint()`: `setup`/`setup-pre` から次スプリントを開始する入口（`BEGIN` 相当）。初回 setup は beat を
    経由しないため `resolveBeat` では進めない。これが無いと `SetupScreen` から先へ進めず setup で詰まる。
- **削除（最後の段で）**: `enterNode(id)`。
- 型定義（`src/game.ts`）・`useRun.ts`・E2E 型・architecture §4.1 を更新。`enterNode` 撤去は**破壊的変更**なので
  E2E/smoke を `resolveBeat`/`beginSetupSprint` ベースへ同時に移す。

### 5.4 UI

- **削除**: `RunMapScreen`。
- **追加**: `SetupScreen`（第1スプリント前の編成。既存 `FormationScreen` を流用してよい）と
  `BeatScreen`（判定結果カード／選択肢を提示。「予算補強」「一息つく」は既存 `ShopScreen`/`RestScreen` へ）。
- 進行表示は**線形トラック**（Sprint i / N、次が山場か）に変更。`RunBar`/パンくず更新。

## 6. 決定論・テスト（第22.3 / 22.5）

- すべての抽選は seed 付き PRNG（key: 四半期番号＋スプリント index）。デイリーラン/リプレイ/再現が保てる。
- **Vitest**:
  - 重み付け: 技術的負債↑で debt/incident 系の確率が上がる（同一 org で決定論）。
  - 混合比: `DECISION_BEAT_CHANCE` 付近の出し分け。
  - 連結（`leadsTo`）: 高負荷選択→次スプリント elite 化／予算補強→shop／一息→rest の遷移。
  - スプリント種別の保持: 高負荷案件を受ける→`pendingSprintKind='elite'`→`beginSprint` で
    タスク倍率＋進化ポイント加算が効く（完了時まで `currentSprintKind` が保持される）。
  - **ボス優先**: 最終ビートでは elite 選択肢が出ない／`pendingSprintKind` が `boss` に強制される
    （elite を受けても最終スプリントは boss になる）。ボス/四半期レビューがスキップされないこと。
  - **次スプリント一時効果**: `EventOutcome.nextSprint` が `pendingSprintModifiers` に積まれ、当該スプリントで
    のみ反映され、完了後にクリアされる（翌スプリントへ持ち越さない）。
  - ボス到達: N スプリントでボス（`currentSprintKind='boss'`）→四半期レビュー。
  - **イベント出荷の反映**: `EventOutcome.delivered` が `RunTotals.delivered` に積まれ、四半期レビューの
    Delivery 進捗に効く（出荷+30 を取ると前進、出荷0 の安全側は遅れる）。
  - **信頼の代償**: `EventOutcome.trust` が `RunState.stakeholderTrust` を下げる（SPEC 9.4 の C 例）。
  - ハード敗北: `EventOutcome.forceLose='reviewFreeze'` の判定→`beat --LOST--> lost`（`loseReason` 設定）。
  - 初回編成: `setup`/`setup-pre`/`beat`/`shop`/`rest` 中は `assignMember`/`setMemberAi` が効き、`sprint` 中は no-op。
  - shop/rest 後の編成: 採用したメンバーを `setup-pre` で配置→次スプリントから即戦力になる（1スプリント遅れない）。
  - **中間段階の互換**（§7 step2-4）: `enterNode` の shim が `MapNode.type`→`pendingSprintKind` を写し、elite/boss
    ノードが normal で始まらない（高負荷報酬・ボス遷移が中間段階でも保たれる）。
- **Playwright**: ラン開始→Setup（編成）→スプリント→ビート（選択）→次スプリント→…→ボス→四半期レビューの通し。
  `enterNode` を使うテストは `resolveBeat`／`beginSetupSprint` ベースへ更新。

## 7. 段階的移行（リスクを抑える）

**原則: 撤去は利用側の置換と同じ段階で行う**。`map.ts`/`enterNode`/`RunState.map` は `src/App.tsx`・
`RunMapScreen`・`src/game.ts`・多数の E2E/unit が参照しているため、sim 層の段で先に消すとビルドが割れる。
各段の終わりで `npm test` / `build` が緑であることを不変条件とし、撤去は最後の置換段にまとめる。

1. **データ層（追加のみ・非破壊）**: `EventDef` に `kind?`/`weight?`/`triggers?`（**optional＋デフォルト**で
   既存 `EVENT_DEFS` 全件を無改修で通す）、`EventChoice` に `leadsTo?`、`EventOutcome` に `nextSprint?`/`trust?`/
   `forceLose?` を**追加**。`applyEventOutcome` を拡張し **`delivered` を `RunTotals.delivered` にも加算**・
   `trust` を `stakeholderTrust` へ適用・`forceLose` で敗北情報を返す。純関数 `weightedEventPool` と
   `leadsTo`/`nextSprint`/`trust`/`delivered→totals`/`forceLose` の適用を Vitest で先行検証。
2. **sim 層（追加のみ・旧経路温存＋互換 shim）**: `advanceBeat`/`resolveBeat`/`beginSetupSprint`、
   `pendingSprintKind`/`currentSprintKind`/`pendingSprintModifiers`、`setup`/`setup-pre` を **追加**する。
   `beginSprint` を「種別＋modifiers を読む」形へ切替えるが、**`map.ts`/`enterNode`/`RunState.map` はこの段では残す**。
   ただし `enterNode` 内に **`MapNode.type`→`pendingSprintKind` を写す互換 shim** を入れ、中間段階でも elite/boss が
   normal に落ちない（高負荷報酬・ボス→レビュー遷移を保つ）ようにする。
3. **state 層**: `runMachine` に `setup`/`setup-pre`/`beat` を追加（`map` も当面併存可）。
4. **契約（追加のみ）**: `game.ts`/`useRun.ts` に `resolveBeat`/`beginSetupSprint`/`getBeat` を**追加**
   （`enterNode` は残す）。これで UI 接続（step5）が新 API を呼べる。
5. **UI 層**: `SetupScreen`/`BeatScreen` を追加し、`App.tsx` を新フローへ接続。進行表示を線形化。
6. **テスト移行＋撤去（同一段階）**: E2E 型・smoke/run スペックを `resolveBeat`/`beginSetupSprint` ベースへ更新し、
   **同じコミット群で** `RunMapScreen`・`map.ts`・`enterNode`（と shim）・`RunState.map`・`runMachine.map` を撤去する。
   利用側の置換と撤去を同段にまとめることで、各段の `build`/`test` 緑を保つ。
7. **SPEC**: §8 の変更を反映し、第3/4.4 章の「実装状況」バナーを除去（実装が追いついたため）。

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
