# プロジェクト残課題バックログ

プロジェクトの残課題を **ID 管理のバックログ**として一覧化したもの。**1 項目 ≒ 1 PR** を原則とし、
各 ID が独立して着手・レビュー・マージできる単位になるよう整理している。実装後に繰り越した未解決事項・
改善候補・判断点、`SPEC.md` の企画・デザイン意図に対して**まだ届いていない／
暫定のままの項目**、および**遊んでみて見えてきた設計再検討（SPEC からの変更提案）**を一本化して追跡する。

> 実装済み機能とコードの対応・充足状況は [spec-mapping.md](./spec-mapping.md) §1 の対応表、
> 未充足箇所の一覧は同 §2 に集約している。本ファイルは「繰り越し・未解決のやること」に絞る。

> 基本ループ再設計（ノード選択廃止→四半期トラック＋イベント判定）は **RI-33 として実装済み**
> （PR #48 マージ）。詳細は RI-33 の項と実装コード（`src/sim/run/`）を参照する。

## 運用ルール

- **ID**: `RI-NN`。採番は連番・**欠番を再利用しない**（完了・破棄しても番号は空けたまま追記）。
- **粒度**: 1 項目 ≒ 1 PR。大きすぎて 1 PR に収まらない項目は **エピック**として印を付け、本文に分割方針を書く
  （子 PR は本文の箇条書きで管理）。
- **優先度**: **高**=体験の核に直結 / **中**=見栄え・整合 / **低**=将来拡張。
- **状態**: `未着手` / `進行中` / `保留(要判断)` / `完了`。完了は当面リストに残し、追って整理する。
- **依存**: 先行して完了が必要な項目 ID（横断的な基盤＝統計テスト基盤 RI-14・スプライト化 RI-07・
  Pixi 適用拡張 RI-11 などは依存列で表現する）。

> 旧版（節番号 §1〜§4・横断テーマ A〜F）からの対応は末尾「旧分類との対応」を参照。

---

## インデックス

### 画面・演出（VIS）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-01 | 全社マップ(org-screen)の等角化 | 高 | 完了 | — | 第4.8 / `org-screen.png` |
| RI-02 | 部署ビュー(dept-screen)の等角化 | 高 | 完了 | — | 第4.9 / `dept-screen.png` |
| RI-03 | 業界ランキング(industry-screen)の等角化 | 中 | 完了 | — | 第4.10 / `industry-screen.png` |
| RI-04 | ドリルダウンのカメラ遷移演出 | 中 | 完了 | RI-11 | 第4.11 / `drilldown.html` |
| RI-05 | タスク粒の工程間移動アニメ | 高 | 完了 | — | 第18.1 |
| RI-06 | 延焼の連鎖演出 | 高 | 完了 | — | 第18.2 |
| RI-07 | キャラ/粒のスプライト化(`render/iso.ts`) | 低 | 完了 | — | 第18 |
| RI-08 | キャラ表情スプライト(疲れ顔/ガッツポーズ) | 低 | 完了 | RI-07 | 第18 |
| RI-09 | アクションバーのマネージャー像 | 低 | 未着手 | — | 第4.3 |
| RI-10 | ジューシー演出の上積み(スイープ/スローモ/ご褒美) | 低 | 未着手 | — | 第18.2 / 18.4 |

### 選択の可視化・フィードバック（UX）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-43 | 効果タグ自動生成基盤＋ビート選択肢のリスク・リターン表示 | 高 | 完了 | — | 第9 / 18.2 |
| RI-44 | カード/レリック/進化ノードへの効果タグ適用 | 高 | 完了 | RI-43 | 第7 / 8 / 11 |
| RI-45 | レバー/休憩/目標修正/介入アクションの効果数値表示 | 中 | 完了 | RI-43 | 第4.8 / 6 |
| RI-46 | 確率的な結果のリスク幅プレビュー(what-if 試算) | 中 | 完了 | RI-43 | 第22.3 / RI-13 / RI-14 |
| RI-47 | ステータス増減の汎用フィードバック演出 | 高 | 完了 | — | 第18.2 |
| RI-48 | HUD の情報設計強化(アイコン・良し悪しの方向・しきい値色) | 中 | 完了 | — | 第4.2 / 18 |
| RI-49 | 介入結果ペイロードの拡張(フィードバック基盤) | 高 | 完了 | — | 第6 / 18.2 |
| RI-50 | 介入ごとの盤面リアクション演出 | 高 | 完了 | RI-49 | 第6 / 18.2 / RI-10 |
| RI-51 | 発動不能理由の可視化＋対象数ライブバッジ | 高 | 完了 | — | 第4.3 / 6.1 |
| RI-52 | スプリント内イベントティッカー(介入・出来事ログ) | 中 | 完了 | RI-49 | 第6 / 18 |
| RI-53 | スプリントタイムライン記録とリザルト表示 | 中 | 完了 | RI-49 | 第4.6 / 6.3 |
| RI-54 | リザルトの介入効果分析とプレイ改善 Tips | 中 | 完了 | RI-49, RI-53 | 第4.6 / 13 |
| RI-55 | 無介入ベースライン比較(介入の成果表示) | 中 | 完了 | RI-49 | 第6 / RI-46 / RI-14 |

### 技術構成（TECH）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-11 | Pixi 適用範囲の拡張(部署/現場盤面) | 中 | 完了 | — | 第22 |
| RI-12 | バンドル分割(動的 import) | 低 | 未着手 | — | 第22 |
| RI-13 | 未導入の技術スタック(Web Worker+Comlink / Recharts・visx) | 中 | 未着手 | — | 第22 |
| RI-57 | メタ永続化の IndexedDB 移行＋旧 localStorage 統合 | 中 | 完了 | — | 第17 / 22 |

### バランス（BAL）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-14 | モンテカルロ統計テスト基盤 | 中 | 完了 | — | 第22.3 |
| RI-15 | スプリント主要メトリクスの許容レンジ | 中 | 完了 | RI-14 | — |
| RI-16 | 全社/部門レバー係数の許容レンジ | 中 | 完了 | RI-14 | `src/data/levers.ts` |
| RI-17 | 四半期レビューの代償・outcome 閾値・目標生成の許容レンジ | 中 | 完了 | RI-14 | `quarterReview.ts` |
| RI-18 | メタ解放コスト・points 配分の許容レンジ | 中 | 完了 | RI-14 | `src/data/unlocks.ts` |
| RI-19 | 編成差のスプリント結果への影響レンジ | 低 | 完了 | RI-14 | — |
| RI-56 | 介入効果量の許容レンジ(介入あり/なし差の担保) | 中 | 完了 | RI-14 | 第6 / `src/sim/actions.ts` |

