# Issue #499：独立 Action の実測記録

検証日: 2026-09-14 JST（run の UTC 日付は 2026-09-13）。[専用 PR #502](https://github.com/nimiusrd/devops-tycoon/pull/502) は本人 `nimiusrd` 名義、専用 base `codex/issue-499-base`／`codex/issue-499-base-alt` で検証し、マージせず終了しました。検証用の head 更新・コメント・空行は main に取り込みません。

[実装 PR](https://github.com/nimiusrd/pr-merge-readiness-action/pull/1)、[v0.1.0](https://github.com/nimiusrd/pr-merge-readiness-action/releases/tag/v0.1.0)、[移行 PR #501](https://github.com/nimiusrd/devops-tycoon/pull/501)、[全体 Issue #499](https://github.com/nimiusrd/devops-tycoon/issues/499)。旧 writer の最後の [run 34766401108 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34766401108/attempts/1) が実行終了したことを確認してから入口を切り替えました。旧実装の成功を新 Action の検証として数えていません。

## 出所・保存情報

全レポートで次を照合しました。PR の base を変更しても、設定は準備 job が固定した default branch の SHA を使います。

| 種別 | repository | SHA | path |
| --- | --- | --- | --- |
| Action・評価器 | nimiusrd/pr-merge-readiness-action | `fb9e82eadd7e56467b762102597ad8a77d47d82d` | `pr_merge_readiness` |
| 共通 workflow | nimiusrd/pr-merge-readiness-action | `fb9e82eadd7e56467b762102597ad8a77d47d82d` | `.github/workflows/readiness.yml` |
| 設定 | nimiusrd/devops-tycoon | `a2b9cc45ab175701592ac5b14080b3cb59ff4257` | `.github/pr-merge-readiness.toml` |

artifact 名は `pr-merge-readiness-RUN_ID-ATTEMPT`、下表の PR 別 JSON はすべて `pr-502.json` です。同じ artifact に `manifest.json` と `summary.md` を保存しています。レポートの format は `pr-merge-readiness/report`、manifest は `pr-merge-readiness/manifest`、どちらも `schema_version = 1`。生 JSON・API 証跡・再評価結果は artifact または Git 管理外の `evidence/` に保存しました。

下表の SHA 略号は次の固定値を示します。

| 略号 | SHA |
| --- | --- |
| H1 (head) | `620247583ac15172e0b07af37337b94861d37ced` |
| H2 (head) | `ada14a22a6d367632d97978374744d264ce5143d` |
| B1 (base) | `a2b9cc45ab175701592ac5b14080b3cb59ff4257` |
| B2 (base) | `39b15006a5d51874c9abde33f295c35b0fb1c9b2` |

## 期待値と実測値

| ケース | run / attempt | head / base | 期待値 | 実測値 |
| --- | --- | --- | --- | --- |
| CI 実行中 | [run 34766831607 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34766831607/attempts/1) | H1 / B1 | 実行中の必須 Check は waiting。GitHub 総合状態も尊重 | `HUMAN_REVIEW_REQUIRED`。`required_check:Lint & Unit (Vitest)=waiting (in_progress)`; `required_check:E2E (Playwright)=waiting (in_progress)`; `github_merge_state=blocked (UNSTABLE)` |
| 未解決スレッド | [run 34766976400 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34766976400/attempts/1) | H1 / B1 | review_threads は blocked、件数 1 | `HUMAN_REVIEW_REQUIRED`。`review_threads=blocked (1)`; `required_check:Lint & Unit (Vitest)=waiting (in_progress)`; `required_check:E2E (Playwright)=waiting (in_progress)`; `github_merge_state=blocked (UNSTABLE)` |
| スレッド解決・base 変更 | [run 34767212194 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34767212194/attempts/1) | H1 / B2 | 新 base を記録し、スレッド件数 0 | `HUMAN_REVIEW_REQUIRED`。`required_check:E2E (Playwright)=waiting (in_progress)`; `github_merge_state=blocked (UNSTABLE)` |
| Draft 化 | [run 34767363577 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34767363577/attempts/1) | H1 / B1 | ready_for_review は waiting | `WAITING`。`ready_for_review=waiting (true)` |
| Ready 復帰直後 | [run 34767521658 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34767521658/attempts/1) | H1 / B1 | GitHub の総合状態が安定するまで結果を条件達成にしない | `HUMAN_REVIEW_REQUIRED`。`github_merge_state=blocked (UNSTABLE)` |
| Ready 復帰後・手動公開 | [run 34767654775 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34767654775/attempts/1) | H1 / B1 | CI 2 件とその他の条件が pass なら SHADOW_CONDITIONS_MET | `SHADOW_CONDITIONS_MET`。全条件 pass |
| head 更新・30日超の既存ファイル | [run 34768100031 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34768100031/attempts/1) | H2 / B1 | stale_change_review は blocked、人間承認を 1 件要求 | `HUMAN_REVIEW_REQUIRED`。`stale_change_review=blocked`; `required_check:Lint & Unit (Vitest)=waiting (in_progress)`; `required_check:E2E (Playwright)=waiting (in_progress)`; `github_merge_state=blocked (UNSTABLE)` |
| PR 終了 | [run 34768435546 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34768435546/attempts/1) | H2 / B1 | open_pr は blocked（CLOSED） | `HUMAN_REVIEW_REQUIRED`。`open_pr=blocked (CLOSED)`; `stale_change_review=blocked`; `required_check:E2E (Playwright)=waiting (in_progress)`; `github_merge_state=blocked (UNSTABLE)` |

CI が実行中なら必須 Check 条件は waiting です。ただし GitHub の総合状態 `UNSTABLE` が blocked の場合、全体判定は `HUMAN_REVIEW_REQUIRED` になります。CI 待機の実測を全体判定 `WAITING` と読み替えていません。Draft／Ready 更新直後の一時的な状態も保存し、安定後の新しい run で条件達成を確認しています。

## イベントと公開

- CI 再実行: [run 34766770577 / attempt 2](https://github.com/nimiusrd/devops-tycoon/actions/runs/34766770577/attempts/2) が成功。開始を受けた [run 34767818207 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34767818207/attempts/1) の `mark` が成功し、未観測表示への更新を確認しました。
- 条件達成時の手動公開: [run 34767654775 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34767654775/attempts/1)。観測 → Check 公開 → ラベル公開が成功し、`shadow/要マージ判断` を確認しました。
- 30日超の手動公開: [run 34768100031 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34768100031/attempts/1)。同じ順序で公開し、`shadow/要対応` を確認しました。job の開始・完了時刻でも Check 完了後にラベル job が開始しています。
- 終了後の全 open PR 手動更新: [run 34768536350 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34768536350/attempts/1) が成功。専用 PR は CLOSED、管理ラベルは空になりました。
- 参考 Check は `Autonomous Merge Shadow / PR #502`、`completed / neutral`。本文の run・attempt、対象 head/base、Action SHA、JSON 名を保存レポートと照合しました。
- 新 head の [run 34768003919 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34768003919/attempts/1) 完了後も、終了 PR の Check は終了イベント [run 34768435546 / attempt 1](https://github.com/nimiusrd/devops-tycoon/actions/runs/34768435546/attempts/1) の記録を保持していました。遅い CI 完了で終了前の観測へ戻っていません。

## 30日超レビュー条件

既存ファイル `LICENSE` の base 上の最終変更は `33cde691d1d75fbdad5840e47677905717700710`、日時は `2026-07-26T15:14:33Z` でした。観測時刻 `2026-09-13T16:17:13.582841+00:00` で 4237360.582841 秒経過し、30日（2,592,000秒）を超えています。履歴日時を作り替えず、実際の既存ファイルへの動作に影響しない変更で検証しました。

`stale_change_review=blocked`、`required_human_approvals=1`、`human_approval_review_ids=[]` を確認しました。本人名義の専用 PR なので人間承認による解除は実測していません。30日ちょうど／超過、rename・追加、人間／Bot・所属・head・dismiss・履歴不正、承認による解除は Action の自動テストで検証しています。

## オフライン再評価・自動検証

この公開リポジトリから保存した新 Action の PR レポート **14 件すべて**を、Docker の `--network none`、ソースの読み取り専用 mount、Python 3.11 の `-I -B` で再評価しました。明示したローカル Git と信頼済み Action SHA `fb9e82eadd7e56467b762102597ad8a77d47d82d` から `git archive` で評価器・依存モジュールを取得し、保存した観測・policy・出所だけで元レポート全体と一致、終了コード 0 でした。14 件には全 open PR 観測で得た他 PR と、移行 PR 終了時のレポートも含みます。旧形式や旧 SHA との比較は行っていません。

利用者の再評価コマンドは[利用案内](./pr-merge-readiness.md)からリンクした Action README の `replay` を参照してください。評価器には保存したレポートと一致する信頼済み Action SHA を指定します。

Action の Dev Container と [main CI](https://github.com/nimiusrd/pr-merge-readiness-action/actions/runs/34765377704) で Python 113 テスト、Ruff lint・format、YAML・生成物の検証が成功しました。入力・設定矛盾、SHA 不一致、設定途中変更、モジュール混入、権限不足、artifact 欠落・別 attempt、公開失敗後のラベル抑止、遅延結果を含みます。100 ファイル × 10 PR で履歴要求が run 全体 100 以下、失敗要求の消費、PR 間 cache、base 変更、run 間分離も自動検証しました。

## Artifact の保存設定と再実行の制約

保持期間は[共通 workflow](https://github.com/nimiusrd/pr-merge-readiness-action/blob/fb9e82eadd7e56467b762102597ad8a77d47d82d/.github/workflows/readiness.yml)で 30 日に設定しています。

同じ run の全 job 再実行で前 attempt の artifact が取得できなくなる場合については、公開されている [upload-artifact #585](https://github.com/actions/upload-artifact/issues/585) を参照してください。30日の保存設定は、GitHub 上で削除・再実行された artifact の再取得を保証するものではありません。

再観測には新しい **Run workflow** を使い、同じ run を再実行する場合は必要な artifact を先に Git 外へ保存してください。Action は別 run／attempt への fallback や旧 artifact の変換を行いません。
