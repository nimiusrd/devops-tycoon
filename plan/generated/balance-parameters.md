# バランスパラメータ一覧

> **このファイルは自動生成です。直接編集しないでください。**
> 更新するには `npm run balance:docs` を実行してください。

| ID | ラベル | 現在値 | 単位 | 許容範囲 | 説明 | タグ | 派生値 |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `process.ai.adoption` | AI 導入時の既定採用率 | `0.85` | `probability` | `0〜1` | AI 導入済みの組織で、各タスクが AI 支援を使う既定確率。 | process, ai | いいえ |
| `process.coding.aiSpeedup` | AI Coding 高速化倍率 | `2.6` | `multiplier` | `1〜5` | AI 支援タスクの Coding 所要 tick を短縮する倍率。 | process, coding, ai | いいえ |
| `process.coding.baseTicks` | Coding 基礎所要 tick | `7` | `ticks` | `1〜30` | 標準規模かつ AI 支援なしのタスクを実装する基礎所要 tick。 | process, coding | いいえ |
