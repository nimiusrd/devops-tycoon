# フェーズ1: スプリントシミュレーション

| 項目 | 内容 |
| --- | --- |
| 対応 MVP | MVP 1 |
| SPEC 参照 | 第21章 MVP1 / 第4.1〜4.2章 / 第4.6章 / 第5章 |
| 前提 | [phase-0-foundation](./phase-0-foundation.md) |
| 次フェーズ | [phase-2-active-ops-and-cards](./phase-2-active-ops-and-cards.md) |

---

## 目的

AIなし / AIあり の違いを、タスク粒の流れと結果表示で体感できる最小ループ。「AIを入れると Coding は速くなるが Review が詰まる」という本作のコア因果（第2章）を最初に成立させる。

## タスク

### sim 層

- ドメイン型: `Task`（定型/通常/複雑/AI/手戻り/障害/高価値/負債）、`Lane`（Backlog▸Coding▸Review▸Rework▸Done）、`OrgState`（第5章のリソース）
- 工程モデル: Coding 速度、Review 容量、Rework 率、Incident 率を確率で算出
- **AI 導入フラグ**で Coding 加速 → Review 渋滞が増える因果を実装（第2章のコア）
- 固定タイムステップの `step(dt)`、seed 付きで決定論

### 状態 / UI

- 基本ステータス表示（出荷ポイント/開発速度/レビュー耐性/品質/シニア体力/AI依存度/技術的負債/士気/炎上リスク）（第4.2章）
- 盤面: タスク粒が `Backlog → Coding → Review → Rework → Done` を流れる（DOM/SVG、`mockups/main-screen` 準拠）
- 種類ごとの見た目（第4.1章の表: 小/中/大/光る/赤/炎上/金/黒）
- スプリントリザルト画面（第4.6章の項目: Done / Delivered / Rework / Incidents / Senior HP 等）

## 成果物

1スプリントを最後まで自動進行し、AIあり/なしを切り替えて結果差を観察できる。

## テスト（Vitest 中心）

- 不変条件: 「AI依存度↑ → Rework 傾向↑」（第22.5 の代表例）
- seed 再現性: 同一 seed で同一リザルト
- 「状態→見た目」マッピング（粒の色/サイズ）を純関数で検証

## 完了の目安（DoD）

AIあり/なしで結果差が出る・リザルト表示・不変条件テスト緑。
