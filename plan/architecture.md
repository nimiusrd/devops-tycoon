# アーキテクチャと横断規律

全フェーズ共通の技術前提と実装規律。各フェーズ計画（`plan/phase-*.md`）はこの方針に従う。出典は [`SPEC.md`](../SPEC.md) 第22章。

---

## 1. 技術スタック

| 領域 | 採用技術 | 役割 |
| --- | --- | --- |
| 言語 | TypeScript | 全レイヤ共通 |
| ビルド/Dev | Vite | 開発サーバ・バンドル |
| UIシェル | React | HUD・アクションバー・カード・ツリー・マップ・リザルト・パンくず |
| UI演出 | Framer Motion | 画面遷移・マイクロインタラクション |
| 盤面描画 | DOM/SVG（MVP1〜3）→ PixiJS + pixi-viewport（MVP5着手前必須 / MVP4は必要時前倒し） | タスク粒・アイソメ盤面・フロー・ヒートマップ・延焼 |
| 状態管理 | Zustand（ラン/メタ状態）＋ XState（フェーズ遷移） | 予測可能な状態とフロー管理 |
| シミュレーション | 純TS・固定タイムステップ・seed付きPRNG | 確率モデル本体（描画から分離・決定論） |
| 重い試算 | Web Worker（+Comlink） | what-if 計算・モンテカルロ等 |
| 静的グラフ | Recharts または visx | リザルト/診断の図 |
| 保存 | localStorage（MVP）→ IndexedDB（idb/Dexie） | セーブ・メタ進行・リプレイ |
| テスト | Vitest（ロジック）＋ Playwright（実ブラウザ） | 第22.5 の二段構え |
| バックエンド | 当面なし（ローカル擬似） | 将来: ランキング共有・デイリーラン配信 |

---

## 2. レイヤ分離の原則（最重要）

```text
React (UIシェル)  ── 状態を持ち、表示する。Zustand + XState。
        │ 読む（一方向）
Simulation (純TS) ── 固定タイムステップ＋seed付きPRNGで状態を更新。描画を一切知らない。
        │ 読まれる（一方向）
Renderer (DOM/SVG → Pixi) ── 状態を読んで描くだけ。双方向バインドしない。
```

- **React は状態を持ち、Renderer は状態を読んで描くだけ**（第22.2）。
- **sim は描画を知らない**。`step(dt)` で状態を進める純粋な関数群とし、入力（介入アクション等）はイベントキュー経由で受ける。
- 乱数は seed付き PRNG（`mulberry32` 程度）に一本化し、`?seed=` で再現可能にする（第22.3）。
- `window.game`（`src/game.ts` の `GameHandle`）を E2E / デバッグから露出し、`?seed=` と `startRun` / 各フェーズ操作で状態を固定・駆動できるようにする（第22.5）。

---

## 3. ディレクトリ構成（初期案）

```text
/
├─ SPEC.md
├─ plan/                       ← 実装単位ごとの計画（本ディレクトリ）
│  ├─ README.md                ← 索引
│  ├─ architecture.md
│  └─ phase-*.md
├─ mockups/                    ← デザインの正（維持）
├─ index.html
├─ vite.config.ts
├─ package.json
├─ tsconfig.json
└─ src/
   ├─ sim/                     ← シミュレーション（純TS・描画非依存）
   │  ├─ rng.ts               ← seed付きPRNG（mulberry32）
   │  ├─ types.ts             ← ドメイン型（Task, Lane, OrgState 等）
   │  ├─ model/               ← 確率モデル（coding/review/rework/incident）
   │  ├─ engine.ts            ← 固定タイムステップのループと step(dt)
   │  └─ scenarios.ts         ← 難易度プリセット（第16章）
   ├─ state/                   ← Zustand ストア + XState マシン
   │  ├─ runMachine.ts        ← マップ→スプリント→ドラフト→進化（第3章）
   │  └─ stores/
   ├─ render/                  ← 描画アダプタ（DOM/SVG → 後でPixi）
   │  ├─ Board.tsx            ← 盤面（タスク粒の流れ）
   │  └─ adapters/            ← レンダラ差し替え用インターフェース
   ├─ ui/                      ← React UI（HUD/アクションバー/カード/ツリー…）
   ├─ data/                    ← カード・レリック・イベント・ボス定義（データ駆動）
   ├─ game.ts                  ← window.game フック（GameHandle）
   └─ main.tsx
   tests/
   ├─ unit/                    ← Vitest（sim 不変条件・ビューモデル）
   └─ e2e/                     ← Playwright（視覚回帰・操作）
```

