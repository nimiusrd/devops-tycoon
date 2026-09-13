#!/usr/bin/env python3
"""観測結果への導線をneutral Checkとして公開する。評価・ラベル更新はしない。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from publish import DECISION_LABELS, GitHub, MAX_PAGES, PublishError

CHECK_PREFIX = "Autonomous Merge Shadow / PR #"
EXTERNAL_PREFIX = "shadow-v1"
ACTIONS_APP_ID = 15368


def timestamp(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise PublishError("timestamp must have a timezone")
    return result


def positive(value) -> int:
    if isinstance(value, bool) or not str(value).isdigit() or int(value) <= 0:
        raise PublishError("positive integer required")
    return int(value)


def snapshot(pr: dict) -> dict:
    return {
        "number": positive(pr["number"]),
        "head_sha": pr["head"]["sha"],
        "base_sha": pr["base"]["sha"],
        "base_ref": pr["base"]["ref"],
        "state": "MERGED" if pr.get("merged_at") else pr["state"].upper(),
        "draft": pr["draft"],
        "updated_at": pr["updated_at"],
    }


def code(value) -> str:
    return "<code>" + html.escape(str(value)) + "</code>"


def state_hash(current: dict) -> str:
    # タイトル・本文・コメントでも変わる時刻は、遅延イベントの失効判定に使わない。
    # 観測と公開直前の鮮度比較ではsnapshotのupdated_atを引き続き照合する。
    state = {key: value for key, value in current.items() if key != "updated_at"}
    return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()


def check_time(record: dict) -> datetime:
    return timestamp(record["external_id"].split(":", 2)[2].split("|", 1)[0])


def managed_checks(api: GitHub, number: int, head: str) -> list:
    """現在SHAの自分のCheckだけを読む。workflow/run履歴は走査しない。"""
    records = []
    name = CHECK_PREFIX + str(number)
    for page in range(1, MAX_PAGES + 1):
        result = api.request(
            f"{api.prefix}/commits/{head}/check-runs?filter=all"
            f"&check_name={quote(name, safe='')}&per_page=100&page={page}"
        )
        batch = result["check_runs"]
        if not isinstance(batch, list):
            raise PublishError("invalid Check page")
        records.extend(batch)
        if len(batch) < 100:
            if result["total_count"] != len(records):
                raise PublishError("Check collection count mismatch")
            break
    else:
        raise PublishError("Check pagination limit exceeded")
    return [
        record for record in records
        if record["name"] == name
        and record["head_sha"] == head
        and record["app"]["id"] == ACTIONS_APP_ID
        and (record.get("external_id") or "").startswith(
            f"{EXTERNAL_PREFIX}:{number}:"
        )
    ]


def write_check(api: GitHub, current: dict, at: str, title: str, summary: str,
                run_url: str) -> str:
    number = current["number"]
    incoming = timestamp(at)
    existing = managed_checks(api, number, current["head_sha"])
    # 一度だけ作成したCheckを更新する。異常な既存メタデータは黙って上書きしない。
    if existing:
        latest = max(existing, key=check_time)
        if check_time(latest) >= incoming and latest["external_id"].endswith("|" + state_hash(current)):
            return "newer_or_same_observation_kept"
        # 同じheadでもbase等が変わった場合は古い表示を失効させる。
        # その際にも時刻のwatermarkは戻さない。
        incoming = max(incoming, check_time(latest))
    else:
        latest = None
    # 一覧取得後にもPRを確認し、head/base更新との競合で誤った結果を書かない。
    confirmed = snapshot(api.request(f"{api.prefix}/pulls/{number}"))
    if current != confirmed:
        raise PublishError("PR changed before Check publication; recollect")
    body = {
        "name": CHECK_PREFIX + str(number),
        "status": "completed",
        "conclusion": "neutral",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "external_id": f"{EXTERNAL_PREFIX}:{number}:{incoming.isoformat()}|{state_hash(current)}",
        "details_url": run_url,
        "output": {
            "title": title,
            "summary": summary,
        },
    }
    if latest:
        api.request(f"{api.prefix}/check-runs/{latest['id']}", body, method="PATCH")
    else:
        api.request(f"{api.prefix}/check-runs", {**body, "head_sha": current["head_sha"]})
    return "published"


def heading(current: dict, run_url: str) -> str:
    return (
        "観測時点の参考表示です。自動マージ許可・必須CIではありません。\n\n"
        f"PR: #{current['number']} / 表示対象head: {code(current['head_sha'])}\n\n"
        f"現在のbase: {code(current['base_ref'])} {code(current['base_sha'])}\n\n"
        f"[このrun・attemptのSummaryとArtifacts]({run_url})\n\n"
    )


def publish_report(api: GitHub, number: int, report: dict, run_url: str,
                   artifact: str) -> str:
    decision = report["decision"]
    facts = report["observations"]
    observed = facts.get("pr") or {}
    if decision not in DECISION_LABELS or facts["repository"] != api.repository:
        raise PublishError("report decision or repository mismatch")
    if observed.get("number", number) != number:
        raise PublishError("report PR mismatch")
    at = facts["observed_at"]
    timestamp(at)
    current = snapshot(api.request(f"{api.prefix}/pulls/{number}"))
    agrees = all(observed.get(key) == value for key, value in current.items())
    old_head = bool(observed.get("head_sha") and observed["head_sha"] != current["head_sha"])
    if old_head:
        title = "未観測：古いSHAの記録（現在headは再観測が必要）"
    elif not agrees or decision == "INSUFFICIENT_DATA":
        title = "再観測が必要：INSUFFICIENT_DATA"
    else:
        title = "観測済み：" + decision
    summary = heading(current, run_url)
    if not agrees:
        summary += "保存した観測と公開時のPR状態が一致しません。以下は過去の記録です。\n\n"
    summary += (
        f"観測時刻: {code(at)}\n\n"
        f"観測head: {code(observed.get('head_sha'))}\n\n"
        f"観測base: {code(observed.get('base_sha'))}\n\n"
        f"評価器SHA: {code(facts.get('evaluator_sha'))}\n\n"
        f"Policy SHA-256: {code(report['policy_sha256'])}\n\n"
        f"保存した判定: {code(decision)}\n\n"
        f"Artifact: {code(artifact)} / {code(f'pr-{number}.json')}\n\n"
    )
    for condition in report["conditions"]:
        summary += "- " + code(json.dumps(condition, ensure_ascii=False)) + "\n"
    summary += "\n再観測はAutonomous Merge ShadowのRun workflowでPR番号を指定してください。\n"
    # GitHubのsummary上限に収め、詳細は完全なartifactへ誘導する。
    if len(summary.encode()) > 60000:
        summary = summary.encode()[:58000].decode("utf-8", errors="ignore")
        summary += "\n\n条件詳細は上記artifactを参照してください。\n"
    return write_check(api, current, at, title, summary, run_url)


def mark_event(api: GitHub, event: dict, run_url: str) -> list:
    candidates = []
    if "pull_request" in event:
        payload = event["pull_request"]
        # タイトル・本文だけの編集では失効させない。base編集はchangesで識別する。
        if event.get("action") == "edited" and "base" not in event.get("changes", {}):
            return []
        candidates = [payload]
        at = payload["updated_at"]
        expected = snapshot(payload)
        run = None
    elif "workflow_run" in event:
        payload = event["workflow_run"]
        # 特定のイベント元runだけを再取得。再実行の古いattemptや完了済み通知は無視。
        run = api.request(f"{api.prefix}/actions/runs/{positive(payload['id'])}")
        if run["status"] != "in_progress" or run["run_attempt"] != payload["run_attempt"]:
            return []
        at = run["run_started_at"]
        candidates = api.pages("/pulls?state=open")
        expected = None
    else:
        raise PublishError("unsupported marker event")
    timestamp(at)
    results = []
    for candidate in candidates:
        number = positive(candidate["number"])
        pr = api.request(f"{api.prefix}/pulls/{number}")
        current = snapshot(pr)
        if current["state"] != "OPEN":
            continue
        if expected and any(current[k] != expected[k] for k in current if k != "updated_at"):
            continue
        if run and run["head_sha"] not in {
            current["head_sha"], pr.get("merge_commit_sha"),
            current["base_sha"] if run["event"] == "push" else None,
        }:
            continue
        summary = heading(current, run_url) + (
            f"未観測イベント時刻: {code(at)}\n\n"
            "この表示では収集・評価を実行していません。CI完了後の観測、日次観測、"
            "または手動観測を待ってください。観測JSONはまだありません。\n"
        )
        results.append({"pr": number, "result": write_check(
            api, current, at, "未観測：CI完了・再観測待ち", summary, run_url,
        )})
    return results


def publish_directory(api: GitHub, directory: Path, run_id: str, attempt: str,
                      run_url: str, artifact: str) -> list:
    manifest = json.loads((directory / "manifest.json").read_text())
    if (manifest["version"] != 1 or manifest["repository"] != api.repository
            or manifest["run_id"] != run_id or manifest["run_attempt"] != attempt):
        raise PublishError("manifest repository/run/attempt mismatch")
    if manifest["collection_failed"] is not False:
        raise PublishError("global collection failure; no complete target list")
    numbers = manifest["reports"]
    if not isinstance(numbers, list) or len(set(numbers)) != len(numbers):
        raise PublishError("invalid manifest targets")
    results = []
    for value in numbers:
        number = positive(value)
        try:
            report = json.loads((directory / f"pr-{number}.json").read_text())
            result = publish_report(api, number, report, run_url, artifact)
            results.append({"pr": number, "result": result})
        except (PublishError, OSError, KeyError, TypeError, ValueError) as error:
            results.append({"pr": number, "error": str(error)})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--report-dir", type=Path)
    mode.add_argument("--event", type=Path)
    parser.add_argument("--artifact-name")
    args = parser.parse_args()
    try:
        api = GitHub(args.repository)
        run_id = str(positive(os.environ["GITHUB_RUN_ID"]))
        attempt = str(positive(os.environ["GITHUB_RUN_ATTEMPT"]))
        server = os.environ.get("GITHUB_SERVER_URL", "https://github.com").rstrip("/")
        run_url = f"{server}/{api.repository}/actions/runs/{run_id}/attempts/{attempt}"
        if args.event:
            results = mark_event(api, json.loads(args.event.read_text()), run_url)
        else:
            if not args.artifact_name or not args.artifact_name.endswith(f"-{run_id}-{attempt}"):
                raise PublishError("this run/attempt's artifact name is required")
            results = publish_directory(api, args.report_dir, run_id, attempt,
                                        run_url, args.artifact_name)
        for result in results:
            print(json.dumps(result, ensure_ascii=False))
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as output:
                output.write("## Shadow Check公開\n\n")
                for result in results:
                    output.write("- " + code(json.dumps(result, ensure_ascii=False)) + "\n")
                if not results:
                    output.write("更新対象なし（観測成功の検証には数えません）。\n")
        return int(any("error" in result for result in results))
    except (PublishError, OSError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
