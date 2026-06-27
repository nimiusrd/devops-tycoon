# SPEC ↔ 実装フェーズ 対応表（実装済みフェーズ計画の集約）

[`SPEC.md`](../SPEC.md) の各章が、どのフェーズで実装され、コードのどこに対応するかを一望するための
トレーサビリティ表。実装が一通り完了したため、**従来フェーズごとに分かれていた計画ドキュメント
（`phase-0`〜`phase-8`）の要点をこのファイルに集約**した（§2 のフェーズ別サマリ）。各章番号は SPEC.md の
該当見出しへリンクしている。

関連ドキュメント（集約対象外・継続利用）:
[architecture.md](./architecture.md)（技術スタック・レイヤ分離・横断規律） /
[follow-ups.md](./follow-ups.md)（各フェーズ実装後の繰り越し） /
[mockup-parity.md](./mockup-parity.md)（モックアップ乖離・SPEC 未充足の横断バックログ） /
[run-loop-redesign.md](./run-loop-redesign.md)（未着手の基本ループ再設計）。

> 状態列の凡例:
> - **✅ 実装済み** … SPEC の当該章の**中核要件**を満たし、残務がない（または軽微）。SPEC が描く理想の全要素を漏れなく実装済み、という意味ではない。
> - **🟡 一部実装** … 中核は動作するが、SPEC 記載の一部要素・操作方式・モックアップ視覚到達・拡張が残る（残務は備考の追跡先へ）。
> - **— 非実装章** … 企画文・前提で、コード実装の対象ではない。
>
> 「🟡」はフェーズの DoD 未達を意味しない。各フェーズは DoD を満たして完了済みで、🟡 は
> **SPEC 章を細部まで充足し切るには残務がある**ことを示す（追跡先は [follow-ups.md](./follow-ups.md) /
> [mockup-parity.md](./mockup-parity.md) / [run-loop-redesign.md](./run-loop-redesign.md)）。

---

## 1. 章 → フェーズ → 実装（前方トレース）

