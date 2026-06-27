# SPEC ↔ 実装フェーズ 対応表

[`SPEC.md`](../SPEC.md) の各章が、どのフェーズ（[`plan/`](./README.md) の `phase-*.md`）で実装され、
コードのどこに対応するかを一望するためのトレーサビリティ表。各フェーズの DoD・繰り越しは [follow-ups.md](./follow-ups.md)、
横断バックログは [mockup-parity.md](./mockup-parity.md) を参照。

> 読み方:
> - **フェーズ**列は実装の主担当。複数フェーズで段階的に積み増した章は両方を記載する。
> - **状態**列の凡例: ✅ 実装済み / 🟡 一部実装（再設計・拡張が残る） / — 非実装章（企画文・前提）。
> - SPEC §3・9・10 の基本ループは「現行=分岐マップ実装済み」だが、SPEC が目標仕様とする
>   **固定トラック＋イベント判定**への移行は未着手（[run-loop-redesign.md](./run-loop-redesign.md)）。該当行は 🟡。

---

## 1. 章 → フェーズ → 実装（前方トレース）

| SPEC 章 | 内容 | フェーズ | 主な実装 / テスト | 状態 |
| --- | --- | --- | --- | --- |
| 1 | 企画概要 | — | （企画文・実装対象なし） | — |
| 2 | コンセプト（AI導入のコア因果） | [phase-1](./phase-1-sprint-simulation.md) | `src/sim/sprint.ts`, `src/sim/model/process.ts` / `tests/unit/sprint.test.ts`, `process.test.ts` | ✅ |
| 2.1 | 世界観の制約 | 横断 | [architecture.md](./architecture.md) §4.5（イベント/ボス/敗北/称号の判断基準） | ✅ |
| 3 | ゲームの基本ループ | [phase-3](./phase-3-roguelike-loop.md) / [phase-8](./phase-8-goal-adjustment.md) | `src/state/runMachine.ts`, `src/sim/run/engine.ts`, `src/sim/run/map.ts` / `tests/unit/run-machine.test.ts`, `run-engine.test.ts` | 🟡 現行=分岐マップ。固定トラック＋イベント判定は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 4.1 | メイン画面: 開発ライン | [phase-1](./phase-1-sprint-simulation.md) | `src/ui/SprintScreen.tsx`, `src/render/taskView.ts`, `src/render/Board.tsx` / `tests/unit/taskView.test.ts` | ✅ |
| 4.2 | ステータス表示 | [phase-1](./phase-1-sprint-simulation.md) | `src/ui/Hud.tsx`, `src/render/status.ts` / `tests/unit/status.test.ts` | ✅ |
| 4.3 | 介入アクションバー | [phase-2](./phase-2-active-ops-and-cards.md) | `src/ui/ActionBar.tsx`, `src/sim/actions.ts`, `src/data/actions.ts` / `tests/unit/actions.test.ts`, `tests/e2e/interventions.spec.ts` | ✅ |
| 4.4 | スプリント間イベント画面 | [phase-3](./phase-3-roguelike-loop.md) | `src/ui/EventScreen.tsx`, `src/sim/run/events.ts`, `src/data/events.ts` | 🟡 現行=ノード遷移。判定/混合ビートは [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 4.5 | 組織進化ツリー画面 | [phase-3](./phase-3-roguelike-loop.md) | `src/ui/EvolutionScreen.tsx`, `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| 4.6 | スプリントリザルト画面 | [phase-1](./phase-1-sprint-simulation.md) | `src/ui/SprintResultScreen.tsx`, `src/sim/outcome.ts` | ✅ |
| 4.6.1 | 四半期レビュー / 目標修正画面 | [phase-8](./phase-8-goal-adjustment.md) | `src/ui/QuarterReviewScreen.tsx`, `src/sim/run/quarterReview.ts`, `src/data/goalAdjustments.ts` / `tests/unit/quarter-review.test.ts` | ✅ |
| 4.7–4.11 | 組織スケールとズーム階層 / 全社・部署・業界ビュー / 画面遷移 | [phase-5](./phase-5-org-scale.md) | `src/sim/orgscale/*`, `src/ui/OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx`, `src/render/orgScene.ts`, `orgCamera.ts` / `tests/unit/orgscale*.test.ts`, `orgScene.test.ts`, `tests/e2e/org-scale.spec.ts` | ✅ |
| 5 | プレイヤーが操作するリソース | [phase-1](./phase-1-sprint-simulation.md) | `src/sim/types.ts`（`OrgState`）, `src/sim/org.ts` | ✅ |
| 6 | スプリント中の能動操作 | [phase-2](./phase-2-active-ops-and-cards.md) | `src/sim/actions.ts`, `src/ui/ComboBadge.tsx`（6.2 コンボ）/ `tests/unit/combo.test.ts` | ✅ |
| 7 | AI導入施策カード（デッキ） | [phase-2](./phase-2-active-ops-and-cards.md) | `src/sim/cards.ts`, `src/data/cards.ts`, `src/ui/CardView.tsx`, `DeckBar.tsx`, `DraftScreen.tsx` / `tests/unit/cards.test.ts` | ✅ |
| 8 | 組織文化レリック | [phase-3](./phase-3-roguelike-loop.md) | `src/data/relics.ts`, `src/sim/run/effects.ts` | ✅ |
| 9 | ランダムイベント | [phase-3](./phase-3-roguelike-loop.md) | `src/sim/run/events.ts`, `src/data/events.ts` / `tests/unit/run-systems.test.ts` | 🟡 イベント自体は実装済み。組織状態依存の重み付け・混合ビート化は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 10 | ランとボススプリント | [phase-3](./phase-3-roguelike-loop.md) / [phase-8](./phase-8-goal-adjustment.md) | `src/data/bosses.ts`, `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` | 🟡 ボス/四半期レビューは実装済み。トラック化は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| 11 | 組織進化ツリー | [phase-3](./phase-3-roguelike-loop.md) | `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| 12 | キャラクター育成 | [phase-4](./phase-4-character-growth.md) | `src/sim/member/*`, `src/data/members.ts`, `src/data/traits.ts`, `src/ui/FormationScreen.tsx` / `tests/unit/member.test.ts`, `run-roster.test.ts`, `tests/e2e/formation.spec.ts` | ✅ |
| 13 | 組織タイプ診断 | [phase-3](./phase-3-roguelike-loop.md) | `src/sim/diagnosis.ts` / `tests/unit/run-systems.test.ts` | ✅ |
| 14 | 勝利条件 | [phase-3](./phase-3-roguelike-loop.md) / [phase-8](./phase-8-goal-adjustment.md) | `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` / `tests/unit/run-engine.test.ts`, `quarter-review.test.ts` | ✅ |
| 15 | 敗北条件 / 継続不能条件 | [phase-3](./phase-3-roguelike-loop.md) / [phase-8](./phase-8-goal-adjustment.md) | `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts`（即時敗北→継続判断へ） | ✅ |
| 16 | 難易度設定と試練 | [phase-3](./phase-3-roguelike-loop.md) | `src/data/difficulties.ts`, `src/sim/scenarios.ts` | ✅ |
| 17 | メタ進行とアンロック | [phase-3](./phase-3-roguelike-loop.md) / [phase-7](./phase-7-meta-progression.md) | `src/state/meta.ts`, `src/data/unlocks.ts`, `src/ui/MetaShopScreen.tsx`, `AchievementCollectionScreen.tsx` / `tests/unit/meta.test.ts`, `meta-unlock-run.test.ts`, `unlocks.test.ts` | ✅ |
| 18.1 | 基本演出 | [phase-1](./phase-1-sprint-simulation.md) | `src/render/taskView.ts`, `src/styles.css` | ✅ |
| 18.2 | ジューシーな手応え演出 | [phase-2](./phase-2-active-ops-and-cards.md) | `src/ui/PointPops.tsx`, `ComboBadge.tsx` | ✅ |
| 18.3 | 画面ステート（組織の空気感） | [phase-3](./phase-3-roguelike-loop.md) | `src/render/status.ts`, `src/styles.css` | ✅ |
| 18.4 | ご褒美演出 | [phase-3](./phase-3-roguelike-loop.md) | `src/ui/RunResultScreen.tsx`, `src/ui/PointPops.tsx` | ✅ |
| 18（描画基盤） | 視覚表現の WebGL 化 | [phase-6](./phase-6-webgl-migration.md) / [phase-6b](./phase-6b-pixi-visual-parity.md) | `src/render/adapters/pixiOrgRenderer.ts`, `selectRenderer.ts`, `src/ui/OrgPixiField.tsx` / `tests/e2e/org-pixi-visual.spec.ts`（`?renderer=pixi` で opt-in） | ✅ |
| 19 | 面白さの核 | 横断 | 各フェーズの体験設計に反映（[phase-8](./phase-8-goal-adjustment.md) のリスク/リターン議論ほか） | ✅ |
| 20 | 教育的価値 | [phase-3](./phase-3-roguelike-loop.md) | `src/sim/diagnosis.ts`（組織タイプ診断による気づき） | ✅ |
| 21 | MVPスコープ | 横断 | MVP1〜7 をフェーズ骨格として採用（[README.md](./README.md) のマイルストーン表）| ✅ |
| 22 | 技術構成 | [phase-0](./phase-0-foundation.md) | `package.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `src/sim/rng.ts`, `src/sim/seed.ts` / `tests/unit/rng.test.ts`, `seed.test.ts` ／ 詳細は [architecture.md](./architecture.md) | ✅ |
| 23 | 拡張案 | [phase-7](./phase-7-meta-progression.md) | デイリーランを実装: `tests/unit/daily-run.test.ts`, `tests/e2e/daily-run.spec.ts`（他の拡張案は未着手） | 🟡 |
| 24 | 企画の価値 | — | （企画文・実装対象なし） | — |
| 25 | 結論 | — | （企画文・実装対象なし） | — |

---

## 2. フェーズ → 章（後方トレース）

| フェーズ | マイルストーン | カバーする SPEC 章 |
| --- | --- | --- |
| [phase-0](./phase-0-foundation.md) | M0 基盤 | 22 |
| [phase-1](./phase-1-sprint-simulation.md) | M1 スプリント | 2, 4.1, 4.2, 4.6, 5, 18.1 |
| [phase-2](./phase-2-active-ops-and-cards.md) | M2 能動操作・カード | 4.3, 6, 7, 18.2 |
| [phase-3](./phase-3-roguelike-loop.md) | M3 周回・育成・診断 | 3, 4.4, 4.5, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18.3, 18.4, 20 |
| [phase-4](./phase-4-character-growth.md) | M4 メンバー育成 | 12 |
| [phase-5](./phase-5-org-scale.md) | M5 巨大組織 | 4.7–4.11 |
| [phase-6](./phase-6-webgl-migration.md) / [phase-6b](./phase-6b-pixi-visual-parity.md) | M6 WebGL 移行 | 18（描画基盤）, 22.2, 22.4 |
| [phase-7](./phase-7-meta-progression.md) | M7 メタ進行の閉ループ | 17, 23 |
| [phase-8](./phase-8-goal-adjustment.md) | M8 四半期レビューと目標修正 | 3, 4.6.1, 10, 14, 15, 19 |

> MVP 連番の対応: SPEC §21 の MVP1〜5 = phase-1〜5、MVP6（メタ進行の閉ループ）= phase-7、
> MVP7（四半期レビューと目標修正）= phase-8。WebGL 移行（phase-6/6b）は SPEC §22.4 の段階的移行に基づく拡張で MVP 連番には含まれない。

---

## 3. 未充足・再設計が残る箇所

| 項目 | 該当 SPEC 章 | 状態 | 追跡先 |
| --- | --- | --- | --- |
| 基本ループの再設計（分岐マップ廃止 → 固定トラック＋イベント判定） | 3, 4.4, 9, 10 | 🟡 設計合意済み・実装未着手 | [run-loop-redesign.md](./run-loop-redesign.md) |
| バランス調整（目標修正の代償・outcome 閾値ほか） | 10, 14, 15 | 進行中 | [follow-ups.md](./follow-ups.md) |
| 拡張案（デイリーラン以外） | 23 | 未着手 | [follow-ups.md](./follow-ups.md) |
| モックアップ乖離・SPEC 未充足の横断課題 | 4 系ほか | バックログ | [mockup-parity.md](./mockup-parity.md) |
