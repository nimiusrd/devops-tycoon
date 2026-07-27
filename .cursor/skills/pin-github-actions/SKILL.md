---
name: pin-github-actions
description: "GitHub Actions ワークフローの外部アクションを最新リリースへ更新し、フルコミットSHAでピン留めする。Use when asked to pin actions to commit SHA, update third-party GitHub Actions, harden workflows, or refresh uses: versions in .github/workflows."
---

# GitHub Actions の最新化と SHA 固定

`.github/workflows/`（および `.github/actions/` の composite）内の外部アクションを、最新リリースのフルコミットSHAへピン留めする。

## 対象

- `uses: owner/action@...` 形式の参照
- 自リポジトリ外はすべて対象（`actions/*` 含む）。ローカル `./` や `uses: ./.github/actions/...` は対象外
- ワークフローが無い、または外部アクションが無い場合は、その旨を報告して終了

## 手順

1. `.github/workflows/**/*.{yml,yaml}` と `.github/actions/**/action.{yml,yaml}` から全 `uses:` を棚卸しする。
2. ユニークな `owner/action` ごとに最新リリースを取得する:

```bash
gh api "repos/<owner>/<action>/releases/latest" --jq '{tag:.tag_name, published:.published_at}'
```

3. タグが指すコミットSHAを解決する（annotated tag は peel する）:

```bash
# 1) タグ ref を取得
gh api "repos/<owner>/<action>/git/ref/tags/<tag>" --jq '{type:.object.type, sha:.object.sha}'

# 2) object.type が tag（annotated）なら、tag object からコミット SHA を取得
gh api "repos/<owner>/<action>/git/tags/<object.sha>" --jq '.object.sha'

# object.type が commit（lightweight）なら、その sha をそのまま使う
```

4. メジャーバージョン更新がある場合はリリースノートの破壊的変更を確認し、現行の `with:` が壊れるときだけ入力を最小修正する。壊さないなら `with:` / ジョブ構成は変えない。
5. 各 `uses:` を次の形式に更新する（SHA + バージョンコメント）:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

6. 変更後、全 `uses:` がフルSHA（40桁hex）になっていることを再確認する。

## 制約

- ムービングタグ（`@v4`）や短いSHAは使わない
- 最新化とSHA固定以外のリファクタ（permissions 追加、ジョブ分割など）はしない
- container image や `runs-on` の更新はスコープ外（ユーザーが明示した場合のみ）
- コミット・PR が求められたら、既存の commit/PR スキルまたはリポジトリ慣例に従う（日本語）

## 完了条件

- 対象ワークフローの外部アクションがすべて最新リリースのフルコミットSHAで固定されている
- 各行に `# vX.Y.Z`（または同等のタグ名）コメントがある
- 破壊的変更で必要な `with:` 修正以外に差分がない
