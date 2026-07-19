# SPEC ↔ 実装 対応表（トレーサビリティ）

[`SPEC.md`](../SPEC.md) の各章が、コードのどこに対応し、どこまで実装済みかを一望するための
トレーサビリティ表。各章番号は SPEC.md の該当見出しへリンクしている。

関連ドキュメント:
[architecture.md](./architecture.md)（技術スタック・レイヤ分離・横断規律） /
[remaining-issues.md](./remaining-issues.md)（プロジェクト残課題リスト＝実装後の繰り越し・未解決事項＋デザイン残務・SPEC 未充足の横断バックログ）。

> 状態列の凡例:
> - **✅ 実装済み** … SPEC の当該章の**中核要件**を満たし、残務がない（または軽微）。SPEC が描く理想の全要素を漏れなく実装済み、という意味ではない。
> - **🟡 一部実装** … 中核は動作するが、SPEC 記載の一部要素・操作方式・視覚演出の到達・拡張が残る（残務は備考の追跡先へ）。
> - **— 非実装章** … 企画文・前提で、コード実装の対象ではない。
>
> 「🟡」は中核機能の欠落を意味しない。中核は動作しており、🟡 は
> **SPEC 章を細部まで充足し切るには残務がある**ことを示す（追跡先は
> [remaining-issues.md](./remaining-issues.md)）。

---

## 1. 章 → 実装 対応（前方トレース）

