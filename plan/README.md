# plan/ ドキュメント索引

DevOps Tycoon の計画・設計ドキュメント一式の置き場で、このファイルがその索引。段階的な実装は一通り完了したため、本ディレクトリは現状の実装と SPEC の対応・残務・設計判断を追うための資料に位置づける。

> 方針: SPEC 第22章「技術構成」をアーキテクチャの前提とする。**シミュレーション層を描画から分離し、seed付き決定論で実装する**ことを横断規律とする（第22.3〜22.5）。SPEC 各章とコードの対応・充足状況は [spec-mapping.md](./spec-mapping.md) を参照。

---

## 現状

- 実装は一通り完了し、`src/`（sim / state / render / ui）と `tests/`（Vitest / Playwright E2E）が揃って `npm run dev` で通しプレイできる。
- 盤面描画は既定で DOM/SVG、`?renderer=pixi` で全社マップのみ PixiJS に opt-in 切替。
- SPEC 各章の充足状況（✅/🟡）と残務の追跡先は [spec-mapping.md](./spec-mapping.md) §1・§2 に集約。モックアップは**デザイン・レイアウトの正**として維持する（第22.2）。
- 残務・未解決事項は [remaining-issues.md](./remaining-issues.md) に一本化して追跡する。

---

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| [spec-mapping.md](./spec-mapping.md) | **SPEC 各章 ↔ コードの対応表＋未充足箇所の一覧**。まずここを見る |
| [architecture.md](./architecture.md) | 技術スタック・レイヤ分離・ディレクトリ構成・横断規律 |
| [remaining-issues.md](./remaining-issues.md) | **プロジェクト残課題バックログ**（`RI-NN` で ID 管理、1項目 ≒ 1PR。実装後の繰り越し・未解決事項＋モックアップ乖離・SPEC 未充足を統合）。基本ループ再設計（四半期トラック＋ビート）は RI-33 として実装済み |

---

## リスクと留意点

- **世界観の制約（第2.1章）**: イベント/ボス/敗北/称号/演出は「現実の開発組織で起こりうる範囲」に留める（[architecture.md](./architecture.md) §4.5）。
- **バランス調整コスト**: 確率モデルのチューニングは Web Worker のモンテカルロ試算（第22.3）＋データ駆動定義で回す。
- **状態の複雑化**: ゲーム内のフェーズ遷移は XState、ラン/メタ状態は Zustand に分離して肥大化を防ぐ。

---

## 残務の進め方

主な残務はバランス調整（四半期レビューの代償・outcome 閾値ほか）と横断的な繰り越し（統計テスト基盤・レバーバランス・業界とメタ進行の接続・メタ解放対象の拡張など）。詳細と追跡先は [remaining-issues.md](./remaining-issues.md) と [spec-mapping.md](./spec-mapping.md) §2 を参照。
