# アーキテクチャと横断規律

現行実装の技術構成と、機能追加時に維持する境界をまとめる。体験要件は[`SPEC.md`](../SPEC.md)、確率モデルは[probability-model.md](./probability-model.md)、バランスパラメータSSoTの導入計画は[balance-ssot-plan.md](./balance-ssot-plan.md)、実装対応は[spec-mapping.md](./spec-mapping.md)を正とする。

## 1. 技術スタック

| 領域 | 採用技術 | 役割 |
| --- | --- | --- |
| 言語・ビルド | TypeScript / Vite / Node 24 | 全レイヤとビルド |
| UI | React 19 / Framer Motion | HUD、カード、画面遷移、離散UI |
| 盤面 | PixiJS / pixi-viewport | 現場、部署、全社の動的描画とカメラ |
| フォールバック | DOM / SVG | WebGL不可環境と標準E2E |
| シミュレーション | 純TypeScript / seed付きPRNG | 固定タイムステップ、決定論 |
| 状態と遷移 | `RunEngine` / 純TS遷移表 / XState | ラン状態の正本、遷移検証、契約可視化 |
| 重い試算 | Web Worker / Comlink | what-if計算 |
| グラフ | Recharts | リザルトの静的分析 |
| 永続化 | IndexedDB / idb | メタ進行、ラン途中セーブ、リプレイ |
| テスト | Vitest / Playwright | ロジック、操作、視覚回帰 |

状態管理ライブラリは要件ではない。`RunEngine`の決定論、保存・復元、リプレイ、Reactとの同期を損なわない範囲で実装を選択する。

## 2. レイヤ境界

```text
React UI ──入力──▶ GameHandle ──操作──▶ RunEngine / Simulation
    ▲                    │                         │
    └────スナップショット┘                         │
    ▲                                              │
Renderer ◀──────────── 描画用の純データ ────────────┘

IndexedDB ◀──── Meta / RunSave / Replayの直列化境界
```

- `RunEngine`がラン状態とフェーズの正本。`src/sim/run/phases.ts`が許可遷移の正本。
- ReactとRendererは状態を読んで表示し、シミュレーション内部を直接変更しない。
- `src/sim/`はReact、PixiJS、IndexedDBを知らない。
- 乱数はseed付きPRNGへ集約し、同じseedと入力で同じ結果を返す。派生seedと乱数消費順の規律は[probability-model.md](./probability-model.md)に従う。
- `window.game`の公開契約は`src/game.ts`の`GameHandle`を正とする。`engine`直接参照はデバッグ専用。

## 3. ディレクトリ責務

| パス | 責務 |
| --- | --- |
| `src/sim/` | ドメイン型、確率モデル、ラン進行、組織集約 |
| `src/state/` | メタ進行、IndexedDB、セーブ、リプレイ、XState契約 |
| `src/data/` | カード、レリック、イベント、難易度などの宣言的定義 |
| `src/render/` | 状態から描画計画への純変換、Pixi/DOMアダプタ |
| `src/ui/` | React画面、HUD、入力UI |
| `src/game.ts` | UI・E2E・デバッグ向けの操作ファサード |
| `tests/unit/` | 純ロジック、不変条件、統計レンジ |
| `tests/e2e/` | ブラウザ操作、主要フロー、視覚回帰 |

## 4. 描画規律

- 既定はPixiJS。`?renderer=dom`またはWebGL不可時のみDOM/SVGを使う。
- 座標、深度、カリング、LOD、ヒット判定は可能な限り純関数化し、GPU不要のVitestで検証する。
- 実ピクセルはPlaywrightの`@pixi`テスト、主要画面の目視は`npm run gallery`で確認する。
- FPSをCIで直接assertせず、表示数、カリング数、スプライト再利用数など決定論的な予算を検証する。
- 独立チーム対応では、非選択チームを粗粒度で更新・描画し、選択中チームだけを詳細盤面へ展開する。

## 5. データと永続化

- カード、レリック、進化、イベント、難易度は`src/data/`の定義を正とする。
- 調整対象の基本値は、[balance-ssot-plan.md](./balance-ssot-plan.md)に従って型付きの分割レジストリへ段階的に移す。現時点では未実装である。
- SPEC内の具体例は方向性であり、データ定義と完全一致する必要はない。ただし第2章の因果関係は維持する。
- 永続データはスキーマバージョンを持ち、読み込み時に検証・既定値補完する。
- 独立チーム状態を追加する場合は、ラン保存、次四半期継続、リプレイの各直列化境界を同時に更新する。

## 6. テスト規律

- シミュレーション、不変条件、統計レンジ、状態→表示変換はVitest。
- フェーズ横断操作、IndexedDB連携、DOMフォールバックは標準Playwright。
- 実WebGLと視覚回帰は`npm run test:e2e:pixi`。
- `?seed=`、`pause()`、`step(ms)`、各フェーズ操作で失敗を再現できる状態を維持する。
- Node上で実WebGLを動かさず、実GPUが必要な検証はPlaywrightへ集約する。

## 7. 世界観

イベント、ボス、敗北、称号、演出は現実の開発組織で起こりうる範囲に留める。誇張は状態理解を助ける比喩に限定し、SF的飛躍や実在企業・個人を貶める表現を避ける。
