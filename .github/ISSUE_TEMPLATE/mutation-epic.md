---
name: Mutation エピック
about: フルシャード Mutation run 1回分のトラッキング（子 Issue へのハブ）
title: "[RI-N] ミューテーションテストに基づくユニットテスト強化"
labels: []
---

## ベースライン

- run: https://github.com/nimiusrd/devops-tycoon/actions/runs/<RUN_ID>
- headSha: `<sha>`
- 方針: `plan/mutation-remediation.md`

## 参考スナップショット（任意）

- total / covered / Survived など。完了条件には使わない。

## 実装単位

子 Issue を先に作成し、確定した番号で埋める（プレースホルダのまま残さない）。

| ID | Issue | 対象 |
| --- | --- | --- |
| RI-N-A1 | #123 | `path/to/file.ts` |

## 完了条件

- 上記の実装単位 Issue がすべて close されていること。
- 全体 mutation score の到達は完了条件に含めない。
- 後続エピックへ置換する場合は、このエピック Issue と引き継いだ子 Issue を置換理由付きで close する。