### 機能・メタ進行（FEAT）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-20 | 称号(WinType)の永続コレクション化 | 中 | 完了 | — | 第4.6 / 17 |
| RI-21 | 診断別の画面演出(6組織タイプ) | 中 | 完了 | — | 第13 / 18.3 |
| RI-22 | 継続不能種別ごとの終了演出分け | 中 | 完了 | — | 第15 / 18.3 |
| RI-23 | 業界ランキングへのデイリー記録接続 | 中 | 完了 | — | 第4.10 / 17 |
| RI-24 | メタ解放対象の拡張(メンバー/トレイト/初期カード等) | 低 | 保留(要判断) | — | 第17 |
| RI-25 | 開始時の組織プリセット(実装 or 足場削除) | 低 | 保留(要判断) | — | 第17 |
| RI-26 | 採用の入口拡張(専用ノード/イベント/ショップ枠) | 低 | 保留(要判断) | — | 第4 |
| RI-27 | 個体メンバーの集約粒度を深める | 低 | 未着手 | — | 第4.7–4.9 |
| RI-28 | 四半期レビュー評価→メタ報酬の接続 | 低 | 保留(要判断) | — | 第8 / 17 |
| RI-29 | リザルトの介入内訳表示(割り込み×N / 緊急対応×N) | 中 | 完了 | — | 第4.6 |
| RI-30 | 能動操作の操作方式(タスク差配ドラッグ / 手札配布→発動) | 中 | 完了 | — | 第6 / 7 |
| RI-31 | 試練の追加(AI依存度の自然増加 ほか) | 低 | 完了 | — | 第16 |
| RI-32 | レリック入手元・即時敗北条件の補完 | 中 | 完了 | — | 第8 / 15 |

### 設計再検討（DESIGN）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-33 | ノード選択廃止→イベント判定化【エピック】 | 高 | 実装済み | — | 第3 / 4.4 / 9.4 / 10 |
| RI-34 | 23章「拡張案」全般【将来エピック】 | 低 | 保留(要判断) | — | 第23 |

### テスト・保守・技術的負債（QA）

| ID | 項目 | 優先度 | 状態 | 依存 | 関連 |
| --- | --- | --- | --- | --- | --- |
| RI-35 | 介入アクションのテーブル駆動テスト | 中 | 完了 | — | 第6 |
| RI-36 | コンボ/連携ゲージの UI↔sim 検証 E2E | 中 | 完了 | — | 第6.2 |
| RI-37 | カード強化のショップ/休息接続確認＋強化対象選択 UI | 中 | 完了 | — | 第7 |
| RI-38 | `tone: joke` のネタイベント追加 | 低 | 完了 | — | 第9 |
| RI-39 | XState の役割整理(`phase` 二重管理の解消) | 中 | 完了 | — | 第22 |
| RI-40 | 通しテスト(DoD)の再確認 | 低 | 未着手 | — | — |
| RI-41 | 代表 seed の記録(AIあり/なし差分) | 低 | 完了 | — | — |
| RI-42 | AI 過信の二重診断の段階分け判断 | 低 | 完了 | — | 第13 |

---

## 詳細

### 画面・演出（VIS）

> 「数字は動くが SPEC の目指すゲーム画面から離れている」問題への対応。メイン画面（スプリント盤面）は
> アイソメ俯瞰オフィスへ刷新済み（PR #38）。スプリント盤面で確立した手法 ——「純シーン計画
> （`*Scene.ts`、Vitest 検証）＋ SVG/Pixi 描画アダプタ＋設計座標空間の % 配置」—— を
> 全社マップ→部署ビュー→業界ランキングへ横展開するのが最短。Pixi 移植（RI-11）はこの等角化と歩調を合わせる。

#### RI-01 全社マップ(org-screen)の等角化 — 優先度:高 / 完了

**完了**: `src/render/orgBoardScene.ts` に `ORG_VIEW`（1404×573）設計座標空間と
`planOrgBoardScene()` を追加し、浮遊等角プレート・部門ゾーン（縦ストライプ）・共通基盤ハブ・
静的フローレーン（heat 色）・チーム島（ミニ机＋アバター＋AI ボット）のシーン計画を純関数で導出。
`OrgPlate` / `OrgTeamActor` / `OrgFlowLanes` / `OrgHub` / `OrgBoard` で DOM/SVG 等角描画に接続し、
`OrgScreen` の既定レンダラを矩形カードから等角盤面へ差し替え（`?renderer=pixi` は既存 Pixi を維持）。
Vitest: `tests/unit/orgBoardScene.test.ts`。E2E: `tests/e2e/org-scale.spec.ts`（`org-board` 検証追加）。

#### RI-02 部署ビュー(dept-screen)の等角化 — 優先度:高 / 完了

**完了**: `src/render/deptBoardScene.ts` に `DEPT_VIEW`（1404×573）設計座標空間と
`planDeptBoardScene()` を追加し、単一部門プレート・チームミニパイプライン（Coding/Review/Done）・
チーム間依存フロー（連鎖炎上 heat）・工程ラベルを純関数で導出。
`DeptPlate` / `DeptTeamMini` / `DeptDependencyFlows` / `DeptBoard` で DOM/SVG 等角描画に接続し、
`DeptScreen` のフラット `TeamPipeline` を等角盤面へ差し替え（部門 HUD・部門レバーは維持）。
Vitest: `tests/unit/deptBoardScene.test.ts`。E2E: `tests/e2e/org-scale.spec.ts`（`dept-board` 検証）。

#### RI-03 業界ランキング(industry-screen)の等角化 — 優先度:中 / 完了

**完了**: `src/render/industryBoardScene.ts` に `INDUSTRY_VIEW`（740×360）設計座標空間と
`planIndustryBoardScene()` を追加し、ランキング種別ごとのスコアから上位 HQ ビルの高さ・配置・
1位王冠・自社発光を純関数で導出。`src/ui/IndustrySkyline.tsx` で等角ビル SVG とラベルへ接続し、
`IndustryScreen` のフラットな棒グラフスカイラインを置換した。自社が上位枠外でも自社 HQ を末尾に含める。
Vitest: `tests/unit/industryBoardScene.test.ts`。E2E: `tests/e2e/org-scale.spec.ts`（スカイライン・王冠・自社 HQ 検証）。

#### RI-04 ドリルダウンのカメラ遷移演出 — 優先度:中（依存: RI-11）/ 完了

**完了**: 島タップ→フォーカスリング→カメラが島へ寄る→クロスフェードで現場着地（第4.11）を実装。
`src/render/orgIslandView.ts` の `focusRingTone` が遷移先チームの炎上/渋滞状態からリングの色
（炎上=橙赤 / Review Hell=赤 / 渋滞=黄 / 健全=緑）と強さを導き、「移動先の状態が遷移演出にも
反映される」を満たす。`pixiOrgRenderer.playFocusRing`（ticker で 420ms 拡大フェード）→
`focusTeamCamera`（480ms）await → 状態遷移 → App の zoom-overlay クロスフェード、のシーケンス。
非プレイヤーチームは engine の department 止まりに合わせてカメラも部門 bounds へ寄せる（engine 不変）。
部署ビューは viewport が無いため `deptPixiView.ts` の `teamZoomTransform` / `zoomTransformAt` で
root を 360ms 手動トゥイーンする（`focusTeamZoom`）。DOM レンダラは従来のクロスフェードのみ。
Vitest: `tests/unit/orgIslandView.test.ts` / `deptPixiView.test.ts`。
E2E: `tests/e2e/org-pixi-visual.spec.ts`（島タップ→リング→現場着地）。

