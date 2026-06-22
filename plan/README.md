# 実装計画（索引）

DevOps Tycoon の実装計画。[`SPEC.md`](../SPEC.md) の企画内容を、実装単位ごとにファイル分割した。各ファイルは SPEC の章番号を参照する。本ディレクトリ（`plan/`）が計画ドキュメント一式の置き場で、このファイルがその索引。

> 方針: SPEC 第21章「MVPスコープ」を段階の骨格とし、第22章「技術構成」をアーキテクチャの前提とする。**シミュレーション層を最初から描画から分離し、seed付き決定論で実装する**ことを全フェーズ共通の規律とする（第22.3〜22.5）。

---

## ゴール

- 「AI導入が開発組織の生産性に与える影響」を、seed付き決定論の確率モデルで再現するWebゲームを段階的に構築する。
- 各 MVP の終わりに「遊べる/検証できる」状態を作り、次フェーズへ積み増す。
- ロジックは GPU 不要の Vitest で厚く、実ピクセル/操作は Playwright で薄くテストする二段構え（第22.5）。

## 現状

- **MVP1〜5（M0〜M5）は実装済み**。`src/`（sim / state / render / ui）と `tests/`（Vitest / Playwright E2E）が揃い、`npm run dev` で通しプレイできる。各フェーズの実装内容と繰り越しは [follow-ups.md](./follow-ups.md) を参照。
- **Phase 6（WebGL / PixiJS 移行）は完了**: 6a（React 接続・pan/zoom・カリング）/ 6b（DOM 同等の情報量）/ 6c（カメラ同期）/ 6d（性能予算）/ 6e（Pixi 視覚回帰・opt-in）まで完了。詳細は [phase-6b-pixi-visual-parity.md](./phase-6b-pixi-visual-parity.md)。
- 盤面描画は既定で DOM/SVG、`?renderer=pixi` で全社マップのみ PixiJS に opt-in 切替。
- モックアップは**デザイン・レイアウトの正**として維持する（第22.2）。

---

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| [architecture.md](./architecture.md) | 技術スタック・レイヤ分離・ディレクトリ構成・横断規律（全フェーズ共通） |
| [phase-0-foundation.md](./phase-0-foundation.md) | 基盤セットアップ（MVPの前提） |
| [phase-1-sprint-simulation.md](./phase-1-sprint-simulation.md) | スプリントシミュレーション（MVP1） |
| [phase-2-active-ops-and-cards.md](./phase-2-active-ops-and-cards.md) | 能動操作とカード（MVP2） |
| [phase-3-roguelike-loop.md](./phase-3-roguelike-loop.md) | 周回・育成・診断（MVP3） |
| [phase-4-character-growth.md](./phase-4-character-growth.md) | キャラクター育成（MVP4） |
| [phase-5-org-scale.md](./phase-5-org-scale.md) | 組織スケール / 巨大組織対応（MVP5） |
| [phase-6-webgl-migration.md](./phase-6-webgl-migration.md) | WebGL（PixiJS）移行 / DOM・SVG からの局所差し替え |
| [phase-6b-pixi-visual-parity.md](./phase-6b-pixi-visual-parity.md) | Phase 6 続き: Pixi 見た目 parity・カメラ同期・性能 DoD |
| [follow-ups.md](./follow-ups.md) | 各フェーズ実装後のフォローアップ / 未解決事項 |

---

## マイルストーンと順序

| # | マイルストーン | 対応 MVP | 完了の目安 | 状態 |
| --- | --- | --- | --- | --- |
| M0 | 基盤セットアップ | 前提 | dev 起動・Vitest/Playwright 稼働・PRNG 決定論テスト緑 | ✅ 完了 |
| M1 | スプリントが回る | MVP1 | AIあり/なしで結果差・リザルト表示・不変条件テスト緑 | ✅ 完了 |
| M2 | 捌けるスプリント | MVP2 | 介入/集中力/コンボ/ドラフトで結果が変わる | ✅ 完了 |
| M3 | 1ラン通し | MVP3 | マップ→ボス→解放まで通しプレイ・診断/称号/勝敗 | ✅ 完了 |
| M4 | メンバー育成 | MVP4 | 個体育成・編成が戦術になる | ✅ 完了 |
| M5 | 巨大組織 | MVP5 | 4階層ズーム・全社/部署/業界・カメラ遷移 | ✅ 完了 |
| M6 | WebGL 移行 | 拡張 | `?renderer=pixi` で全社マップ Pixi 描画・DOM 同等の情報量・カメラ同期 | ✅ 完了 |

依存関係: M0 → M1 → M2 → M3 →（M4・M5 は M3 以降で並行可能）。M6（Pixi 移行）は M5 の `src/render/iso.ts`（投影 / 深度 / カリング / プール）を供給先とする局所差し替えとして完了済み。

---

## リスクと留意点

- **世界観の制約（第2.1章）**: イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める（[architecture.md](./architecture.md) §4.5）。
- **描画移行のタイミング**: 早すぎる Pixi 投資は過剰（第22.4）。MVP1〜3 は DOM/SVG で通しプレイの DoD を優先し、MVP5 着手前には PixiJS + pixi-viewport 移植を完了する（MVP4 でも粒数・ズーム階層が破綻し始める場合は前倒しする）。
- **バランス調整コスト**: 確率モデルのチューニングは Web Worker のモンテカルロ試算（第22.3）＋データ駆動定義で回す。
- **状態の複雑化**: フェーズ遷移は XState、ラン/メタ状態は Zustand に分離して肥大化を防ぐ。

---

## 次の一手（着手順）

M0〜M5（MVP1〜5）および Phase 6（WebGL 移行）は完了済み。横断的な繰り越しは [follow-ups.md](./follow-ups.md) で追跡。

1. 横断的な繰り越し（統計テスト・レバーバランス・業界とメタ進行の接続 等）は [follow-ups.md](./follow-ups.md) で追跡。

各フェーズ末に「動く成果物＋テスト」をコミットし、SPEC の章番号で追跡可能にする。
