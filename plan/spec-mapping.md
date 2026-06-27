# SPEC ↔ 実装フェーズ 対応表（実装済みフェーズ計画の集約）

[`SPEC.md`](../SPEC.md) の各章が、どのフェーズで実装され、コードのどこに対応するかを一望するための
トレーサビリティ表。実装が一通り完了したため、**従来フェーズごとに分かれていた計画ドキュメント
（`phase-0`〜`phase-8`）の要点をこのファイルに集約**した（§2 のフェーズ別サマリ）。

関連ドキュメント（集約対象外・継続利用）:
[architecture.md](./architecture.md)（技術スタック・レイヤ分離・横断規律） /
[follow-ups.md](./follow-ups.md)（各フェーズ実装後の繰り越し） /
[mockup-parity.md](./mockup-parity.md)（モックアップ乖離・SPEC 未充足の横断バックログ） /
[run-loop-redesign.md](./run-loop-redesign.md)（未着手の基本ループ再設計）。

> 状態列の凡例:
> - **✅ 実装済み** … SPEC の当該章を満たし、残務がない（または軽微）。
> - **🟡 一部実装** … 中核は動作するが、SPEC 記載の一部要素・モックアップ視覚到達・拡張が残る（残務は備考の追跡先へ）。
> - **— 非実装章** … 企画文・前提で、コード実装の対象ではない。
>
> 「🟡」はフェーズの DoD 未達を意味しない。各フェーズは DoD を満たして完了済みで、🟡 は
> **SPEC 章を細部まで充足し切るには残務がある**ことを示す（追跡先は [follow-ups.md](./follow-ups.md) /
> [mockup-parity.md](./mockup-parity.md) / [run-loop-redesign.md](./run-loop-redesign.md)）。

---

## 1. 章 → フェーズ → 実装（前方トレース）

