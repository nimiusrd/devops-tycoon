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
MAX_PUBLISH_MATRIX = 256
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
BROADCAST_EVENTS = {"schedule", "workflow_run"}
TARGETED_PR = re.compile(r"^shadow-pr-([1-9][0-9]*)$")
ACTIVE_RUNS = {
    "completed",
    "in_progress",
    "queued",
    "pending",
    "waiting",
    "requested",
}
LIVE_STATUSES = tuple(sorted(ACTIVE_RUNS - {"completed"}))

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


def rotate_prs(prs: list[int], offset: int = 0) -> list[int]:
    values = sorted({int(number) for number in prs})
    if not values:
        return []
    start = int(offset) % len(values)
    return values[start:] + values[:start]


def publish_matrix(prs: list[int], offset: int = 0) -> tuple[str, list[int]]:
    values = rotate_prs(prs, offset)
    return "per-pr", values[:MAX_PUBLISH_MATRIX]


def overflow_prs(prs: list[int], offset: int = 0) -> list[int]:
    values = rotate_prs(prs, offset)
    return values[MAX_PUBLISH_MATRIX : MAX_PUBLISH_MATRIX * 2]


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


def observed_run_started_at(report: dict) -> str | None:
    return (report.get("observations") or {}).get("run_started_at")


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


def _workflow_run_page(api: GitHub, path: str) -> list:
    result = api.request(path)
    if not isinstance(result, dict):
        raise PublishError("invalid REST page")
    batch = result.get("workflow_runs")
    if not isinstance(batch, list):
        raise PublishError("invalid REST page")
    return batch


def list_relevant_runs(api: GitHub, workflow: str, run_id: int) -> list:
    records = []
    seen = set()
    path = f"{api.prefix}/actions/workflows/{workflow}/runs"

    def add(batch: list) -> None:
        for item in batch:
            run = int(item["id"])
            if run in seen:
                continue
            seen.add(run)
            records.append(item)

    for status in LIVE_STATUSES:
        for page in range(1, MAX_PAGES + 1):
            batch = _workflow_run_page(
                api, f"{path}?status={status}&per_page=100&page={page}"
            )
            add(batch)
            if not batch or len(batch) < 100:
                break
        else:
            raise PublishError("REST pagination limit exceeded")

    for page in range(1, MAX_PAGES + 1):
        batch = _workflow_run_page(api, f"{path}?per_page=100&page={page}")
        add(batch)
        if not batch or len(batch) < 100:
            return records
    raise PublishError("REST pagination limit exceeded")


def list_recent_runs(
    api: GitHub,
    workflow: str,
    known: list | None = None,
    number: int | None = None,
    run_id: int | None = None,
    default_branch: str | None = None,
    pr_open: bool = True,
) -> list:
    records = {}
    path = f"{api.prefix}/actions/workflows/{workflow}/runs"

    def add(batch: list, replace: bool = False) -> None:
        for item in batch:
            if not isinstance(item, dict) or item.get("id") is None:
                continue
            run = int(item["id"])
            if run in records and not replace:
                continue
            records[run] = item

    for status in LIVE_STATUSES:
        add(_workflow_run_page(api, f"{path}?status={status}&per_page=100&page=1"))
    add(_workflow_run_page(api, f"{path}?per_page=100&page=1"))
    if known:
        add(known)
        for item in known:
            if number is None or run_id is None:
                continue
            other = int(item["id"])
            if other == int(run_id) or item.get("status") == "completed":
                continue
            if not run_observed(item, default_branch):
                continue
            targets = run_declared_targets(item)
            if targets is not None and number not in targets:
                continue
            try:
                latest = api.request(f"{api.prefix}/actions/runs/{other}")
            except PublishError:
                raise
            if isinstance(latest, dict):
                add([latest], replace=True)
    return list(records.values())


def run_observed(run: dict, default_branch: str | None) -> bool:
    if run.get("conclusion") == "skipped":
        return False
    if run.get("event") != "push":
        return True
    return bool(default_branch) and run.get("head_branch") == default_branch


def run_declared_targets(run: dict) -> set[int] | None:
    title = str(run.get("display_title") or "").strip()
    named = TARGETED_PR.fullmatch(title)
    if named:
        return {int(named.group(1))}
    if title == "shadow-all":
        return None
    event = run.get("event")
    if event == "push" or event in BROADCAST_EVENTS:
        return None
    prs = {
        item.get("number")
        for item in run.get("pull_requests") or []
        if item.get("number")
    }
    if prs:
        return prs
    return set()


def run_targets_pr(
    run: dict,
    number: int,
    default_branch: str | None = None,
    pr_open: bool = True,
    api: GitHub | None = None,
) -> bool:
    if not run_observed(run, default_branch):
        return False
    targets = run_declared_targets(run)
    if targets is None:
        if pr_open or run.get("status") == "completed":
            return True
        return _broadcast_published_pr(run, api, number)
    return number in targets


