# フェーズ7: メタ進行の閉ループ化（永続アンロック・メタショップ・デイリーラン）

| 項目 | 内容 |
| --- | --- |
| 対応 MVP | 拡張（MVP3 のメタ進行を完成させる） |
| SPEC 参照 | 第17章（メタ進行とアンロック） / 第23章（拡張案: デイリーラン） |
| 前提 | M0〜M6 完了。`src/state/meta.ts`・`src/sim/run/engine.ts`・`src/sim/cards.ts`・`src/data/`（cards / relics / difficulties） |
| 次フェーズ | （拡張案 / 第23章: ジューシー演出・バランス検証基盤・GitHub 連携） |

---

## 目的

ランをまたいで蓄積する**メタ進行を、実際のゲームプレイへ還元する閉ループにする**。

現状のメタ進行（`src/state/meta.ts`）は points / 難易度解放 / 撃破ボス / 実績 / ベストスコアを **記録するだけ**で、ゲームへ戻っているのは難易度解放のみ。SPEC 第17章の「**解放した要素は次のランのドラフトやショップに登場するようになる**」が未実装で、points は消費先が無く、実績はラベル止まり。これを以下で閉じる。

- カード／レリック／開始プリセットに**解放状態**を持たせ、ドラフト・ショップのプールを解放済みだけに絞る純関数を導入する。
- 蓄積した points を消費してコンテンツを永続解放する**メタショップ**を追加する。
- 実績を**コレクションとして閲覧**できるようにする。
- 同一シードで競う**デイリーラン**（第23章）を追加し、業界ランキング（MVP5）とメタ進行を接続する第一歩にする。

> 規律: ロジックはすべて `src/sim/`・`src/state/` の**純関数／seed付き決定論**に置き、描画は読むだけ（architecture §2 / §4.1）。永続化は localStorage を差し替え可能な `MetaStorage` で受ける（既存方針を踏襲）。`window.game` に操作を足す場合は型・E2E 型・architecture §4.1 を同時更新する。

---

## サブステップ

| # | 内容 | 主レイヤ | DoD |
| --- | --- | --- | --- |
| 7a | アンロック・データモデルと解放判定（純関数） | data / state | 解放対象テーブル＋`unlockedContent(meta)` 純関数。Vitest 緑 |
| 7b | 解放プールのラン反映（ドラフト／ショップ／レリック） | sim / state | `drawDraft` 等が解放セットを受け、未解放は出ない。既存 seed 回帰を確認 |
| 7c | メタショップ（points 消費で永続解放） | state / ui | points を消費して解放が保存され、次ランに登場。Vitest＋E2E 1 本 |
| 7d | 実績コレクション閲覧 | ui | 取得済み／未取得を一覧表示。獲得条件のヒントを出す |
| 7e | デイリーラン（共有シード） | sim / state / ui | 日付→seed 固定・難易度固定で開始でき、結果がメタへ記録される |

依存: 7a →（7b・7c は 7a に依存し並行可）→ 7d・7e は 7c の後。最小で「閉ループが回る」のは 7a→7b→7c まで。7d・7e は周回動機の上積み。

---

## タスク詳細

### 7a. アンロック・データモデルと解放判定

- カード（`CardDef`）／レリック（`RelicDef`）に**解放区分**を持たせる。既定解放（最初から出る）と、メタ解放（points 購入や実績で開く）を区別する。実データの大半は既定解放のままにし、新規追加分や強カードを解放対象に回す（バランスは暫定で可、`src/data/` 編集だけで調整できる形を保つ／architecture §4.3）。
- 解放対象を宣言的に定義する **`src/data/unlocks.ts`**（仮）を新設: `{ id, kind: 'card'|'relic'|'preset', cost, requires?: achievementId, label, description }`。
- **`src/state/meta.ts`** に解放済み集合を追加: `unlockedCards: string[]` / `unlockedRelics: string[]` / `unlockedPresets: string[]`（後方互換のため `loadMeta` の既定マージで欠損を埋める。`STORAGE_KEY` を `:v2` に上げ、`v1` からの移行は欠損フィールド補完で吸収）。
- 解放状態を 1 つにまとめる純関数 **`unlockedContent(meta): { cards: Set<string>; relics: Set<string>; presets: Set<string> }`** を用意（既定解放 ∪ メタ解放）。
- points 消費の純関数 **`purchaseUnlock(meta, unlockId): { meta, ok, reason? }`**（残高・前提実績・二重購入をチェックして不変更新）。

### 7b. 解放プールのラン反映