---

## 4. 横断的な実装規律

### 4.1 決定論とテスト容易性（第22.3 / 22.5）

- 乱数は seed付き PRNG に一本化、`?seed=` で再現。
- レンダラは「状態を読んで描くだけ」＝同一状態なら同一フレーム＝スクショ安定。
- **`window.game` の公開 API は `src/game.ts` の `GameHandle` を正とする。** E2E / 外部自動化が使うメソッド:
  - 制御: `pause()` / `resume()` / `isPaused()`
  - 状態読取: `getState()` / `phase()` / `revision()` / `isSprintRunning()` / `getMeta()`
  - ラン開始: `startRun(difficulty?, trials?, seed?)` / `newRun(seed?)`（旧設計の `loadState(seed, scenario)` は廃止。seed は URL パラメータまたは引数で指定）
  - メタ進行（第17章）: `purchaseMetaUnlock(unlockId)`（points 消費で永続解放。`getMeta()` で残高・購入済みを読む）
  - フェーズ駆動: `enterNode(id)` / `step(ms)` / `dispatch(id)` / `acknowledgeResult()` / `chooseCard(defId)` / `skipDraft()` / `unlockEvolution(id)` / `finishEvolution()` / `chooseEvent(index)` / `buyShopCard(defId)` / `buyShopRelic()` / `leaveShop()` / `restChoose(option)`（option に `recruit` を含む）
  - 編成（MVP4 / 第12章）: `assignMember(id, assignment)` / `setMemberAi(id, on)`
  - 組織スケール / ズーム階層（MVP5 / 第4.7〜4.11）: `zoomTo(level)` / `focusDept(id)` / `focusTeam(id)` / `setRankingKind(kind)` / `applyOrgLever(leverId, deptId?)`。集約結果（`orgScale` / `industry`）と現在地（`zoom` / `rankingKind`）は `getState()` のスナップショットから読む（描画は読むだけ。第22.2）。
- **デバッグ専用:** `engine`（`RunEngine` への直接参照）。E2E テストからは使わない。
- `GameHandle` にメソッドを追加する場合は型定義と E2E 型（`tests/e2e/run.spec.ts` 等）を同時更新する。
- スプライト生成は依存注入にし、テストでモック差し替え可能に。

### 4.2 避けること（CIが脆くなる / 第22.5）

- Node 上で実 WebGL を回さない（実ピクセル検証は Playwright に集約）。
- FPS を CI で直接 assert しない（カリング数・プール再利用・生成スプライト数の上限を数値検証）。

### 4.3 データ駆動

- カード（第7章）・レリック（第8章）・イベント（第9章）・ボス（第10章）・難易度（第16章）は `src/data/` の宣言的定義に寄せ、追加・バランス調整をコード変更なしで行える形にする。

### 4.4 段階的描画移行（第22.4）

- MVP1〜3: DOM/SVG（モックアップ準拠）で素早く。PHASE3 は周回・診断・勝敗の通しプレイ DoD を優先し、過剰投資を避ける。ただし sim は最初から分離・seed付き。
- MVP5: 4階層ズーム・巨大組織ビューの**描画非依存の基礎**（アイソメ投影 / 深度ソート / 画面外カリング / スプライトプール）を `src/render/iso.ts` に純TS で実装し、数値検証した（第22.5）。全社/部署/業界ビューは既定では DOM/SVG（Framer Motion でクロスフェード）で実装し、`iso.ts` の座標系を共有する。Phase 6 で全社マップのみ `?renderer=pixi` の opt-in PixiJS + pixi-viewport 描画へ差し替え済み。実ピクセル/WebGL 検証は opt-in Playwright（`npm run test:e2e:pixi`）に集約し、CI 既定 job では実 WebGL を回さない。React/TS/Framer Motion/Recharts は役割を限定して継続。

### 4.5 世界観の制約（第2.1章）

- イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める。SF的飛躍・実在企業/個人の貶めはしない。実装レビューの基準にする。
