---
name: Mutation 実装単位
about: ミューテーション改善の1PR分の作業（完了したら close。達成率は書かない）
title: "[RI-N-A1] "
labels: []
---

## 対象

- `path/to/file.ts`

## 既存テスト

- `tests/unit/….test.ts` または なし

## 再計測

```bash
npm run test:mutation:force -- --mutate path/to/file.ts
```

## 受入

対象の主要 Survived / NoCoverage をテストで潰す（達成率の数値目標は置かない）。

## やる事

- …

## メモ

- 1 Issue = 1PR。完了時は PR で `Fixes #このIssue` して close する。
- エピック Issue の **サブイシュー**として紐づける。
- 計画 MD や単位ファイルへの状態・達成率の書き戻しは不要。