| SPEC 章 | 内容 | 主な実装 / テスト | 状態 |
| --- | --- | --- | --- |
| [1](../SPEC.md#1-企画概要) | 企画概要 | （企画文・実装対象なし） | — |
| [2](../SPEC.md#2-コンセプト) | コンセプト（AI導入のコア因果） | `src/sim/sprint.ts`, `src/sim/model/process.ts` / `tests/unit/sprint.test.ts`, `process.test.ts` | ✅ |
| [2.1](../SPEC.md#21-世界観の制約現実の開発組織から大きく逸脱しない) | 世界観の制約 | [architecture.md](./architecture.md) §4.5（イベント/ボス/敗北/称号の判断基準） | ✅ |
| [3](../SPEC.md#3-ゲームの基本ループ) | ゲームの基本ループ | `src/sim/run/phases.ts`, `src/sim/run/engine.ts`, `src/state/runMachine.ts` / `tests/unit/run-phases.test.ts`, `run-machine.test.ts`, `run-engine.test.ts`, `run-loop.test.ts` | ✅ 固定トラック（`SPRINTS_PER_QUARTER`、最終がボス）＋スプリント間ビートで実装（分岐マップは撤去）。フェーズ遷移は遷移表 `phases.ts` が単一の真実源（RI-39） |
| [3.1](../SPEC.md#31-時間の目安ペーシング規定) | 時間の目安（ペーシング規定） | `src/ui/sprintTempo.ts`, `useRun.ts`, `SprintScreen.tsx` / `tests/unit/sprintTempo.test.ts` | ✅ RI-62。1x=680ms/tick・Pause/1x/2x UI・ボス taskCountMul 微調整でスプリント 60〜120 秒帯（最短 30 秒以上）を充足 |
| [4.1](../SPEC.md#41-メイン画面-開発ライン能動操作フェーズ) | メイン画面: 開発ライン | `src/ui/SprintScreen.tsx`, `src/ui/OfficeRoom.tsx`, `OfficeActors.tsx`, `src/render/taskView.ts`, `src/render/boardScene.ts` / `tests/unit/taskView.test.ts`, `boardScene.test.ts` | ✅ 8種のタスク見た目・レーン・介入バーに加え、粒の工程間フロー移動（`BoardDotMotion` の補間配置＋方向ドリフト・AI速度差。RI-05）を実装 |
| [4.2](../SPEC.md#42-ステータス表示) | ステータス表示 | `src/ui/Hud.tsx`, `src/render/status.ts` / `tests/unit/status.test.ts` | ✅ |
| [4.3](../SPEC.md#43-介入アクションバー) | 介入アクションバー | `src/ui/ActionBar.tsx`, `src/sim/actions.ts`, `src/data/actions.ts` / `tests/unit/actions.test.ts`, `tests/e2e/interventions.spec.ts` | ✅ |
| [4.4](../SPEC.md#44-スプリント間イベント画面判定--選択) | スプリント間イベント画面 | `src/ui/SetupScreen.tsx`, `src/ui/BeatScreen.tsx`, `src/sim/run/events.ts`, `src/data/events.ts` | ✅ 編成（setup）＋判定/選択の混合ビート（BeatScreen）として実装 |
| [4.5](../SPEC.md#45-組織進化ツリー画面) | 組織進化ツリー画面 | `src/ui/EvolutionScreen.tsx`, `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| [4.6](../SPEC.md#46-スプリントリザルト画面) | スプリントリザルト画面 | `src/ui/SprintResultScreen.tsx`, `src/sim/outcome.ts`, `src/render/sprintTimelineView.ts`, `sprintInterventionAnalysis.ts`, `sprintBaselineComparison.ts` | ✅ Done/Delivered/Combo/AI率/Review Max/Rework/Incidents/評価/診断/称号に加え、介入内訳（`actionCounts`。RI-29）・スプリントタイムライン（RI-53）・介入分析と改善 Tips（RI-54）・無介入ベースライン比較（RI-55）を表示 |
| [4.6.1](../SPEC.md#461-四半期レビュー--目標修正画面) | 四半期レビュー / 目標修正画面 | `src/ui/QuarterReviewScreen.tsx`, `src/sim/run/quarterReview.ts`, `src/data/goalAdjustments.ts` / `tests/unit/quarter-review.test.ts` | ✅ |
| [4.7–4.11](../SPEC.md#47-組織スケールとズーム階層巨大組織対応) | 組織スケールとズーム階層 / 全社・部署・業界ビュー / 画面遷移 | `src/sim/orgscale/*`, `src/ui/OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx`, `src/render/orgScene.ts`, `orgCamera.ts` / `tests/unit/orgscale*.test.ts`, `tests/e2e/org-scale.spec.ts` | ✅ 4階層ズーム/集約は動作。全社・部署・業界の等角化は完了し、業界画面へ `meta.dailyRuns` の擬似リーダーボード接続も完了（[remaining-issues.md](./remaining-issues.md) RI-23）。ドリルダウンのカメラズーム演出（島タップ→フォーカスリング→カメラ→クロスフェード着地）も RI-04 で実装済み。シーズン/リーグはラン内都度生成（meta 非恒久化）。個体→チーム島の稼働人数/アバター/AIボット集約は RI-27 で接続済み |
| [5](../SPEC.md#5-プレイヤーが操作するリソース) | プレイヤーが操作するリソース | `src/sim/types.ts`（`OrgState` の基本リソース・`SprintState.focus`=集中力）, `src/sim/org.ts`, `src/sim/run/types.ts`（`RunState.budget`=予算・`EvolutionState.points`=進化ポイント） | ✅ |
| [6](../SPEC.md#6-スプリント中の能動操作) | スプリント中の能動操作 | `src/sim/actions.ts`, `src/ui/ComboBadge.tsx`（6.2 コンボ）, `src/render/boardDragPlan.ts` / `tests/unit/combo.test.ts`, `actions.test.ts`, `tests/e2e/assign-task-drag.spec.ts` | ✅ 介入8種・集中力・コンボに加え、§6.1 のタスク差配/PR分割は武装→盤面ドラッグの対象指定（RI-30。省略時は従来の自動選択）で実装 |
| [7](../SPEC.md#7-ai導入施策カードデッキ) | AI導入施策カード（デッキ） | `src/sim/cards.ts`, `src/data/cards.ts`, `src/ui/CardView.tsx`, `DeckBar.tsx`, `DraftScreen.tsx` / `tests/unit/cards.test.ts` | ✅ ドラフト/強化に加え、§7.1 の手札配布→発動（スプリント開始時に `HAND_SIZE=3` を deal、集中力コストで発動しそのスプリントの `cardEffects` へ合成）を RI-30 で実装。レリック/進化/試練は常時パッシブ |
| [8](../SPEC.md#8-組織文化レリック) | 組織文化レリック | `src/data/relics.ts`, `src/sim/run/effects.ts`, `src/sim/run/engine.ts` / `tests/unit/run-engine.test.ts`, `tests/e2e/run.spec.ts` | ✅ 恒久パッシブとして実装。イベント選択・ショップ購入に加え、ボス突破時は未所持レリック全体から決定論的に1つを報酬として付与し、四半期レビューとラン決着画面へ表示 |
| [9](../SPEC.md#9-ランダムイベント周回進行の中核エンジン) | ランダムイベント | `src/sim/run/events.ts`, `src/data/events.ts` / `tests/unit/run-systems.test.ts`, `run-loop.test.ts` | ✅ 判定/選択イベントを組織状態依存の重み付けで抽選する混合ビートとして実装 |
| [10](../SPEC.md#10-ランとボススプリント) | ランとボススプリント | `src/data/bosses.ts`, `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` | ✅ 固定トラックの最終スプリント＝ボスとして実装（分岐マップ廃止） |
| [11](../SPEC.md#11-組織進化ツリー) | 組織進化ツリー | `src/sim/run/evolution.ts`, `src/data/evolution.ts` | ✅ |
| [12](../SPEC.md#12-キャラクター育成) | キャラクター育成 | `src/sim/member/*`, `src/data/members.ts`, `src/data/traits.ts`, `src/ui/FormationScreen.tsx` / `tests/unit/member.test.ts`, `run-roster.test.ts`, `tests/e2e/formation.spec.ts` | ✅ 個体ステータス・6トレイト・成長/昇格・編成・スタミナ離脱は実装。§12.2 の「メンバー状態のキャラ表情への反映（疲れ顔/ガッツポーズ）」も RI-08 で実装（`src/render/memberMood.ts` → 盤面キャラの exhausted/cheer 表情） |
| [13](../SPEC.md#13-組織タイプ診断) | 組織タイプ診断 | `src/sim/diagnosis.ts`, `src/render/diagnosisTheme.ts`, `src/ui/RunBar.tsx`, `src/ui/RunResultScreen.tsx` / `tests/unit/run-systems.test.ts`, `diagnosisTheme.test.ts` | ✅ |
| [14](../SPEC.md#14-勝利条件) | 勝利条件 | `src/sim/run/engine.ts`, `src/sim/run/quarterReview.ts` / `tests/unit/run-engine.test.ts`, `quarter-review.test.ts` | ✅ |
| [15](../SPEC.md#15-敗北条件--継続不能条件) | 敗北条件 / 継続不能条件 | `src/sim/outcome.ts`（`evaluateLose`）, `src/sim/run/engine.ts`, `src/ui/RunResultScreen.tsx` / `tests/unit/run-systems.test.ts`, `tests/e2e/run.spec.ts` | ✅ Senior HP / 士気 / 技術負債 / レビュー詰まりに加え、Incident連続、AI依存過多、予算枯渇を継続不能として判定し、理由をラン決着画面に表示 |
| [16](../SPEC.md#16-難易度設定と試練) | 難易度設定と試練 | `src/data/difficulties.ts`（4 難易度 + `TRIAL_DEFS`）, `src/sim/run/effects.ts`, `src/sim/run/engine.ts` | ✅ 5種の試練を実装。「フロンティアモデル依存」はスプリントごとのAI依存度自然増加と、依存度に応じた予算消費を適用 |
| [17](../SPEC.md#17-メタ進行とアンロック) | メタ進行とアンロック | `src/state/meta.ts`, `src/state/metaPersistence.ts`, `src/state/runPersistence.ts`, `src/data/unlocks.ts`, `src/ui/MetaShopScreen.tsx`, `AchievementCollectionScreen.tsx` / `tests/unit/meta.test.ts`, `metaPersistence.test.ts`, `runPersistence.test.ts`, `meta-unlock-run.test.ts`, `unlocks.test.ts` | ✅ IndexedDB によるカード/レリックの永続解放・旧 localStorage 移行・メタショップ・実績閲覧に加え、ラン途中セーブ/復帰（RI-58）も実装。開始時の組織は難易度（§16）で選定し、メタ解放プリセットはスコープ外（[remaining-issues.md](./remaining-issues.md) RI-25 完了）。メンバー／トレイト／開始キット等の解放拡張もスコープ外（RI-24 完了） |
| [18.1](../SPEC.md#181-基本演出) | 基本演出 | `src/render/taskView.ts`, `src/render/boardScene.ts`, `src/ui/OfficeActors.tsx`, `src/styles.css` | ✅ 基本演出に加え、ベルトコンベア状の粒移動（工程間フロー補間・残像・AI 速度差。RI-05）を実装 |
| [18.2](../SPEC.md#182-ジューシーな手応え演出) | ジューシーな手応え演出 | `src/ui/PointPops.tsx`, `ComboBadge.tsx`, `InterventionEffects.tsx`, `JuicyEffects.tsx`, `src/render/juicyEffects.ts`, `src/game.ts`（`pauseBriefly`） | ✅ 数字ポップ/`COMBO xN`・延焼（RI-06）・割り込みスイープ・ボススローモ（オーバーレイ＋一時 pause）を実装（[remaining-issues.md](./remaining-issues.md) RI-10 完了） |
| [18.3](../SPEC.md#183-画面ステート組織の空気感) | 画面ステート（組織の空気感） | `src/render/diagnosisTheme.ts`, `src/App.tsx`, `src/ui/RunBar.tsx`, `src/ui/OrgScreen.tsx`, `src/ui/RunResultScreen.tsx`, `src/styles.css` / `tests/unit/diagnosisTheme.test.ts`, `tests/e2e/run.spec.ts` | ✅ 6 組織タイプ別の背景・色・状態文を実装 |
| [18.4](../SPEC.md#184-ご褒美演出) | ご褒美演出 | `src/ui/RunResultScreen.tsx`, `SprintResultScreen.tsx`, `QuarterReviewScreen.tsx`, `EvolutionScreen.tsx`, `JuicyEffects.tsx`, `PointPops.tsx` | ✅ リザルト／数字ポップに加え、レリック獲得・進化解放・評価 S・称号の `RewardCeremony` を実装（[remaining-issues.md](./remaining-issues.md) RI-10 完了） |
| [18（描画基盤）](../SPEC.md#18-視覚表現) | 視覚表現の WebGL 化 | `src/render/adapters/pixiOrgRenderer.ts`, `pixiDeptRenderer.ts`, `pixiBoardRenderer.ts`, `selectRenderer.ts`, `src/ui/OrgPixiField.tsx`, `DeptPixiBoard.tsx`, `BoardPixiLayer.tsx` / `tests/e2e/org-pixi-visual.spec.ts`, `dept-pixi-visual.spec.ts`, `sprint-pixi-visual.spec.ts` | ✅ 全社マップ・部署ビュー・現場盤面を Pixi 化し**既定レンダラは Pixi**（`?renderer=dom` で DOM/SVG へ opt-out。WebGL 不可環境は自動フォールバック。RI-11 完了）。粒/キャラは RenderTexture 焼き込み＋`SpritePool` のスプライト（RI-07） |
| [19](../SPEC.md#19-面白さの核) | 面白さの核 | 各画面の体験設計に反映（リスク/リターン設計ほか） | ✅ |
| [20](../SPEC.md#20-教育的価値) | 教育的価値 | `src/sim/diagnosis.ts`（組織タイプ診断による気づき） | ✅ |
| [22](../SPEC.md#22-技術構成) | 技術構成 | `package.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `src/state/metaPersistence.ts`, `src/state/runPersistence.ts`, `src/state/gameDb.ts`, `src/sim/rng.ts`, `src/sim/seed.ts`, `src/sim/run/whatIfState.ts`, `whatIfClient.ts`, `whatIf.worker.ts`, `src/ui/BaselineComparisonChart.tsx` / `tests/unit/metaPersistence.test.ts`, `runPersistence.test.ts`, `rng.test.ts`, `seed.test.ts`, `whatIf.test.ts` ／ 詳細は [architecture.md](./architecture.md) | ✅ 基盤・IndexedDB 永続化（メタ＋ラン途中セーブ）・seed付き決定論・テスト二段構え（22.3/22.5）に加え、what-if の Web Worker(+Comlink) オフロードとリザルトの Recharts 可視化を実装（[remaining-issues.md](./remaining-issues.md) RI-13 / RI-58）。visx / タイムラインの Recharts 化は意図的に見送り。リプレイ保存は RI-61 |
| [23](../SPEC.md#23-拡張案) | 拡張案 | デイリーラン＋「なぜ燃えたか」（RI-34′）＋「AI導入失敗図鑑」（RI-34″）を実装。外部 API 系は仕様から削除。他のローカル拡張は未着手 | 🟡 |
| [24](../SPEC.md#24-企画の価値) | 企画の価値 | （企画文・実装対象なし） | — |
| [25](../SPEC.md#25-結論) | 結論 | （企画文・実装対象なし） | — |

---

## 2. 未充足・再設計が残る箇所

| 項目 | 該当 SPEC 章 | 状態 | 追跡先 |
| --- | --- | --- | --- |
| 演出・ビジュアルの残務（スイープ・スローモー・ご褒美） | [4.1](../SPEC.md#41-メイン画面-開発ライン能動操作フェーズ), [18.2](../SPEC.md#182-ジューシーな手応え演出), [18.4](../SPEC.md#184-ご褒美演出) | ✅ スイープ・ボススローモ（一時 pause）・ご褒美セレモニーを実装（カメラ遷移 RI-04・スプライト化 RI-07・表情 RI-08・マネージャー像 RI-09 も完了） | [remaining-issues.md](./remaining-issues.md) RI-10 |
| リザルトの介入内訳（割り込み×N / 緊急対応×N の表示） | [4.6](../SPEC.md#46-スプリントリザルト画面) | ✅ `SprintMetrics.actionCounts` を集計しリザルトへ表示 | [remaining-issues.md](./remaining-issues.md) RI-29 |
| 能動操作・カードの操作方式（タスク差配のドラッグ / 手札配布→発動） | [6](../SPEC.md#6-スプリント中の能動操作), [7](../SPEC.md#7-ai導入施策カードデッキ) | ✅ RI-30 で SPEC 準拠 | [remaining-issues.md](./remaining-issues.md) RI-30 |
| 開始プリセットの永続解放 | [17](../SPEC.md#17-メタ進行とアンロック) | ✅ スコープ外。開始組織は難易度（§16）。足場削除済み | [remaining-issues.md](./remaining-issues.md) RI-25 |
| メタ解放対象の拡張（メンバー／トレイト／開始キット等） | [17](../SPEC.md#17-メタ進行とアンロック) | ✅ スコープ外。解放対象はカード／レリックのプール拡張に限定 | [remaining-issues.md](./remaining-issues.md) RI-24 |
| 技術構成の残項目（Web Worker+Comlink / Recharts・visx） | [22](../SPEC.md#22-技術構成) | ✅ RI-13 で Worker+Comlink / Recharts を導入。visx・タイムライン Recharts 化は見送り | [remaining-issues.md](./remaining-issues.md) RI-13 |
| メタ永続化の IndexedDB 移行＋旧 localStorage 統合 | [17](../SPEC.md#17-メタ進行とアンロック), [22](../SPEC.md#22-技術構成) | ✅ `idb` による保存、既定値補完付き移行、旧キー削除、失敗時フォールバックを実装 | [remaining-issues.md](./remaining-issues.md) RI-57 |
| バランス調整（目標修正の代償・outcome 閾値・レバー・解放コスト） | [10](../SPEC.md#10-ランとボススプリント), [14](../SPEC.md#14-勝利条件), [15](../SPEC.md#15-敗北条件--継続不能条件), [16](../SPEC.md#16-難易度設定と試練), [17](../SPEC.md#17-メタ進行とアンロック) | ✅ RI-14〜RI-19 / RI-56 でモンテカルロ許容レンジ検証を整備（暫定値は現状調整不要と判断） | [remaining-issues.md](./remaining-issues.md) RI-14〜RI-19, RI-56 |
| ゲーム時間の目安（スプリント 60〜120 秒・一時停止/倍速） | [3.1](../SPEC.md#31-時間の目安ペーシング規定) | ✅ RI-62 でテンポ・速度 UI・分布圧縮を実装 | [remaining-issues.md](./remaining-issues.md) RI-62 |
| サウンド演出（BGM・効果音） | [18.3](../SPEC.md#183-画面ステート組織の空気感) | 完了（Web Audio シンセ + MetaState.soundMuted） | [remaining-issues.md](./remaining-issues.md) RI-59 |
| ラン途中セーブ・リプレイ保存（保存の想定用途「セーブ・リプレイ」） | [17](../SPEC.md#17-メタ進行とアンロック), [22](../SPEC.md#22-技術構成), [23](../SPEC.md#23-拡張案) | ✅ セーブ復帰は RI-58 完了。リプレイ保存・閲覧は未着手 | [remaining-issues.md](./remaining-issues.md) RI-58 / RI-61 |
| 拡張案（デイリーラン・なぜ燃えたか・図鑑以外のローカル拡張） | [23](../SPEC.md#23-拡張案) | 一部着手（RI-34′ / RI-34″ 完了）。外部 API は対象外。本体は保留 | [remaining-issues.md](./remaining-issues.md) RI-34 / RI-34′ / RI-34″ |