#### RI-05 タスク粒の工程間移動アニメ — 優先度:高 / 完了

**完了**: `src/render/boardScene.ts` に `BoardDotMotion` / `flowPointAt` / `findBoardFlow` を追加し、
`Task.progress > 0` の Coding/Rework 粒を工程間フロー上へ補間配置。`Board.tsx` と `styles.css` で
方向ドリフト・残像・AI 速度差の CSS 演出を接続。Backlog/Review/Done の山表示は維持。
Vitest: `tests/unit/boardScene.test.ts`（フロー補間・流動粒・山との共存）。

> プレイテスト所感（2026-07）「視覚的な面白さに欠ける・マネジメントしている感覚が薄い」を受けて
> 中→高へ格上げ。粒が工程間を流れて初めて「組織が動いている」ように見え、介入の因果も追える。

#### RI-06 延焼の連鎖演出 — 優先度:高 / 完了

**完了**: `src/render/fireEffects.ts` にスプリント状態差分から延焼・鎮火・点火の演出 plan を導出する
純関数（`detectFireEvents` / `positionFireEffects`）を追加。`src/ui/FireEffects.tsx` で Framer Motion により
延焼パーティクル（rework→review 連鎖）・緊急対応/自動鎮火の消火バースト・Review 落ち点火フラッシュを再生。
`SprintScreen` に演出レイヤを統合。`boardScene` は炎上粒に `burnUrgency`、Rework ステーションに panic 表情を追加。
Vitest: `tests/unit/fireEffects.test.ts` / `tests/unit/boardScene.test.ts`。

#### RI-07 キャラ/粒のスプライト化(`render/iso.ts`) — 優先度:低 / 完了

**完了**: スプリント盤面の Pixi 化（RI-11）と同時に実装。タスク粒（variant×size）と
ステーションキャラ（lane×mood）を `renderer.generateTexture`（resolution 2）で RenderTexture へ
焼き込み、`Map<string, Texture>` にレイジーキャッシュして Sprite で使い回す
（`src/render/adapters/pixiBoardRenderer.ts`）。粒 Container は `render/iso.ts` の
`SpritePool`（budget 96）で再利用し、毎 render `releaseAll()` → plan 順 acquire。
机は静的スプライトへ分離し、キャラだけが bob/shake する DOM の構造を保つ。
キャッシュキーは純関数 `dotTextureKey` / `actorTextureKey`（`src/render/boardPixiView.ts`、Vitest 済み）。

#### RI-08 キャラ表情スプライト(疲れ顔/ガッツポーズ) — 優先度:低（依存: RI-07）/ 完了

**完了**: `StationMood` に `exhausted` を追加し、`src/render/memberMood.ts` の
`deriveMemberMoodOverrides` が育成メンバーの `memberExpression`（スタミナ比・休職。SPEC §12.2）を
レーン配属ごとに集計して表情上書きを導く（半数以上休職→exhausted / 休職+疲労が半数以上→tired /
過半が絶好調→cheer=ガッツポーズ）。`planBoardScene(tasks, moodOverrides?)` の `mergeStationMood` は
panic（渋滞・炎上）を常に優先し、上書きで表情が変わったら文脈の合わない吹き出しを落とす。
DOM（`OfficeActors`）と Pixi（焼き込みテクスチャ）の両方に exhausted 表情（閉じ目＋クマ＋汗・波線口）を
追加し、Station の `data-mood` で両レンダラの一貫性を検証できる。
Vitest: `tests/unit/memberMood.test.ts` / `boardScene.test.ts`。

#### RI-09 アクションバーのマネージャー像 — 優先度:低

旧モックの footer にあったマネージャーマスコットは未移植。`ActionBar` へ追加する。

#### RI-10 ジューシー演出の上積み(スイープ/スローモ/ご褒美) — 優先度:低

割り込みレビューの一括処理スイープ、ボス最後の1件のスローモー（第18.2）に加え、レリック獲得・
進化解放の手応え演出や評価 S の特別演出（第18.4、現状は静的表示）を上積みする。

### 選択の可視化・フィードバック（UX）

> プレイテスト所感（2026-07）「システム的な表示が多くマネジメントしている感覚が薄い。選択した時に
> どういう影響があるのか（ステータスへの予想影響＝リスク・リターン）がわかりにくい」への対応グループ。
> コード事実として、選択の効果は `src/data/` に数値データとして存在する（ビートの `EventOutcome`、
> カードの `CardEffects`、レバーの `LeverDef.effect` 等）が、UI は手書きの説明文を表示するだけで、
> 実データからの自動生成・事前プレビュー・事後フィードバックが無い。**事前（RI-43〜46: 選ぶ前に
> 影響がわかる）と事後（RI-47〜48: 選んだ結果どこがどれだけ動いたかが見える）を対で整備する。**

> プレイテスト所感（2026-07 第2回）「ゲームとして技術介入要素が少なく見える。画面上に操作するものは
> あるが、**操作に対するフィードバックが弱いため何が良い手だったのかわからず、プレイ改善ができない**」
> への対応グループが RI-49〜56。RI-43〜48 が戦略層（ビート選択・カード・レバー）の可視化だったのに対し、
> こちらは**リアルタイム層＝スプリント中の介入アクション**のフィードバックループを閉じる。
> コード事実として、介入の結果は sim 層で発生した瞬間に失われている——`applyAction`
> （`src/sim/actions.ts`）は `InterventionOutcome { ok, reason }` しか返さず、UI はその戻り値すら
> 捨てている（`App.tsx` は `run.dispatch` を素通し）。何件捌けたか・どのタスクに効いたか・失敗した
> 理由も、介入の巧拙も、プレイヤーに一切届かない。対応は 3 層で行う:
> **①即時（RI-49〜51: 押した瞬間に効果と因果が見える）→ ②スプリント内（RI-52〜53: 何が効いたかを
> 追える）→ ③リザルト（RI-54〜55: 巧拙がわかり次に活きる）**。介入の効果量そのものの担保は
> RI-56（BAL）で対にする。推奨着手順は RI-49 → RI-51 → RI-50 →（RI-52 / RI-53）→ RI-54 → RI-55。
> 保留中の RI-30（操作方式）は、このグループ完了後に再判断する（フィードバック不足が原因の
> 「介入している感の薄さ」を先に除去してから、操作方式自体の変更要否を測る）。
> **→ RI-49〜56 完了後に再判断し、RI-30 として SPEC 準拠実装を完了した。**

#### RI-43 効果タグ自動生成基盤＋ビート選択肢のリスク・リターン表示 — 優先度:高 / 完了

**完了**: `src/render/eventOutcomeView.ts` に `EventOutcome` → 色分けタグの純関数を追加し、
`BeatScreen` / `EffectTagList` で選択肢・判定イベントの事前プレビューに適用。
`src/data/events.ts` の `description` はフレーバー文へ整理し、数値は実データ由来のタグ表示に一本化。
Vitest: `tests/unit/eventOutcomeView.test.ts`。

#### RI-44 カード/レリック/進化ノードへの効果タグ適用 — 優先度:高 / 完了

