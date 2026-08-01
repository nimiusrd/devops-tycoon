---
name: Mutation エピック
about: フルシャード Mutation run 1回分のトラッキング（実装単位はサブイシュー）
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

実装単位 Issue をこのエピックの **サブイシュー**として追加する。  
進捗確認はサブイシュー一覧の open / closed だけでよい（本文に子リンク表は置かない）。

## 完了条件

- サブイシュー（実装単位）がすべて close されていること（このエピック Issue も close する）。
- `plan/remaining-issues.md` にこのエピック行がある場合のみ、完了にして短い完了要約を書く（行が無いなら新設しない）。
- 全体 mutation score の到達は完了条件に含めない。
- 後続エピックへ置換する場合は、このエピック Issue と配下の **全 open サブイシュー**を close する（引き継いだものは新 Issue へのリンク、引き継がないものは不要理由をコメント）。
