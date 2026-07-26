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
| [2](../SPEC.md#2-コンセプト) | AI導入と組織制約の因果 | `src/sim/sprint.ts`, `src/sim/model/process.ts`, `tests/unit/process.test.ts` | ✅ |
| [2.1](../SPEC.md#21-世界観の制約現実の開発組織から大きく逸脱しない) | 世界観 | [architecture.md](./architecture.md) §7 | ✅ |
| [3](../SPEC.md#3-ゲームの基本ループ) | 複数四半期ラン、固定トラック、ビート | `src/sim/run/engine.ts`, `phases.ts`, `events.ts`, `tests/unit/run-loop.test.ts` | ✅ |
| [3.1](../SPEC.md#31-時間の目安ペーシング規定) | テンポと速度操作 | `src/ui/sprintTempo.ts`, `tests/unit/sprintTempo.test.ts`, `tests/unit/helpers/pacingStats.ts` | ✅ |
| [4.1〜4.6](../SPEC.md#4-ゲーム画面) | 現場、HUD、介入、ビート、進化、リザルト | `src/ui/*Screen.tsx`, `src/sim/actions.ts`, `src/render/boardScene.ts`, 関連unit/E2E | 🟡 主要機能は実装済み。デスクトップの操作バー重なりはRI-69、狭幅の操作性はRI-70 |
| [4.6.1](../SPEC.md#461-四半期レビュー--目標修正画面) | 四半期レビューと継続 | `QuarterReviewScreen.tsx`, `quarterReview.ts`, `goalAdjustments.ts` | 🟡 フロー実装済み。Delivery KPI のスケール不整合はRI-68 |
| [4.7〜4.11](../SPEC.md#47-組織スケールとズーム階層巨大組織対応) | 独立チーム、部署・全社・業界、ドリルダウン | `src/sim/orgscale/`, `OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx` | ✅ |
| [5](../SPEC.md#5-プレイヤーが操作するリソース) | 組織・集中力・予算・進化資源 | `src/sim/types.ts`, `src/sim/org.ts`, `src/sim/run/types.ts` | ✅ |
| [6](../SPEC.md#6-スプリント中の能動操作) | 介入、集中力、コンボ、対象指定 | `src/sim/actions.ts`, `ActionBar.tsx`, `boardDragPlan.ts` | ✅ |
| [7](../SPEC.md#7-ai導入施策カードデッキ) | デッキ、手札、ドラフト、強化、コレクション | `src/data/cards.ts`, `src/sim/cards.ts`, `CardView.tsx`, `DeckPolicyScreen.tsx`, `CardCollectionScreen.tsx` | ✅ |
| [8](../SPEC.md#8-組織文化レリック) | 恒久パッシブ | `src/data/relics.ts`, `src/sim/run/effects.ts` | ✅ |
| [9](../SPEC.md#9-ランダムイベント周回進行の中核エンジン) | 状態依存イベント | `src/data/events.ts`, `src/sim/run/events.ts` | ✅ |
| [10](../SPEC.md#10-ランとボススプリント) | 四半期末ボス | `src/data/bosses.ts`, `src/sim/run/engine.ts` | ✅ |
| [11](../SPEC.md#11-組織進化ツリー) | ラン内ビルド | `src/data/evolution.ts`, `src/sim/run/evolution.ts` | ✅ |
| [12](../SPEC.md#12-キャラクター育成) | 個体、成長、編成、スタミナ | `src/sim/member/`, `FormationScreen.tsx`, `tests/unit/member.test.ts` | ✅ |
| [13](../SPEC.md#13-組織タイプ診断) | 診断と演出 | `src/sim/diagnosis.ts`, `src/render/diagnosisTheme.ts` | ✅ |
| [14〜16](../SPEC.md#14-勝利条件) | 勝利、継続不能、難易度・試練 | `src/sim/outcome.ts`, `src/data/difficulties.ts`, `quarterReview.ts` | 🟡 判定は実装済み。Easy 序盤のシニア燃え尽き即死とオンボーディング欠落はRI-67 |
| [17](../SPEC.md#17-メタ進行とアンロック) | メタ解放、実績、永続化 | `src/state/meta.ts`, `metaPersistence.ts`, `runPersistence.ts`, `replayPersistence.ts` | ✅ |
| [18](../SPEC.md#18-視覚表現) | Pixi描画、演出、音響 | `src/render/adapters/`, `src/ui/*Effects.tsx`, `src/audio/` | ✅ |
| [19〜20](../SPEC.md#19-面白さの核) | 体験・教育的価値 | ゲーム全体の判断基準 | — |
| [19.1](../SPEC.md#191-面白さの定義と判定基準) | 面白さの定義と判定基準（F-1〜F-12） | プレイテストの合否判断基準。[playtest-findings.md](./playtest-findings.md) | 🟡 定義済み。F-1・F-2・F-4・F-5・F-6・F-7・F-8・F-9・F-10・F-12 が未充足でRI-72〜81。F-3・F-11 は今回のプレイテストでは未検証 |
| [21](../SPEC.md#21-仕様の解釈と優先順位) | 仕様の優先順位 | `SPEC.md`, 本表, `src/data/` | — |
| [22](../SPEC.md#22-技術構成) | レイヤ分離、決定論、保存、テスト | [architecture.md](./architecture.md), `src/game.ts`, `src/state/`, `tests/` | ✅ |
| [23](../SPEC.md#23-拡張案) | ローカル完結の将来拡張 | デイリー、研修方針、図鑑、リプレイ等は実装済み | 🟡 残候補はRI-34 |
| [24〜25](../SPEC.md#24-企画の価値) | 企画価値と結論 | — | — |

## 2. 未充足一覧

| 課題 | 影響 | 追跡先 |
| --- | --- | --- |
| ローカル拡張の一部が未着手 | 第23章 | [RI-34](./remaining-issues.md#ri-34-ローカル完結の将来拡張) |
| Easy 序盤のシニア燃え尽き即死とオンボーディング欠落 | 第14〜16／第19〜20の導入体験 | [RI-67](./remaining-issues.md#ri-67-オンボーディングとシニア燃え尽きの断絶) |
| 四半期レビュー Delivery KPI が四半期累計と1スプリント相当目標を比較し自明達成 | 第4.6.1／第15の勝利条件表示 | [RI-68](./remaining-issues.md#ri-68-四半期レビュー-delivery-kpi-のスケール不整合) |
| デスクトップでスプリント上部操作バーが盤面と重なる | 第4のUI | [RI-69](./remaining-issues.md#ri-69-スプリント上部操作バーと盤面の重なり) |
| 狭幅で盤面・介入バーへスクロールが必要 | 第4のUI操作性 | [RI-70](./remaining-issues.md#ri-70-モバイルのスプリント操作性) |
| 難易度カーブの崖と、介入・カード・採用が勝率に結びつかない | 第16／第19.1 F-1・F-5・F-7 | [RI-72](./remaining-issues.md#ri-72-難易度カーブの崖と介入が勝率に結びつかない構造) |
| Nightmare が第1スプリントで AI 依存敗北に確定 | 第15〜16／第19.1 F-8・F-9 | [RI-73](./remaining-issues.md#ri-73-nightmare-が第1スプリントで-ai-依存敗北に確定する) |
| スプリントが規定の半分の長さで、難易度が低いほど短い | 第3.1／第19.1 F-4 | [RI-74](./remaining-issues.md#ri-74-スプリントが規定の半分の長さで難易度が低いほど短い) |
| 勝利種別が実質2種で、受動的なプレイが最上位勝利を取る | 第14／第19.1 F-10 | [RI-75](./remaining-issues.md#ri-75-勝利種別が実質2種で最も受動的なプレイが最上位勝利を取る) |
| AI 導入が既定 ON で「AI を入れるか」の意思決定が無い | 第2／第19.1 F-1・F-2・F-10 | [RI-76](./remaining-issues.md#ri-76-ai-導入が既定-on-でai-を入れるかの意思決定が存在しない) |
| 介入の打ち所が来ず、介入回数が第3.1 の規定を下回る | 第3.1／第6／第19.1 F-4 | [RI-77](./remaining-issues.md#ri-77-介入の打ち所が来ない炎上介入回数が規定を下回る) |
| 予算枯渇・信頼枯渇が予兆なく終わる | 第15／第19.1 F-6・F-8・F-9 | [RI-78](./remaining-issues.md#ri-78-予算枯渇信頼枯渇が予兆なく終わる) |
| スプリント評価が S に偏る | 第4.6／第19.1 F-6 | [RI-79](./remaining-issues.md#ri-79-スプリント評価が-s-に偏る) |
| ドラフトのマリガンが無い | 第7／第19.1 F-12 | [RI-80](./remaining-issues.md#ri-80-ドラフトのマリガンが無い) |
| 敗北画面に「次の一手」が無い | 第13／第19.1 F-6 | [RI-81](./remaining-issues.md#ri-81-敗北画面に次の一手が無い) |