**完了**: `src/render/eventOutcomeView.ts` に `formatCardEffectsTags` / `formatCardDefTags` /
`formatRelicDefTags` / `formatEvolutionNodeTags` を追加し、`CardView` / `ShopScreen` /
`EvolutionScreen` で `EffectTagList` による実データ由来の効果タグ表示に接続。
手書き `description` はフレーバー文として残し、デメリット付きカードのリスクはタグ色で判別可能。
Vitest: `tests/unit/eventOutcomeView.test.ts`（カード・レリック・進化ノードのタグ変換テスト追加）。

#### RI-45 レバー/休憩/目標修正/介入アクションの効果数値表示 — 優先度:中 / 完了

**完了**: `src/render/eventOutcomeView.ts` に `formatLeverDefTags` / `formatGoalAdjustmentTags` /
`formatActionDefTags` / `formatRestOptionTags` と tooltip ヘルパを追加し、`OrgScreen` / `DeptScreen` /
`RestScreen` / `QuarterReviewScreen` / `ActionBar` へ `EffectTagList` で接続。`PAUSE_AI_DEBUFF_MUL` /
`REORG_RESET_*` / `OVERTIME_*_MUL` は sim 層から import して DRY 化。Vitest:
`tests/unit/eventOutcomeView.test.ts`（全 8 アクション・全 6 目標修正の網羅テスト含む）。

#### RI-46 確率的な結果のリスク幅プレビュー(what-if 試算) — 優先度:中（依存: RI-43。関連: RI-13 / RI-14） / 完了

**完了**: `src/sim/run/whatIf.ts` で `SprintBaselineInput` を派生 seed 24 本で掃引し、出荷・延焼の
期待値と観測レンジを返す純TS試算を追加。`RunEngine.whatIfPreview()` が setup / draft の現在編成と
カード候補別プレビューを副作用なく公開し、候補間では同じ seed 群で比較する。重い試算は
`snapshot()` ではなく UI の `game.getState()` 経路に限定し、モンテカルロ／オートプレイを遅延させない。
`WhatIfPreview` を `FormationGrid` / `CardView` に接続し、「次スプリント予測」「出荷」「延焼」
「24回試算」を表示。Vitest: `tests/unit/whatIf.test.ts`（決定性・カード差分・試算状態の非変更・
編成差分）。E2E: `tests/e2e/what-if.spec.ts`（編成変更とドラフト候補の表示）。

#### RI-47 ステータス増減の汎用フィードバック演出 — 優先度:高 / 完了

**完了**: `src/render/status.ts` に HUD 指標（出荷ポイント・シニアHP・AI依存度・技術的負債・士気）と
RunBar 指標（予算・経営/顧客/チーム信頼）の前回スナップショット差分検出を追加。`Hud.tsx` /
`RunBar.tsx` で **±N ポップ・数値フラッシュ・色点滅**（改善=緑 / 悪化=赤）を Framer Motion で表示し、
ビート選択・レバー適用・目標修正後に影響を受けた指標へ視線誘導する。Vitest:
`tests/unit/status.test.ts`。

#### RI-48 HUD の情報設計強化(アイコン・良し悪しの方向・しきい値色) — 優先度:中 / 完了

**完了**: `src/render/status.ts` に `deriveHudMetrics` を追加し、8指標のアイコン・良し悪し方向・危険域
（good/watch/danger）・補助説明を純関数で導出。`Hud.tsx` はこのメタデータを共通カードとして描画し、
`styles.css` で方向チップ・危険域色・説明行を整備した。Vitest: `tests/unit/status.test.ts`。

#### RI-49 介入結果ペイロードの拡張(フィードバック基盤) — 優先度:高 / 完了

**完了**: `src/sim/types.ts` に `InterventionEffect` / `InterventionModifierKind` を追加し、
`InterventionOutcome.effect` で成功時の効果ペイロードを返す契約に拡張。
`src/sim/actions.ts` の各 `EFFECTS` が適用内容（対象タスク ID・捌いた件数・鎮火 ID・HP/士気コスト・
時限モディファイア等）を組み立て、`applyAction` が `focusCost` / `gaugeGain` / `focusRefund` を合成。
sim 挙動は不変（返す情報が増えるだけ）。Vitest: `tests/unit/actions.test.ts`（全 8 アクションの
ペイロード検証・失敗時 effect 無し・ゲージ満タン還元）、`tests/unit/fire.test.ts`（`containedTaskId`）。
UI 接続は RI-51 / RI-50 で行う。

#### RI-50 介入ごとの盤面リアクション演出 — 優先度:高 / 完了

**完了**: `src/render/interventionEffects.ts` に `InterventionEffect` → 座標付き plan の純関数
（`planInterventionReactions` / `positionInterventionReactions` / `deriveActiveBoardAuras`）を追加。
`src/ui/InterventionEffects.tsx` で Framer Motion により review スイープ・split・firefight 照準→消火・
assign ダッシュ・モディファイア pulse を再生。`SprintScreen` で dispatch をラップし成功ペイロードを
`Board` へ渡す。時限系（AIスロットル/残業/アンドン）は盤面オーラ＋ `ActionBar` の `.mod-ring` で
残り tick を表示（`RunState.sprintTick` 公開）。firefight は `FireEffects` の鎮火推定と二重再生を
`suppressExtinguishTaskIds` で抑制。Vitest: `tests/unit/interventionEffects.test.ts`。
E2E: `tests/e2e/interventions.spec.ts`（スイープ演出 DOM 確認）。

#### RI-51 発動不能理由の可視化＋対象数ライブバッジ — 優先度:高 / 完了

**完了**: `src/render/actionBarView.ts` に `countActionTargets` / `deriveActionAvailability` /
`planActionBarView` を追加し、`src/sim/actions.ts` の EFFECTS と同じ対象判定で対象数バッジ・
発動不能理由（`no-target` / `no-focus` / `cooldown`）を純関数で導出。`ActionBar.tsx` で
対象数ライブバッジ・理由ラベル・`no-target` 時の disabled、成功時の集中力 `-⚡N` ポップ・
連携ゲージフラッシュ・満タン還元 `+⚡N`、レース失敗時の shake+トーストを接続。
Vitest: `tests/unit/actionBarView.test.ts`。E2E: `tests/e2e/interventions.spec.ts`
（無効理由・バッジ表示）。

#### RI-52 スプリント内イベントティッカー(介入・出来事ログ) — 優先度:中 / 完了（依存: RI-49）

**完了**: `src/sim/types.ts` に `SprintEvent` を追加し、`SprintState.events`（上限 64 の ring
buffer）へ介入・点火・鎮火・自動鎮火・延焼・コンボ途切れを構造化記録。`appendSprintEvent`
（`sprintEvents.ts`）と `applyAction` / `reviewOne` / `igniteTask` / `advanceBurning` のフックで
seed 決定論の範囲に収める。`src/render/sprintEventView.ts` が文言化し、`EventTicker` を
`SprintScreen` 盤面脇に配置。Vitest: `tests/unit/sprintEventView.test.ts`。
E2E: `tests/e2e/interventions.spec.ts`（ティッカー表示）。