def _broadcast_published_pr(
    run: dict, api: GitHub | None, number: int
) -> bool:
    jobs = run.get("jobs")
    if jobs is None and api is not None:
        try:
            jobs = api.pages(
                f"/actions/runs/{int(run['id'])}/jobs?filter=all", "jobs"
            )
        except (PublishError, KeyError, TypeError, ValueError):
            return True
    if not isinstance(jobs, list):
        return False
    return any(
        _is_publish_job(str(job.get("name") or ""), number)
        and job.get("conclusion") not in {None, "cancelled", "skipped"}
        for job in jobs
        if isinstance(job, dict)
    )


def _is_publish_job(name: str, number: int | None = None) -> bool:
    if name == "publish":
        return True
    if number is None:
        return name.startswith("publish (") or name.startswith("publish-overflow (")
    return name in {f"publish ({number})", f"publish-overflow ({number})"}


def run_published_labels(
    run: dict, api: GitHub | None = None, number: int | None = None
) -> bool:
    if run.get("status") != "completed":
        return True
    if run.get("conclusion") == "skipped":
        return False
    jobs = run.get("jobs")
    if jobs is None and api is not None:
        try:
            jobs = api.pages(
                f"/actions/runs/{int(run['id'])}/jobs?filter=all", "jobs"
            )
        except (PublishError, KeyError, TypeError, ValueError):
            return True
    if jobs is None:
        if run.get("conclusion") == "cancelled":
            return True
        return run_declared_targets(run) is not None
    if not isinstance(jobs, list):
        return True
    return any(
        _is_publish_job(str(job.get("name") or ""), number)
        and job.get("conclusion") not in {None, "cancelled", "skipped"}
        for job in jobs
        if isinstance(job, dict)
    )


def run_started_at(run: dict) -> datetime | None:
    raw = run.get("run_started_at") or run.get("created_at")
    if not raw:
        return None
    return parse_time(raw)


def current_started_at(
    runs: list,
    run_id: int,
    observed_at: str | None = None,
    recorded_started_at: str | None = None,
) -> datetime | None:
    started = parse_time(recorded_started_at) if recorded_started_at else None
    if started is None:
        for run in runs:
            if int(run["id"]) == int(run_id):
                started = run_started_at(run)
                break
    observed = parse_time(observed_at) if observed_at else None
    if started and observed:
        return min(started, observed)
    return started or observed