- `drawDraft(rng, count, allowed?: ReadonlySet<string>)` を拡張し、`allowed` 指定時は `CARD_DEFS` を解放済みに絞ってから抽選する（未指定時は従来どおり＝テスト後方互換）。
- `RunEngine` がランの開始時に解放セットを受け取れるようにする（`createRunEngine({ ..., unlocked })` か `startRun` 引数）。`buildShop` のカード抽選・`offerRelic` のレリックプールも解放セットでフィルタする。
- `game.ts` は `loadMeta()` → `unlockedContent(meta)` を解決してエンジンへ渡す。**ラン中は固定**（ラン内で解放しても次ランから反映）にして決定論を保つ。
- **回帰確認**: 既存の draft / shop / run-engine テストは `allowed` 未指定パスを使い続けるので結果不変。解放絞り込みは新規テストで検証する。

### 7c. メタショップ（points 消費で永続解放）

- タイトル画面から開く**メタショップ画面**（`src/ui/MetaShopScreen.tsx` 仮）。解放可能一覧（コスト・前提・購入済み）を表示し、購入で `purchaseUnlock` → `saveMeta`。
- `game.ts` に `purchaseMetaUnlock(unlockId)` を追加（`GameHandle` 型・E2E 型・architecture §4.1 を同時更新）。`getMeta()` は既存。
- 表示は mockups のトーンに合わせる（派手にしすぎない。世界観制約 §4.5: 「研修費でツール解禁」程度の現実的な比喩）。

### 7d. 実績コレクション閲覧

- `ACHIEVEMENT_LABEL`（既存）に**獲得条件の説明**を併記したコレクション表示（タイトル or 専用画面）。取得済み／未取得をグレーアウトで区別。
- 称号（`WinType`）の永続記録を検討（フェーズ3フォローアップ「称号の永続化」を回収）。最小では「勝利種別ごとの達成有無」を meta に足して一覧化。

### 7e. デイリーラン（共有シード）

- 日付（`currentDate` 基準の UTC 日付文字列）から **決定論シードを導出**する純関数（`dailySeed(dateStr)`）。難易度・試練は固定セットにする。
- `game.ts` に `startDailyRun(dateStr?)` を追加（内部は `startRun(fixedDifficulty, fixedTrials, dailySeed(...))`）。結果は通常どおりメタへ記録。
- ローカル擬似リーダーボード: その日のベストスコアを meta に保存し、業界ランキングビュー（MVP5）へ「自分のデイリー記録」として差し込めるかを検討（バックエンド配信はスコープ外 / architecture §1）。

---

## データ／描画前提

- 新規 UI（メタショップ・実績コレクション）は既定の DOM/SVG（React＋Framer Motion）。Pixi は不要。
- 解放・購入・デイリーのロジックは描画非依存の純TS。localStorage は `MetaStorage` 経由でテスト時にモックする（既存方針）。

## 成果物

ランをクリアして points と実績を貯めると、メタショップで新カード／レリック／開始プリセットを永続解放でき、次ランのドラフト・ショップに登場する。実績はコレクションとして閲覧でき、デイリーランで同一シードのスコアを競える。

## テスト

- **Vitest（厚め）**: `unlockedContent` / `purchaseUnlock`（残高不足・前提未達・二重購入）/ `drawDraft(allowed)` の絞り込み / 解放セット反映後の shop・relic プール / `loadMeta` の v1→v2 移行 / `dailySeed` の決定論。
- **Playwright（薄め）**: クリア→points 取得→メタショップで解放→次ランのドラフトに該当カードが出る、を `window.game` 経由の seed 固定で 1 本。デイリーランの開始導線を 1 本。
- 既存テスト（draft / shop / run-engine / meta）が**緑のまま**であること（後方互換パスを維持）。

## 完了の目安（DoD）

- 周回でメタ進行 points・実績が増え、メタショップでの永続解放が**次ランのドラフト／ショップに反映**される（SPEC 第17章の閉ループが成立）。
- 実績がコレクションとして閲覧でき、デイリーラン（共有シード）で開始・記録できる。
- `npm run lint` / `npm run format:check` / `npm test` / `npm run build` が緑。E2E の追加 2 本が緑。

## リスク・留意点

- **後方互換**: `drawDraft` の追加引数は省略可にし、既存テストと挙動を変えない。`MetaState` のスキーマ拡張は `loadMeta` の既定マージで吸収（`:v2`）。
- **バランス**: 解放対象のコスト・効果は暫定。フェーズ1/4/5 フォローアップの「モンテカルロでの許容レンジ化」と統一して後続調整する（解放追加でプールが歪まないかは統計テスト基盤フェーズで検証）。
- **決定論**: 解放セットは**ラン開始時に固定**し、ラン中は変化させない（seed 再現性を壊さない）。
- **世界観制約（§4.5）**: 解放・デイリーの演出は現実の開発組織の範囲（研修・ツール解禁・社内コンテスト等）に留める。