#### RI-53 スプリントタイムライン記録とリザルト表示 — 優先度:中 / 完了（依存: RI-49）

**完了**: `TimelineSample` を `SprintState.timeline` に毎 `stepSprint` 終端で記録し、
`summarizeSprint` が `SprintResult.timeline` / `events` へコピー。介入マーカーは
`events` の `intervention` から抽出（二重管理なし）。`sprintTimelineView` が自前 SVG
スパークライン計画を導出し、`SprintTimelineChart` を `SprintResultScreen` に配置。
Vitest: `tests/unit/sprintTimelineView.test.ts`。

#### RI-54 リザルトの介入効果分析とプレイ改善 Tips — 優先度:中 / 完了（依存: RI-49, RI-53）

**完了**: `SprintResult` に `focusRemaining` / `focusMax` / `autoContainCount` を追加し、
`sprintInterventionAnalysis` が `events` / `timeline` / `actionCounts` から捌いた PR 総数・緊急対応での
コンボ守り・自動鎮火/延焼・集中力余りを集計。ルールベースで改善 Tips を 1 件導出し、
`SprintResultScreen` に「介入分析」セクションを配置。Vitest:
`tests/unit/sprintInterventionAnalysis.test.ts`。

#### RI-55 無介入ベースライン比較(介入の成果表示) — 優先度:中 / 完了

**完了**: `src/sim/run/sprintBaseline.ts` に、スプリント開始時の組織状態・設定・合成効果・seed・
初期 Review 負荷から同条件のスプリントを再構築し、無介入で完了まで進める純 TS 実行を追加。
`RunEngine` が開始入力を保持してリザルトへ無介入推定を添付し、ライブ状態への副作用を避けた。
`src/render/sprintBaselineComparison.ts` が出荷・延焼・Max Combo の実績差と良し悪しを導出し、
`SprintResultScreen` の「介入の成果」に表示する。介入で乱数消費列が変わるため厳密な同一世界線では
ない旨も明記。Vitest: `tests/unit/sprintBaseline.test.ts` /
`tests/unit/sprintBaselineComparison.test.ts` / `tests/unit/run-engine.test.ts`。
E2E: `tests/e2e/interventions.spec.ts`（比較値・推定注記）。

### 技術構成（TECH）

#### RI-11 Pixi 適用範囲の拡張(部署/現場盤面) — 優先度:中 / 完了

**部署ビュー: 完了**。`src/render/adapters/pixiDeptRenderer.ts` が `planDeptBoardScene`（既存の純シーン
計画）を読んで WebGL 描画する。チームミニ Container は `iso.ts` の `SpritePool` で再利用し、盤面は固定
設計空間（1404×573）なので viewport は使わず contain-fit の root スケールだけで DOM 版と同じ見え方に
した。数値計算（フローパス解析・破線分割・contain-fit）は `src/render/deptPixiView.ts` へ分離。
Vitest: `tests/unit/deptPixiView.test.ts`。E2E: `tests/e2e/dept-pixi-visual.spec.ts`
（@pixi opt-in。視覚回帰＋プレイヤーチームタップのドリルダウン）。

**現場盤面（スプリント盤面）: 完了**。演出の移植方針は **DOM オーバーレイ併用**を採用
（`FireEffects` / `InterventionEffects` / 数字ポップ / オーラ / ラベル / 吹き出し / 凡例は
設計座標→% の DOM のまま透明 canvas に重ね、DOM 版と演出コンポーネントを共有）。Pixi 化するのは
常駐物＝フロー線・タスク粒・ステーションキャラのみで、粒/キャラは RenderTexture 焼き込み＋
`SpritePool`（RI-07）。CSS keyframes（flybob / bob / flowBobDrift / fireShake / dash）は ticker の
時間関数（`src/render/boardPixiView.ts`、位相 0 で全オフセット 0）で再現し、`freezeForScreenshot` で
決定論フレームに固定する。RI-30 のドラッグ介入は盤面 div の DOM pointer＋`hitTestBoardDot` の逆引きで
成立。実装: `src/render/adapters/pixiBoardRenderer.ts` / `src/ui/BoardPixiLayer.tsx` / `Board.tsx`。
Vitest: `tests/unit/boardPixiView.test.ts`。E2E: `tests/e2e/sprint-pixi-visual.spec.ts`。

**既定レンダラを Pixi へ切替**。`?renderer=dom` で DOM/SVG へ opt-out（DOM レンダラは維持）。
WebGL 初期化に失敗した環境は `usePixiRenderer` フックで全画面が DOM へ自動フォールバックする。
CI 既定の E2E は `renderer=dom` を明示して実 WebGL を回さない方針を維持し、Pixi 経路は
@pixi スイート（`npm run test:e2e:pixi`）が検証する。副産物として、複数 Application 構成で
どの renderer の destroy でも共有プール（TexturePool / Batcher の batchPool）が purge されて
生存 renderer が落ちる Pixi v8 問題に対し、`pixiTexturePoolGuard.ts` へ生存カウンタ
（`retainPixiApp`/`releasePixiApp`）による release 抑止を追加した。

#### RI-12 バンドル分割(動的 import) — 優先度:低

`npm run build` の index チャンクが 956kB（2026-07 計測。>500kB 警告、Pixi/WebGL 同梱）。動的 import 等で
コード分割するか（機能要件ではないが計測値として残す）。

#### RI-13 未導入の技術スタック(Web Worker+Comlink / Recharts・visx) — 優先度:中

第22章で前提とした技術スタックのうち未導入の分。Web Worker + Comlink（モンテカルロ試算の並列化＝RI-14 の
基盤候補）、Recharts・visx（指標可視化）の導入要否を判断し、必要なものを入れる。
IndexedDB（永続化）は RI-57 へ切り出した。

#### RI-57 メタ永続化の IndexedDB 移行＋旧 localStorage 統合 — 優先度:中 / 完了

**完了**: `src/state/metaPersistence.ts` に `idb` ベースの非同期 `MetaStorage` を追加し、
起動時に IndexedDB からメタ進行を復元する構成へ移行した。IndexedDB が空の場合は旧
`localStorage`（`devops-tycoon:meta:v1`）を現行スキーマの既定値で補完して保存し、成功後に旧キーを削除する。
IndexedDB に既存値がある場合はそちらを正として旧値を破棄し、利用不可・保存失敗時も旧値または初期値で
ゲームを継続する。Vitest で往復・補完・優先順位・失敗時フォールバックを、Playwright で移行・購入・
再読み込みを検証する。リプレイ・大量履歴の保存設計は引き続き非スコープ。

### バランス（BAL）

> 各領域で「暫定値」と明記した係数群を、代表 seed のモンテカルロで許容レンジ化する統計テスト基盤
> （RI-14）に統一する。RI-15〜RI-19 は RI-14 を土台に各領域を校正する子タスク。

#### RI-14 モンテカルロ統計テスト基盤 — 優先度:中 / 完了

