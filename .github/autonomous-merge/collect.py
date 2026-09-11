#!/usr/bin/env python3
"""GitHub APIのメタデータを収集する。PRのcheckout・ソース解析・書き込みは行わない。"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from evaluate import assess, load_policy, markdown, sha, string

MAX_PAGES = 30
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
RECOVERY_LABELS = (
    "shadow/要マージ判断",
    "shadow/CI・レビュー待ち",
    "shadow/再観測が必要",
)
PR_FIELDS = """
number state isDraft headRefOid baseRefOid baseRefName updatedAt
mergeable mergeStateStatus reviewDecision
additions deletions changedFiles
potentialMergeCommit { oid }
"""


class CollectionError(ValueError):
    """API失敗・打ち切りは情報不足として記録する。"""


class GitHub:
    def __init__(self, repository: str):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise CollectionError("invalid repository")
        self.repository = repository
        self.prefix = f"/repos/{repository}"
        self.owner, self.repo = repository.split("/")
        self.api_url = os.environ.get(
            "GITHUB_API_URL", "https://api.github.com"
        ).rstrip("/")
        self.graphql_url = os.environ.get(
            "GITHUB_GRAPHQL_URL", "https://api.github.com/graphql"
        )

    def request(self, path: str, body: dict | None = None):
        headers = {
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "autonomous-merge-shadow",
        }
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        url = self.graphql_url if path == "/graphql" else self.api_url + path
        request = Request(
            url,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                raise CollectionError("API response exceeds limit")
            result = json.loads(data)
        except CollectionError:
            raise
        except HTTPError as error:
            raise CollectionError(f"API {path}: HTTP {error.code}") from None
        except (URLError, TimeoutError, OSError, ValueError) as error:
            raise CollectionError(f"API {path}: {type(error).__name__}") from None
        if isinstance(result, dict) and result.get("errors"):
            raise CollectionError("GraphQL returned errors")
        return result

    def pages(self, path: str, key: str | None = None) -> list:
        records = []
        separator = "&" if "?" in path else "?"
        for page in range(1, MAX_PAGES + 1):
            result = self.request(
                f"{self.prefix}{path}{separator}per_page=100&page={page}"
            )
            batch = result[key] if key else result
            if not isinstance(batch, list):
                raise CollectionError("invalid REST page")
            records.extend(batch)
            if len(batch) < 100:
                if key and result.get("total_count") != len(records):
                    raise CollectionError("REST collection count mismatch")
                return records
        raise CollectionError("REST pagination limit exceeded")

    def graphql(self, number: int, selection: str, cursor: str | None = None) -> dict:
        query = """
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { SELECTION }
  }
}
""".replace("SELECTION", selection)
        # PR state queryに未使用の変数宣言を残さない。
        if "$cursor" not in selection:
            query = query.replace(", $cursor: String", "")
        variables = {"owner": self.owner, "repo": self.repo, "number": number}
        if "$cursor" in selection:
            variables["cursor"] = cursor
        result = self.request("/graphql", {"query": query, "variables": variables})
        return result["data"]["repository"]["pullRequest"]

    def connection(self, number: int, name: str, fields: str) -> list:
        records = []
        cursor = None
        for _ in range(MAX_PAGES):
            result = self.graphql(
                number,
                f"{name}(first: 100, after: $cursor) {{ totalCount nodes {{ {fields} }} pageInfo {{ endCursor hasNextPage }} }}",
                cursor,
            )
            connection = result[name]
            records.extend(connection["nodes"])
            info = connection["pageInfo"]
            if info["hasNextPage"] is False:
                if connection["totalCount"] != len(records):
                    raise CollectionError("GraphQL collection count mismatch")
                return records
            next_cursor = info["endCursor"]
            if not next_cursor or next_cursor == cursor:
                raise CollectionError("invalid GraphQL cursor")
            cursor = next_cursor
        raise CollectionError("GraphQL pagination limit exceeded")


def normalized_pr(raw: dict) -> dict:
    merge = raw["potentialMergeCommit"]
    return {
        "number": raw["number"],
        "state": raw["state"],
        "draft": raw["isDraft"],
        "head_sha": sha(raw["headRefOid"]),
        "base_sha": sha(raw["baseRefOid"]),
        "base_ref": raw["baseRefName"],
        "updated_at": raw["updatedAt"],
        "merge_sha": sha(merge["oid"]) if merge else None,
        "mergeable": raw["mergeable"],
        "merge_state": raw["mergeStateStatus"],
        "review_decision": raw["reviewDecision"],
        "additions": raw["additions"],
        "deletions": raw["deletions"],
        "changed_files": raw["changedFiles"],
    }


def decision_metadata(api: GitHub, number: int, pr: dict) -> dict:
    """判定に使うCI・レビュー状態を同じ方法で再取得できるようにする。"""
    metadata = {}
    reviews = api.pages(f"/pulls/{number}/reviews")
    metadata["reviews"] = [
        {
            "id": r["id"],
            "author": (r["user"] or {}).get("login"),
            "state": r["state"],
            "commit_sha": r["commit_id"],
            "submitted_at": r["submitted_at"],
        }
        for r in reviews
    ]
    threads = api.connection(number, "reviewThreads", "isResolved")
    if any(type(t["isResolved"]) is not bool for t in threads):
        raise CollectionError("invalid review thread state")
    metadata["unresolved_threads"] = sum(not t["isResolved"] for t in threads)
    metadata["checks"] = []
    for commit in dict.fromkeys([pr["head_sha"], pr["merge_sha"]]):
        if commit is None:
            continue
        runs = api.pages(f"/commits/{commit}/check-runs?filter=all", "check_runs")
        for run in runs:
            # APIを要求したSHAとcheck自体のSHAの双方を保存・照合する。
            if run["head_sha"] != commit:
                raise CollectionError("check run SHA mismatch")
            metadata["checks"].append(
                {
                    "kind": "check_run",
                    "name": run["name"],
                    "app_id": run["app"]["id"],
                    "id": run["id"],
                    "sha": commit,
                    "status": run["status"],
                    "conclusion": run["conclusion"],
                }
            )
        for status in api.pages(f"/commits/{commit}/statuses"):
            metadata["checks"].append(
                {
                    "kind": "status",
                    "name": status["context"],
                    "creator": status["creator"]["login"],
                    "id": status["id"],
                    "sha": commit,
                    "status": "pending"
                    if status["state"] == "pending"
                    else "completed",
                    "conclusion": status["state"],
                }
            )
    for key in ("reviews", "checks"):
        metadata[key].sort(key=lambda item: json.dumps(item, sort_keys=True))
    return metadata


def stamp_current_run(facts: dict, api: GitHub) -> None:
    raw_id = os.environ.get("GITHUB_RUN_ID")
    raw_attempt = os.environ.get("GITHUB_RUN_ATTEMPT")
    if raw_id:
        facts["run_id"] = int(raw_id)
    if raw_attempt:
        facts["run_attempt"] = int(raw_attempt)
    if not raw_id:
        return
    request = getattr(api, "request", None)
    prefix = getattr(api, "prefix", f"/repos/{api.repository}")
    if not callable(request):
        return
    try:
        run = request(f"{prefix}/actions/runs/{int(raw_id)}")
    except CollectionError:
        return
    if isinstance(run, dict):
        started = run.get("run_started_at") or run.get("created_at")
        if started:
            facts["run_started_at"] = started


def collect(api: GitHub, number: int, evaluator_sha: str) -> dict:
    facts = {
        "schema_version": 2,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "repository": api.repository,
        "evaluator_sha": evaluator_sha,
        "collection_errors": [],
        "stable": False,
    }
    stamp_current_run(facts, api)
    try:
        before = normalized_pr(api.graphql(number, PR_FIELDS))
        facts["pr"] = before
        # RESTの旧pathも使い、workflowディレクトリ外へのrenameを取りこぼさない。
        # 同梱されるpatchやsource URLは参照・保存しない。
        files = []
        for raw in api.pages(f"/pulls/{number}/files"):
            previous = (
                string(raw["previous_filename"], "previous_filename")
                if raw["status"] == "renamed"
                else None
            )
            files.append(
                {
                    "path": string(raw["filename"], "filename"),
                    "previous_path": previous,
                    "changeType": "DELETED"
                    if raw["status"] == "removed"
                    else string(raw["status"], "file.status").upper(),
                    "additions": raw["additions"],
                    "deletions": raw["deletions"],
                }
            )
        if len({f["path"] for f in files}) != len(files):
            raise CollectionError("duplicate file metadata")
        facts["change"] = {
            "changed_files": len(files),
            "additions": sum(f["additions"] for f in files),
            "deletions": sum(f["deletions"] for f in files),
            "types": dict(Counter(f["changeType"] for f in files)),
            # APIで確定できない情報は、0や「通常ファイル」に置き換えない。
            "binary_files": None,
            "mode_changes": None,
        }
        facts["files"] = files
        # GitHub Actionsの共通規約。コードベース固有の重要pathは持たない。
        facts["ci_definition_changes"] = sorted(
            {
                path
                for file in files
                for path in (file["path"], file["previous_path"])
                if path is not None and path.startswith(".github/workflows/")
            }
        )
        if any(
            facts["change"][key] != before[key]
            for key in ("changed_files", "additions", "deletions")
        ):
            raise CollectionError("PR file totals mismatch")
        initial_metadata = decision_metadata(api, number, before)
        facts.update(initial_metadata)
        histories = {}
        for check in facts["checks"]:
            key = (
                check["sha"],
                check["kind"],
                check["name"],
                check.get("app_id", check.get("creator")),
            )
            histories.setdefault(key, []).append(check)
        facts["ci_history"] = [
            {
                "sha": key[0],
                "kind": key[1],
                "name": key[2],
                "producer": key[3],
                "records": len(checks),
                "failure_before_success": any(
                    c["conclusion"] in {"failure", "error", "timed_out"} for c in checks
                )
                and max(checks, key=lambda c: c["id"])["conclusion"] == "success",
            }
            for key, checks in histories.items()
        ]
        confirmed_metadata = decision_metadata(api, number, before)
        after = normalized_pr(api.graphql(number, PR_FIELDS))
        facts["rechecked"] = {
            "pr": before == after,
            **{
                key: initial_metadata[key] == confirmed_metadata[key]
                for key in initial_metadata
            },
        }
        facts["stable"] = all(facts["rechecked"].values())
        facts["observed_at"] = datetime.now(timezone.utc).isoformat()
    except (CollectionError, KeyError, TypeError, ValueError) as error:
        facts["collection_errors"].append(str(error))
    return facts


def targets(api: GitHub, event: dict, requested: int | None) -> list[int]:
    if requested is not None:
        if requested <= 0:
            raise CollectionError("PR number must be positive")
        return [requested]
    if "pull_request" in event:
        return [event["pull_request"]["number"]]
    # CI完了時も全open PRを再評価する。base更新・fork・同じheadを持つ複数PRに対応。
    # 古いworkflow_run payloadのSHAを、現在のPRのSHAとして使わない。
    # closeイベント失敗後も、管理ラベルが残る最近closedなPRを回収する。
    open_prs = [p["number"] for p in api.pages("/pulls?state=open")]
    recovered = labeled_closed_prs(api)
    return sorted({*open_prs, *recovered})


def labeled_closed_prs(api: GitHub) -> list[int]:
    found = []
    seen = set()
    prefix = getattr(api, "prefix", f"/repos/{api.repository}")
    for name in RECOVERY_LABELS:
        path = (
            f"{prefix}/issues?state=closed&labels={quote(name, safe='')}"
            "&sort=updated&direction=desc&per_page=100&page=1"
        )
        batch = api.request(path)
        if not isinstance(batch, list):
            raise CollectionError("invalid REST page")
        for item in batch:
            if not isinstance(item, dict) or "pull_request" not in item:
                continue
            number = item.get("number")
            if number in (None, "") or int(number) in seen:
                continue
            seen.add(int(number))
            found.append(int(number))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repository", default=os.environ.get("GITHUB_REPOSITORY"), required=False
    )
    parser.add_argument("--pr", type=int)
    parser.add_argument(
        "--event", type=Path, default=os.environ.get("GITHUB_EVENT_PATH")
    )
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evaluator-sha", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    failed = False
    try:
        policy = load_policy(args.policy)
        api = GitHub(args.repository)
        event = json.loads(args.event.read_text()) if args.event else {}
        numbers = targets(api, event, args.pr)
        for number in numbers:
            facts = collect(api, number, sha(args.evaluator_sha))
            result = assess(facts, policy)
            (args.output / f"pr-{number}.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            )
            summary.append(markdown(result))
            failed = failed or result["decision"] == "INSUFFICIENT_DATA"
        if not numbers:
            summary.append("評価対象のopen PRはありません。\n")
    except (CollectionError, OSError, KeyError, TypeError, ValueError) as error:
        failed = True
        # collection失敗も必ず今回のartifactへ保存する。
        result = {"decision": "INSUFFICIENT_DATA", "error": str(error)}
        (args.output / "collection-error.json").write_text(json.dumps(result) + "\n")
        summary.append(
            "INSUFFICIENT_DATA: <code>" + html.escape(str(error)) + "</code>\n"
        )
    (args.output / "summary.md").write_text("\n".join(summary))
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
