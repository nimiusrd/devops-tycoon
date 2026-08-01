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

実装単位 Issue をこのエピックの **サブイシュー**として追加する（推奨）。  
本文に番号を書く場合は確定した `#n` だけを使う（プレースホルダを残さない）。  
進捗確認はサブイシュー一覧、または下記リンクの open / closed 表示でよい。

| ID | Issue | 対象 |
| --- | --- | --- |
| RI-N-A1 | #123 | `path/to/file.ts` |

## 完了条件

- サブイシュー（実装単位）がすべて close されていること（このエピック Issue も close する）。
- `plan/remaining-issues.md` のエピック行を完了にし、短い完了要約を書く。
- 全体 mutation score の到達は完了条件に含めない。
- 後続エピックへ置換する場合は、このエピック Issue と引き継いだ子 Issue を置換理由付きで close する。
