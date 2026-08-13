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
| [2](../SPEC.md#2-コンセプト) | AI導入と組織制約の因果 | [probability-model.md](./probability-model.md), `src/sim/sprint.ts`, `src/sim/model/process.ts`, `tests/unit/sim/defaultAiDelivery.test.ts`, `tests/unit/helpers/aiAdoptionSeeds.ts` | ✅ AI on/off は状態へ伝播し、既定部分配布の出荷正方向と Review/Rework 増を固定（RI-77）。コホートでも `skilledNoHire` が出荷・勝率で `noAiCtl` を上回る |
| [2.1](../SPEC.md#21-世界観の制約現実の開発組織から大きく逸脱しない) | 世界観 | [architecture.md](./architecture.md) §7 | ✅ |
| [3](../SPEC.md#3-ゲームの基本ループ) | 複数四半期ラン、固定トラック、ビート | `src/sim/run/engine.ts`, `phases.ts`, `events.ts`, `tests/unit/sim/runLoop.test.ts` | ✅ |
| [3.1](../SPEC.md#31-時間の目安ペーシング規定) | テンポと速度操作 | `src/ui/sprintTempo.ts`, `tests/unit/ui/sprintTempo.test.ts`, `tests/unit/helpers/pacingStats.ts` | ✅ |
| [4.1〜4.6](../SPEC.md#4-ゲーム画面) | 現場、HUD、介入、ビート、進化、リザルト | `src/ui/*Screen.tsx`, `src/ui/SprintLayout.tsx`, `src/ui/AspectStage.tsx`, `src/ui/responsiveMode.tsx`, `src/sim/actions.ts`, `src/render/boardScene.ts`, `tests/e2e/sprint-layout.spec.ts`, `tests/e2e/sprint-pixi-visual.spec.ts` | 🟡 主要機能、RI-69／RI-70の個別症状、RI-94の5 viewport契約、RI-95の名前付きスロット、RI-96のスプリント盤面共通AspectStage、RI-97のCSS境界、RI-98のレスポンシブ表示モード正本を固定済み。共有トークンはRI-99 |
| [4.6.1](../SPEC.md#461-四半期レビュー--目標修正画面) | 四半期レビューと継続 | `QuarterReviewScreen.tsx`, `quarterReview.ts`, `goalAdjustments.ts` | ✅ Delivery KPI は四半期累計スケールで整合（RI-68） |
| [4.7〜4.11](../SPEC.md#47-組織スケールとズーム階層巨大組織対応) | 独立チーム、部署・全社・業界、ドリルダウン | `src/sim/orgscale/`, `OrgScreen.tsx`, `DeptScreen.tsx`, `IndustryScreen.tsx`, `src/ui/AspectStage.tsx`, `tests/e2e/org-scale.spec.ts` | ✅ 全社・部署・業界の設計比率、DOM/Pixi共有AspectStage、全社カメラ、部署ドリルダウン、ズームオーバーレイスクロールを固定（RI-100） |
| [5](../SPEC.md#5-プレイヤーが操作するリソース) | 組織・集中力・予算・進化資源 | `src/sim/types.ts`, `src/sim/org.ts`, `src/sim/run/types.ts` | ✅ |
| [6](../SPEC.md#6-スプリント中の能動操作) | 介入、集中力、コンボ、対象指定 | `src/sim/actions.ts`, `ActionBar.tsx`, `boardDragPlan.ts` | ✅ |
| [7](../SPEC.md#7-ai導入施策カードデッキ) | デッキ、手札、ドラフト、強化、コレクション | `src/data/cards.ts`, `src/sim/cards.ts`, `CardView.tsx`, `DeckPolicyScreen.tsx`, `CardCollectionScreen.tsx` | ✅ |
| [8](../SPEC.md#8-組織文化レリック) | 恒久パッシブ | `src/data/relics.ts`, `src/sim/run/effects.ts` | ✅ |
| [9](../SPEC.md#9-ランダムイベント周回進行の中核エンジン) | 状態依存イベント | [probability-model.md](./probability-model.md), `src/data/events.ts`, `src/sim/run/events.ts` | ✅ |
| [10](../SPEC.md#10-ランとボススプリント) | 四半期末ボス | `src/data/bosses.ts`, `src/sim/run/engine.ts` | ✅ |
| [11](../SPEC.md#11-組織進化ツリー) | ラン内ビルド | `src/data/evolution.ts`, `src/sim/run/evolution.ts` | ✅ |
| [12](../SPEC.md#12-キャラクター育成) | 個体、成長、編成、スタミナ | `src/sim/member/`, `FormationScreen.tsx`, `tests/unit/sim/member.test.ts` | ✅ |
| [13](../SPEC.md#13-組織タイプ診断) | 診断と演出 | `src/sim/diagnosis.ts`, `src/render/diagnosisTheme.ts` | ✅ |
| [14〜16](../SPEC.md#14-勝利条件) | 勝利、継続不能、難易度・試練 | `src/sim/outcome.ts`, `src/data/difficulties.ts`, `quarterReview.ts` | ✅ 判定は実装済み。Easy 序盤の燃え尽き導線は RI-67 でチュートリアル／HUD を補強 |
| [17](../SPEC.md#17-メタ進行とアンロック) | メタ解放、実績、永続化 | `src/state/meta.ts`, `metaPersistence.ts`, `runPersistence.ts`, `replayPersistence.ts` | ✅ |
| [18](../SPEC.md#18-視覚表現) | Pixi描画、演出、音響 | `src/render/adapters/`, `src/ui/*Effects.tsx`, `src/audio/` | ✅ |
| [19〜20](../SPEC.md#19-面白さの核) | 体験・教育的価値 | ゲーム全体の判断基準 | — |
| [19.1](../SPEC.md#191-面白さの定義と判定基準) | 面白さの定義と判定基準（F-1〜F-12） | プレイテストの合否判断基準。[playtest-findings.md](./playtest-findings.md) | 🟡 定義済み。F-1・F-7（RI-73）と F-10（RI-76）は再計測で未達。F-2・F-8 も未充足（RI-74 等）。F-11 は RI-86 で充足。F-4 は RI-75／RI-85、F-5 は RI-84、F-6 は RI-82、F-12 は RI-81 で実装済み。F-9 の「打てた手」観測は RI-89 で計測可能（差の再計測は playtest:report 参照）。F-3 は未検証 |
| [21](../SPEC.md#21-仕様の解釈と優先順位) | 仕様の優先順位 | `SPEC.md`, 本表, `src/data/` | — |
| [22](../SPEC.md#22-技術構成) | レイヤ分離、決定論、保存、テスト | [architecture.md](./architecture.md), [probability-model.md](./probability-model.md), `src/game.ts`, `src/state/`, `src/data/assets.ts`, `src/render/gameAssetView.ts`, `src/ui/SprintLayout.tsx`, `src/ui/AspectStage.tsx`, `src/ui/responsiveMode.tsx`, `tests/e2e/fixtures.ts`, `tests/` | 🟡 中核のレイヤ分離・決定論・保存、公開 `GameHandle` による5 viewport回帰、名前付きスロット、全盤面のAspectStage、RI-97のCSS境界、RI-98のレスポンシブ正本、RI-99の共有ビジュアルトークンを実装済み。残る未充足は本表の他課題 |
| [23](../SPEC.md#23-拡張案) | ローカル完結の将来拡張 | デイリー、研修方針、図鑑、リプレイ等は実装済み | 🟡 残候補はRI-34 |
| [24〜25](../SPEC.md#24-企画の価値) | 企画価値と結論 | — | — |

## 2. 未充足一覧

| 課題 | 影響 | 追跡先 |
| --- | --- | --- |
| ローカル拡張の一部が未着手 | 第23章 | [RI-34](./remaining-issues.md#ri-34-ローカル完結の将来拡張) |
| 子コンテンツの変更で画面レイアウトが再崩壊する | 第4／第22.2／第22.5 | [RI-93](./remaining-issues.md#ri-93-子コンテンツの変更で再崩壊する画面レイアウト構造)（実装単位RI-94〜100） |
| ~~狭幅で盤面・介入バーへスクロールが必要~~ | 第4のUI操作性 | ~~[RI-70](./remaining-issues.md#ri-70-モバイルのスプリント操作性)~~ 完了 |
| 難易度カーブと固定強手の解消（F-1・F-7。再計測で未達） | 第16／第19.1 F-1・F-7 | [RI-73](./remaining-issues.md#ri-73-難易度カーブと常に正解常に不正解な手がある構造) |
| Nightmare は AI 依存を意識しない方針で第1スプリント敗北が確定する | 第15〜16／第19.1 F-8・F-9 | [RI-74](./remaining-issues.md#ri-74-nightmare-は-ai-依存を意識しない方針で第1スプリント敗北が確定する) |
| ~~スプリントが規定帯をほぼ全面的に下回る~~ | 第3.1／第19.1 F-4 | ~~[RI-75](./remaining-issues.md#ri-75-スプリントが規定帯をほぼ全面的に下回る)~~ 完了 |
| 勝利種別のビルド分岐（F-10。再計測で modal FAIL） | 第14／第19.1 F-10 | [RI-76](./remaining-issues.md#ri-76-勝利種別が実質2種で最も受動的なプレイが最上位勝利を取る) |
| ~~AI 導入が既定 ON で、解除側の代償が一方的に大きく、AI の効き方が実務感覚と逆向き~~ | 第2／第19.1 F-1・F-2・F-10 | ~~[RI-77](./remaining-issues.md#ri-77-ai-導入が既定-on-で既定のまま進むのが有利)~~ 完了 |
| ~~スプリント間投資のうち、ショップと休息の選択が結果を変えない~~ | 第7／第19.1 F-2 | ~~[RI-78](./remaining-issues.md#ri-78-スプリント間投資のうちショップと休息の選択が結果を変えない)~~ 完了。ショップは `skilledShopCtl` 対照の純出荷改善 13/14 |
| ~~予算枯渇・信頼枯渇が予兆なく終わり、敗因ラベルが実態と一致しない~~ | 第15／第19.1 F-8・F-9 | ~~[RI-79](./remaining-issues.md#ri-79-予算枯渇信頼枯渇が予兆なく終わり敗因ラベルが実態と一致しない)~~ 完了 |
| ~~スプリント評価が S に偏り、無介入と熟練を区別しない~~ | 第4.6 | ~~[RI-80](./remaining-issues.md#ri-80-スプリント評価が-s-に偏る)~~ 完了 |
| ~~目標修正の選択が結果を変えない~~ | 第4.6.1／第19.1 F-2 第4層 | ~~[RI-83](./remaining-issues.md#ri-83-目標修正の選択が結果を変えない)~~ 完了 |
| ~~条件を揃えると介入の寄与がほぼ消える（F-5 の定義と実装のずれ）~~ | 第6／第19.1 F-5 | ~~[RI-84](./remaining-issues.md#ri-84-条件を揃えると介入の寄与がほぼ消える)~~ 完了 |
| ~~レビュー凍結が選択不能な判定イベントでしか確定しない~~ | 第4／第19.1 F-4・F-8 | ~~[RI-85](./remaining-issues.md#ri-85-レビュー凍結が選択不能な判定イベントでしか確定しない)~~ 完了 |
| ~~Q1 で進化ツリーを取り切れ、ビルドの方向という概念が成立しない~~ | 第11／第19.1 F-11 | ~~[RI-86](./remaining-issues.md#ri-86-q1-で進化ツリーを取り切れてしまいビルドの方向という概念が成立しない)~~ 完了 |
| セキュリティ軸が存在しない | 第19.1 F-10 のビルド表 | [RI-87](./remaining-issues.md#ri-87-セキュリティ軸が存在しない) |
| ~~インフラコスト軸が存在しない~~ | 第19.1 F-10 のビルド表 | ~~[RI-88](./remaining-issues.md#ri-88-インフラコスト軸が存在しない)~~ 完了 |
| ~~敗因ごとに「打てた手」が違うかを測る手段が無い（F-9 が部分検証に留まる）~~ | 第19.1 F-9 | ~~[RI-89](./remaining-issues.md#ri-89-敗因ごとに打てた手が違うかを測る手段が無い)~~ 完了 |
| ゲーム用SVGアセットの置き換え・利用方針が未定義 | 第22.2 / 第22.4 | [RI-92](./remaining-issues.md#ri-92-ゲーム用svgアセットの置き換え利用方針が未定義) |
