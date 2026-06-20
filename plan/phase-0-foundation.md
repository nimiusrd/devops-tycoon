# フェーズ0: 基盤セットアップ

| 項目 | 内容 |
| --- | --- |
| 対応 MVP | 前提（MVPの土台） |
| SPEC 参照 | 第22章（技術構成） |
| 前提 | なし |
| 次フェーズ | [phase-1-sprint-simulation](./phase-1-sprint-simulation.md) |

SPEC に明記はないが、第22章を成立させるための土台。**sim を最初から描画から分離し、seed付き決定論で書く**規律をここで確立する。

---

## 目的

`npm run dev` で空のシェルが立ち上がり、`npm test` が通る状態を作る。決定論・テスト容易性のフック（`window.game`、seed付きPRNG）を最初から用意する。

## タスク

- Vite + React + TypeScript プロジェクトの初期化
- Zustand / XState / Framer Motion の導入
- Vitest セットアップ（`src/sim` を最優先でテスト可能に）
- Playwright セットアップ（既存 `mockups/` 撮影構成を視覚回帰の基盤として流用 / 第22.5）
- Lint/format（ESLint + Prettier）、CI（テスト実行）
- `src/sim/rng.ts`（mulberry32）と seed の一元管理、`?seed=` パラメータ
- `window.game` フックの骨組み（`GameHandle`: `pause` / `step` / `startRun` 等。公開契約は `src/game.ts`）
- ディレクトリ構成（[architecture.md](./architecture.md) §3）の雛形を作成

## 成果物

- 開発サーバが起動し、空の UI シェルが表示される。
- `npm test`（Vitest）と Playwright のスモークが通る。
- CI で両テストが走る。

## テスト

- Vitest: `rng.ts` の決定論（同一 seed で同一列）を検証。
- Playwright: トップが表示されるスモーク 1 本。

## 完了の目安（DoD）

dev 起動・Vitest/Playwright 稼働・PRNG 決定論テスト緑・CI 緑。
