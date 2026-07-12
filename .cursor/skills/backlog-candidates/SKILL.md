---
name: backlog-candidates
description: Explores this repository's backlog and proposes validated implementation candidates with user value, scope, risk, and implementation difficulty. Use when asked to find backlog tasks, suggest what to work on next, prioritize remaining issues, or select an agent based on task complexity.
---

# バックログ候補の探索

`plan/remaining-issues.md` を起点に、実装と照合した未着手バックログ候補を提示する。
ドキュメントだけで状態を判断しない。候補ごとに関連コード・テストを確認し、実装済みまたは重複した項目は除外する。

## 調査手順

1. `plan/remaining-issues.md`、`plan/spec-mapping.md`、`SPEC.md` を読み、`未着手` と `保留(要判断)` を抽出する。
2. 各候補について、関連する `src/` と `tests/` を検索する。
3. ドキュメントと実装にずれがあれば、実装を正として候補から除外するか、残作業を具体的に再定義する。
4. 候補をプレイヤー価値、依存関係、回帰リスク、変更範囲で優先付けする。
5. 実装難易度に応じて、着手に適したエージェント種別を示す。

広範な探索は `explore` サブエージェントを並列に使う。少なくとも「バックログ文書」と「関連実装・テスト」を別の観点で確認する。

## 難易度と推奨エージェント

| 難易度 | 判断基準 | 推奨エージェント |
| --- | --- | --- |
| 低 | 変更は1〜3ファイル、既存パターンが明確、状態遷移やデータ移行に触れない | 親エージェントが直接実装 |
| 中 | UIと状態またはsimの複数層にまたがる、4〜8ファイル程度、既存テストの拡張で検証可能 | `generalPurpose` で実装・検証を分担 |
| 高 | 操作モデル・保存形式・フェーズ遷移・レンダラなどの設計変更、8ファイル超、複数のE2E経路や移行が必要 | まず `explore` で設計を精査し、再現可能な不具合は `debug`、UIの手動検証は `computerUse` を併用 |
| 要判断 | 仕様に複数の有効な選択肢があり、選択で変更範囲が大きく変わる | 実装候補として出すが、設計選択を明示してユーザーへ確認する |

難易度はファイル数だけで決めない。データ永続化、公開契約、決定論、バランス、UI手動検証の必要性を加味する。

## 出力形式

候補は最大5件に絞り、次の形式で日本語で提示する。

| 優先 | ID | 項目 | 難易度 | 推奨エージェント | 根拠 |
| --- | --- | --- | --- | --- | --- |
| 1 | RI-NN | 簡潔な項目名 | 低 / 中 / 高 / 要判断 | 種別 | 関連ファイルと未実装である根拠 |

候補ごとに次を1〜3文で補足する。

- 期待するユーザー価値
- 主な変更範囲とリスク
- 実装済み部分と残作業の境界

最後に、価値・難易度・依存関係を踏まえた推奨着手順を示す。