**完了**: `tests/unit/helpers/monteCarlo.ts` に seed 掃引（`runMonteCarlo`）・メトリクス抽出
（`extractRunMetrics`）・集計（`summarizeMonteCarlo` / `summarizeNumeric`）・許容レンジ検証
（`assertWithinRange`）の純関数群を追加。RI-15〜RI-19 が再利用できる `MonteCarloSummary` 型と
代表 seed 群での決定論・難易度差・メトリクス健全性テストを `tests/unit/monteCarlo.test.ts` に整備。

#### RI-15 スプリント主要メトリクスの許容レンジ — 優先度:中 / 完了

**完了**: `tests/unit/monteCarlo.test.ts` に RI-15 用の許容レンジ検証を追加。代表 seed 群
（`ri15-mc-0..9,11,12`。10 は review-freeze 境界のため除外、normal 難易度・既定オートプレイ）で
`runMonteCarloSummary` 相当の集計を行い、Delivered / Rework / Incidents / Senior HP / Review Queue Peak
が許容レンジ内に収まることに加え、勝率・Senior HP 平均/最大・Review Queue Peak（`REVIEW_FREEZE_PEAK`
未満）を検証して `assertWithinRange` で回帰検知する。レンジは 2026-07 計測値に余裕を持たせ、
極端なバランス崩壊の早期検知を目的とする（細かな調整の縛りではない）。

#### RI-16 全社/部門レバー係数の許容レンジ — 優先度:中 / 完了

**完了**: `tests/unit/helpers/leverRanges.ts` にレバー定義の cost / 効果量レンジと、
`applyLever` + `generateOrgScale` による代表 baseline 適用後の集約指標検証を追加。
`tests/unit/orgscale.test.ts` で全 12 レバーをデータ駆動で網羅し、部門レバーの非対象部門への
副作用がないこと、代表 seed 群での影響方向性（AI依存度低下・負債返済・炎上鎮火等）が
許容レンジ内であることを検証。現行 `src/data/levers.ts` の暫定値は調整不要。

#### RI-17 四半期レビューの代償・outcome 閾値・目標生成の許容レンジ — 優先度:中 / 完了（依存: RI-14）

**完了**: `tests/unit/quarter-review.test.ts` で、目標修正の信頼・予算・KPI・組織状態の代償が安全な
レンジに収まり、`evaluateQuarterOutcome` の信頼・予算・士気・Senior HP・missedCount 境界が期待する
outcome になることを検証。`buildQuarterGoal` は全ボス・全難易度と `priorGoal` 引き継ぎで目標値の
許容範囲を検証する。さらに `tests/unit/monteCarlo.test.ts` で、normal 難易度の代表 8 seed を通し、
レビュー回数・修正回数・四半期数・最終 KPI・最小信頼の長ラン許容レンジを回帰検知する。

#### RI-18 メタ解放コスト・points 配分の許容レンジ — 優先度:中（依存: RI-14）

メタ解放のコスト（`UNLOCK_DEFS` / `src/data/unlocks.ts`）、`applyRunReward` の points 配分
（勝利20 / 敗北5 × `scoreMul`）、デイリー固定条件（難易度 normal・試練なし）の暫定値を後続調整する。

#### RI-19 編成差のスプリント結果への影響レンジ — 優先度:低 / 完了（依存: RI-14）

**完了**: `tests/unit/helpers/formationSeeds.ts` に、normal 難易度の初回スプリントで初期の均衡編成と
レビュアー `m2` を coding へ移した偏重編成を同一 seed で比較するヘルパを追加。候補 32 seed の全件で
偏重編成の Review Queue 最大値が増えることを確認し、先頭 12 seed を代表群として固定した。
`tests/unit/monteCarlo.test.ts` で決定論・全 seed の因果・Delivered / Review Queue / Rework 差分の
許容レンジを検証する。初回計測は平均で Delivered +27.75（-35〜+95）、Review Queue +4.33
（+1〜+8）、Rework -2.67（-6〜0）。極端な崩壊検知用の余裕付きレンジ内だったため、
`src/sim/member/roster.ts` の係数調整は不要と判断した。

#### RI-56 介入効果量の許容レンジ(介入あり/なし差の担保) — 優先度:中 / 完了（依存: RI-14）

**完了**: RI-55 のシャドー実行を任意の介入ポリシーでも再利用できる
`runSprintSimulation` として整理し、`tests/unit/helpers/monteCarlo.ts` に同一 seed ペアの
Delivered / spread / maxCombo 差分集計を追加。高リスク組織（Test Coverage / AI Literacy 0、
初期 Review 負荷 6）の代表 24 seed で、Review 6 件以上なら割り込みレビュー、点火時は緊急対応する
単純ポリシーを無介入と比較する。平均出荷改善率 5〜25%（単一 seed 上限 75%）、平均延焼削減
0.5〜4 件、平均最大コンボ改善 1〜8、平均介入回数 3〜8 を許容レンジとして回帰検知する。
2026-07 の初回計測は平均出荷 +9.6%、延焼 -1.67 件、最大コンボ +3.42、介入 4.5 回で範囲内だったため、
`src/sim/actions.ts` / `src/data/actions.ts` の係数調整は不要と判断した。

### 機能・メタ進行（FEAT）

#### RI-20 称号(WinType)の永続コレクション化 — 優先度:中 / 完了

**完了**: `MetaState.collectedWinTypes` に勝利種別を重複なく永続記録し、旧セーブは空配列で補完する。
実績コレクション画面に独立した「勝利称号」セクションを追加し、取得済みは説明、未取得は獲得ヒントを表示。
ラン決着画面にも今回の勝利称号とコレクション登録を表示する。Vitest: `tests/unit/meta.test.ts`。
E2E: `tests/e2e/achievements.spec.ts`。

#### RI-21 診断別の画面演出(6組織タイプ) — 優先度:中 / 完了

**完了**: `src/render/diagnosisTheme.ts` に6つの組織タイプ診断（Healthy Acceleration / Review Hell /
AI Overproduction / Rework Spiral / Senior Sacrifice / Documentation Kingdom）から、固有トーン・
アイコン・短い状態文を導出する純関数を追加。`App` の3トーンを6背景へ置換し、`RunBar` の常時状態文、
`OrgScreen` の診断バッジ、`RunResultScreen` の診断アクセントへ接続した。診断判定と更新タイミング、
チーム単位の健全度・盤面 heat は従来どおり独立している。Vitest: `tests/unit/diagnosisTheme.test.ts` /
`tests/unit/run-systems.test.ts`（全6タイプ）。E2E: `tests/e2e/run.spec.ts`（画面トーン・状態文・
ラン結果の診断属性）。

#### RI-22 継続不能種別ごとの終了演出分け — 優先度:中 / 完了

**完了**: `missed_crisis` / `reorg_required` / `shutdown` を共通の `lose` 系から分離し、
`quarterFailureTheme`（`src/render/quarterFailureTheme.ts`）で種別ごとのトーン・eyebrow・ラベル・説明を返す。
`RunResultScreen` が `data-quarter-outcome` と `quarter-failure-*` class を付与する。
Vitest: `tests/unit/quarterFailureTheme.test.ts` / `tests/unit/quarter-review-seeds.test.ts`。
E2E: `tests/e2e/run.spec.ts`（`E2E_TERMINAL_*` seed で種別固有の終了演出を検証）。

