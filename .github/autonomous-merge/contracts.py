"""Shadow schema v2の共有契約。型注釈は実行時検証・欠落値の補完を行わない。

Observationsは収集失敗で途中までの辞書になるため、取得前の項目はNotRequired。
必須条件に使う欠落・不正値はassess内の既存検証で情報不足になる。
診断項目の欠落/null/空配列の意味はdocs/autonomous-merge-contracts.mdを参照。
"""

from __future__ import annotations

import re
from typing import Any, Literal, NotRequired, TypedDict

Decision = Literal[
    "SHADOW_CONDITIONS_MET", "WAITING", "HUMAN_REVIEW_REQUIRED", "INSUFFICIENT_DATA"
]
ConditionStatus = Literal["pass", "waiting", "blocked", "unknown"]


class RequiredCheckRun(TypedDict):
    kind: Literal["check_run"]
    name: str
    app_id: int


class RequiredStatus(TypedDict):
    kind: Literal["status"]
    name: str
    creator: str


RequiredCheck = RequiredCheckRun | RequiredStatus


class Policy(TypedDict):
    version: Literal[2]
    mode: Literal["shadow"]
    minimum_approvals: int
    require_resolved_threads: bool
    required_checks: list[RequiredCheck]


class PullRequest(TypedDict):
    number: int
    state: Literal["OPEN", "CLOSED", "MERGED"]
    draft: bool
    head_sha: str
    base_sha: str
    merge_sha: str | None
    mergeable: Literal["MERGEABLE", "CONFLICTING", "UNKNOWN"]
    merge_state: str
    review_decision: str | None
    base_ref: NotRequired[str]
    updated_at: NotRequired[str]
    additions: NotRequired[int]
    deletions: NotRequired[int]
    changed_files: NotRequired[int]


class CheckRun(RequiredCheckRun):
    id: int
    sha: str
    status: str
    conclusion: str | None


class CommitStatus(RequiredStatus):
    id: int
    sha: str
    status: str
    conclusion: str | None


Check = CheckRun | CommitStatus


class Review(TypedDict):
    id: int
    author: str | None
    state: str
    commit_sha: str | None
    submitted_at: str | None


class ChangeSize(TypedDict):
    additions: int
    deletions: int
    changed_files: int
    types: NotRequired[dict[str, int]]
    binary_files: NotRequired[int | None]
    mode_changes: NotRequired[int | None]


class ChangedFile(TypedDict):
    path: str
    previous_path: NotRequired[str | None]
    changeType: str
    additions: int
    deletions: int


class CIHistory(TypedDict):
    sha: str
    kind: str
    name: str
    producer: int | str
    records: int
    failure_before_success: bool


class ObservationChange(TypedDict):
    group: str
    identity: dict[str, Any] | None
    field: str
    before: Any
    after: Any


class DecisionMetadata(TypedDict):
    reviews: list[Review]
    unresolved_threads: int
    checks: list[Check]


class Observations(TypedDict):
    schema_version: Literal[2]
    observed_at: str
    repository: str
    evaluator_sha: str
    collection_errors: list[str]
    stable: bool
    pr: NotRequired[PullRequest]
    change: NotRequired[ChangeSize]
    files: NotRequired[list[ChangedFile]]
    reviews: NotRequired[list[Review]]
    unresolved_threads: NotRequired[int]
    checks: NotRequired[list[Check]]
    ci_definition_changes: NotRequired[list[str]]
    ci_history: NotRequired[list[CIHistory]]
    rechecked: NotRequired[dict[str, bool]]
    observation_changes: NotRequired[list[ObservationChange] | None]


class Condition(TypedDict):
    name: str
    status: ConditionStatus
    # CI記録・件数・理由文など条件ごとに異なる。保存時にJSONへ変換する。
    detail: Any


class Assessment(TypedDict):
    schema_version: Literal[2]
    mode: Literal["shadow"]
    decision: Decision
    conditions: list[Condition]
    observations: Observations
    policy: Policy
    policy_sha256: str


class Manifest(TypedDict):
    version: Literal[1]
    repository: str
    run_id: str | None
    run_attempt: str | None
    started_at: str
    reports: list[int]
    collection_failed: bool


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
