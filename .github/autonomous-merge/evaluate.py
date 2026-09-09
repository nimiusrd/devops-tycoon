#!/usr/bin/env python3
"""PRの変更内容を決定論的に採点するAutonomous MergeのShadow Mode評価器。

このスクリプトはPRのコードを実行せず、base/headのチェックアウトに含まれる
ファイル内容だけを比較する。workflowからは必ずbase側のスクリプトとpolicyを
指定することで、PR自身の変更で評価ルールを弱められないようにする。
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import os
import re
import sys
import tomllib
from collections import Counter
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


class EvaluationError(ValueError):
    """入力されたpolicyまたはチェックアウトが評価できない場合のエラー。"""


@dataclass(frozen=True)
class ScoreBand:
    maximum: int
    risk: int


@dataclass(frozen=True)
class PathRule:
    pattern: str
    risk: int
    hard_gate: bool
    reason: str


@dataclass(frozen=True)
class SnapshotEntry:
    kind: str
    data: bytes


@dataclass(frozen=True)
class VerificationScope:
    name: str
    code_globs: tuple[str, ...]
    test_globs: tuple[str, ...]
    fallback: bool


@dataclass(frozen=True)
class Policy:
    version: int
    mode: str
    project_health: int
    minimum_project_health: int
    maximum_pr_risk: int
    maximum_path_risk: int
    missing_test_risk: int
    test_removal_risk: int
    line_bands: tuple[ScoreBand, ...]
    file_bands: tuple[ScoreBand, ...]
    code_globs: tuple[str, ...]
    test_globs: tuple[str, ...]
    verification_scopes: tuple[VerificationScope, ...]
    ignored_globs: tuple[str, ...]
    path_rules: tuple[PathRule, ...]


@dataclass(frozen=True)
class ChangedFile:
    path: str
    status: str
    additions: int
    deletions: int
    binary: bool
    gitlink: bool

    @property
    def changed_lines(self) -> int:
        return self.additions + self.deletions


@dataclass(frozen=True)
class PathAssessment:
    path: str
    risk: int
    hard_gate_reasons: tuple[str, ...]


@dataclass(frozen=True)
class RiskAssessment:
    decision: str
    project_health: int
    minimum_project_health: int
    risk: int
    maximum_pr_risk: int
    changed_files: int
    additions: int
    deletions: int
    line_risk: int
    file_risk: int
    path_risk: int
    verification_risk: int
    code_changes: bool
    test_changes: bool
    missing_test_scopes: tuple[str, ...]
    test_removal_risk: int
    hard_gate_reasons: tuple[str, ...]
    reasons: tuple[str, ...]
    files: tuple[ChangedFile, ...]
    path_assessments: tuple[PathAssessment, ...]
    base_sha: str | None
    head_sha: str | None


def _require_mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise EvaluationError(f"policyの{name}はテーブルで指定してください")
    return value


def _require_int(value: Any, name: str, *, minimum: int = 0, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise EvaluationError(f"policyの{name}は整数で指定してください")
    if value < minimum or (maximum is not None and value > maximum):
        upper = f"〜{maximum}" if maximum is not None else ""
        raise EvaluationError(f"policyの{name}は{minimum}{upper}の範囲で指定してください")
    return value


def _require_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvaluationError(f"policyの{name}は空でない文字列で指定してください")
    return value


def _require_string_list(value: Any, name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise EvaluationError(f"policyの{name}は文字列配列で指定してください")
    return tuple(value)


def _load_bands(value: Any, name: str) -> tuple[ScoreBand, ...]:
    if not isinstance(value, list) or not value:
        raise EvaluationError(f"policyの{name}は1件以上指定してください")

    bands: list[ScoreBand] = []
    previous_maximum = -1
    for index, raw_band in enumerate(value):
        band = _require_mapping(raw_band, f"{name}[{index}]")
        maximum = _require_int(band.get("maximum"), f"{name}[{index}].maximum")
        risk = _require_int(band.get("risk"), f"{name}[{index}].risk", maximum=100)
        if maximum <= previous_maximum:
            raise EvaluationError(f"policyの{name}はmaximumの昇順で指定してください")
        bands.append(ScoreBand(maximum=maximum, risk=risk))
        previous_maximum = maximum
    return tuple(bands)


def _load_path_rules(value: Any) -> tuple[PathRule, ...]:
    if not isinstance(value, list) or not value:
        raise EvaluationError("policyのpath_rulesは1件以上指定してください")

    rules: list[PathRule] = []
    for index, raw_rule in enumerate(value):
        rule = _require_mapping(raw_rule, f"path_rules[{index}]")
        hard_gate = rule.get("hard_gate")
        if not isinstance(hard_gate, bool):
            raise EvaluationError(
                f"path_rules[{index}].hard_gateは真偽値で指定してください"
            )
        rules.append(
            PathRule(
                pattern=_require_string(rule.get("pattern"), f"path_rules[{index}].pattern"),
                risk=_require_int(
                    rule.get("risk"),
                    f"path_rules[{index}].risk",
                    maximum=100,
                ),
                hard_gate=hard_gate,
                reason=_require_string(rule.get("reason"), f"path_rules[{index}].reason"),
            )
        )
    return tuple(rules)


def _load_verification_scopes(value: Any) -> tuple[VerificationScope, ...]:
    if not isinstance(value, list) or not value:
        raise EvaluationError("policyのverification.scopesは1件以上指定してください")

    scopes: list[VerificationScope] = []
    names: set[str] = set()
    for index, raw_scope in enumerate(value):
        scope = _require_mapping(raw_scope, f"verification.scopes[{index}]")
        name = _require_string(scope.get("name"), f"verification.scopes[{index}].name")
        if name in names:
            raise EvaluationError(f"policyのverification.scopesに重複したnameがあります: {name}")
        names.add(name)
        fallback = scope.get("fallback", False)
        if not isinstance(fallback, bool):
            raise EvaluationError(
                f"verification.scopes[{index}].fallbackは真偽値で指定してください"
            )
        scopes.append(
            VerificationScope(
                name=name,
                code_globs=_require_string_list(
                    scope.get("code_globs"),
                    f"verification.scopes[{index}].code_globs",
                ),
                test_globs=_require_string_list(
                    scope.get("test_globs"),
                    f"verification.scopes[{index}].test_globs",
                ),
                fallback=fallback,
            )
        )
    return tuple(scopes)


def load_policy(policy_path: Path) -> Policy:
    """TOML policyを読み込み、評価器が扱える型へ正規化する。"""

    try:
        with policy_path.open("rb") as policy_file:
            raw = tomllib.load(policy_file)
    except OSError as error:
        raise EvaluationError(f"policyを読み込めません: {policy_path}: {error}") from error
    except tomllib.TOMLDecodeError as error:
        raise EvaluationError(f"policyのTOMLが不正です: {policy_path}: {error}") from error

    project = _require_mapping(raw.get("project"), "project")
    scoring = _require_mapping(raw.get("scoring"), "scoring")
    verification = _require_mapping(raw.get("verification"), "verification")

    version = _require_int(raw.get("version"), "version", minimum=1)
    mode = _require_string(raw.get("mode"), "mode")
    project_health = _require_int(project.get("health"), "project.health", maximum=100)
    minimum_project_health = _require_int(
        project.get("minimum_health"),
        "project.minimum_health",
        maximum=100,
    )
    maximum_pr_risk = _require_int(
        scoring.get("maximum_pr_risk"),
        "scoring.maximum_pr_risk",
        maximum=100,
    )
    maximum_path_risk = _require_int(
        scoring.get("maximum_path_risk"),
        "scoring.maximum_path_risk",
        maximum=100,
    )
    missing_test_risk = _require_int(
        verification.get("missing_test_risk"),
        "verification.missing_test_risk",
        maximum=100,
    )
    test_removal_risk = _require_int(
        verification.get("test_removal_risk"),
        "verification.test_removal_risk",
        maximum=100,
    )

    return Policy(
        version=version,
        mode=mode,
        project_health=project_health,
        minimum_project_health=minimum_project_health,
        maximum_pr_risk=maximum_pr_risk,
        maximum_path_risk=maximum_path_risk,
        missing_test_risk=missing_test_risk,
        test_removal_risk=test_removal_risk,
        line_bands=_load_bands(scoring.get("line_bands"), "scoring.line_bands"),
        file_bands=_load_bands(scoring.get("file_bands"), "scoring.file_bands"),
        code_globs=_require_string_list(verification.get("code_globs"), "verification.code_globs"),
        test_globs=_require_string_list(verification.get("test_globs"), "verification.test_globs"),
        verification_scopes=_load_verification_scopes(verification.get("scopes")),
        ignored_globs=_require_string_list(
            verification.get("ignored_globs", []),
            "verification.ignored_globs",
        ),
        path_rules=_load_path_rules(raw.get("path_rules")),
    )


def _glob_regex(pattern: str) -> re.Pattern[str]:
    """パス区切りを意識したglobを正規表現へ変換する。

    fnmatchは`*`が`/`も跨ぐため、リポジトリの階層を意識したpolicyでは使わない。
    `**/`だけは0個以上のディレクトリにマッチさせ、`src/**/*.ts`が
    `src/main.ts`と`src/sim/engine.ts`の両方に一致するようにする。
    """

    parts: list[str] = ["^"]
    index = 0
    while index < len(pattern):
        character = pattern[index]
        if character == "*":
            if index + 1 < len(pattern) and pattern[index + 1] == "*":
                index += 2
                if index < len(pattern) and pattern[index] == "/":
                    parts.append("(?:.*/)?")
                    index += 1
                else:
                    parts.append(".*")
                continue
            parts.append("[^/]*")
        elif character == "?":
            parts.append("[^/]")
        else:
            parts.append(re.escape(character))
        index += 1
    parts.append("$")
    return re.compile("".join(parts))


@lru_cache(maxsize=256)
def _matches(path: str, pattern: str) -> bool:
    return _glob_regex(pattern).match(path) is not None


def matches_any(path: str, patterns: Iterable[str]) -> bool:
    return any(_matches(path, pattern) for pattern in patterns)


MAX_DIFF_BYTES = 1_000_000
MAX_DIFF_LINES = 4_000
CONSERVATIVE_LINE_RISK_LINES = 401
MAX_SNAPSHOT_FILE_BYTES = 8_000_000
MAX_SNAPSHOT_TOTAL_BYTES = 64_000_000


def _read_gitlinks(manifest_path: Path | None) -> dict[str, SnapshotEntry]:
    if manifest_path is None:
        return {}
    try:
        contents = manifest_path.read_text(encoding="utf-8")
    except OSError as error:
        raise EvaluationError(f"gitlink manifestを読み込めません: {manifest_path}: {error}") from error

    gitlinks: dict[str, SnapshotEntry] = {}
    for line_number, line in enumerate(contents.splitlines(), start=1):
        try:
            object_id, relative_path = line.split("\t", 1)
        except ValueError as error:
            raise EvaluationError(
                f"gitlink manifestの{line_number}行目が不正です: {manifest_path}"
            ) from error
        if not re.fullmatch(r"[0-9a-f]{40,64}", object_id) or not relative_path:
            raise EvaluationError(
                f"gitlink manifestの{line_number}行目が不正です: {manifest_path}"
            )
        gitlinks[relative_path] = SnapshotEntry("gitlink", object_id.encode("ascii"))
    return gitlinks


def _read_snapshot(root: Path, gitlinks_path: Path | None = None) -> dict[str, SnapshotEntry]:
    if not root.is_dir():
        raise EvaluationError(f"チェックアウトディレクトリがありません: {root}")

    snapshot: dict[str, SnapshotEntry] = {}
    snapshot_total_bytes = 0
    for directory, directories, filenames in os.walk(root, topdown=True, followlinks=False):
        directory_path = Path(directory)
        for name in directories:
            path = directory_path / name
            if path.is_symlink():
                try:
                    snapshot[path.relative_to(root).as_posix()] = SnapshotEntry(
                        "symlink",
                        b"\x00SYMLINK:" + os.fsencode(path.readlink()),
                    )
                except OSError as error:
                    raise EvaluationError(f"symlinkを読み込めません: {path}: {error}") from error
        directories[:] = [
            name
            for name in directories
            if name != ".git" and not (directory_path / name).is_symlink()
        ]
        for filename in filenames:
            if filename == ".git":
                continue
            path = directory_path / filename
            relative_path = path.relative_to(root).as_posix()
            if path.is_symlink():
                try:
                    snapshot[relative_path] = SnapshotEntry(
                        "symlink",
                        b"\x00SYMLINK:" + os.fsencode(path.readlink()),
                    )
                except OSError as error:
                    raise EvaluationError(f"symlinkを読み込めません: {path}: {error}") from error
                continue
            if not path.is_file():
                continue
            try:
                file_size = path.stat().st_size
            except OSError as error:
                raise EvaluationError(f"ファイルサイズを読み込めません: {path}: {error}") from error
            if file_size > MAX_SNAPSHOT_FILE_BYTES:
                raise EvaluationError(
                    f"snapshotのファイルサイズが上限を超えています: {path} "
                    f"({file_size} bytes > {MAX_SNAPSHOT_FILE_BYTES} bytes)"
                )
            if snapshot_total_bytes + file_size > MAX_SNAPSHOT_TOTAL_BYTES:
                raise EvaluationError(
                    "snapshotの総読込み量が上限を超えています: "
                    f"{snapshot_total_bytes + file_size} bytes > {MAX_SNAPSHOT_TOTAL_BYTES} bytes"
                )
            try:
                with path.open("rb") as file:
                    data = file.read(MAX_SNAPSHOT_FILE_BYTES + 1)
            except OSError as error:
                raise EvaluationError(f"ファイルを読み込めません: {path}: {error}") from error
            if len(data) > MAX_SNAPSHOT_FILE_BYTES:
                raise EvaluationError(
                    f"snapshotのファイルサイズが上限を超えています: {path}"
                )
            if snapshot_total_bytes + len(data) > MAX_SNAPSHOT_TOTAL_BYTES:
                raise EvaluationError(
                    "snapshotの総読込み量が上限を超えています: "
                    f"{snapshot_total_bytes + len(data)} bytes > {MAX_SNAPSHOT_TOTAL_BYTES} bytes"
                )
            snapshot[relative_path] = SnapshotEntry("blob", data)
            snapshot_total_bytes += len(data)
    for relative_path, gitlink_data in _read_gitlinks(gitlinks_path).items():
        existing_data = snapshot.get(relative_path)
        if existing_data is not None and existing_data != gitlink_data:
            raise EvaluationError(
                f"gitlink manifestが通常ファイルと衝突しています: {relative_path}"
            )
        snapshot[relative_path] = gitlink_data
    return snapshot


def _is_binary(data: bytes) -> bool:
    return b"\x00" in data[:8192]


def _conservative_line_count(data: bytes, lines: Sequence[str]) -> int:
    if len(data) > MAX_DIFF_BYTES:
        return max(len(lines), CONSERVATIVE_LINE_RISK_LINES)
    return len(lines)


def _line_changes(base_data: bytes | None, head_data: bytes | None) -> tuple[int, int, bool]:
    if base_data == head_data:
        return 0, 0, False
    if base_data is None or head_data is None:
        present_data = head_data if head_data is not None else base_data
        if present_data is not None and _is_binary(present_data):
            return (1 if head_data is not None else 0, 1 if base_data is not None else 0, True)

    if (base_data is not None and _is_binary(base_data)) or (
        head_data is not None and _is_binary(head_data)
    ):
        return (1 if head_data is not None else 0, 1 if base_data is not None else 0, True)

    base_lines = (base_data or b"").decode("utf-8", errors="replace").splitlines()
    head_lines = (head_data or b"").decode("utf-8", errors="replace").splitlines()
    if (
        len(base_data or b"") > MAX_DIFF_BYTES
        or len(head_data or b"") > MAX_DIFF_BYTES
        or len(base_lines) + len(head_lines) > MAX_DIFF_LINES
    ):
        return (
            _conservative_line_count(head_data or b"", head_lines),
            _conservative_line_count(base_data or b"", base_lines),
            False,
        )

    # autojunk=True avoids quadratic behavior for repeated untrusted lines.
    matcher = difflib.SequenceMatcher(a=base_lines, b=head_lines, autojunk=True)
    additions = 0
    deletions = 0
    for tag, base_start, base_end, head_start, head_end in matcher.get_opcodes():
        if tag in {"replace", "delete"}:
            deletions += base_end - base_start
        if tag in {"replace", "insert"}:
            additions += head_end - head_start
    return additions, deletions, False


def collect_changed_files(
    base_dir: Path,
    head_dir: Path,
    policy: Policy,
    *,
    base_gitlinks: Path | None = None,
    head_gitlinks: Path | None = None,
) -> tuple[ChangedFile, ...]:
    base_snapshot = _read_snapshot(base_dir, base_gitlinks)
    head_snapshot = _read_snapshot(head_dir, head_gitlinks)
    return _collect_changed_files_from_snapshots(base_snapshot, head_snapshot, policy)


def _collect_changed_files_from_snapshots(
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    policy: Policy,
) -> tuple[ChangedFile, ...]:
    changed: list[ChangedFile] = []

    for path in sorted(set(base_snapshot) | set(head_snapshot)):
        if matches_any(path, policy.ignored_globs):
            continue
        base_entry = base_snapshot.get(path)
        head_entry = head_snapshot.get(path)
        if base_entry == head_entry:
            continue
        base_data = base_entry.data if base_entry is not None else None
        head_data = head_entry.data if head_entry is not None else None
        additions, deletions, binary = _line_changes(base_data, head_data)
        if base_data is None:
            status = "A"
        elif head_data is None:
            status = "D"
        else:
            status = "M"
        changed.append(
            ChangedFile(
                path=path,
                status=status,
                additions=additions,
                deletions=deletions,
                binary=binary,
                gitlink=(base_entry is not None and base_entry.kind == "gitlink")
                or (head_entry is not None and head_entry.kind == "gitlink"),
            )
        )
    return tuple(changed)


def _band_risk(value: int, bands: Sequence[ScoreBand]) -> int:
    for band in bands:
        if value <= band.maximum:
            return band.risk
    return bands[-1].risk


def _matching_rules(path: str, policy: Policy) -> tuple[PathRule, ...]:
    return tuple(rule for rule in policy.path_rules if _matches(path, rule.pattern))


def _scope_has_code_changes(
    scope: VerificationScope,
    files: Sequence[ChangedFile],
    scopes: Sequence[VerificationScope],
) -> bool:
    for changed_file in files:
        if not matches_any(changed_file.path, scope.code_globs):
            continue
        if scope.fallback and any(
            other.name != scope.name
            and not other.fallback
            and matches_any(changed_file.path, other.code_globs)
            for other in scopes
        ):
            continue
        return True
    return False


def _has_test_removal(
    files: Sequence[ChangedFile],
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    policy: Policy,
) -> bool:
    """テストの削除・純減を検出し、同内容の純粋なrenameは除外する。"""

    added_test_contents: Counter[SnapshotEntry] = Counter(
        head_snapshot[item.path]
        for item in files
        if item.status == "A"
        and matches_any(item.path, policy.test_globs)
        and item.path in head_snapshot
    )
    for item in files:
        if not matches_any(item.path, policy.test_globs):
            continue
        if item.status != "D" and item.additions >= item.deletions:
            continue
        if item.status == "D":
            content = base_snapshot.get(item.path)
            if content is not None and added_test_contents[content] > 0:
                added_test_contents[content] -= 1
                continue
        return True
    return False


def assess(
    base_dir: Path,
    head_dir: Path,
    policy: Policy,
    *,
    base_sha: str | None = None,
    head_sha: str | None = None,
    base_gitlinks: Path | None = None,
    head_gitlinks: Path | None = None,
) -> RiskAssessment:
    base_snapshot = _read_snapshot(base_dir, base_gitlinks)
    head_snapshot = _read_snapshot(head_dir, head_gitlinks)
    files = _collect_changed_files_from_snapshots(base_snapshot, head_snapshot, policy)
    additions = sum(item.additions for item in files)
    deletions = sum(item.deletions for item in files)
    changed_lines = additions + deletions
    line_risk = _band_risk(changed_lines, policy.line_bands)
    file_risk = _band_risk(len(files), policy.file_bands)

    path_assessments: list[PathAssessment] = []
    hard_gate_reasons: list[str] = []
    path_risk_total = 0
    for changed_file in files:
        matching_rules = _matching_rules(changed_file.path, policy)
        path_risk = max((rule.risk for rule in matching_rules), default=0)
        reasons = [
            f"{reason}（{changed_file.path} matches `{pattern}`）"
            for pattern, reason in sorted(
                ((rule.pattern, rule.reason) for rule in matching_rules if rule.hard_gate),
                key=lambda item: item[0],
            )
        ]
        if changed_file.gitlink:
            path_risk = max(path_risk, 100)
            reasons.insert(0, f"Git submodule参照の変更（{changed_file.path}）")
        path_assessments.append(
            PathAssessment(
                path=changed_file.path,
                risk=path_risk,
                hard_gate_reasons=tuple(reasons),
            )
        )
        path_risk_total += path_risk
        for reason in reasons:
            if reason not in hard_gate_reasons:
                hard_gate_reasons.append(reason)
    path_risk = min(path_risk_total, policy.maximum_path_risk)

    code_changes = any(matches_any(item.path, policy.code_globs) for item in files)
    missing_test_scopes = tuple(
        scope.name
        for scope in policy.verification_scopes
        if _scope_has_code_changes(scope, files, policy.verification_scopes)
        and not any(
            item.status != "D"
            and item.additions > 0
            and matches_any(item.path, scope.test_globs)
            for item in files
        )
    )
    test_changes = code_changes and not missing_test_scopes
    test_removal_risk = (
        policy.test_removal_risk
        if _has_test_removal(files, base_snapshot, head_snapshot, policy)
        else 0
    )
    verification_risk = (
        (policy.missing_test_risk if missing_test_scopes else 0) + test_removal_risk
    )
    risk = min(100, line_risk + file_risk + path_risk + verification_risk)

    reasons: list[str] = []
    if hard_gate_reasons:
        reasons.extend(f"Hard Gate: {reason}" for reason in hard_gate_reasons)
    if policy.project_health < policy.minimum_project_health:
        reasons.append(
            f"Project Health {policy.project_health}が最低値"
            f" {policy.minimum_project_health}を下回る"
        )
    if risk > policy.maximum_pr_risk:
        reasons.append(f"PR Risk {risk}が閾値 {policy.maximum_pr_risk}を超える")
    if missing_test_scopes:
        reasons.append(
            f"コード変更に対応するテスト変更がなく（不足: {', '.join(missing_test_scopes)}）、"
            f"検証リスク +{policy.missing_test_risk}"
        )
    if test_removal_risk:
        reasons.append(f"テストの削除・純減リスク +{test_removal_risk}")
    if not reasons:
        reasons.append("Hard Gateなし、PR RiskとProject Healthが閾値内")

    decision = (
        "HUMAN_REVIEW_REQUIRED"
        if hard_gate_reasons
        or policy.project_health < policy.minimum_project_health
        or risk > policy.maximum_pr_risk
        else "ELIGIBLE_FOR_AUTONOMOUS_MERGE"
    )

    return RiskAssessment(
        decision=decision,
        project_health=policy.project_health,
        minimum_project_health=policy.minimum_project_health,
        risk=risk,
        maximum_pr_risk=policy.maximum_pr_risk,
        changed_files=len(files),
        additions=additions,
        deletions=deletions,
        line_risk=line_risk,
        file_risk=file_risk,
        path_risk=path_risk,
        verification_risk=verification_risk,
        code_changes=code_changes,
        test_changes=test_changes,
        missing_test_scopes=missing_test_scopes,
        test_removal_risk=test_removal_risk,
        hard_gate_reasons=tuple(hard_gate_reasons),
        reasons=tuple(reasons),
        files=files,
        path_assessments=tuple(path_assessments),
        base_sha=base_sha,
        head_sha=head_sha,
    )


def _escape_markdown(value: str) -> str:
    normalized = value.replace("\n", " ").replace("\r", " ")
    escaped = html.escape(normalized, quote=False)
    return (
        escaped.replace("\\", "&#92;")
        .replace("`", "&#96;")
        .replace("*", "&#42;")
        .replace("_", "&#95;")
        .replace("[", "&#91;")
        .replace("]", "&#93;")
        .replace("|", "&#124;")
        .replace("~", "&#126;")
    )


def _safe_code(value: str) -> str:
    """動的な値をMarkdownのcode span外で安全に表示する。"""

    return f"<code>{_escape_markdown(value)}</code>"


def _markdown(assessment: RiskAssessment, policy: Policy, policy_path: Path) -> str:
    verification_base_risk = assessment.verification_risk - assessment.test_removal_risk
    lines = [
        "## Autonomous Merge Shadow Mode",
        "",
        "> 判定のみを行うPoCです。PRをblockせず、mergeも実行しません。",
        "",
        "| 指標 | 値 |",
        "| --- | ---: |",
        f"| Decision | {_safe_code(assessment.decision)} |",
        f"| Project Health | {_safe_code(str(assessment.project_health))} / "
        f"{_safe_code(str(assessment.minimum_project_health))} |",
        f"| PR Risk | {_safe_code(str(assessment.risk))} / "
        f"{_safe_code(str(assessment.maximum_pr_risk))} |",
        f"| Changed files | {_safe_code(str(assessment.changed_files))} |",
        f"| Changed lines | {_safe_code(f'+{assessment.additions} / -{assessment.deletions}')} |",
        f"| Evaluator policy | {_safe_code(str(policy_path))} (trusted base checkout) |",
    ]
    if assessment.base_sha:
        lines.append(f"| Comparison base SHA | {_safe_code(assessment.base_sha)} |")
    if assessment.head_sha:
        lines.append(f"| Head SHA | {_safe_code(assessment.head_sha)} |")

    lines.extend(
        [
            "",
            "### Risk breakdown",
            "",
            "| Component | Risk |",
            "| --- | ---: |",
            f"| Changed lines | {assessment.line_risk} |",
            f"| Changed files | {assessment.file_risk} |",
            f"| Changed paths | {assessment.path_risk} |",
            f"| Verification | {verification_base_risk} |",
            f"| Test removal | {assessment.test_removal_risk} |",
            "",
            "### Reasons",
            "",
        ]
    )
    lines.extend(f"- {_escape_markdown(reason)}" for reason in assessment.reasons)
    lines.extend(
        [
            "",
            "### Changed paths",
            "",
            "| Status | Path | + | - | Path risk |",
            "| --- | --- | ---: | ---: | ---: |",
        ]
    )
    if assessment.files:
        path_risks = {item.path: item.risk for item in assessment.path_assessments}
        lines.extend(
            f"| {_escape_markdown(item.status)} | {_safe_code(item.path)} | {item.additions} | "
            f"{item.deletions} | {path_risks[item.path]} |"
            for item in assessment.files
        )
    else:
        lines.append("| - | 変更なし | 0 | 0 | 0 |")
    lines.append("")
    return "\n".join(lines)


def _json(assessment: RiskAssessment, policy: Policy, policy_path: Path) -> str:
    payload = asdict(assessment)
    payload["policy"] = {
        "version": policy.version,
        "mode": policy.mode,
        "path": str(policy_path),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-dir",
        type=Path,
        required=True,
        help="PRの差分比較元（通常はmerge base）のチェックアウト",
    )
    parser.add_argument("--head-dir", type=Path, required=True, help="PR head SHAのチェックアウト")
    parser.add_argument("--policy", type=Path, help="評価に使うpolicy.toml（trusted base側を指定する）")
    parser.add_argument(
        "--trusted-base-dir",
        type=Path,
        help="evaluatorとpolicyの信頼元チェックアウト（省略時は--base-dir）",
    )
    parser.add_argument(
        "--base-gitlinks",
        type=Path,
        help="比較baseのGit treeから抽出したgitlink manifest",
    )
    parser.add_argument(
        "--head-gitlinks",
        type=Path,
        help="PR headのGit treeから抽出したgitlink manifest",
    )
    parser.add_argument("--base-sha", help="出力へ記録する差分比較元のmerge base SHA")
    parser.add_argument("--head-sha", help="出力へ記録するPR head SHA")
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="出力形式（既定: markdown）",
    )
    return parser


def _ensure_within_base(base_dir: Path, candidate: Path, label: str) -> None:
    try:
        candidate.resolve(strict=True).relative_to(base_dir.resolve(strict=True))
    except (FileNotFoundError, ValueError) as error:
        raise EvaluationError(f"{label}はbase checkout配下を指定してください: {candidate}") from error


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    trusted_base_dir = args.trusted_base_dir or args.base_dir
    policy_path = args.policy or trusted_base_dir / ".github" / "autonomous-merge" / "policy.toml"
    try:
        _ensure_within_base(trusted_base_dir, Path(__file__), "evaluator")
        _ensure_within_base(trusted_base_dir, policy_path, "policy")
        policy = load_policy(policy_path)
        assessment = assess(
            args.base_dir,
            args.head_dir,
            policy,
            base_sha=args.base_sha,
            head_sha=args.head_sha,
            base_gitlinks=args.base_gitlinks,
            head_gitlinks=args.head_gitlinks,
        )
    except EvaluationError as error:
        print(f"Autonomous Merge Shadow Modeの評価に失敗しました: {error}", file=sys.stderr)
        return 2

    if args.format == "json":
        print(_json(assessment, policy, policy_path))
    else:
        print(_markdown(assessment, policy, policy_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
