# フェーズ別フォローアップ

各フェーズの実装後に残った確認事項・改善候補・次フェーズへ渡す判断点をまとめる。フェーズ本体の計画ファイルはスコープと DoD を保ち、このファイルで横断的な取りこぼしを追跡する。

---

## フェーズ1: スプリントシミュレーション

- AI あり/なしの差分が seed 固定で安定して観測できる代表 seed を記録し、バランス調整時の回帰確認に使う。
- スプリント結果の主要メトリクス（Delivered / Rework / Incidents / Senior HP / Review Queue Peak）について、許容レンジを持つ統計テストを追加する。
- DOM/SVG 盤面の状態→見た目マッピングを、後続の PixiJS 移行でも再利用できる純関数として維持する。

## フェーズ2: 能動操作とカード

- 介入アクション全種について、成功/失敗理由、集中力消費、クールダウン、副作用のテーブル駆動テストを追加する。
- カード強化はショップ/休息ノードで接続済みかを確認し、強化対象選択 UI が必要ならフェーズ3フォローアップへ送る。
- コンボ/連携ゲージの表示と実効果が乖離しないよう、UI 表示値と sim 集計値を同一 seed で検証する E2E を追加する。

## フェーズ3: 周回・育成・診断

- **PixiJS 移行の繰り越し管理**: PHASE3 は周回・診断・勝敗の通しプレイ DoD に集中するため DOM/SVG を継続する。PixiJS + pixi-viewport 移植は PHASE5 着手前の必須ゲートとして追跡し、PHASE4 でも粒数・ズーム階層が増える場合は前倒しする。
- **ランダムイベントの不足補完**: `tone: joke` のネタイベントを最低 1〜2 件追加し、良い/悪い/ネタの分類が UI とテストで確認できるようにする。
- **メタ進行の解放先拡張**: 現状の難易度・実績・撃破ボス記録に加え、初期カード、初期レリック、追加イベント、追加試練など、ボス撃破で解放される対象を増やすかスコープ外として明記する。
- **称号の永続化**: 勝利種別をラン結果表示だけで終わらせず、称号/実績コレクションとして保存・閲覧できる形にするか判断する。
- **診断別画面演出の強化**: 現状の昼/曇り/地獄系トーンを、6つの組織タイプ診断それぞれの色・背景・警告文へ拡張する。
- **XState の役割整理**: XState を「遷移契約のテスト用」とするのか、実ランタイム遷移にも使うのかを決め、RunEngine の `phase` 直接代入との二重管理リスクを減らす。
- **通しテストの再確認**: 依存関係導入後に `npm test` / `npm run test:e2e` / `npm run build` を実行し、マップ→ボス→解放までの DoD を緑で確認する。

## フェーズ4: キャラクター育成

実装済み（MVP4 / 第12章）:

- 個体メンバー（実装力 / レビュー力 / AI習熟 / スタミナ）とトレイト6種を `src/data/traits.ts`・`src/data/members.ts`（データ駆動）＋ `src/sim/member/`（純関数）で導入。
- **個体値→組織値の集約は純関数**（`foldFormationEffects`）。編成を `CardEffects`＋集中力/実装枠補正へ畳み込み、既存のスプリント純関数（`sprint.ts` 等）を一切変更せずに結果へ反映。`OrgState` の集計指標は不変。
- 成長: 配置された稼働メンバーがタスク経験でレベルアップし、ジュニア→ミドル→シニアへ昇格（`applySprintGrowth`）。
- 編成: レーン配置（コーディング/レビュー/ベンチ）と AI 配布を `FormationScreen` で操作。誰に AI を配るか（習熟者ほど手戻り減）が戦術になる。
- スタミナ管理と離脱: 個体スタミナはシニア体力（組織全体）と別軸。枯渇で休職（離脱）し、回復で復帰。UI で個体＝スタミナバー、組織＝シニアHP/士気を分けて表示。
- 採用カード: 施策カード（`CardDef`）と分離し、メンバーは別データ型（`MemberArchetype`）。採用は休息ノードの `recruit` 選択で「未来の主力候補」を迎える形に。
- 表情演出: スタミナ/休職から表情（💪😩😴🙂）を純関数で導出し、ランバーと編成画面に表示。

繰り越し・未解決:

- **表情演出はスプライト未着手**: 現状は絵文字。PixiJS 移植時に疲れ顔/ガッツポーズ等のスプライト表現へ拡張する。
- **採用の入口拡張**: 現状は休息ノードのみ。採用専用ノード/イベント/ショップ枠へ広げるか判断する（スコープ外なら明記）。
- **編成バランスの統計検証**: 編成差がスプリント結果に与える影響レンジを、代表 seed のモンテカルロで許容レンジ化する（フェーズ1フォローアップの統計テスト方針と統一）。
- **PixiJS 移行ゲート**: MVP4 時点では粒数・ズーム階層は増えていないため DOM/SVG を継続。PHASE5 着手前の必須ゲートとして引き続き追跡（下記フェーズ5）。
- メタ進行へのメンバー解放（初期メンバー/トレイト解放など）を加えるかは未着手。フェーズ3の「メタ進行の解放先拡張」と合わせて判断する。

