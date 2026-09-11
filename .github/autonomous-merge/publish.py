#!/usr/bin/env python3
"""観測結果をPRラベルへ反映する。判定の再計算はしない。"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

MAX_PAGES = 30
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
BROADCAST_EVENTS = {"schedule", "workflow_run"}
TARGETED_PR = re.compile(r"shadow-pr-(\d+)")
IGNORED_CONCLUSIONS = {"cancelled", "skipped"}
ACTIVE_RUNS = {
    "completed",
    "in_progress",
    "queued",
    "pending",
    "waiting",
    "requested",
}

DECISION_LABELS = {
    "SHADOW_CONDITIONS_MET": "shadow/要マージ判断",
    "WAITING": "shadow/CI・レビュー待ち",
    "HUMAN_REVIEW_REQUIRED": "shadow/要対応",
    "INSUFFICIENT_DATA": "shadow/再観測が必要",
}
MANAGED_LABELS = set(DECISION_LABELS.values())
LABEL_COLORS = {
    "shadow/要マージ判断": "0E8A16",
    "shadow/CI・レビュー待ち": "FBCA04",
    "shadow/要対応": "D93F0B",
    "shadow/再観測が必要": "BFD4F2",
}
LABEL_DESCRIPTIONS = {
    "shadow/要マージ判断": (
        "直近のShadow観測。自動マージ許可ではない。"
        "人がマージ可否を判断する。詳細はActionsの最新Shadow run。"
    ),
    "shadow/CI・レビュー待ち": (
        "直近のShadow観測。CI完了・Draft解除・承認・base追随などを待つ。"
        "詳細はActionsの最新Shadow run。"
    ),
    "shadow/要対応": (
        "直近のShadow観測。競合・CI失敗・変更要求・未解決スレッドなどを人が解消する。"
        "詳細はActionsの最新Shadow run。"
    ),
    "shadow/再観測が必要": (
        "直近のShadow観測が失敗または鮮度不足。再実行か次の定期観測を待つ。"
        "詳細はActionsの最新Shadow run。"
    ),
}


class PublishError(ValueError):
    """ラベル書き込みや対象PRの再取得失敗。観測JSONは変更しない。"""


class GitHub:
    def __init__(self, repository: str):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise PublishError("invalid repository")
        self.repository = repository
        self.prefix = f"/repos/{repository}"
        self.api_url = os.environ.get(
            "GITHUB_API_URL", "https://api.github.com"
        ).rstrip("/")

    def request(self, path: str, body: dict | None = None, method: str | None = None):
        headers = {
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "autonomous-merge-shadow-publisher",
        }
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        verb = method or ("POST" if body is not None else "GET")
        request = Request(
            self.api_url + path,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
            method=verb,
        )
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                raise PublishError("API response exceeds limit")
            if not data:
                return None
            return json.loads(data)
        except PublishError:
            raise
        except HTTPError as error:
            raise PublishError(f"API {verb} {path}: HTTP {error.code}") from None
        except (URLError, TimeoutError, OSError, ValueError) as error:
            raise PublishError(f"API {verb} {path}: {type(error).__name__}") from None

    def pages(self, path: str, key: str | None = None) -> list:
        records = []
        separator = "&" if "?" in path else "?"
        for page in range(1, MAX_PAGES + 1):
            result = self.request(
                f"{self.prefix}{path}{separator}per_page=100&page={page}"
            )
            batch = result[key] if key else result
            if not isinstance(batch, list):
                raise PublishError("invalid REST page")
            records.extend(batch)
            if len(batch) < 100:
                if key and result.get("total_count") != len(records):
                    raise PublishError("REST collection count mismatch")
                return records
        raise PublishError("REST pagination limit exceeded")


def encoded_label(name: str) -> str:
    return quote(name, safe="")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def receipt(observed_at: str, run_id: int, run_attempt: int) -> tuple:
    return (parse_time(observed_at), int(run_id), int(run_attempt))


def is_fresher(candidate: dict, incumbent: dict | None) -> bool:
    if incumbent is None:
        return True
    return receipt(
        candidate["observed_at"], candidate["run_id"], candidate["run_attempt"]
    ) > receipt(incumbent["observed_at"], incumbent["run_id"], incumbent["run_attempt"])


def event_pr(event: dict) -> int | None:
    if "pull_request" in event:
        return int(event["pull_request"]["number"])
    raw = (event.get("inputs") or {}).get("pr_number")
    if raw in (None, ""):
        return None
    return int(raw)


def load_reports(directory: Path, event: dict) -> list[tuple[int, dict]]:
    reports = []
    seen = set()
    for path in sorted(directory.glob("pr-*.json")):
        number = int(path.stem.split("-", 1)[1])
        reports.append((number, json.loads(path.read_text())))
        seen.add(number)
    error_path = directory / "collection-error.json"
    if error_path.exists():
        known = event_pr(event)
        if known is not None and known not in seen:
            reports.append((known, json.loads(error_path.read_text())))
    return reports


def observed_pr(report: dict) -> dict:
    return (report.get("observations") or {}).get("pr") or {}


def observed_at(report: dict) -> str | None:
    return (report.get("observations") or {}).get("observed_at")


def snapshot(api: GitHub, number: int) -> dict:
    pull = api.request(f"{api.prefix}/pulls/{number}")
    if not isinstance(pull, dict):
        raise PublishError("invalid pull request")
    return {
        "number": number,
        "head_sha": pull["head"]["sha"],
        "base_sha": pull["base"]["sha"],
        "base_ref": pull["base"]["ref"],
        "state": pull["state"],
        "merged": bool(pull.get("merged")),
        "draft": bool(pull.get("draft")),
        "labels": [item["name"] for item in pull.get("labels") or []],
    }


def current_pr_state(current: dict) -> str:
    if current.get("merged"):
        return "MERGED"
    return str(current.get("state") or "").upper()


def list_relevant_runs(api: GitHub, workflow: str, run_id: int) -> list:
    records = []
    current = int(run_id)
    path = f"{api.prefix}/actions/workflows/{workflow}/runs"
    for page in range(1, MAX_PAGES + 1):
        result = api.request(f"{path}?per_page=100&page={page}")
        if not isinstance(result, dict):
            raise PublishError("invalid REST page")
        batch = result.get("workflow_runs")
        if not isinstance(batch, list):
            raise PublishError("invalid REST page")
        records.extend(batch)
        if not batch or len(batch) < 100:
            return records
        if min(int(item["id"]) for item in batch) <= current:
            return records
    return records


def run_observed(run: dict, default_branch: str | None) -> bool:
    if run.get("conclusion") in IGNORED_CONCLUSIONS:
        return False
    if run.get("event") != "push":
        return True
    return bool(default_branch) and run.get("head_branch") == default_branch


def run_declared_targets(run: dict) -> set[int] | None:
    title = str(run.get("display_title") or "")
    named = TARGETED_PR.search(title)
    if named:
        return {int(named.group(1))}
    if "shadow-all" in title:
        return None
    prs = {
        item.get("number")
        for item in run.get("pull_requests") or []
        if item.get("number")
    }
    if prs:
        return prs
    event = run.get("event")
    if event == "push" or event in BROADCAST_EVENTS:
        return None
    return set()


def run_targets_pr(
    run: dict,
    number: int,
    default_branch: str | None = None,
    pr_open: bool = True,
) -> bool:
    if not run_observed(run, default_branch):
        return False
    targets = run_declared_targets(run)
    if targets is None:
        return pr_open
    return number in targets


def run_started_at(run: dict) -> datetime | None:
    raw = run.get("run_started_at") or run.get("created_at")
    if not raw:
        return None
    return parse_time(raw)


def current_started_at(
    runs: list,
    run_id: int,
    observed_at: str | None = None,
) -> datetime | None:
    for run in runs:
        if int(run["id"]) == int(run_id):
            started = run_started_at(run)
            if started is not None:
                return started
            break
    return parse_time(observed_at) if observed_at else None


def has_newer_run(
    runs: list,
    number: int,
    run_id: int,
    run_attempt: int,
    default_branch: str | None = None,
    pr_open: bool = True,
    observed_at: str | None = None,
) -> bool:
    current_started = current_started_at(runs, run_id, observed_at)
    current_key = (int(run_id), int(run_attempt))
    for run in runs:
        if run.get("status") not in ACTIVE_RUNS:
            continue
        if not run_targets_pr(run, number, default_branch, pr_open):
            continue
        other_key = (int(run["id"]), int(run.get("run_attempt") or 1))
        other_started = run_started_at(run)
        if current_started is not None and other_started is not None:
            if (other_started, *other_key) > (current_started, *current_key):
                return True
            continue
        if other_key > current_key:
            return True
    return False


def skip_reason(
    report: dict,
    current: dict,
    runs: list,
    run_id: int,
    run_attempt: int,
    incumbent: dict | None = None,
    default_branch: str | None = None,
) -> str | None:
    facts = observed_pr(report)
    if facts.get("head_sha") and facts["head_sha"] != current["head_sha"]:
        return "stale_sha"
    if facts.get("base_sha") and facts["base_sha"] != current["base_sha"]:
        return "stale_sha"
    if facts.get("state") and facts["state"].upper() != current_pr_state(current):
        return "stale_pr_state"
    if "draft" in facts and bool(facts["draft"]) != bool(current.get("draft")):
        return "stale_pr_state"
    if facts.get("base_ref") and facts["base_ref"] != current.get("base_ref"):
        return "stale_pr_state"
    if has_newer_run(
        runs,
        current["number"],
        run_id,
        run_attempt,
        default_branch,
        current_pr_state(current) == "OPEN",
        observed_at(report),
    ):
        return "newer_run"
    stamp = observed_at(report)
    if stamp and incumbent is not None:
        candidate = {
            "observed_at": stamp,
            "run_id": run_id,
            "run_attempt": run_attempt,
        }
        if not is_fresher(candidate, incumbent):
            return "stale_receipt"
    return None


def desired_label(report: dict) -> str:
    decision = report.get("decision")
    if decision not in DECISION_LABELS:
        raise PublishError(f"unknown decision: {decision}")
    return DECISION_LABELS[decision]


def ensure_labels(api: GitHub) -> None:
    for name in DECISION_LABELS.values():
        path = f"{api.prefix}/labels/{encoded_label(name)}"
        try:
            api.request(path)
        except PublishError as error:
            if "HTTP 404" not in str(error):
                raise
            api.request(
                f"{api.prefix}/labels",
                {
                    "name": name,
                    "color": LABEL_COLORS[name],
                    "description": LABEL_DESCRIPTIONS[name],
                },
            )


def sync_labels(
    api: GitHub,
    number: int,
    current_names: list[str],
    desired: str,
    before_write=None,
) -> tuple[list[str], str | None]:
    writes = []
    names = list(current_names)

    def guard() -> str | None:
        if before_write is None or writes:
            return None
        return before_write()

    if desired not in names:
        reason = guard()
        if reason:
            return writes, reason
        api.request(f"{api.prefix}/issues/{number}/labels", {"labels": [desired]})
        writes.append(f"add:{desired}")
        names.append(desired)
    for name in names:
        if name in MANAGED_LABELS and name != desired:
            reason = guard()
            if reason:
                return writes, reason
            try:
                api.request(
                    f"{api.prefix}/issues/{number}/labels/{encoded_label(name)}",
                    method="DELETE",
                )
            except PublishError as error:
                if "HTTP 404" not in str(error):
                    raise
            writes.append(f"remove:{name}")
    return writes, None


def publish_pr(
    api: GitHub,
    number: int,
    report: dict,
    run_id: int,
    run_attempt: int,
    runs: list | None = None,
    incumbent: dict | None = None,
    workflow: str = "autonomous-merge-shadow.yml",
    default_branch: str | None = None,
) -> str:
    def current_runs() -> list:
        return (
            runs
            if runs is not None
            else list_relevant_runs(api, workflow, run_id)
        )

    current = snapshot(api, number)
    reason = skip_reason(
        report, current, current_runs(), run_id, run_attempt, incumbent, default_branch
    )
    if reason:
        return f"skipped:{reason}"
    desired = desired_label(report)
    ensure_labels(api)
    current = snapshot(api, number)
    reason = skip_reason(
        report, current, current_runs(), run_id, run_attempt, incumbent, default_branch
    )
    if reason:
        return f"skipped:{reason}"

    def before_write() -> str | None:
        latest = snapshot(api, number)
        return skip_reason(
            report,
            latest,
            current_runs(),
            run_id,
            run_attempt,
            incumbent,
            default_branch,
        )

    writes, reason = sync_labels(
        api, number, current["labels"], desired, before_write
    )
    if reason:
        return f"skipped:{reason}"
    return "unchanged" if not writes else "updated"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repository", default=os.environ.get("GITHUB_REPOSITORY"), required=False
    )
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--run-attempt", type=int, required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument(
        "--event", type=Path, default=os.environ.get("GITHUB_EVENT_PATH")
    )
    parser.add_argument(
        "--workflow",
        default="autonomous-merge-shadow.yml",
    )
    parser.add_argument(
        "--default-branch",
        default=os.environ.get("DEFAULT_BRANCH"),
    )
    args = parser.parse_args()
    if not args.report_dir.is_dir():
        return 0
    event = json.loads(args.event.read_text()) if args.event else {}
    reports = load_reports(args.report_dir, event)
    if not reports:
        return 0
    failed = False
    try:
        api = GitHub(args.repository)
        for number, report in reports:
            try:
                publish_pr(
                    api,
                    number,
                    report,
                    args.run_id,
                    args.run_attempt,
                    workflow=args.workflow,
                    default_branch=args.default_branch,
                )
            except (PublishError, KeyError, TypeError, ValueError) as error:
                failed = True
                print(f"PR #{number}: {error}", flush=True)
    except (PublishError, OSError, KeyError, TypeError, ValueError) as error:
        print(str(error), flush=True)
        return 1
    print(f"observation run: {args.run_url}", flush=True)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
