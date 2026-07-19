# アーキテクチャと横断規律

実装全体に共通する技術前提と実装規律。SPEC 各章とコードの対応は [`spec-mapping.md`](./spec-mapping.md) を参照。出典は [`SPEC.md`](../SPEC.md) 第22章。

---

## 1. 技術スタック

| 領域 | 採用技術 | 役割 |
| --- | --- | --- |
| 言語 | TypeScript | 全レイヤ共通 |
| ビルド/Dev | Vite | 開発サーバ・バンドル |
| UIシェル | React | HUD・アクションバー・カード・ツリー・マップ・リザルト・パンくず |
| UI演出 | Framer Motion | 画面遷移・マイクロインタラクション |
| 盤面描画 | DOM/SVG → PixiJS + pixi-viewport（規模拡大時に移行） | タスク粒・アイソメ盤面・フロー・ヒートマップ・延焼 |
| 状態管理 | 純TS遷移表 `src/sim/run/phases.ts`（フェーズ遷移の単一真実源）＋ Zustand（ラン/メタ状態） | `RunEngine.setPhase()` が表で実遷移を検証。XState マシンは表から生成し契約テスト/可視化用（RI-39） |
| シミュレーション | 純TS・固定タイムステップ・seed付きPRNG | 確率モデル本体（描画から分離・決定論） |
| 重い試算 | Web Worker（+Comlink） | what-if 計算（`whatIf.worker.ts`）。Vitest は同期フォールバック。バランス用モンテカルロ（RI-14）は Node テストのまま |
| 静的グラフ | Recharts | リザルト「介入の成果」等。タイムライン（RI-53）とライブメーターは自前 SVG / Pixi のまま。visx は未採用 |
| 保存 | IndexedDB（idb、旧 localStorage から起動時移行） | メタ進行（将来: セーブ・リプレイ） |
| テスト | Vitest（ロジック）＋ Playwright（実ブラウザ） | 第22.5 の二段構え |
| バックエンド | なし（ローカル擬似）／対象外 | 外部 API・共有サーバは採用しない。デイリー・業界順位は端末内擬似 |

---

## 2. レイヤ分離の原則（最重要）

```text
React (UIシェル)  ── 状態を持ち、表示する。Zustand +（フェーズ遷移は sim の遷移表が真実源）。
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
├─ plan/                       ← 計画・設計ドキュメント（本ディレクトリ）
│  ├─ README.md                ← 索引
│  ├─ architecture.md
│  └─ spec-mapping.md           ← SPEC ↔ 実装 対応表
├─ scripts/                    ← 画面ギャラリー撮影（npm run gallery）
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
   │  ├─ runMachine.ts        ← sim/run/phases.ts の遷移表から生成（契約テスト/可視化用。第3章 / RI-39）
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
- UI 専用クエリ: `?tutorial=`（`1` / `force` / `help` / `off`）。sim には渡さない（RI-60）。
- **`window.game` の公開 API は `src/game.ts` の `GameHandle` を正とする。** E2E / 外部自動化が使うメソッド:
  - 制御: `pause()` / `resume()` / `isPaused()`
  - 状態読取: `getState()` / `phase()` / `revision()` / `isSprintRunning()` / `getMeta()` / `getRunEpoch()`（ラン開始世代。RI-60）
  - ラン開始: `startRun(difficulty?, trials?, seed?)` / `startDailyRun(dateStr?)` / `newRun(seed?)`（旧設計の `loadState(seed, scenario)` は廃止。seed は URL パラメータまたは引数で指定）
  - メタ進行（第17章）: `purchaseMetaUnlock(unlockId)`（points 消費で永続解放。`getMeta()` で残高・購入済みを読む） / `markTutorialSeen()`（初見ガイド表示済みフラグ。RI-60）
  - フェーズ駆動（固定トラック＋ビート）: `beginSetupSprint()`（setup/setup-pre から次スプリント開始） / `step(ms)` / `dispatch(id)` / `acknowledgeResult()` / `chooseCard(defId)` / `skipDraft()` / `unlockEvolution(id)` / `finishEvolution()` / `resolveBeat(choiceIndex?)`（判定は引数なし、選択は index） / `buyShopCard(defId)` / `buyShopRelic()` / `leaveShop()` / `restChoose(option)`（option に `recruit` を含む）。旧 `enterNode(id)` / `chooseEvent(index)` は撤去。
  - 編成（第12章）: `assignMember(id, assignment)` / `setMemberAi(id, on)`
  - 組織スケール / ズーム階層（第4.7〜4.11）: `zoomTo(level)` / `focusDept(id)` / `focusTeam(id)` / `setRankingKind(kind)` / `applyOrgLever(leverId, deptId?)`。集約結果（`orgScale` / `industry`）と現在地（`zoom` / `rankingKind`）は `getState()` のスナップショットから読む（描画は読むだけ。第22.2）。
- **デバッグ専用:** `engine`（`RunEngine` への直接参照）。E2E テストからは使わない。
- `GameHandle` にメソッドを追加する場合は型定義と E2E 型（`tests/e2e/run.spec.ts` 等）を同時更新する。
- スプライト生成は依存注入にし、テストでモック差し替え可能に。

### 4.2 避けること（CIが脆くなる / 第22.5）

- Node 上で実 WebGL を回さない（実ピクセル検証は Playwright に集約）。
- FPS を CI で直接 assert しない（カリング数・プール再利用・生成スプライト数の上限を数値検証）。

### 4.3 データ駆動

- カード（第7章）・レリック（第8章）・イベント（第9章）・ボス（第10章）・難易度（第16章）は `src/data/` の宣言的定義に寄せ、追加・バランス調整をコード変更なしで行える形にする。

### 4.4 段階的描画移行（第22.4）

- 初期段階: DOM/SVG で素早く。周回・診断・勝敗の通しプレイを優先し、過剰投資を避ける。ただし sim は最初から分離・seed付き。
- 巨大組織・4階層ズーム: 4階層ズーム・巨大組織ビューの**描画非依存の基礎**（アイソメ投影 / 深度ソート / 画面外カリング / スプライトプール）を `src/render/iso.ts` に純TS で実装し、数値検証した（第22.5）。全社/部署/業界ビューは既定では DOM/SVG（Framer Motion でクロスフェード）で実装し、`iso.ts` の座標系を共有する。Phase 6 で全社マップのみ `?renderer=pixi` の opt-in PixiJS + pixi-viewport 描画へ差し替え済み。実ピクセル/WebGL 検証は opt-in Playwright（`npm run test:e2e:pixi`）に集約し、CI 既定 job では実 WebGL を回さない。React/TS/Framer Motion/Recharts は役割を限定して継続。

### 4.5 世界観の制約（第2.1章）

- イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める。SF的飛躍・実在企業/個人の貶めはしない。実装レビューの基準にする。
