---
name: pin-github-actions
description: "GitHub Actions ワークフローの外部アクションを最新リリースへ更新し、フルコミットSHAでピン留めする。Use when asked to pin actions to commit SHA, update third-party GitHub Actions, harden workflows, or refresh uses: versions in .github/workflows."
---

# GitHub Actions の最新化と SHA 固定

`.github/workflows/`（および `.github/actions/` の composite）内の外部アクションを、最新リリースのフルコミットSHAへピン留めする。

## 対象

- `uses: owner/repository[/path]@ref` 形式の外部参照（サブディレクトリや reusable workflow を含む）
- 自リポジトリ外はすべて対象（`actions/*` 含む）。ローカル `./` や `uses: ./.github/actions/...` は対象外
- ワークフローが無い、または外部アクションが無い場合は、その旨を報告して終了

## 手順

1. `.github/workflows/**/*.{yml,yaml}` と `.github/actions/**/action.{yml,yaml}` から全 `uses:` を棚卸しし、ローカル参照を除いた外部参照だけを対象にする。
2. ユニークな外部参照ごとに最新安定版タグを取得する。`uses` の `owner/repository[/path]` のうち先頭2要素（`owner/repository`）だけを API のリポジトリ名に使い、`/path` 以降は更新後の `uses:` にそのまま残す:

```bash
# まず Release を試す
gh api "repos/<owner>/<repository>/releases/latest" --jq '{tag:.tag_name, published:.published_at}'

# Release が無い（404 等）場合はタグを列挙し、安定版のバージョンタグ（vX / vX.Y.Z）から最新を選ぶ
gh api "repos/<owner>/<repository>/tags?per_page=30" --jq '.[].name'
```

3. タグが指すコミットSHAを解決する（annotated / nested tag は peel する）:

```bash
# 1) タグ ref を取得
gh api "repos/<owner>/<repository>/git/ref/tags/<tag>" --jq '{type:.object.type, sha:.object.sha}'

# 2) object.type が commit になるまで繰り返す
#    - commit: その sha を採用
#    - tag: 下の API で次の object を取り、type を再確認
gh api "repos/<owner>/<repository>/git/tags/<object.sha>" --jq '{type:.object.type, sha:.object.sha}'
```

4. メジャーバージョン更新がある場合はリリースノートの破壊的変更を確認する。最新版へ上げるために必要な最小修正（`with:`、出力名、`permissions`、後続ステップなど）だけを行う。対応が過大でスコープを超える場合は、そのアクションを旧版のまま SHA 固定し、非互換内容を報告する。無関係なリファクタはしない。
5. 各外部 `uses:` を次の形式に更新する（SHA + バージョンコメント）。サブディレクトリがある場合はパスを保持する:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: github/codeql-action/init@<commit-sha> # <tag>
```

6. 変更後、すべての外部 `uses:` がフルSHA（40桁hex）になっていることを再確認する。ローカル参照は検証対象外。

## 制約

- ムービングタグ（`@v4`）や短いSHAは使わない
- 最新化とSHA固定、および破壊的変更への必要最小限の移行以外のリファクタはしない
- container image や `runs-on` の更新はスコープ外（ユーザーが明示した場合のみ）
- コミット・PR が求められたら、既存の commit/PR スキルまたはリポジトリ慣例に従う（日本語）

## 完了条件

- 対象ワークフローの外部アクションがすべて（可能な範囲で最新の）フルコミットSHAで固定されている
- 各外部 `uses:` 行に `# vX.Y.Z`（または同等のタグ名）コメントがある
- 破壊的変更で必要な最小修正以外に差分がない
- 最新化できなかった外部アクションがある場合は、理由と非互換内容を報告している
