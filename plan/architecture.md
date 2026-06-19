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
| 盤面描画 | DOM/SVG（MVP1〜2）→ PixiJS + pixi-viewport（MVP3以降） | タスク粒・アイソメ盤面・フロー・ヒートマップ・延焼 |
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
- `window.game` に `pause() / step(ms) / loadState(seed, scenario)` を露出し、E2E から状態を固定できるようにする（第22.5）。

---

## 3. ディレクトリ構成（初期案）

```text
/
├─ SPEC.md
├─ IMPLEMENTATION_PLAN.md      ← 索引
├─ plan/                       ← 実装単位ごとの計画（本ディレクトリ）
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
   ├─ game.ts                  ← window.game フック（pause/step/loadState）
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
- `window.game.pause()/step(ms)/loadState(seed, scenario)` を全フェーズで維持。
- スプライト生成は依存注入にし、テストでモック差し替え可能に。

### 4.2 避けること（CIが脆くなる / 第22.5）

- Node 上で実 WebGL を回さない（実ピクセル検証は Playwright に集約）。
- FPS を CI で直接 assert しない（カリング数・プール再利用・生成スプライト数の上限を数値検証）。

### 4.3 データ駆動

- カード（第7章）・レリック（第8章）・イベント（第9章）・ボス（第10章）・難易度（第16章）は `src/data/` の宣言的定義に寄せ、追加・バランス調整をコード変更なしで行える形にする。

### 4.4 段階的描画移行（第22.4）

- MVP1〜2: DOM/SVG（モックアップ準拠）で素早く。ただし sim は最初から分離・seed付き。
- MVP3 以降: 粒数/ズームが増える時点で PixiJS へ移植。React/TS/Framer Motion/Recharts は役割を限定して継続。

### 4.5 世界観の制約（第2.1章）

- イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める。SF的飛躍・実在企業/個人の貶めはしない。実装レビューの基準にする。