def has_newer_run(
    runs: list,
    number: int,
    run_id: int,
    run_attempt: int,
    default_branch: str | None = None,
    pr_open: bool = True,
    observed_at: str | None = None,
    api: GitHub | None = None,
    recorded_started_at: str | None = None,
    published_cache: dict | None = None,
) -> bool:
    current_started = current_started_at(
        runs, run_id, observed_at, recorded_started_at
    )
    current_key = (int(run_id), int(run_attempt))
    cache = published_cache if published_cache is not None else {}
    for run in runs:
        if int(run["id"]) == int(run_id):
            continue
        if run.get("status") not in ACTIVE_RUNS:
            continue
        if not run_targets_pr(run, number, default_branch, pr_open, api):
            continue
        other_key = (int(run["id"]), int(run.get("run_attempt") or 1))
        other_started = run_started_at(run)
        if current_started is not None and other_started is not None:
            if (other_started, *other_key) <= (current_started, *current_key):
                continue
        elif other_key <= current_key:
            continue
        cache_key = (
            int(run["id"]),
            int(run.get("run_attempt") or 1),
            str(run.get("status") or ""),
            str(run.get("conclusion") or ""),
            int(number),
        )
        if cache_key not in cache:
            cache[cache_key] = run_published_labels(run, api, number)
        if cache[cache_key]:
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
    api: GitHub | None = None,
    published_cache: dict | None = None,
) -> str | None:
    facts = observed_pr(report)
    if (report.get("observations") or {}) and not observed_run_started_at(report):
        return "missing_run_started_at"
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
        api,
        observed_run_started_at(report),
        published_cache,
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
            try:
                api.request(
                    f"{api.prefix}/labels",
                    {
                        "name": name,
                        "color": LABEL_COLORS[name],
                        "description": LABEL_DESCRIPTIONS[name],
                    },
                )
            except PublishError as created:
                if "HTTP 422" not in str(created):
                    raise
                api.request(path)


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

    def refresh() -> list[str]:
        pull = api.request(f"{api.prefix}/pulls/{number}")
        if not isinstance(pull, dict):
            return names
        labels = pull.get("labels")
        if not isinstance(labels, list):
            return names
        names[:] = [
            item["name"]
            for item in labels
            if isinstance(item, dict) and item.get("name")
        ]
        return names

    def extras_of(latest: list[str]) -> list[str]:
        return [name for name in latest if name in MANAGED_LABELS and name != desired]

    def add_desired() -> str | None:
        reason = guard()
        if reason:
            return reason
        api.request(f"{api.prefix}/issues/{number}/labels", {"labels": [desired]})
        writes.append(f"add:{desired}")
        if desired not in names:
            names.append(desired)
        return None

    def remove_extras(latest: list[str]) -> str | None:
        for name in extras_of(latest):
            reason = guard()
            if reason:
                return reason
            try:
                api.request(
                    f"{api.prefix}/issues/{number}/labels/{encoded_label(name)}",
                    method="DELETE",
                )
            except PublishError as error:
                if "HTTP 404" not in str(error):
                    raise
            writes.append(f"remove:{name}")
            names[:] = [item for item in names if item != name]
        return None

    for _ in range(6):
        latest = refresh()
        if desired not in latest:
            reason = add_desired()
            if reason:
                return writes, reason
            continue
        if not extras_of(latest):
            return writes, None
        reason = remove_extras(latest)
        if reason:
            return writes, reason
    latest = refresh()
    if desired not in latest:
        reason = add_desired()
        if reason:
            return writes, reason
        latest = refresh()
    reason = remove_extras(latest)
    if reason:
        return writes, reason
    latest = refresh()
    if desired not in latest:
        reason = add_desired()
        if reason:
            return writes, reason
        latest = refresh()
        reason = remove_extras(latest)
        if reason:
            return writes, reason
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
    published_cache: dict | None = None,
    prepare_labels: bool = True,
) -> str:
    def current_runs() -> list:
        return (
            runs
            if runs is not None
            else list_relevant_runs(api, workflow, run_id)
        )

    cache = published_cache if published_cache is not None else {}
    current = snapshot(api, number)
    reason = skip_reason(
        report,
        current,
        current_runs(),
        run_id,
        run_attempt,
        incumbent,
        default_branch,
        api,
        cache,
    )
    if reason:
        return f"skipped:{reason}"
    desired = desired_label(report)
    if prepare_labels:
        ensure_labels(api)
    current = snapshot(api, number)
    reason = skip_reason(
        report,
        current,
        current_runs(),
        run_id,
        run_attempt,
        incumbent,
        default_branch,
        api,
        cache,
    )
    if reason:
        return f"skipped:{reason}"

    def before_write() -> str | None:
        latest = snapshot(api, number)
        return skip_reason(
            report,
            latest,
            list_recent_runs(
                api,
                workflow,
                current_runs(),
                number,
                run_id,
                default_branch,
                current_pr_state(latest) == "OPEN",
            ),
            run_id,
            run_attempt,
            incumbent,
            default_branch,
            api,
            cache,
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
    parser.add_argument("--report-dir", type=Path)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--run-attempt", type=int)
    parser.add_argument("--run-url")
    parser.add_argument("--export-runs", type=Path)
    parser.add_argument("--runs-file", type=Path)
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
    parser.add_argument("--pr", type=int)
    parser.add_argument("--shard", type=int)
    parser.add_argument("--shard-count", type=int, default=MAX_PUBLISH_MATRIX)
    parser.add_argument("--only-prs")
    args = parser.parse_args()
    if args.export_runs:
        try:
            api = GitHub(args.repository)
            runs = list_relevant_runs(api, args.workflow, args.run_id)
            args.export_runs.parent.mkdir(parents=True, exist_ok=True)
            args.export_runs.write_text(json.dumps(runs) + "\n")
        except (PublishError, OSError, KeyError, TypeError, ValueError) as error:
            print(str(error), flush=True)
            return 1
        return 0
    if args.report_dir is None or not args.report_dir.is_dir():
        return 0
    if args.run_attempt is None or not args.run_url:
        return 1
    event = json.loads(args.event.read_text()) if args.event else {}
    reports = load_reports(args.report_dir, event)
    if args.pr is not None:
        reports = [item for item in reports if item[0] == args.pr]
    if args.shard is not None:
        count = args.shard_count or MAX_PUBLISH_MATRIX
        reports = [item for item in reports if item[0] % count == args.shard]
    if args.only_prs:
        allowed = {int(number) for number in json.loads(args.only_prs)}
        reports = [item for item in reports if item[0] in allowed]
    if not reports:
        return 0
    failed = False
    try:
        api = GitHub(args.repository)
        if args.runs_file:
            loaded = json.loads(args.runs_file.read_text())
            if not isinstance(loaded, list):
                raise PublishError("invalid runs file")
            runs = loaded
        else:
            runs = list_relevant_runs(api, args.workflow, args.run_id)
        ensure_labels(api)
        published_cache: dict = {}
        for number, report in reports:
            try:
                publish_pr(
                    api,
                    number,
                    report,
                    args.run_id,
                    args.run_attempt,
                    runs,
                    workflow=args.workflow,
                    default_branch=args.default_branch,
                    published_cache=published_cache,
                    prepare_labels=False,
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
