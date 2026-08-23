# SPEC ↔ 実装 対応表

[`SPEC.md`](../SPEC.md)と現行実装のトレーサビリティ。実装手順や完了課題の履歴は持たず、現在の対応先と未充足だけを示す。

状態:

- **✅** 中核要件を実装済み
- **🟡** 動作する実装はあるが、明示的な未充足がある
- **—** 企画・判断基準であり直接の実装対象ではない

## 1. 章別対応

| SPEC | 内容 | 主な実装・テスト | 状態 |
| --- | --- | --- | --- |
| [1](../SPEC.md#1-企画概要) | 企画概要 | — | — |
| [2](../SPEC.md#2-コンセプト) | AI導入と組織制約の因果 | [probability-model.md](../docs/probability-model.md), `src/sim/sprint.ts`, `src/sim/model/process.ts`, `tests/unit/sim/defaultAiDelivery.test.ts`, `tests/unit/helpers/aiAdoptionSeeds.ts` | ✅ AI on/off は状態へ伝播し、既定部分配布の出荷正方向と Review/Rework 増を固定（RI-77）。AI前提ワークフローの成熟差は64 seedの統制Monte Carloで確定（RI-134） |
| [2.1](../SPEC.md#21-世界観の制約現実の開発組織から大きく逸脱しない) | 世界観 | [architecture.md](../docs/architecture.md) §7 | ✅ |
| [3](../SPEC.md#3-ゲームの基本ループ) | 複数四半期ラン、固定トラック、ビート | `src/sim/run/engine.ts`, `src/data/balance/run.ts`, `phases.ts`, `events.ts`, `tests/unit/sim/runLoop.test.ts` | ✅ 固定トラックの進行値とイベント率をランレジストリへ移行済み（RI-111） |
| [3.1](../SPEC.md#31-時間の目安ペーシング規定) | テンポと速度操作 | `src/data/balance/pacing.ts`, `src/sim/run/sprintBaselineBuild.ts`, `src/sim/engine.ts`, `src/sim/run/engine.ts`, `src/ui/sprintTempo.ts`, `src/ui/useRun.ts`, `scripts/playtest-report.mjs`, `tests/unit/ui/sprintTempo.test.ts`, `tests/unit/helpers/pacingStats.ts` | ✅ `PACING_BALANCE`を正本とし、実行alias・壁時計派生値・SSRレポート読込を移行済み（RI-114） |
| [4.1〜4.6](../SPEC.md#4-ゲーム画面) | 現場、HUD、介入、ビート、進化、リザルト | `src/ui/*Screen.tsx`, `src/ui/SprintLayout.tsx`, `src/ui/AspectStage.tsx`, `src/ui/responsiveMode.tsx`, `src/sim/actions.ts`, `src/data/balance/sprint.ts`, `src/render/boardScene.ts`, `tests/e2e/sprint-layout.spec.ts`, `tests/e2e/sprint-pixi-visual.spec.ts` | ✅ 主要機能、5 viewport契約、名前付きスロット、共通AspectStage、CSS境界、レスポンシブ表示モード、DOM/Pixi共有トークン、1024×768・6レリックの盤面最低寸法（RI-69／70、RI-93〜100）。タスク分布・評価・称号閾値をスプリントレジストリへ移行済み（RI-120） |
| [4.6.1](../SPEC.md#461-四半期レビュー--目標修正画面) | 四半期レビューと継続 | `QuarterReviewScreen.tsx`, `quarterReview.ts`, `goalAdjustments.ts`, `reviewHistoryView.ts`, `okrTemplates.ts`, `okrView.ts`, `stakeholderNegotiationView.ts`, `quarterRoadmapView.ts` | ✅ 本体のレビューと目標修正は実装済み（RI-68）。完了済み四半期の履歴表示は RI-126。OKRテンプレートは RI-129。ステークホルダー別交渉は RI-130。複数四半期ロードマップ（表示専用）は RI-131 |
| [4.7〜4.11](../SPEC.md#47-組織スケールとズーム階層巨大組織対応) | 独立チーム、部署・全社・業界、ドリルダウン | `src/sim/orgscale/`, `OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx`, `src/ui/AspectStage.tsx`, `src/render/orgDeptComparison.ts`, `src/render/trendHistoryView.ts`, `tests/e2e/org-scale.spec.ts` | ✅ 全社・部署・業界の設計比率、DOM/Pixi共有AspectStage、全社カメラ、部署ドリルダウン、ズームオーバーレイスクロールを固定（RI-100）。粗粒度チームモデルの値・境界は `COARSE_TEAM_BALANCE` へ移行済み（RI-113）。部門現在値比較は RI-125。診断・KPI時系列は RI-128 |
| [5](../SPEC.md#5-プレイヤーが操作するリソース) | 組織・集中力・予算・進化資源 | `src/sim/types.ts`, `src/sim/org.ts`, `src/sim/run/types.ts`, `src/data/balance/run.ts` | ✅ 休息・ショップ・進化報酬・インフラ費用の基本値をランレジストリへ移行済み（RI-111） |
| [6](../SPEC.md#6-スプリント中の能動操作) | 介入、集中力、コンボ、対象指定 | `src/sim/actions.ts`, `src/data/balance/actions.ts`, `ActionBar.tsx`, `boardDragPlan.ts` | ✅ 実行値・効果・差配境界をアクションレジストリへ移行済み（RI-110） |
| [7](../SPEC.md#7-ai導入施策カードデッキ) | デッキ、手札、ドラフト、強化、コレクション | `src/data/cards.ts`, `src/data/balance/cards.ts`, `src/sim/cards.ts`, `CardView.tsx`, `DeckPolicyScreen.tsx`, `CardCollectionScreen.tsx` | ✅ 手札・ドラフト・強化・効果clampなどの共通実行ルールをカードレジストリへ移行済み（RI-122） |
| [8](../SPEC.md#8-組織文化レリック) | 恒久パッシブ | `src/data/relics.ts`, `src/sim/run/effects.ts` | ✅ |
| [9](../SPEC.md#9-ランダムイベント周回進行の中核エンジン) | 状態依存イベント | [probability-model.md](../docs/probability-model.md), `src/data/events.ts`, `src/data/balance/run.ts`, `src/sim/run/events.ts` | ✅ イベント率とsoft結果の生存境界をランレジストリへ移行済み（RI-111） |
| [10](../SPEC.md#10-ランとボススプリント) | 四半期末ボス | `src/data/bosses.ts`, `src/data/balance/run.ts`, `src/sim/run/engine.ts` | ✅ 四半期スプリント数とショップ・課金のラン値をレジストリへ移行済み（RI-111） |
| [11](../SPEC.md#11-組織進化ツリー) | ラン内ビルド | `src/data/evolution.ts`, `src/data/balance/run.ts`, `src/sim/run/evolution.ts` | ✅ 進化ポイント報酬の基本値をランレジストリへ移行済み（RI-111） |
| [12](../SPEC.md#12-キャラクター育成) | 個体、成長、編成、スタミナ | `src/sim/member/`, `FormationScreen.tsx`, `tests/unit/sim/member.test.ts` | ✅ |
| [13](../SPEC.md#13-組織タイプ診断) | 診断と演出 | `src/sim/diagnosis.ts`, `src/data/balance/outcome.ts`, `src/render/diagnosisTheme.ts`, `src/render/trendHistoryView.ts` | ✅ 診断境界は `OUTCOME_BALANCE` へ移行済み。第23章の時系列トレンドは RI-128 |
| [14〜16](../SPEC.md#14-勝利条件) | 勝利、継続不能、難易度・試練 | `src/sim/outcome.ts`, `src/data/balance/outcome.ts`, `src/data/difficulties.ts`, `quarterReview.ts` | ✅ KPI・勝敗・継続不能・勝利種別の境界を `OUTCOME_BALANCE` へ移行済み（RI-112）。Easy 序盤の燃え尽き導線は RI-67 でチュートリアル／HUD を補強 |
| [17](../SPEC.md#17-メタ進行とアンロック) | メタ解放、実績、永続化 | `src/state/meta.ts`, `src/data/balance/meta.ts`, `metaPersistence.ts`, `runPersistence.ts`, `replayPersistence.ts` | ✅ 優先カード上限・ラン報酬係数・デイリー条件は `META_BALANCE` へ移行済み（RI-124） |
| [18](../SPEC.md#18-視覚表現) | Pixi描画、演出、音響 | `src/render/adapters/`, `src/ui/*Effects.tsx`, `src/audio/` | ✅ |
| [19〜20](../SPEC.md#19-面白さの核) | 体験・教育的価値 | ゲーム全体の判断基準 | — |
| [19.1](../SPEC.md#191-面白さの定義と判定基準) | 面白さの定義と判定基準（F-1〜F-12） | プレイテストの合否判断基準。[playtest-findings.md](./playtest-findings.md) | 🟡 F-8の回復余地ギャップは既定コホートで PASS（RI-132）。F-9の有効手集合は完全評価不足で未計測（ゲート実装済み、追跡は [RI-136](./remaining-issues.md#ri-136-f-9-有効手集合の完全計測)）。F-1・F-7はRI-73、F-2はRI-77／78／83、F-3はRI-102、F-4はRI-75／85、F-5はRI-84、F-6はRI-82、F-10はRI-76、F-11はRI-86、F-12はRI-81で充足または実装済み |
| [21](../SPEC.md#21-仕様の解釈と優先順位) | 仕様の優先順位 | `SPEC.md`, 本表, `src/data/` | — |
| [22](../SPEC.md#22-技術構成) | レイヤ分離、決定論、保存、テスト | [architecture.md](../docs/architecture.md), [probability-model.md](../docs/probability-model.md), `src/game.ts`, `src/state/`, `src/data/balance/`, `src/data/assets.ts`, `src/render/gameAssetView.ts`, `src/ui/SprintLayout.tsx`, `src/ui/AspectStage.tsx`, `src/ui/responsiveMode.tsx`, `tests/e2e/fixtures.ts`, `tests/` | 🟡 中核のレイヤ分離・決定論・保存、公開 `GameHandle` による5 viewport回帰、名前付きスロット、全盤面のAspectStage、RI-97のCSS境界、RI-98のレスポンシブ正本、RI-99の共有ビジュアルトークンを実装済み。SSoT親エピック（RI-104）と型付きバランスレジストリ、生成パラメータ表、工程モデル、メンバー・採用、介入・差配、ラン進行・経済、KPI・勝敗・診断、粗粒度チーム、カード実行ルール、タスク分布・スプリント評価、ペーシング、メタ進行・デイリー条件のレジストリ移行、ルールセット互換、代表曲線、AI前提ワークフローの係数確定（RI-134）は完了済み。Fast Refresh警告5件の解消は[RI-137](./remaining-issues.md#ri-137-fast-refresh警告の解消)、`balance:check`の手書き差分誤検知は[RI-138](./remaining-issues.md#ri-138-balancecheckの手書き差分誤検知)で追跡する。 |
| [23](../SPEC.md#23-拡張案) | ローカル完結の将来拡張 | デイリー、研修方針、図鑑、リプレイ、ツール別シナリオ、部門比較、レビュー履歴、開始レシピ、診断・KPI時系列、OKRテンプレート、ステークホルダー別交渉、複数四半期ロードマップ（表示専用）、途中セーブ・リプレイのファイル共有等は実装済み | 🟡 切り出し候補のうち開始レシピと途中セーブ・リプレイのファイル共有は充足。組織診断ダッシュボードの深掘りは [RI-135](./remaining-issues.md#ri-135-組織診断ダッシュボードの深掘り)。外部API・共有バックエンド、社内LT／経営プレゼンモードは対象外 |
| [24〜25](../SPEC.md#24-企画の価値) | 企画価値と結論 | — | — |

## 2. 未充足一覧

| 課題 | 影響 | 追跡先 |
| --- | --- | --- |
| 組織診断ダッシュボードの深掘り | 第4.7〜4.11／第23 | [RI-135](./remaining-issues.md#ri-135-組織診断ダッシュボードの深掘り) |
| F-9 有効手集合の完全計測 | 第19.1 | [RI-136](./remaining-issues.md#ri-136-f-9-有効手集合の完全計測) |
