# 実装計画（索引）

DevOps Tycoon の実装計画。[`SPEC.md`](./SPEC.md) の企画内容を、実装単位ごとにファイル分割した。各ファイルは SPEC の章番号を参照する。

> 方針: SPEC 第21章「MVPスコープ」を段階の骨格とし、第22章「技術構成」をアーキテクチャの前提とする。**シミュレーション層を最初から描画から分離し、seed付き決定論で実装する**ことを全フェーズ共通の規律とする（第22.3〜22.5）。

---

## ゴール

- 「AI導入が開発組織の生産性に与える影響」を、seed付き決定論の確率モデルで再現するWebゲームを段階的に構築する。
- 各 MVP の終わりに「遊べる/検証できる」状態を作り、次フェーズへ積み増す。
- ロジックは GPU 不要の Vitest で厚く、実ピクセル/操作は Playwright で薄くテストする二段構え（第22.5）。

## 現状

- **MVP1〜5（M0〜M5）は実装済み**。`src/`（sim / state / render / ui）と `tests/`（Vitest 26 ファイル・236 本緑、Playwright E2E）が揃い、`npm run dev` で通しプレイできる。各フェーズの実装内容と繰り越しは [plan/follow-ups.md](./plan/follow-ups.md) を参照。
- **Phase 6（WebGL / PixiJS 移行）は進行中**: 6a（React 接続・pan/zoom・カリング）/ 6b（DOM 同等の情報量）/ 6c（カメラ同期）まで完了。残りは 6d（性能予算の実測・数値確定）と 6e（視覚回帰・任意）で、いずれもホストブラウザ計測が前提。詳細は [plan/phase-6b-pixi-visual-parity.md](./plan/phase-6b-pixi-visual-parity.md)。
- 盤面描画は既定で DOM/SVG、`?renderer=pixi` で全社マップのみ PixiJS に opt-in 切替。
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
| [plan/phase-6-webgl-migration.md](./plan/phase-6-webgl-migration.md) | WebGL（PixiJS）移行 / DOM・SVG からの局所差し替え |
| [plan/phase-6b-pixi-visual-parity.md](./plan/phase-6b-pixi-visual-parity.md) | Phase 6 続き: Pixi 見た目 parity・カメラ同期・性能 DoD |
| [plan/follow-ups.md](./plan/follow-ups.md) | 各フェーズ実装後のフォローアップ / 未解決事項 |

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
| M6 | WebGL 移行 | 拡張 | `?renderer=pixi` で全社マップ Pixi 描画・DOM 同等の情報量・カメラ同期 | 🚧 進行中（6a–6c 完了 / 6d 性能計測・6e 視覚回帰 残） |

依存関係: M0 → M1 → M2 → M3 →（M4・M5 は M3 以降で並行可能。ただし、M5 は PixiJS + pixi-viewport 移植完了を着手前提とし、M4 でも粒数・ズーム階層が増える場合は同じゲートを適用する）。M6（Pixi 移行）は M5 の `src/render/iso.ts`（投影 / 深度 / カリング / プール）を供給先とする局所差し替えとして実施中。

---

## リスクと留意点

- **世界観の制約（第2.1章）**: イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める（[architecture.md](./plan/architecture.md) §4.5）。
- **描画移行のタイミング**: 早すぎる Pixi 投資は過剰（第22.4）。MVP1〜3 は DOM/SVG で通しプレイの DoD を優先し、MVP5 着手前には PixiJS + pixi-viewport 移植を完了する（MVP4 でも粒数・ズーム階層が破綻し始める場合は前倒しする）。
- **バランス調整コスト**: 確率モデルのチューニングは Web Worker のモンテカルロ試算（第22.3）＋データ駆動定義で回す。
- **状態の複雑化**: フェーズ遷移は XState、ラン/メタ状態は Zustand に分離して肥大化を防ぐ。

---

## 次の一手（着手順）

M0〜M5（MVP1〜5）は完了済み。残りは Phase 6（WebGL 移行）の仕上げ。

1. [phase-6b 6d](./plan/phase-6b-pixi-visual-parity.md#6d-性能予算-dod-の確定ローカル計測--数値テスト): ホストブラウザで `?renderer=pixi` を大規模チーム（100/500/1000 件）で計測し、FPS / メモリ / `culled` / `overBudget` の実測値と上限を §4 表へ確定。`ORG_SPRITE_BUDGET`（暫定 500）と LOD 閾値を反映し、大規模 fixture の Vitest を追加。
2. [phase-6b 6e](./plan/phase-6b-pixi-visual-parity.md#6e-視覚回帰任意判断)（任意）: DOM parity が安定したら固定 seed + `pause()` の Pixi 視覚回帰を別 job / `@pixi` tag で追加するか判断。
3. 横断的な繰り越し（統計テスト・レバーバランス・業界とメタ進行の接続 等）は [follow-ups.md](./plan/follow-ups.md) で追跡。

各フェーズ末に「動く成果物＋テスト」をコミットし、SPEC の章番号で追跡可能にする。