#### RI-23 業界ランキングへのデイリー記録接続 — 優先度:中 / 完了

**完了**: `dailyLeaderboardEntries(meta)` で `meta.dailyRuns` をベストスコア順（同点は新しい UTC 日付優先）
に順位付けし、`IndustryScreen` 下部の「デイリーランキング」セクションへ擬似リーダーボードとして表示する。
`App` から `meta` を渡し、記録なし時は空状態メッセージを出す。シーズン番号・リーグ名はラン内
`generateIndustry`（seed ハッシュ／瞬間順位の百分位）の都度生成を維持し、`MetaState` へは恒久化しない
（バックエンドなし・ローカル擬似の前提で十分。デイリー側のメタ接続は `dailyRuns` で完結）。モックの
リーグ昇格目標・健全経営ボーナス・業界画面からのデイリー挑戦導線は §4.10 の別スコープとする。
Vitest: `tests/unit/meta.test.ts`。E2E: `tests/e2e/org-scale.spec.ts`。

#### RI-24 メタ解放対象の拡張 — 優先度:低 / 保留(要判断)

現状のメタ解放はカード／レリックのみ。初期カード・初期レリック・メンバー／トレイト解放（初期メンバー/
トレイト）・追加イベント・追加試練など、ボス撃破で解放される対象を増やすかスコープ外として明記するかを
判断する（周回・育成・診断／キャラクター育成／メタ進行で同根の課題）。

#### RI-25 開始時の組織プリセット — 優先度:低 / 保留(要判断)

合意した方針（定義＋タイトル選択 UI＋`startRun` 引数の 3 点セットを伴わないならスコープ外）に従い、
プリセットは実装を見送り済み（[spec-mapping.md](./spec-mapping.md) §2）。ただし `MetaState.unlockedPresets` /
`unlockedContent().presets` / `purchaseUnlock`・`MetaShopScreen` の preset 分岐が**到達不能な足場として残存**
（`UnlockKind` は `'card' | 'relic'` のみ）。明示的にスコープ外として足場を削除するか、プリセットを正式
実装するかを判断する。

#### RI-26 採用の入口拡張 — 優先度:低 / 保留(要判断)

現状は休息ノードのみ。採用専用ノード/イベント/ショップ枠へ広げるか判断する（スコープ外なら明記）。

#### RI-27 個体メンバーの集約粒度を深める — 優先度:低

全社/部署ビューではチーム単位の集約までに留め、個体メンバーは現場でのみ表示。チーム島のエンジニア数等
への個体反映を深めるかは未着手。

#### RI-28 四半期レビュー評価→メタ報酬の接続 — 優先度:低 / 保留(要判断)

未達でも学習・改善ポイントを少量得る「四半期レビュー評価に紐づくメタ報酬」は未着手。`reviewHistory` の
outcome をメタ進行（`state/meta`）の報酬・解放条件へ接続するか判断する。

#### RI-29 リザルトの介入内訳表示 — 優先度:中 / 完了

**完了**: `SprintMetrics.actionCounts` にアクション種別ごとの発動回数を集計し、
`SprintResult` 経由で `SprintResultScreen` に「介入: 割り込みレビュー×3 / 緊急対応×1」形式で表示する。
称号「火消しの達人」の判定にも使う。

#### RI-30 能動操作の操作方式 — 優先度:中 / 完了

**完了**: SPEC §6/§7 の操作方式に寄せた。
- タスク差配 / PR分割: ActionBar で武装 → 盤面ドラッグで `dispatch(id, ActionTarget)` 確定。
  省略時は従来の自動選択を維持。偏重（理想差配 vs ミスマッチ）で士気コストが変わる。
- カード: スプリント開始時に `HAND_SIZE=3` を deal。手札から集中力を払って発動し、
  そのスプリントの `cardEffects` に合成。加算系 baseline はラン中初回発動のみ。
  レリック/進化/試練は常時パッシブのまま。`foldRunEffects` からデッキを除外。
- Vitest: `assignTask` / `boardDragPlan` / 手札 deal・play。E2E: 対象指定差配・手札発動・武装 UI。

#### RI-31 試練の追加 — 優先度:低 / 完了

第16 の試練に「フロンティアモデル依存」を追加。各スプリント開始時に AI依存度が自然増加し、
依存度に応じたフロンティアモデル利用コストが予算から差し引かれる。AI利用ガイドラインの教育効果で
AI依存度を下げ、効率的な利用へ立て直せる。

#### RI-32 レリック入手元・即時敗北条件の補完 — 優先度:中 / 完了

ボス突破時に未所持レリックを決定論的に付与し、四半期レビューとラン決着画面に表示する。
第15 の Incident 連続、AI依存過多、予算枯渇を継続不能として判定し、敗北理由を結果画面に表示する。
Vitest と Playwright で報酬・各敗北理由の経路を検証済み。レリック獲得演出は RI-10 の対象。

### 設計再検討（DESIGN）

#### RI-33 ノード選択廃止→イベント判定化【エピック】 — 優先度:高 / 実装済み

> **実装済み**（PR #48）: 分岐マップ（`map.ts`/`RunMapScreen`/`enterNode`）を撤去し、
> 固定トラック（`SPRINTS_PER_QUARTER`、最終がボス）＋スプリント間ビート（判定/選択の混合・
> 組織状態で重み付け）へ置換した。公開契約は `enterNode` を撤去し `beginSetupSprint`/`resolveBeat`
> を追加。判定/選択・ボス優先・一回消費・次スプリント一時効果・出荷の当期反映・信頼の代償・
> ハード敗北を Vitest / Playwright で検証済み。実装は `src/sim/run/engine.ts`・`events.ts`・
> `src/data/events.ts`・`src/ui/{SetupScreen,BeatScreen}.tsx` を正とする。
> 以下は当時の課題メモ（記録として残す）。

- **課題**: メイン画面（ラン中）はノード選択（ランマップ）が大半を占める。戦略的要素はあるが、
  **状況をコントロールできすぎている**。Slay the Spire は「リターンを得るためにリスクを取る」
  トレードオフ設計だが、現状はノード選択に**明確なリターンが無い**ため、結局**リスクの無い選択肢を
  取るだけ**になり、意思決定が形骸化している。
- **提案（主案）**: **ノード選択を廃止**し、従来ノードを選んでいたタイミングで**何らかのイベント判定**
  （確率/状況依存のイベント）が起きるようにする。プレイヤーが盤面を完全制御するのではなく、
  「次に何が来るか」に対処する緊張感を戻す。
- **影響範囲（SPEC）**: 第3章 基本ループ図、第4.4 ランマップ画面（分岐ルート）、第9.4 分岐選択イベント、
  第10章 ボススプリントへの到達構造。`src/sim/run/map.ts`・`RunMapScreen`・`runMachine` の `map`/`enterNode`、
  `window.game.enterNode` の公開契約に波及する大きめの変更。