| SPEC 章 | 内容 | フェーズ | 主な実装 / テスト | 状態 |
| --- | --- | --- | --- | --- |
| 1 | 企画概要 | — | （企画文・実装対象なし） | — |
| 2 | コンセプト（AI導入のコア因果） | M1 | `src/sim/sprint.ts`, `src/sim/model/process.ts` / `tests/unit/sprint.test.ts`, `process.test.ts` | ✅ |
| 2.1 | 世界観の制約 | 横断 | [architecture.md](./architecture.md) §4.5（イベント/ボス/敗北/称号の判断基準） | ✅ |
| 3 | ゲームの基本ループ | M3 / M8 | `src/state/runMachine.ts`, `src/sim/run/engine.ts`, `src/sim/run/map.ts` / `tests/unit/run-machine.test.ts`, `run-engine.test.ts` | 🟡 現行=分岐マップ。固定トラック＋イベント判定は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 4.1 | メイン画面: 開発ライン | M1 | `src/ui/SprintScreen.tsx`, `src/ui/OfficeRoom.tsx`, `OfficeActors.tsx`, `src/render/taskView.ts` / `tests/unit/taskView.test.ts` | ✅ |
| 4.2 | ステータス表示 | M1 | `src/ui/Hud.tsx`, `src/render/status.ts` / `tests/unit/status.test.ts` | ✅ |
| 4.3 | 介入アクションバー | M2 | `src/ui/ActionBar.tsx`, `src/sim/actions.ts`, `src/data/actions.ts` / `tests/unit/actions.test.ts`, `tests/e2e/interventions.spec.ts` | ✅ |
| 4.4 | スプリント間イベント画面 | M3 | `src/ui/EventScreen.tsx`, `src/sim/run/events.ts`, `src/data/events.ts` | 🟡 現行=ノード遷移。判定/混合ビートは [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 4.5 | 組織進化ツリー画面 | M3 | `src/ui/EvolutionScreen.tsx`, `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| 4.6 | スプリントリザルト画面 | M1 | `src/ui/SprintResultScreen.tsx`, `src/sim/outcome.ts` | ✅ |
| 4.6.1 | 四半期レビュー / 目標修正画面 | M8 | `src/ui/QuarterReviewScreen.tsx`, `src/sim/run/quarterReview.ts`, `src/data/goalAdjustments.ts` / `tests/unit/quarter-review.test.ts` | ✅ |
| 4.7–4.11 | 組織スケールとズーム階層 / 全社・部署・業界ビュー / 画面遷移 | M5 | `src/sim/orgscale/*`, `src/ui/OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx`, `src/render/orgScene.ts`, `orgCamera.ts` / `tests/unit/orgscale*.test.ts`, `tests/e2e/org-scale.spec.ts` | 🟡 4階層ズーム/集約/カメラ遷移は動作。全社・部署・業界の等角化（mockup 視覚到達）は [mockup-parity.md](./mockup-parity.md) §1-B〜1-E で残務 |
| 5 | プレイヤーが操作するリソース | M1 | `src/sim/types.ts`（`OrgState`）, `src/sim/org.ts` | ✅ |
| 6 | スプリント中の能動操作 | M2 | `src/sim/actions.ts`, `src/ui/ComboBadge.tsx`（6.2 コンボ）/ `tests/unit/combo.test.ts` | ✅ |
| 7 | AI導入施策カード（デッキ） | M2 | `src/sim/cards.ts`, `src/data/cards.ts`, `src/ui/CardView.tsx`, `DeckBar.tsx`, `DraftScreen.tsx` / `tests/unit/cards.test.ts` | ✅ |
| 8 | 組織文化レリック | M3 | `src/data/relics.ts`, `src/sim/run/effects.ts` | ✅ |
| 9 | ランダムイベント | M3 | `src/sim/run/events.ts`, `src/data/events.ts` / `tests/unit/run-systems.test.ts` | 🟡 イベントは実装済み。組織状態依存の重み付け・混合ビート化は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 10 | ランとボススプリント | M3 / M8 | `src/data/bosses.ts`, `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` | 🟡 ボス/四半期レビューは実装済み。トラック化は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 11 | 組織進化ツリー | M3 | `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| 12 | キャラクター育成 | M4 | `src/sim/member/*`, `src/data/members.ts`, `src/data/traits.ts`, `src/ui/FormationScreen.tsx` / `tests/unit/member.test.ts`, `run-roster.test.ts`, `tests/e2e/formation.spec.ts` | ✅ |
| 13 | 組織タイプ診断 | M3 | `src/sim/diagnosis.ts` / `tests/unit/run-systems.test.ts` | ✅ |
| 14 | 勝利条件 | M3 / M8 | `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` / `tests/unit/run-engine.test.ts`, `quarter-review.test.ts` | ✅ |
| 15 | 敗北条件 / 継続不能条件 | M3 / M8 | `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts`（即時敗北→継続判断へ） | ✅ |
| 16 | 難易度設定と試練 | M3 | `src/data/difficulties.ts`（4 難易度 + `TRIAL_DEFS`）, `src/sim/scenarios.ts` | 🟡 難易度4種は実装。試練は `low-focus`/`half-budget`/`flammable`/`review-cap` の4種のみで、SPEC §16 の「AI依存度の自然増加」等は未実装 |
| 17 | メタ進行とアンロック | M3 / M7 | `src/state/meta.ts`, `src/data/unlocks.ts`, `src/ui/MetaShopScreen.tsx`, `AchievementCollectionScreen.tsx` / `tests/unit/meta.test.ts`, `meta-unlock-run.test.ts`, `unlocks.test.ts` | 🟡 カード/レリックの永続解放・メタショップ・実績閲覧は実装。SPEC §17 の「開始時の組織（プリセット）解放」は未実装（`UnlockKind = 'card' \| 'relic'`、[mockup-parity.md](./mockup-parity.md) §2） |
| 18.1 | 基本演出 | M1 | `src/render/taskView.ts`, `src/ui/OfficeActors.tsx`, `src/styles.css` | 🟡 基本演出は実装。ベルトコンベア状の粒移動・AI暴走時の Review 突入は [mockup-parity.md](./mockup-parity.md) §1-A で残務 |
| 18.2 | ジューシーな手応え演出 | M2 | `src/ui/PointPops.tsx`, `ComboBadge.tsx` | 🟡 数字ポップ/`COMBO xN` は実装。延焼の連鎖・割り込みレビューのスイープ・ボスのスローモーは [mockup-parity.md](./mockup-parity.md) §1-A で残務 |
| 18.3 | 画面ステート（組織の空気感） | M3 | `src/render/status.ts`, `src/styles.css` | 🟡 昼/曇り/地獄の3トーンは実装。6 組織タイプ別の演出拡張は [mockup-parity.md](./mockup-parity.md) §2 で残務 |
| 18.4 | ご褒美演出 | M3 | `src/ui/RunResultScreen.tsx`, `src/ui/PointPops.tsx` | ✅ |
| 18（描画基盤） | 視覚表現の WebGL 化 | M6 | `src/render/adapters/pixiOrgRenderer.ts`, `selectRenderer.ts`, `src/ui/OrgPixiField.tsx` / `tests/e2e/org-pixi-visual.spec.ts`（`?renderer=pixi` で opt-in） | ✅ 全社マップを Pixi 化（盤面は DOM/SVG 継続。適用範囲拡張は [mockup-parity.md](./mockup-parity.md) §4） |
| 19 | 面白さの核 | 横断 | 各フェーズの体験設計に反映（M8 のリスク/リターン設計ほか） | ✅ |
| 20 | 教育的価値 | M3 | `src/sim/diagnosis.ts`（組織タイプ診断による気づき） | ✅ |
| 21 | MVPスコープ | 横断 | MVP1〜7 をフェーズ骨格として採用（§2 のフェーズ別サマリ） | ✅ |
| 22 | 技術構成 | M0 | `package.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `src/sim/rng.ts`, `src/sim/seed.ts` / `tests/unit/rng.test.ts`, `seed.test.ts` ／ 詳細は [architecture.md](./architecture.md) | 🟡 基盤・seed付き決定論・テスト二段構え（22.3/22.5）は実装。Web Worker(+Comlink) のモンテカルロ試算・Recharts/visx・IndexedDB(idb/Dexie) は未導入（[mockup-parity.md](./mockup-parity.md) §3/§4） |
| 23 | 拡張案 | M7 | デイリーランを実装: `tests/unit/daily-run.test.ts`, `tests/e2e/daily-run.spec.ts`（他の拡張案は未着手） | 🟡 |
| 24 | 企画の価値 | — | （企画文・実装対象なし） | — |
| 25 | 結論 | — | （企画文・実装対象なし） | — |

---

## 2. フェーズ別サマリ（旧 `phase-*.md` の集約）

各フェーズの「対応 MVP / SPEC 参照 / 目的 / 主な実装 / 完了状態」を集約した。詳細な設計判断・繰り越しは
[architecture.md](./architecture.md) と [follow-ups.md](./follow-ups.md) を参照。マイルストーンの依存関係は
[README.md](./README.md) を参照。

### M0 / Phase 0 — 基盤セットアップ

- **対応 MVP**: 前提（MVP の土台） / **SPEC 参照**: 第22章
- **目的**: `npm run dev` で空シェルが立ち上がり `npm test` が通る状態を作る。**sim を描画から分離し、seed付き決定論で書く**規律をここで確立する。
- **主な実装**: Vite + React + TypeScript、Zustand / XState / Framer Motion、Vitest / Playwright、ESLint + Prettier、`src/sim/rng.ts`（mulberry32）・`src/sim/seed.ts`・`?seed=`、`window.game`（`src/game.ts`）、[architecture.md](./architecture.md) §3 のディレクトリ構成。
- **完了状態（DoD）**: ✅ dev 起動・Vitest/Playwright 稼働・PRNG 決定論テスト緑・CI 緑。

### M1 / Phase 1 — スプリントシミュレーション

- **対応 MVP**: MVP1 / **SPEC 参照**: 第21章 MVP1 / 第4.1〜4.2章 / 第4.6章 / 第5章 / 第2章
- **目的**: 「AI を入れると Coding は速くなるが Review が詰まる」コア因果（第2章）を最小ループで成立させる。
- **主な実装**: `src/sim/types.ts`（`Task`/`Lane`/`OrgState`）, `src/sim/model/process.ts`（工程モデル）, `src/sim/sprint.ts`（AI フラグでの因果）, `src/render/taskView.ts`・`src/ui/SprintScreen.tsx`・`Hud.tsx`・`SprintResultScreen.tsx`。
- **完了状態（DoD）**: ✅ AI あり/なしで結果差・リザルト表示・不変条件テスト緑。
- **残務**: 18.1 の粒の流れ／AI暴走演出（[mockup-parity.md](./mockup-parity.md) §1-A）。

### M2 / Phase 2 — 能動操作とカード

- **対応 MVP**: MVP2 / **SPEC 参照**: 第6章 / 第4.3章 / 第7章 / 第18.2章
- **目的**: 「眺める」から「捌く」へ。介入アクション・集中力・コンボ・カードドラフトで、同じデッキでも捌き方次第で結果が変わるようにする。
- **主な実装**: `src/sim/actions.ts`・`src/data/actions.ts`・`src/ui/ActionBar.tsx`（介入）, `src/ui/ComboBadge.tsx`（コンボ）, `src/sim/cards.ts`・`src/data/cards.ts`・`src/ui/CardView.tsx`/`DeckBar.tsx`/`DraftScreen.tsx`（カード/ドラフト）, `src/ui/PointPops.tsx`（演出）。
- **完了状態（DoD）**: ✅ 介入/集中力/コンボ/ドラフトで結果が変わることを操作 E2E で確認。
- **残務**: 18.2 の延焼連鎖・スイープ・スローモー（[mockup-parity.md](./mockup-parity.md) §1-A）。

### M3 / Phase 3 — 周回・育成・診断

- **対応 MVP**: MVP3 / **SPEC 参照**: 第3章 / 第4.4〜4.5章 / 第8〜17章 / 第18.3章
- **目的**: 1ラン＝1四半期のローグライク周回（マップ→スプリント→リザルト→ドラフト→進化）を通しでプレイ可能にする。
- **主な実装**: `src/state/runMachine.ts`（XState フロー）, `src/sim/run/map.ts`（ランマップ）, `src/data/bosses.ts`, `src/sim/run/evolution.ts`・`src/data/evolution.ts`（進化ツリー）, `src/data/relics.ts`（レリック）, `src/sim/run/events.ts`・`src/data/events.ts`（イベント）, `src/sim/diagnosis.ts`（診断）, `src/data/difficulties.ts`（難易度/試練）, `src/state/meta.ts`（メタ進行）。
- **完了状態（DoD）**: ✅ マップ→ボス→解放まで通しプレイでき、診断/称号/勝敗が機能する。
- **残務**: 基本ループ再設計（第3/4.4/9/10、[run-loop-redesign.md](./run-loop-redesign.md)）、試練の不足（第16）、18.3 の6タイプ演出（[mockup-parity.md](./mockup-parity.md) §2）。

### M4 / Phase 4 — キャラクター育成

- **対応 MVP**: MVP4 / **SPEC 参照**: 第12章
- **目的**: 開発者・シニアを**個体**として育成・編成の対象にし、採用を「未来の主力をどう育てるか」の選択にする。
- **主な実装**: `src/sim/member/*`（個体・成長・スタミナ）, `src/data/members.ts`・`src/data/traits.ts`（トレイト）, `src/ui/FormationScreen.tsx`（編成）。
- **完了状態（DoD）**: ✅ 個体育成・編成が戦術として機能する。

### M5 / Phase 5 — 組織スケール（巨大組織対応）

- **対応 MVP**: MVP5 / **SPEC 参照**: 第4.7〜4.11章
- **目的**: 1チームの現場から複数部署の巨大組織へスケールし、現場↔部署↔全社↔業界を地続きにズームできるようにする。
- **主な実装**: `src/sim/orgscale/*`（集約・生成・業界・レバー）, `src/ui/OrgScreen.tsx`/`DeptScreen.tsx`/`IndustryScreen.tsx`/`Breadcrumb.tsx`, `src/render/orgScene.ts`・`orgIslandView.ts`・`orgCamera.ts`。
- **完了状態（DoD）**: ✅ 4階層ズーム・全社/部署/業界ビュー・カメラ遷移が動作する。
- **残務**: 全社・部署・業界の等角化（mockup 視覚到達、[mockup-parity.md](./mockup-parity.md) §1-B〜1-E）。

### M6 / Phase 6 / 6b — WebGL（PixiJS）移行

- **対応 MVP**: 拡張 / **SPEC 参照**: 第18章 / 第22.2章 / 第22.4章
- **目的**: 効果の大きい**全社マップ（数百〜数千オブジェクト）**のみ DOM/SVG から PixiJS + pixi-viewport へ局所差し替えする（過剰投資回避、第22.4）。
- **主な実装**: `src/render/iso.ts`（投影/深度/カリング/プール、純TS）, `src/render/adapters/pixiOrgRenderer.ts`・`selectRenderer.ts`, `src/ui/OrgPixiField.tsx`。既定は DOM/SVG、`?renderer=pixi` で opt-in。視覚回帰は `npm run test:e2e:pixi`。
- **完了状態（DoD）**: ✅ 6a（React 接続・pan/zoom・カリング）/ 6b（DOM 同等の情報量）/ 6c（カメラ同期）/ 6d（性能予算）/ 6e（Pixi 視覚回帰・opt-in）まで完了。性能予算（同時スプライト ≤500・60fps）を数値テストで固定。

### M7 / Phase 7 — メタ進行の閉ループ化

- **対応 MVP**: 拡張（MVP3 のメタ進行を完成）/ **SPEC 参照**: 第17章 / 第23章（デイリーラン）
- **目的**: 記録だけだったメタ進行を、**永続解放が次ランのドラフト/ショップに反映される閉ループ**にする。
- **主な実装**: `src/data/unlocks.ts`（解放定義）, `src/state/meta.ts`（解放集合・移行）, `src/sim/cards.ts`（`drawDraft(allowed)`）, `src/ui/MetaShopScreen.tsx`（メタショップ）, `src/ui/AchievementCollectionScreen.tsx`（実績閲覧）, デイリーラン（`dailySeed`・`startDailyRun`）。
- **完了状態（DoD）**: ✅ 永続解放が次ランに反映・メタショップ・実績閲覧・デイリーランまで実装済み。
- **残務**: 開始プリセット解放（第17、`UnlockKind` 未対応）、デイリー記録の業界ランキング接続（[mockup-parity.md](./mockup-parity.md) §2）。

### M8 / Phase 8 — 四半期レビューと目標修正

- **対応 MVP**: MVP7 / **SPEC 参照**: 第3章 / 第4.6.1章 / 第10章 / 第14〜15章 / 第19章
- **目的**: 目標未達を即ゲームオーバーにせず、**四半期レビューで原因を読み、目標を修正し、代償を払って継続する判断**としてゲーム化する。
- **主な実装**: `src/sim/run/types.ts`（`QuarterGoal`/`StakeholderTrust`/`QuarterOutcome`）, `src/sim/run/quarterReview.ts`・`quarterReviewSeeds.ts`（判定）, `src/data/goalAdjustments.ts`（6種の目標修正）, `src/ui/QuarterReviewScreen.tsx`, `src/state/runMachine.ts`（`quarterReview` 遷移）。
- **完了状態（DoD）**: ✅ 未達時に即 `lost` せずレビューへ遷移し、スコープ削減・期限延長・品質改善ピボット等で代償を払って次四半期へ継続できる。
- **残務**: 代償・outcome 閾値のバランス調整（[follow-ups.md](./follow-ups.md) / [mockup-parity.md](./mockup-parity.md) §3）。

> **MVP 連番の対応**: SPEC §21 の MVP1〜5 = M1〜M5、MVP6（メタ進行の閉ループ）= M7、MVP7（四半期レビューと目標修正）= M8。
> WebGL 移行（M6）は SPEC §22.4 の段階的移行に基づく拡張で MVP 連番には含まれない。

---

## 3. 未充足・再設計が残る箇所

| 項目 | 該当 SPEC 章 | 状態 | 追跡先 |
| --- | --- | --- | --- |
| 基本ループの再設計（分岐マップ廃止 → 固定トラック＋イベント判定） | 3, 4.4, 9, 10 | 🟡 設計合意済み・実装未着手 | [run-loop-redesign.md](./run-loop-redesign.md) |
| 全社・部署・業界ビューの等角化（mockup 視覚到達） | 4.7–4.11, 18 | 🟡 機能は動作・見た目が残務 | [mockup-parity.md](./mockup-parity.md) §1-B〜1-E |
| 演出の残務（粒の流れ・延焼連鎖・スイープ・スローモー・6タイプ演出） | 18.1, 18.2, 18.3 | 🟡 中核のみ実装 | [mockup-parity.md](./mockup-parity.md) §1-A, §2 |
| 試練の追加（AI依存度の自然増加 ほか） | 16 | 🟡 4種のみ実装 | [follow-ups.md](./follow-ups.md) |
| 開始プリセットの永続解放 | 17 | 🟡 未実装（カード/レリックのみ） | [mockup-parity.md](./mockup-parity.md) §2 |
| 技術構成の残項目（Web Worker+Comlink / Recharts・visx / IndexedDB） | 22 | 🟡 未導入 | [mockup-parity.md](./mockup-parity.md) §3, §4 |
| バランス調整（目標修正の代償・outcome 閾値・レバー・解放コスト） | 10, 14, 15, 16, 17 | 進行中 | [follow-ups.md](./follow-ups.md), [mockup-parity.md](./mockup-parity.md) §3 |
| 拡張案（デイリーラン以外: GitHub 連携・対抗ランキング ほか） | 23 | 未着手 | [follow-ups.md](./follow-ups.md), [mockup-parity.md](./mockup-parity.md) §2 |