| SPEC 章 | 内容 | フェーズ | 主な実装 / テスト | 状態 |
| --- | --- | --- | --- | --- |
| [1](../SPEC.md#1-企画概要) | 企画概要 | — | （企画文・実装対象なし） | — |
| [2](../SPEC.md#2-コンセプト) | コンセプト（AI導入のコア因果） | M1 | `src/sim/sprint.ts`, `src/sim/model/process.ts` / `tests/unit/sprint.test.ts`, `process.test.ts` | ✅ |
| [2.1](../SPEC.md#21-世界観の制約現実の開発組織から大きく逸脱しない) | 世界観の制約 | 横断 | [architecture.md](./architecture.md) §4.5（イベント/ボス/敗北/称号の判断基準） | ✅ |
| [3](../SPEC.md#3-ゲームの基本ループ) | ゲームの基本ループ | M3 / M8 | `src/state/runMachine.ts`, `src/sim/run/engine.ts`, `src/sim/run/map.ts` / `tests/unit/run-machine.test.ts`, `run-engine.test.ts` | 🟡 現行=分岐マップ。固定トラック＋イベント判定は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| [4.1](../SPEC.md#41-メイン画面-開発ライン能動操作フェーズ) | メイン画面: 開発ライン | M1 | `src/ui/SprintScreen.tsx`, `src/ui/OfficeRoom.tsx`, `OfficeActors.tsx`, `src/render/taskView.ts` / `tests/unit/taskView.test.ts` | 🟡 8種のタスク見た目・レーン・介入バーは実装。§4.1 の「粒として流れるライン」は工程間が静的配置（山）で、ベルトコンベア状の流れ・渋滞の可視化は未実装（[mockup-parity.md](./mockup-parity.md) §1-A） |
| [4.2](../SPEC.md#42-ステータス表示) | ステータス表示 | M1 | `src/ui/Hud.tsx`, `src/render/status.ts` / `tests/unit/status.test.ts` | ✅ |
| [4.3](../SPEC.md#43-介入アクションバー) | 介入アクションバー | M2 | `src/ui/ActionBar.tsx`, `src/sim/actions.ts`, `src/data/actions.ts` / `tests/unit/actions.test.ts`, `tests/e2e/interventions.spec.ts` | ✅ |
| [4.4](../SPEC.md#44-スプリント間イベント画面判定--選択) | スプリント間イベント画面 | M3 | `src/ui/EventScreen.tsx`, `src/sim/run/events.ts`, `src/data/events.ts` | 🟡 現行=ノード遷移。判定/混合ビートは [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| [4.5](../SPEC.md#45-組織進化ツリー画面) | 組織進化ツリー画面 | M3 | `src/ui/EvolutionScreen.tsx`, `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| [4.6](../SPEC.md#46-スプリントリザルト画面) | スプリントリザルト画面 | M1 | `src/ui/SprintResultScreen.tsx`, `src/sim/outcome.ts` | 🟡 Done/Delivered/Combo/AI率/Review Max/Rework/Incidents（鎮火・延焼）/評価/診断/称号は実装。§4.6 例の「介入: 割り込み×3 / 緊急対応×1」の介入内訳は `SprintResult` に未集計で表示なし（`summarizeSprint` が `interventionsUsed`/`focusSpent` を渡していない） |
| [4.6.1](../SPEC.md#461-四半期レビュー--目標修正画面) | 四半期レビュー / 目標修正画面 | M8 | `src/ui/QuarterReviewScreen.tsx`, `src/sim/run/quarterReview.ts`, `src/data/goalAdjustments.ts` / `tests/unit/quarter-review.test.ts` | ✅ |
| [4.7–4.11](../SPEC.md#47-組織スケールとズーム階層巨大組織対応) | 組織スケールとズーム階層 / 全社・部署・業界ビュー / 画面遷移 | M5 | `src/sim/orgscale/*`, `src/ui/OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx`, `src/render/orgScene.ts`, `orgCamera.ts` / `tests/unit/orgscale*.test.ts`, `tests/e2e/org-scale.spec.ts` | 🟡 4階層ズーム/集約/カメラ遷移は動作。全社・部署・業界の等角化（mockup 視覚到達）は [mockup-parity.md](./mockup-parity.md) §1-B〜1-E で残務 |
| [5](../SPEC.md#5-プレイヤーが操作するリソース) | プレイヤーが操作するリソース | M1 / M2 / M3 | `src/sim/types.ts`（`OrgState` の基本リソース・`SprintState.focus`=集中力）, `src/sim/org.ts`, `src/sim/run/types.ts`（`RunState.budget`=予算・`EvolutionState.points`=進化ポイント） | ✅ |
| [6](../SPEC.md#6-スプリント中の能動操作) | スプリント中の能動操作 | M2 | `src/sim/actions.ts`, `src/ui/ComboBadge.tsx`（6.2 コンボ）/ `tests/unit/combo.test.ts` | 🟡 介入8種・集中力・コンボは実装。§6.1「タスク差配」は対象/担当をドラッグ選択する操作ではなく `assignTask` のボタン自動選択に留まる |
| [7](../SPEC.md#7-ai導入施策カードデッキ) | AI導入施策カード（デッキ） | M2 | `src/sim/cards.ts`, `src/data/cards.ts`, `src/ui/CardView.tsx`, `DeckBar.tsx`, `DraftScreen.tsx` / `tests/unit/cards.test.ts` | 🟡 ドラフト/強化は実装。§7.1 の「手札配布→発動」は未実装で、現状は `deckEffects` がデッキ全体を毎スプリントの係数へ畳み込む方式（手札・発動 API なし） |
| [8](../SPEC.md#8-組織文化レリック) | 組織文化レリック | M3 | `src/data/relics.ts`, `src/sim/run/effects.ts` | 🟡 恒久パッシブとして実装。入手はイベント選択・ショップ購入のみで、§8 のボス報酬としてのレリック入手は未実装（ボス解決は四半期レビューへ進む） |
| [9](../SPEC.md#9-ランダムイベント周回進行の中核エンジン) | ランダムイベント | M3 | `src/sim/run/events.ts`, `src/data/events.ts` / `tests/unit/run-systems.test.ts` | 🟡 イベントは実装済み。組織状態依存の重み付け・混合ビート化は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| [10](../SPEC.md#10-ランとボススプリント) | ランとボススプリント | M3 / M8 | `src/data/bosses.ts`, `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` | 🟡 ボス/四半期レビューは実装済み。トラック化は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| [11](../SPEC.md#11-組織進化ツリー) | 組織進化ツリー | M3 | `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| [12](../SPEC.md#12-キャラクター育成) | キャラクター育成 | M4 | `src/sim/member/*`, `src/data/members.ts`, `src/data/traits.ts`, `src/ui/FormationScreen.tsx` / `tests/unit/member.test.ts`, `run-roster.test.ts`, `tests/e2e/formation.spec.ts` | 🟡 個体ステータス・6トレイト・成長/昇格・編成・スタミナ離脱は実装。§12.2 の「メンバー状態のキャラ表情への反映（疲れ顔/ガッツポーズ）」は未実装（[mockup-parity.md](./mockup-parity.md) §1-A） |
| [13](../SPEC.md#13-組織タイプ診断) | 組織タイプ診断 | M3 | `src/sim/diagnosis.ts` / `tests/unit/run-systems.test.ts` | ✅ |
| [14](../SPEC.md#14-勝利条件) | 勝利条件 | M3 / M8 | `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` / `tests/unit/run-engine.test.ts`, `quarter-review.test.ts` | ✅ |
| [15](../SPEC.md#15-敗北条件--継続不能条件) | 敗北条件 / 継続不能条件 | M3 / M8 | `src/sim/outcome.ts`（`evaluateLose`）, `src/sim/run/quarterReview.ts` | 🟡 即時敗北は Senior HP/士気/技術負債/レビュー詰まりの4条件。§15 の「Incident 連続によるリリース停止」「AI依存度過多」は即時敗北として未実装（レビューの KPI/診断止まり） |
| [16](../SPEC.md#16-難易度設定と試練) | 難易度設定と試練 | M3 | `src/data/difficulties.ts`（4 難易度 + `TRIAL_DEFS`）, `src/sim/scenarios.ts` | 🟡 難易度4種は実装。試練は `low-focus`/`half-budget`/`flammable`/`review-cap` の4種のみで、SPEC §16 の「AI依存度の自然増加」等は未実装 |
| [17](../SPEC.md#17-メタ進行とアンロック) | メタ進行とアンロック | M3 / M7 | `src/state/meta.ts`, `src/data/unlocks.ts`, `src/ui/MetaShopScreen.tsx`, `AchievementCollectionScreen.tsx` / `tests/unit/meta.test.ts`, `meta-unlock-run.test.ts`, `unlocks.test.ts` | 🟡 カード/レリックの永続解放・メタショップ・実績閲覧は実装。SPEC §17 の「開始時の組織（プリセット）解放」は未実装（`UnlockKind = 'card' \| 'relic'`、[mockup-parity.md](./mockup-parity.md) §2） |
| [18.1](../SPEC.md#181-基本演出) | 基本演出 | M1 | `src/render/taskView.ts`, `src/ui/OfficeActors.tsx`, `src/styles.css` | 🟡 基本演出は実装。ベルトコンベア状の粒移動・AI暴走時の Review 突入は [mockup-parity.md](./mockup-parity.md) §1-A で残務 |
| [18.2](../SPEC.md#182-ジューシーな手応え演出) | ジューシーな手応え演出 | M2 | `src/ui/PointPops.tsx`, `ComboBadge.tsx` | 🟡 数字ポップ/`COMBO xN` は実装。延焼の連鎖・割り込みレビューのスイープ・ボスのスローモーは [mockup-parity.md](./mockup-parity.md) §1-A で残務 |
| [18.3](../SPEC.md#183-画面ステート組織の空気感) | 画面ステート（組織の空気感） | M3 | `src/render/status.ts`, `src/styles.css` | 🟡 昼/曇り/地獄の3トーンは実装。6 組織タイプ別の演出拡張は [mockup-parity.md](./mockup-parity.md) §2 で残務 |
| [18.4](../SPEC.md#184-ご褒美演出) | ご褒美演出 | M3 | `src/ui/RunResultScreen.tsx`, `src/ui/PointPops.tsx` | 🟡 リザルト表示と数字ポップは実装。レリック獲得・進化解放の手応え演出や評価Sの特別演出は静的表示に留まり残務（[mockup-parity.md](./mockup-parity.md) §1-A） |
| [18（描画基盤）](../SPEC.md#18-視覚表現) | 視覚表現の WebGL 化 | M6 | `src/render/adapters/pixiOrgRenderer.ts`, `selectRenderer.ts`, `src/ui/OrgPixiField.tsx` / `tests/e2e/org-pixi-visual.spec.ts`（`?renderer=pixi` で opt-in） | ✅ 全社マップを Pixi 化（盤面は DOM/SVG 継続。適用範囲拡張は [mockup-parity.md](./mockup-parity.md) §4） |
| [19](../SPEC.md#19-面白さの核) | 面白さの核 | 横断 | 各フェーズの体験設計に反映（M8 のリスク/リターン設計ほか） | ✅ |
| [20](../SPEC.md#20-教育的価値) | 教育的価値 | M3 | `src/sim/diagnosis.ts`（組織タイプ診断による気づき） | ✅ |
| [21](../SPEC.md#21-mvpスコープ) | MVPスコープ | 横断 | MVP1〜7 をフェーズ骨格として採用（§2 のフェーズ別サマリ） | 🟡 MVP の骨格として採用済み。ただし MVP3 が含む「四半期トラック＋スプリント間イベント判定」は [run-loop-redesign.md](./run-loop-redesign.md) で未着手 |
| [22](../SPEC.md#22-技術構成) | 技術構成 | M0 | `package.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `src/sim/rng.ts`, `src/sim/seed.ts` / `tests/unit/rng.test.ts`, `seed.test.ts` ／ 詳細は [architecture.md](./architecture.md) | 🟡 基盤・seed付き決定論・テスト二段構え（22.3/22.5）は実装。Web Worker(+Comlink) のモンテカルロ試算・Recharts/visx・IndexedDB(idb/Dexie) は未導入（[mockup-parity.md](./mockup-parity.md) §3/§4） |
| [23](../SPEC.md#23-拡張案) | 拡張案 | M7 | デイリーランを実装: `tests/unit/daily-run.test.ts`, `tests/e2e/daily-run.spec.ts`（他の拡張案は未着手） | 🟡 |
| [24](../SPEC.md#24-企画の価値) | 企画の価値 | — | （企画文・実装対象なし） | — |
| [25](../SPEC.md#25-結論) | 結論 | — | （企画文・実装対象なし） | — |

---

## 2. フェーズ別サマリ（旧 `phase-*.md` の集約）

各フェーズの「対応 MVP / SPEC 参照 / 目的 / 主な実装 / 完了状態」を集約した。詳細な設計判断・繰り越しは
[architecture.md](./architecture.md) と [follow-ups.md](./follow-ups.md) を参照。マイルストーンの依存関係は
[README.md](./README.md) を参照。

### M0 / Phase 0 — 基盤セットアップ

- **対応 MVP**: 前提（MVP の土台） / **SPEC 参照**: [第22章](../SPEC.md#22-技術構成)
- **目的**: `npm run dev` で空シェルが立ち上がり `npm test` が通る状態を作る。**sim を描画から分離し、seed付き決定論で書く**規律をここで確立する。
- **主な実装**: Vite + React + TypeScript、Zustand / XState / Framer Motion、Vitest / Playwright、ESLint + Prettier、`src/sim/rng.ts`（mulberry32）・`src/sim/seed.ts`・`?seed=`、`window.game`（`src/game.ts`）、[architecture.md](./architecture.md) §3 のディレクトリ構成。
- **完了状態（DoD）**: ✅ dev 起動・Vitest/Playwright 稼働・PRNG 決定論テスト緑・CI 緑。

### M1 / Phase 1 — スプリントシミュレーション

- **対応 MVP**: MVP1 / **SPEC 参照**: [第21章 MVP1](../SPEC.md#21-mvpスコープ) / [第4.1](../SPEC.md#41-メイン画面-開発ライン能動操作フェーズ)〜[4.2章](../SPEC.md#42-ステータス表示) / [第4.6章](../SPEC.md#46-スプリントリザルト画面) / [第5章](../SPEC.md#5-プレイヤーが操作するリソース) / [第2章](../SPEC.md#2-コンセプト)
- **目的**: 「AI を入れると Coding は速くなるが Review が詰まる」コア因果（第2章）を最小ループで成立させる。
- **主な実装**: `src/sim/types.ts`（`Task`/`Lane`/`OrgState`）, `src/sim/model/process.ts`（工程モデル）, `src/sim/sprint.ts`（AI フラグでの因果）, `src/render/taskView.ts`・`src/ui/SprintScreen.tsx`・`Hud.tsx`・`SprintResultScreen.tsx`。
- **完了状態（DoD）**: ✅ AI あり/なしで結果差・リザルト表示・不変条件テスト緑。
- **残務**: §4.1/18.1 の粒の流れ（工程間が静的配置）・AI暴走演出（[mockup-parity.md](./mockup-parity.md) §1-A）、§4.6 リザルトの介入内訳（割り込み/緊急対応の回数）が `SprintResult` に未集計。

### M2 / Phase 2 — 能動操作とカード

- **対応 MVP**: MVP2 / **SPEC 参照**: [第6章](../SPEC.md#6-スプリント中の能動操作) / [第4.3章](../SPEC.md#43-介入アクションバー) / [第7章](../SPEC.md#7-ai導入施策カードデッキ) / [第18.2章](../SPEC.md#182-ジューシーな手応え演出)
- **目的**: 「眺める」から「捌く」へ。介入アクション・集中力・コンボ・カードドラフトで、同じデッキでも捌き方次第で結果が変わるようにする。
- **主な実装**: `src/sim/actions.ts`・`src/data/actions.ts`・`src/ui/ActionBar.tsx`（介入）, `src/ui/ComboBadge.tsx`（コンボ）, `src/sim/cards.ts`・`src/data/cards.ts`・`src/ui/CardView.tsx`/`DeckBar.tsx`/`DraftScreen.tsx`（カード/ドラフト）, `src/ui/PointPops.tsx`（演出）。
- **完了状態（DoD）**: ✅ 介入/集中力/コンボ/ドラフトで結果が変わることを操作 E2E で確認。
- **残務**: §6.1 タスク差配のドラッグ操作化、§7.1 手札配布→発動方式（現状はデッキ畳み込み）、18.2 の延焼連鎖・スイープ・スローモー（[mockup-parity.md](./mockup-parity.md) §1-A）。

### M3 / Phase 3 — 周回・育成・診断

- **対応 MVP**: MVP3 / **SPEC 参照**: [第3章](../SPEC.md#3-ゲームの基本ループ) / [第4.4](../SPEC.md#44-スプリント間イベント画面判定--選択)〜[4.5章](../SPEC.md#45-組織進化ツリー画面) / [第8](../SPEC.md#8-組織文化レリック)〜[17章](../SPEC.md#17-メタ進行とアンロック) / [第18.3章](../SPEC.md#183-画面ステート組織の空気感)
- **目的**: 1ラン＝1四半期のローグライク周回（マップ→スプリント→リザルト→ドラフト→進化）を通しでプレイ可能にする。
- **主な実装**: `src/state/runMachine.ts`（XState フロー）, `src/sim/run/map.ts`（ランマップ）, `src/data/bosses.ts`, `src/sim/run/evolution.ts`・`src/data/evolution.ts`（進化ツリー）, `src/data/relics.ts`（レリック）, `src/sim/run/events.ts`・`src/data/events.ts`（イベント）, `src/sim/diagnosis.ts`（診断）, `src/data/difficulties.ts`（難易度/試練）, `src/state/meta.ts`（メタ進行）。
- **完了状態（DoD）**: ✅ マップ→ボス→解放まで通しプレイでき、診断/称号/勝敗が機能する。
- **残務**: 基本ループ再設計（第3/4.4/9/10、[run-loop-redesign.md](./run-loop-redesign.md)）、試練の不足（第16）、ボス報酬レリック（第8）・即時敗北条件（第15）の不足、18.3 の6タイプ演出（[mockup-parity.md](./mockup-parity.md) §2）。

### M4 / Phase 4 — キャラクター育成

- **対応 MVP**: MVP4 / **SPEC 参照**: [第12章](../SPEC.md#12-キャラクター育成)
- **目的**: 開発者・シニアを**個体**として育成・編成の対象にし、採用を「未来の主力をどう育てるか」の選択にする。
- **主な実装**: `src/sim/member/*`（個体・成長・スタミナ）, `src/data/members.ts`・`src/data/traits.ts`（トレイト）, `src/ui/FormationScreen.tsx`（編成）。
- **完了状態（DoD）**: ✅ 個体育成・編成が戦術として機能する。
- **残務**: §12.2 のメンバー状態をキャラ表情（疲れ顔/ガッツポーズ）へ反映するビジュアルが未実装（[mockup-parity.md](./mockup-parity.md) §1-A）。

### M5 / Phase 5 — 組織スケール（巨大組織対応）

- **対応 MVP**: MVP5 / **SPEC 参照**: [第4.7〜4.11章](../SPEC.md#47-組織スケールとズーム階層巨大組織対応)
- **目的**: 1チームの現場から複数部署の巨大組織へスケールし、現場↔部署↔全社↔業界を地続きにズームできるようにする。
- **主な実装**: `src/sim/orgscale/*`（集約・生成・業界・レバー）, `src/ui/OrgScreen.tsx`/`DeptScreen.tsx`/`IndustryScreen.tsx`/`Breadcrumb.tsx`, `src/render/orgScene.ts`・`orgIslandView.ts`・`orgCamera.ts`。
- **完了状態（DoD）**: ✅ 4階層ズーム・全社/部署/業界ビュー・カメラ遷移が動作する。
- **残務**: 全社・部署・業界の等角化（mockup 視覚到達、[mockup-parity.md](./mockup-parity.md) §1-B〜1-E）。

### M6 / Phase 6 / 6b — WebGL（PixiJS）移行

- **対応 MVP**: 拡張 / **SPEC 参照**: [第18章](../SPEC.md#18-視覚表現) / [第22.2](../SPEC.md#222-描画方針react-と-pixi-の分担) / [第22.4章](../SPEC.md#224-段階的移行過剰投資を避ける)
- **目的**: 効果の大きい**全社マップ（数百〜数千オブジェクト）**のみ DOM/SVG から PixiJS + pixi-viewport へ局所差し替えする（過剰投資回避、第22.4）。
- **主な実装**: `src/render/iso.ts`（投影/深度/カリング/プール、純TS）, `src/render/adapters/pixiOrgRenderer.ts`・`selectRenderer.ts`, `src/ui/OrgPixiField.tsx`。既定は DOM/SVG、`?renderer=pixi` で opt-in。視覚回帰は `npm run test:e2e:pixi`。
- **完了状態（DoD）**: ✅ 6a（React 接続・pan/zoom・カリング）/ 6b（DOM 同等の情報量）/ 6c（カメラ同期）/ 6d（性能予算）/ 6e（Pixi 視覚回帰・opt-in）まで完了。
- **性能予算の検証範囲**: 同時スプライト数（≤500）・カリング数・予算超過数は `tests/unit/orgScene.test.ts` で**自動回帰**。フレーム時間（60fps / <16.7ms）は CI では回さず、実ブラウザでの**手動/opt-in 計測**（架空 GPU 不可のため）。

### M7 / Phase 7 — メタ進行の閉ループ化

- **対応 MVP**: 拡張（MVP3 のメタ進行を完成）/ **SPEC 参照**: [第17章](../SPEC.md#17-メタ進行とアンロック) / [第23章](../SPEC.md#23-拡張案)（デイリーラン）
- **目的**: 記録だけだったメタ進行を、**永続解放が次ランのドラフト/ショップに反映される閉ループ**にする。
- **主な実装**: `src/data/unlocks.ts`（解放定義）, `src/state/meta.ts`（解放集合・移行）, `src/sim/cards.ts`（`drawDraft(allowed)`）, `src/ui/MetaShopScreen.tsx`（メタショップ）, `src/ui/AchievementCollectionScreen.tsx`（実績閲覧）, デイリーラン（`dailySeed`・`startDailyRun`）。
- **完了状態（DoD）**: ✅ 永続解放が次ランに反映・メタショップ・実績閲覧・デイリーランまで実装済み。
- **残務**: 開始プリセット解放（第17、`UnlockKind` 未対応）、デイリー記録の業界ランキング接続（[mockup-parity.md](./mockup-parity.md) §2）。

### M8 / Phase 8 — 四半期レビューと目標修正

- **対応 MVP**: MVP7 / **SPEC 参照**: [第3章](../SPEC.md#3-ゲームの基本ループ) / [第4.6.1章](../SPEC.md#461-四半期レビュー--目標修正画面) / [第10章](../SPEC.md#10-ランとボススプリント) / [第14](../SPEC.md#14-勝利条件)〜[15章](../SPEC.md#15-敗北条件--継続不能条件) / [第19章](../SPEC.md#19-面白さの核)
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
| 基本ループの再設計（分岐マップ廃止 → 固定トラック＋イベント判定） | [3](../SPEC.md#3-ゲームの基本ループ), [4.4](../SPEC.md#44-スプリント間イベント画面判定--選択), [9](../SPEC.md#9-ランダムイベント周回進行の中核エンジン), [10](../SPEC.md#10-ランとボススプリント), [21](../SPEC.md#21-mvpスコープ) | 🟡 設計合意済み・実装未着手 | [run-loop-redesign.md](./run-loop-redesign.md) |
| 全社・部署・業界ビューの等角化（mockup 視覚到達） | [4.7–4.11](../SPEC.md#47-組織スケールとズーム階層巨大組織対応), [18](../SPEC.md#18-視覚表現) | 🟡 機能は動作・見た目が残務 | [mockup-parity.md](./mockup-parity.md) §1-B〜1-E |
| 演出・ビジュアルの残務（粒の流れ・延焼連鎖・スイープ・スローモー・ご褒美・6タイプ演出・キャラ表情） | [4.1](../SPEC.md#41-メイン画面-開発ライン能動操作フェーズ), [12](../SPEC.md#12-キャラクター育成), [18.1](../SPEC.md#181-基本演出), [18.2](../SPEC.md#182-ジューシーな手応え演出), [18.3](../SPEC.md#183-画面ステート組織の空気感), [18.4](../SPEC.md#184-ご褒美演出) | 🟡 中核のみ実装 | [mockup-parity.md](./mockup-parity.md) §1-A, §2 |
| リザルトの介入内訳（割り込み×N / 緊急対応×N の表示） | [4.6](../SPEC.md#46-スプリントリザルト画面) | 🟡 `SprintResult` に未集計 | [follow-ups.md](./follow-ups.md) |
| 能動操作・カードの操作方式（タスク差配のドラッグ / 手札配布→発動） | [6](../SPEC.md#6-スプリント中の能動操作), [7](../SPEC.md#7-ai導入施策カードデッキ) | 🟡 効果は実装・操作方式が SPEC と差 | [follow-ups.md](./follow-ups.md) |
| 試練の追加（AI依存度の自然増加 ほか） | [16](../SPEC.md#16-難易度設定と試練) | 🟡 4種のみ実装 | [follow-ups.md](./follow-ups.md) |
| レリック入手元・即時敗北条件の不足（ボス報酬レリック / Incident連続・AI依存過多） | [8](../SPEC.md#8-組織文化レリック), [15](../SPEC.md#15-敗北条件--継続不能条件) | 🟡 主要経路のみ実装 | [follow-ups.md](./follow-ups.md) |
| 開始プリセットの永続解放 | [17](../SPEC.md#17-メタ進行とアンロック) | 🟡 未実装（カード/レリックのみ） | [mockup-parity.md](./mockup-parity.md) §2 |
| 技術構成の残項目（Web Worker+Comlink / Recharts・visx / IndexedDB） | [22](../SPEC.md#22-技術構成) | 🟡 未導入 | [mockup-parity.md](./mockup-parity.md) §3, §4 |
| バランス調整（目標修正の代償・outcome 閾値・レバー・解放コスト） | [10](../SPEC.md#10-ランとボススプリント), [14](../SPEC.md#14-勝利条件), [15](../SPEC.md#15-敗北条件--継続不能条件), [16](../SPEC.md#16-難易度設定と試練), [17](../SPEC.md#17-メタ進行とアンロック) | 進行中 | [follow-ups.md](./follow-ups.md), [mockup-parity.md](./mockup-parity.md) §3 |
| 拡張案（デイリーラン以外: GitHub 連携・対抗ランキング ほか） | [23](../SPEC.md#23-拡張案) | 未着手 | [follow-ups.md](./follow-ups.md), [mockup-parity.md](./mockup-parity.md) §2 |