- **論点（実装前に決める）**:
  - イベント判定の中身: 完全ランダムか、組織状態（渋滞/負債/士気/AI依存度）依存の重み付きか。世界観の
    制約（第2.1）に収める。
  - リスク↔リターンの担保: もしノード選択を一部残すなら、各選択に**明確なリターンとそれに見合うリスク**を
    付ける（代替案B）。主案（完全廃止＋イベント判定）と代替案B（ノードにリスク/リターンを持たせる）の
    どちらを採るか。
  - ボス/四半期末への到達: マップ廃止後、ボススプリント（第10）や四半期レビュー（第8）へどう接続するか
    （固定スプリント数＋途中イベント、等）。
  - 決定論: イベント判定は seed 付き PRNG に載せ、デイリーラン/リプレイ/テストを保てるようにする（第22.3）。

#### RI-34 23章「拡張案」全般【将来エピック】 — 優先度:低 / 保留(要判断)

GitHub API 実データモード、チーム対抗ランキング、社内LT/経営プレゼンモード、ツール別シナリオ、
「AI導入失敗図鑑」「レビュー地獄リプレイ」「なぜ燃えたか解説ログ」等（第23 / 将来拡張）。着手時に
個別 ID へ切り出す。

### テスト・保守・技術的負債（QA）

#### RI-35 介入アクションのテーブル駆動テスト — 優先度:中 / 完了

**完了**: `ACTION_DEFS` 全8種を `tests/unit/actions.test.ts` でテーブル駆動化。成功時の集中力消費・
クールダウン・集計・連携ゲージの共通契約と、アクション別副作用（Review 減・split・鎮火・士気低下・
モディファイア tick 等）を fixture 表で検証。失敗理由（`no-target` / `cooldown` / `no-focus` /
`complete`）も共通契約として整理。炎上タイマー固有は `tests/unit/fire.test.ts` に分離。

#### RI-36 コンボ/連携ゲージの UI↔sim 検証 E2E — 優先度:中 / 完了

**完了**: `tests/e2e/interventions.spec.ts` に固定 seed の E2E を追加。同一 sim スナップショットの
コンボ値・出荷倍率と `ComboBadge` の表示、および介入後の連携ゲージ値とバー幅が一致することを検証する。

#### RI-37 カード強化のショップ/休息接続確認＋強化対象選択 UI — 優先度:中 / 完了

**完了**: `RunEngine.restChoose('upgrade', deckIndex)` で休息強化の対象位置を指定できるようにし、
未指定時は従来互換でデッキ先頭を強化する契約を維持。`RestScreen` に強化対象選択 UI を追加し、
同一 `defId` の重複カードでも UI で選んだ位置だけが強化されるよう `upgradeCardAt` を導入。
ショップ購入カードもデッキ内カードとして休息強化対象にできることを Vitest / Playwright で検証。

#### RI-38 `tone: joke` のネタイベント追加 — 優先度:低 / 完了

**完了**: `src/data/events.ts` に `standup-acronym-storm`（decision）と
`meeting-title-refactor`（judgment）を追加し、既存の `emoji-policy-summit` /
`readme-haiku` と合わせて `tone: joke` が decision / judgment の両方に乗るようにした。
`tests/unit/run-loop.test.ts` で分類を検証し、`tests/e2e/run.spec.ts` で
`BeatScreen` が `.tone-joke` として描画されることを確認する。

#### RI-39 XState の役割整理(`phase` 二重管理の解消) — 優先度:中 / 完了

**完了**: 判断は「XState は遷移契約のテスト/可視化用、実ランタイムは遷移表で検証」。
`src/sim/run/phases.ts` に純TSのフェーズ遷移表 `RUN_PHASE_TRANSITIONS` を単一の真実源として新設し、
`runMachine.ts` の XState マシンは手書き定義を撤去して表から生成。`RunEngine` の `phase` 直接代入
（21箇所）は表を検証する `setPhase()`（不正遷移は `RunPhaseError` を throw）へ置換し、新規ラン・
タイトル復帰の入口のみ `resetPhase()` に分離。ガード無し経路だった `applyOrgLever` には
タイトル/終端フェーズのガードを追加し、進行中全フェーズに `LOST` エッジを明示した。
Vitest: `tests/unit/run-phases.test.ts`（表の形状契約・BFS到達可能性）、`run-machine.test.ts`
（生成後マシンの回帰＋LOST拡張）、`run-engine.test.ts`（`setPhase` の throw・レバーガード）。

#### RI-40 通しテスト(DoD)の再確認 — 優先度:低

依存関係導入後に `npm test` / `npm run test:e2e` / `npm run build` を実行し、マップ→ボス→解放までの DoD を
緑で確認する。

#### RI-41 代表 seed の記録(AIあり/なし差分) — 優先度:低 / 完了

**完了**: `tests/unit/helpers/aiAdoptionSeeds.ts` に代表 12 seed（`ri41-ai-0..11`）を記録。
候補 `0..31` を掃引したところ全件でコア因果が成立したため、回帰コストを抑えて先頭 12 本を固定
（除外なし）。`runSprintSimulationFull`（`aiAdoptionShare` 1 vs 0・無介入・default シナリオ）で
比較し、`tests/unit/monteCarlo.test.ts` で決定論・全件の方向性（AI 利用率・Review / Rework）・
差分許容レンジを回帰検知する。2026-07 初回計測（代表 12）: reviewQueueΔ mean≈+9.7（6〜13）、
reworkΔ mean≈+6.1（3〜10）、deliveredΔ mean≈-94（-155〜-23）、aiAssistedPct with mean≈87 /
without 常に 0。`AI_ADOPTION` 等の係数調整は不要。編成個体値の差分は RI-19 のスコープ。

#### RI-42 AI 過信の二重診断の段階分け判断 — 優先度:低 / 完了

判断結果: メッセージ分割。パスA（AI Adoption KPI 未達）は `aiAdoptionShortfall`、
パスB（`aiDependency >= 60` かつ rework 比率 > 0.3）は従来どおり `aiOverconfidence`。
両方成立時は2行表示。`diagnoseMissedReasons` のユニットテストを追加済み。

---

## 旧分類との対応

旧版の節番号・横断テーマからの引っ越し先（外部参照の読み替え用）。

| 旧 | 新 ID |
| --- | --- |
| §1-A（スプリント盤面の演出残務） | RI-05 / RI-06 / RI-07 / RI-09 / RI-10 |
| §1-B / §1-C / §1-D / §1-E | RI-01 / RI-02 / RI-03 / RI-04 |
| §2（SPEC 未充足） | RI-20〜RI-25, RI-29〜RI-32, RI-34 |
| §3（バランス調整） | RI-14〜RI-19 |
| §3.5-A（ノード選択廃止） | RI-33 |
| §4（技術構成） | RI-11 / RI-12 / RI-13 / RI-57 |
| 横断テーマ A（MC 許容レンジ） | RI-14〜RI-19 |
| 横断テーマ B（Pixi スプライト/拡張） | RI-07 / RI-08 / RI-11 |
| 横断テーマ C（業界↔メタ接続） | RI-23 |
| 横断テーマ D（称号の永続化） | RI-20 |
| 横断テーマ E（診断別・継続不能演出） | RI-21 / RI-22 |
| 横断テーマ F（メタ解放対象の拡張） | RI-24 |
