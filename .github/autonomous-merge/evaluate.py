#!/usr/bin/env python3
"""正規化したGit/PR/CIの観測事実に、明示的なShadow条件を適用する。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import tomllib
from pathlib import Path
from typing import Any


class EvaluationError(ValueError):
    """欠落・不正なデータを成功として扱わない。"""


def integer(value: Any, name: str) -> int:
    if type(value) is not int or value < 0:
        raise EvaluationError(f"{name}: non-negative integer required")
    return value


def string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvaluationError(f"{name}: non-empty string required")
    return value


def boolean(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise EvaluationError(f"{name}: boolean required")
    return value


def sha(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise EvaluationError("invalid commit SHA")
    return value


def validate_policy(policy: dict) -> dict:
    if policy.get("version") != 2 or policy.get("mode") != "shadow":
        raise EvaluationError("version=2 / mode=shadow required")
    integer(policy["minimum_approvals"], "minimum_approvals")
    boolean(policy["require_resolved_threads"], "require_resolved_threads")
    checks = policy["required_checks"]
    if not isinstance(checks, list) or not checks:
        raise EvaluationError(
            "required_checks must explicitly contain at least one check"
        )
    identities = set()
    for check in checks:
        name = string(check["name"], "check.name")
        kind = check["kind"]
        if kind == "check_run":
            producer = integer(check["app_id"], "check.app_id")
            if producer == 0:
                raise EvaluationError("app_id must be positive")
        elif kind == "status":
            producer = string(check["creator"], "check.creator")
        else:
            raise EvaluationError("unknown check kind")
        identity = (kind, name, producer)
        if identity in identities:
            raise EvaluationError("duplicate required check")
        identities.add(identity)
    return policy


def load_policy(path: Path) -> dict:
    with path.open("rb") as stream:
        return validate_policy(tomllib.load(stream))


def check_identity(check: dict) -> tuple:
    kind = check["kind"]
    producer = check["app_id"] if kind == "check_run" else check["creator"]
    return kind, check["name"], producer


def assess(facts: dict, policy: dict) -> dict:
    """欠落はINSUFFICIENT_DATA。規模やソース内容は必須条件を相殺しない。"""
    validate_policy(policy)
    result = {
        "schema_version": 2,
        "mode": "shadow",
        "decision": "INSUFFICIENT_DATA",
        "conditions": [],
        "observations": facts,
        "policy": policy,
        "policy_sha256": hashlib.sha256(
            json.dumps(policy, sort_keys=True).encode()
        ).hexdigest(),
    }

    def condition(name: str, status: str, detail: Any) -> None:
        result["conditions"].append({"name": name, "status": status, "detail": detail})

    try:
        if facts["schema_version"] != 2:
            raise EvaluationError("unsupported facts schema")
        string(facts["observed_at"], "observed_at")
        if facts["collection_errors"]:
            raise EvaluationError(
                "collection incomplete: " + ", ".join(facts["collection_errors"])
            )
        pr = facts["pr"]
        head = sha(pr["head_sha"])
        sha(pr["base_sha"])
        if pr["merge_sha"] is not None:
            sha(pr["merge_sha"])
        if not boolean(facts["stable"], "stable"):
            condition(
                "freshness",
                "unknown",
                "PR, CI or reviews changed between samples; recollect",
            )
        else:
            condition("freshness", "pass", "PR, CI and reviews agree in both samples")
        if pr["state"] not in {"OPEN", "CLOSED", "MERGED"}:
            raise EvaluationError("unknown PR state")
        condition(
            "open_pr", "pass" if pr["state"] == "OPEN" else "blocked", pr["state"]
        )
        condition(
            "ready_for_review",
            "waiting" if boolean(pr["draft"], "draft") else "pass",
            pr["draft"],
        )
        mergeable = pr["mergeable"]
        if mergeable not in {"MERGEABLE", "CONFLICTING", "UNKNOWN"}:
            raise EvaluationError("unknown mergeable value")
        condition(
            "mergeable",
            {"MERGEABLE": "pass", "CONFLICTING": "blocked", "UNKNOWN": "waiting"}[
                mergeable
            ],
            mergeable,
        )
        review_decision = pr["review_decision"]
        if review_decision not in {
            None,
            "APPROVED",
            "CHANGES_REQUESTED",
            "REVIEW_REQUIRED",
        }:
            raise EvaluationError("unknown review decision")
        condition(
            "github_review",
            "blocked"
            if review_decision == "CHANGES_REQUESTED"
            else "waiting"
            if review_decision == "REVIEW_REQUIRED"
            else "pass",
            review_decision,
        )

        reviews = facts["reviews"]
        # 下書きの作成IDより投稿時刻を優先する。コメントだけでは判断を上書きしない。
        latest = {}
        published = [r for r in reviews if r["state"] != "PENDING"]
        for review in sorted(
            published,
            key=lambda r: (
                string(r["submitted_at"], "review.submitted_at"),
                integer(r["id"], "review.id"),
            ),
        ):
            state = review["state"]
            if state not in {"APPROVED", "CHANGES_REQUESTED", "DISMISSED", "COMMENTED"}:
                raise EvaluationError("unknown review state")
            if state in {"APPROVED", "CHANGES_REQUESTED", "DISMISSED"}:
                latest[string(review["author"], "review.author")] = review
        changes = [
            r["id"] for r in latest.values() if r["state"] == "CHANGES_REQUESTED"
        ]
        condition("change_requests", "blocked" if changes else "pass", changes)
        approvals = sum(
            r["state"] == "APPROVED" and r["commit_sha"] == head
            for r in latest.values()
        )
        condition(
            "current_head_approvals",
            "pass" if approvals >= policy["minimum_approvals"] else "waiting",
            {"actual": approvals, "required": policy["minimum_approvals"]},
        )
        unresolved = integer(facts["unresolved_threads"], "unresolved_threads")
        condition(
            "review_threads",
            "blocked" if policy["require_resolved_threads"] and unresolved else "pass",
            unresolved,
        )

        checks = facts["checks"]
        for required in policy["required_checks"]:
            identity = check_identity(required)
            matching = [
                c
                for c in checks
                if check_identity(c) == identity and c["sha"] in {head, pr["merge_sha"]}
            ]
            # 現在のtest mergeに同名checkがあればそちらを優先し、head成功へ逃がさない。
            merged = [
                c
                for c in matching
                if pr["merge_sha"] is not None and c["sha"] == pr["merge_sha"]
            ]
            matching = merged or [c for c in matching if c["sha"] == head]
            label = "required_check:" + required["name"]
            if not matching:
                condition(label, "waiting", {"reason": "missing", "identity": identity})
                continue
            current = max(matching, key=lambda c: integer(c["id"], "check.id"))
            if current["status"] in {
                "queued",
                "in_progress",
                "pending",
                "requested",
                "waiting",
            }:
                state = "waiting"
            elif (
                current["status"] == "completed" and current["conclusion"] == "success"
            ):
                state = "pass"
            else:
                # neutral/skippedは実行成功と混同しない。
                state = "blocked"
            condition(label, state, current)

        # BLOCKEDは原因を列挙しない集約値。明示的な待機条件があれば、
        # その完了後に再評価する。CI失敗・変更要求などのblockedは引き続き優先する。
        merge_state = pr["merge_state"]
        has_waiting_condition = any(
            c["status"] == "waiting" for c in result["conditions"]
        )
        status = (
            "pass"
            if merge_state == "CLEAN"
            else "waiting"
            if merge_state in {"UNKNOWN", "BEHIND", "DRAFT"}
            or (merge_state == "BLOCKED" and has_waiting_condition)
            else "blocked"
        )
        condition("github_merge_state", status, merge_state)

        # サイズと変更形態は観測のみ。テスト差分、パス、作者から安全性を推測しない。
        for key in ("additions", "deletions", "changed_files"):
            integer(facts["change"][key], key)
        states = {c["status"] for c in result["conditions"]}
        result["decision"] = (
            "INSUFFICIENT_DATA"
            if "unknown" in states
            else "HUMAN_REVIEW_REQUIRED"
            if "blocked" in states
            else "WAITING"
            if "waiting" in states
            else "SHADOW_CONDITIONS_MET"
        )
    except (KeyError, TypeError, ValueError) as error:
        condition("data_integrity", "unknown", str(error))
    return result


def markdown(result: dict) -> str:
    def safe(value: Any) -> str:
        return "<code>" + html.escape(json.dumps(value, ensure_ascii=False)) + "</code>"

    facts = result["observations"]
    lines = [
        "## Autonomous Merge Shadow",
        "",
        "観測時点の仮判定です。マージ許可・安全性の証明には使用しません。",
        "",
        "判定: " + safe(result["decision"]),
        "",
        "観測時刻: " + safe(facts.get("observed_at")),
        "",
        "対象: " + safe(facts.get("pr")),
        "",
        "変更量・形態（判定には加点しない）: " + safe(facts.get("change")),
        "",
        "CI履歴（不安定さの原因は推測しない）: " + safe(facts.get("ci_history")),
        "",
        "評価器: " + safe(facts.get("evaluator_sha")),
        "",
        "Policy SHA-256: " + safe(result["policy_sha256"]),
        "",
    ]
    for item in result["conditions"]:
        lines.append("- " + safe(item))
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--facts", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args()
    result = assess(json.loads(args.facts.read_text()), load_policy(args.policy))
    print(
        markdown(result)
        if args.format == "markdown"
        else json.dumps(result, ensure_ascii=False, indent=2)
    )


if __name__ == "__main__":
    main()
