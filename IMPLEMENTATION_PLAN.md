# 実装計画（索引）

DevOps Tycoon の実装計画。[`SPEC.md`](./SPEC.md) の企画内容を、実装単位ごとにファイル分割した。各ファイルは SPEC の章番号を参照する。

> 方針: SPEC 第21章「MVPスコープ」を段階の骨格とし、第22章「技術構成」をアーキテクチャの前提とする。**シミュレーション層を最初から描画から分離し、seed付き決定論で実装する**ことを全フェーズ共通の規律とする（第22.3〜22.5）。

---

## ゴール

- 「AI導入が開発組織の生産性に与える影響」を、seed付き決定論の確率モデルで再現するWebゲームを段階的に構築する。
- 各 MVP の終わりに「遊べる/検証できる」状態を作り、次フェーズへ積み増す。
- ロジックは GPU 不要の Vitest で厚く、実ピクセル/操作は Playwright で薄くテストする二段構え（第22.5）。

## 現状

- リポジトリには企画書（`SPEC.md`）と HTML/PNG モックアップ（`mockups/`）のみ。アプリコードはまだない。
- モックアップは**デザイン・レイアウトの正**として維持する（第22.2）。

---

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| [plan/architecture.md](./plan/architecture.md) | 技術スタック・レイヤ分離・ディレクトリ構成・横断規律（全フェーズ共通） |
| [plan/phase-0-foundation.md](./plan/phase-0-foundation.md) | 基盤セットアップ（MVPの前提） |
| [plan/phase-1-sprint-simulation.md](./plan/phase-1-sprint-simulation.md) | スプリントシミュレーション（MVP1） |
| [plan/phase-2-active-ops-and-cards.md](./plan/phase-2-active-ops-and-cards.md) | 能動操作とカード（MVP2） |
| [plan/phase-3-roguelike-loop.md](./plan/phase-3-roguelike-loop.md) | 周回・育成・診断（MVP3） |
| [plan/phase-4-character-growth.md](./plan/phase-4-character-growth.md) | キャラクター育成（MVP4） |
| [plan/phase-5-org-scale.md](./plan/phase-5-org-scale.md) | 組織スケール / 巨大組織対応（MVP5） |
| [plan/follow-ups.md](./plan/follow-ups.md) | 各フェーズ実装後のフォローアップ / 未解決事項 |

---

## マイルストーンと順序

| # | マイルストーン | 対応 MVP | 完了の目安 |
| --- | --- | --- | --- |
| M0 | 基盤セットアップ | 前提 | dev 起動・Vitest/Playwright 稼働・PRNG 決定論テスト緑 |
| M1 | スプリントが回る | MVP1 | AIあり/なしで結果差・リザルト表示・不変条件テスト緑 |
| M2 | 捌けるスプリント | MVP2 | 介入/集中力/コンボ/ドラフトで結果が変わる |
| M3 | 1ラン通し | MVP3 | マップ→ボス→解放まで通しプレイ・診断/称号/勝敗 |
| M4 | メンバー育成 | MVP4 | 個体育成・編成が戦術になる |
| M5 | 巨大組織 | MVP5 | 4階層ズーム・全社/部署/業界・カメラ遷移 |

依存関係: M0 → M1 → M2 → M3 →（M4・M5 は M3 以降で並行可能。ただし、粒数・ズーム階層が増える M4/M5 では PixiJS 移行を着手前ゲートとして扱う）。

---

## リスクと留意点

- **世界観の制約（第2.1章）**: イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める（[architecture.md](./plan/architecture.md) §4.5）。
- **描画移行のタイミング**: 早すぎる Pixi 投資は過剰（第22.4）。MVP1〜3 は DOM/SVG で通しプレイの DoD を優先し、粒数・ズーム階層が破綻し始める MVP4/5 の着手前ゲートで PixiJS + pixi-viewport へ移行する。
- **バランス調整コスト**: 確率モデルのチューニングは Web Worker のモンテカルロ試算（第22.3）＋データ駆動定義で回す。
- **状態の複雑化**: フェーズ遷移は XState、ラン/メタ状態は Zustand に分離して肥大化を防ぐ。

---

## 次の一手（着手順）

1. [phase-0](./plan/phase-0-foundation.md): Vite+React+TS 初期化、Vitest/Playwright、`rng.ts`、`window.game` 骨組み。
2. [phase-1](./plan/phase-1-sprint-simulation.md): `sim` のドメイン型と工程モデル、AIあり/なしの因果、リザルト画面、不変条件テスト。
3. 以降、M2 → M3 → M4/M5 と積み増す。

各フェーズ末に「動く成果物＋テスト」をコミットし、SPEC の章番号で追跡可能にする。