## フェーズ5: 組織スケール（巨大組織対応）

実装済み（MVP5 / 第4.7〜4.11）:

- **4階層ズーム**: 業界 ▸ 全社 ▸ 部署 ▸ 現場 をパンくず（`Breadcrumb`）で地続きに移動。現場以外はオーバーレイで重ね、Framer Motion でクロスフェード遷移する（第4.11）。`window.game` に `zoomTo` / `focusDept` / `focusTeam` / `setRankingKind` / `applyOrgLever` を追加（型・E2E 型・architecture §4.1 を同時更新）。
- **同一 seed から再現できる集約モデル**: 現場（`OrgState`＋集計）→ チーム → 部署 → 全社 → 業界 の集約を `src/sim/orgscale/`（純TS・描画非依存・seed付き決定論）に実装。下位の事象（渋滞・炎上）が上位へ集約され、上位レバーが下位制約を緩める（第4.7）。プレイヤーチームは実ランの現場を写し取る。
- **全社マップ / 部署ビュー / 業界ランキング**: 部門ゾーン・チーム島（健全度で色分け）・共通基盤ハブ・全社/部門レバー（予算消費）・チーム間連鎖炎上・シーズン制リーダーボード・ランキング種別タブ・HQスカイラインを `OrgScreen` / `DeptScreen` / `IndustryScreen` で実装（mockups 準拠）。
- **描画非依存のアイソメ基礎**: アイソメ投影 / 深度ソート / 画面外カリング（カリング数）/ スプライトプール（再利用・生成上限）を `src/render/iso.ts` に純TS で実装し、Vitest で数値検証（第22.5）。
- **テスト**: Vitest（iso / 集約 / 生成 / レバー / 業界 / エンジン連携、計 45 本追加）と Playwright（ズーム遷移・ドリルダウン・レバーの E2E 3 本）。

繰り越し・未解決:

- **PixiJS + pixi-viewport への差し替え**（Phase 6 / 完了）: 全社マップのみ `?renderer=pixi` で PixiJS に opt-in 切替（既定は DOM/SVG）。`src/render/iso.ts`（投影 / 深度 / カリング / プール）を供給先とする**局所的な差し替え**。実 WebGL は CI 既定 job では回さない（architecture §4.4）。
  - **完了（6a–6e）**: 依存追加（`pixi.js@^8` / `pixi-viewport@^6`）、`RendererAdapter<TState>` の一般化、純TSシーン計画 `src/render/orgScene.ts` + `orgIslandView.ts`（LOD・ラベル）、`PixiOrgRenderer` の React 接続（`OrgPixiField` / `OrgScreen`）、pan/zoom/カリング、DOM 同等のカード/バッジ/ドット LOD 描画、カメラ同期（`orgCamera.ts`）、性能予算 DoD（Vitest fixture + 定数確定）、Pixi 視覚回帰（`tests/e2e/org-pixi-visual.spec.ts` / `npm run test:e2e:pixi`・CI 既定外）。手順は [phase-6-webgl-migration.md](./phase-6-webgl-migration.md) / [phase-6b-pixi-visual-parity.md](./phase-6b-pixi-visual-parity.md)。
- **視覚回帰の固定フレーム**: 全社マップ Pixi は opt-in E2E（`PIXI_E2E=1` / `@pixi`）で seed 固定スクリーンショット比較済み。DOM 既定の操作 E2E は従来どおり要素可視性・属性ベース。
- **個体メンバーの集約粒度**: 全社/部署ビューではチーム単位の集約までに留め、個体（MVP4）は現場でのみ表示。チーム島のエンジニア数等への個体反映を深めるかは未着手。
- **レバー効果のバランス検証**: 全社/部門レバーの効果係数（`src/data/levers.ts`）は暫定。代表 seed のモンテカルロで許容レンジ化する（フェーズ1/4 の統計テスト方針と統一）。
- **業界とメタ進行の接続**: シーズン/リーグ/デイリーラン（同一シード）を `state/meta`（第17章）へ恒久反映するかは未着手（現状はラン内の集約から都度生成）。→ Phase 7e でデイリー記録（同一シード・日別ベスト）の `meta` 保存までは実装。業界ランキングビューへの差し込みは引き続き未着手（下記フェーズ7）。

## フェーズ6: WebGL（PixiJS）移行

実装済み（拡張 / 第22.4〜22.5）:

- 全社マップのみ `?renderer=pixi` で PixiJS + pixi-viewport に opt-in 切替（既定は DOM/SVG）。`src/render/iso.ts`（投影 / 深度 / カリング / プール）を供給先とする局所差し替え。
- `RendererAdapter<TState>` の一般化、純TSシーン計画（`src/render/orgScene.ts` / `orgIslandView.ts`：LOD・ラベル）、`PixiOrgRenderer` の React 接続（`OrgPixiField` / `OrgScreen`）、pan/zoom/カリング、DOM 同等のカード/バッジ/ドット LOD、カメラ同期（`orgCamera.ts`）、性能予算 DoD（Vitest fixture + 定数）、Pixi 視覚回帰（`tests/e2e/org-pixi-visual.spec.ts` / `npm run test:e2e:pixi`・CI 既定外）。

繰り越し・未解決:

- **Pixi 適用範囲の拡張**: 現状は全社マップのみ。部署ビュー／現場盤面など他レイヤへ広げるかは未着手（粒数・ズーム階層が破綻し始めたら検討）。
- **バンドルサイズ**: `npm run build` で index チャンクが 778kB（>500kB 警告）。Pixi/WebGL を動的 import で分割するかは未対応（機能要件ではないが計測値として残す）。

## フェーズ7: メタ進行の閉ループ化

実装済み（拡張 / 第17章・第23章）:

- **7a 解放データモデル**: `src/data/unlocks.ts`（`UNLOCK_DEFS`：カード/レリックの解放エントリ）と純関数 `unlockedContent(meta)` / `purchaseUnlock(meta, unlockId)`（残高・前提実績・二重購入チェック）。`MetaState` を `unlockedCards` / `unlockedRelics` / `unlockedPresets` / `dailyRuns` で拡張し、`STORAGE_KEY` は `:v1` 据え置きで `loadMeta` の既定マージにより既存セーブを失わず吸収。イベント直接付与 ID と解放対象が重複しないことを単体テストで保証（`eventDirectGrantIds` / `metaUnlockContentIds`）。
- **7b 解放プールのラン反映**: `drawDraft(rng, count, allowed?)` の後方互換拡張、`buildShop` のカード抽選・`offerRelic` のレリックプールを解放セットでフィルタ。解放セットはラン開始時に `game.ts` が `unlockedContent(loadMeta())` を解決し `engine.setUnlockedContent` へ渡す（constructor 固定ではなく `startRun` / `newRun` / `startDailyRun` で都度反映 → メタショップ購入が次ランに効く）。ラン中は固定で決定論を維持。
- **7c メタショップ**: `MetaShopScreen`＋`GameHandle.purchaseMetaUnlock`。購入は `meta` 更新＋`revision` bump で `useRun` が `getMeta()` を読み直す（UI 即時反映）。
- **7d 実績コレクション**: `ACHIEVEMENT_DEFS`（獲得条件ヒント付き）と `AchievementCollectionScreen`（取得済み／未取得を区別表示）。
- **7e デイリーラン**: `dailySeed(dateStr)`（UTC 日付→決定論シード）・`startDailyRun`・`applyDailyRunReward`（同一 UTC 日付では points 付与 1 回・再走はベストのみ更新）。Title / RunResult にデイリー記録を表示。
- **テスト**: Vitest（`meta` / `unlocks` / `daily-run` / `meta-unlock-run` 等で 265 本緑）＋ Playwright（`meta-shop` / `daily-run` / `achievements`）。`lint` / `format:check` / `build` 緑。

繰り越し・未解決:

- **開始プリセット（preset）の扱い未確定**: Phase 7 計画 §7b の「定義＋タイトル選択 UI＋`startRun` 引数の 3 点セットを伴わないならスコープ外」に従い、プリセットは実装を見送り済み。ただし `MetaState.unlockedPresets` / `unlockedContent().presets` / `purchaseUnlock`・`MetaShopScreen` の preset 分岐が**到達不能な足場として残存**（`UnlockKind` は `'card' | 'relic'` のみ）。明示的にスコープ外として足場を削除するか、プリセットを正式実装するかを判断する。
- **業界ランキングへのデイリー記録接続**: §7e の「検討」止まり。デイリーのベストは `meta.dailyRuns` に保存され Title / RunResult には出るが、業界ランキングビュー（`IndustryScreen` / MVP5）へ「自分のデイリー記録」を差し込む擬似リーダーボードは未着手（フェーズ5「業界とメタ進行の接続」と同根）。
- **称号（`WinType`）の永続化**: §7d は最小実装として実績 ID コレクションに留め、勝利種別ごとの達成有無の永続記録・一覧化は未実装（フェーズ3「称号の永続化」を一部のみ回収）。実績で十分か、別軸で持つかを判断する。
- **メタ解放のバランス（暫定値）**: `UNLOCK_DEFS` のコスト、`applyRunReward` の points 配分（勝利20 / 敗北5 × `scoreMul`）、デイリー固定条件（難易度 normal・試練なし）は暫定。フェーズ1/4/5 の「モンテカルロ許容レンジ化」統計テスト基盤と統一して後続調整する。
- **メタ解放対象の拡張**: 現状はカード／レリックのみ。メンバー／トレイト解放（フェーズ3/4 の「メタ進行へのメンバー解放」）や追加イベント／試練の解放を加えるかは未着手。
