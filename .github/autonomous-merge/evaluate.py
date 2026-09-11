#!/usr/bin/env python3
"""PRの変更内容を決定論的に採点するAutonomous MergeのShadow Mode評価器。

このスクリプトはPRのコードを実行せず、base/headのチェックアウトに含まれる
ファイル内容だけを比較する。workflowからは必ずbase側のスクリプトとpolicyを
指定することで、PR自身の変更で評価ルールを弱められないようにする。
"""

from __future__ import annotations

import argparse
import ast
from bisect import bisect_right
from collections import Counter
import difflib
import html
import io
import json
import os
import re
import stat
import sys
import tokenize
import tomllib
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
    exclude_globs: tuple[str, ...]
    risk: int
    hard_gate: bool
    reason: str


@dataclass(frozen=True)
class SnapshotEntry:
    kind: str
    mode: str
    data: bytes


@dataclass(frozen=True)
class VerificationMapping:
    code_globs: tuple[str, ...]
    test_globs: tuple[str, ...]


@dataclass(frozen=True)
class VerificationScope:
    name: str
    code_globs: tuple[str, ...]
    test_globs: tuple[str, ...]
    binary_test_globs: tuple[str, ...]
    fallback: bool
    excluded_code_globs: tuple[str, ...] = ()
    test_mappings: tuple[VerificationMapping, ...] = ()


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
                exclude_globs=_require_string_list(
                    rule.get("exclude_globs", []),
                    f"path_rules[{index}].exclude_globs",
                ),
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


def _load_verification_mappings(value: Any, name: str) -> tuple[VerificationMapping, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise EvaluationError(f"policyの{name}はテーブル配列で指定してください")
    mappings: list[VerificationMapping] = []
    for index, raw_mapping in enumerate(value):
        mapping = _require_mapping(raw_mapping, f"{name}[{index}]")
        mappings.append(
            VerificationMapping(
                code_globs=_require_string_list(
                    mapping.get("code_globs"),
                    f"{name}[{index}].code_globs",
                ),
                test_globs=_require_string_list(
                    mapping.get("test_globs"),
                    f"{name}[{index}].test_globs",
                ),
            )
        )
    return tuple(mappings)


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
                binary_test_globs=_require_string_list(
                    scope.get("binary_test_globs", []),
                    f"verification.scopes[{index}].binary_test_globs",
                ),
                fallback=fallback,
                excluded_code_globs=_require_string_list(
                    scope.get("excluded_code_globs", []),
                    f"verification.scopes[{index}].excluded_code_globs",
                ),
                test_mappings=_load_verification_mappings(
                    scope.get("test_mappings"),
                    f"verification.scopes[{index}].test_mappings",
                ),
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
MAX_SNAPSHOT_FILES = 50_000
MAX_MANIFEST_RECORD_BYTES = 1_000_000
MAX_TEST_BEHAVIOR_RECORDS = 512


def _iter_nul_records(manifest_file: Any) -> Iterable[bytes]:
    buffer = bytearray()
    while chunk := manifest_file.read(65_536):
        buffer.extend(chunk)
        while True:
            try:
                delimiter_index = buffer.index(0)
            except ValueError:
                break
            yield bytes(buffer[:delimiter_index])
            del buffer[: delimiter_index + 1]
        if len(buffer) > MAX_MANIFEST_RECORD_BYTES:
            raise EvaluationError("manifestの1レコードが上限を超えています")
    if buffer:
        raise EvaluationError("manifestのレコードがNULで終端されていません")


def _read_object_manifest(
    manifest_path: Path | None,
    *,
    kind: str,
    mode: str,
    label: str,
) -> dict[str, SnapshotEntry]:
    if manifest_path is None:
        return {}
    entries: dict[str, SnapshotEntry] = {}
    try:
        manifest_file = manifest_path.open("rb")
    except OSError as error:
        raise EvaluationError(f"{label} manifestを読み込めません: {manifest_path}: {error}") from error

    with manifest_file:
        for line_number, record in enumerate(_iter_nul_records(manifest_file), start=1):
            if not record:
                continue
            try:
                object_id_bytes, path_bytes = record.split(b"\t", 1)
                object_id = object_id_bytes.decode("ascii")
                relative_path = os.fsdecode(path_bytes)
            except (UnicodeDecodeError, ValueError) as error:
                raise EvaluationError(
                    f"{label} manifestの{line_number}行目が不正です: {manifest_path}"
                ) from error
            if not re.fullmatch(r"[0-9a-f]{40,64}", object_id) or not relative_path:
                raise EvaluationError(
                    f"{label} manifestの{line_number}行目が不正です: {manifest_path}"
                )
            if len(entries) >= MAX_SNAPSHOT_FILES and relative_path not in entries:
                raise EvaluationError(
                    f"snapshotのファイル数が上限を超えています: {manifest_path}"
                )
            entries[relative_path] = SnapshotEntry(
                kind,
                mode,
                object_id.encode("ascii"),
            )
    return entries


def _read_gitlinks(manifest_path: Path | None) -> dict[str, SnapshotEntry]:
    return _read_object_manifest(
        manifest_path,
        kind="gitlink",
        mode="160000",
        label="gitlink",
    )


def _read_symlinks(manifest_path: Path | None) -> dict[str, SnapshotEntry]:
    return _read_object_manifest(
        manifest_path,
        kind="symlink",
        mode="120000",
        label="symlink",
    )


def _read_snapshot(
    root: Path,
    gitlinks_path: Path | None = None,
    symlinks_path: Path | None = None,
) -> dict[str, SnapshotEntry]:
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
                    relative_path = path.relative_to(root).as_posix()
                    if relative_path not in snapshot and len(snapshot) >= MAX_SNAPSHOT_FILES:
                        raise EvaluationError(
                            f"snapshotのファイル数が上限を超えています: {root}"
                        )
                    snapshot[relative_path] = SnapshotEntry(
                        "symlink",
                        "120000",
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
                    if relative_path not in snapshot and len(snapshot) >= MAX_SNAPSHOT_FILES:
                        raise EvaluationError(
                            f"snapshotのファイル数が上限を超えています: {root}"
                        )
                    snapshot[relative_path] = SnapshotEntry(
                        "symlink",
                        "120000",
                        b"\x00SYMLINK:" + os.fsencode(path.readlink()),
                    )
                except OSError as error:
                    raise EvaluationError(f"symlinkを読み込めません: {path}: {error}") from error
                continue
            if not path.is_file():
                continue
            if relative_path not in snapshot and len(snapshot) >= MAX_SNAPSHOT_FILES:
                raise EvaluationError(f"snapshotのファイル数が上限を超えています: {root}")
            try:
                file_stat = path.stat()
                file_size = file_stat.st_size
                file_mode = "100755" if file_stat.st_mode & stat.S_IXUSR else "100644"
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
            snapshot[relative_path] = SnapshotEntry("blob", file_mode, data)
            snapshot_total_bytes += len(data)
    for relative_path, gitlink_data in _read_gitlinks(gitlinks_path).items():
        existing_data = snapshot.get(relative_path)
        if existing_data is not None and existing_data != gitlink_data:
            raise EvaluationError(
                f"gitlink manifestが通常ファイルと衝突しています: {relative_path}"
            )
        if existing_data is None and len(snapshot) >= MAX_SNAPSHOT_FILES:
            raise EvaluationError(f"snapshotのファイル数が上限を超えています: {root}")
        snapshot[relative_path] = gitlink_data
    for relative_path, symlink_data in _read_symlinks(symlinks_path).items():
        existing_data = snapshot.get(relative_path)
        if existing_data is not None and existing_data != symlink_data:
            raise EvaluationError(
                f"symlink manifestが通常ファイルまたはgitlinkと衝突しています: {relative_path}"
            )
        if existing_data is None and len(snapshot) >= MAX_SNAPSHOT_FILES:
            raise EvaluationError(f"snapshotのファイル数が上限を超えています: {root}")
        snapshot[relative_path] = symlink_data
    return snapshot


def _is_binary(data: bytes) -> bool:
    if b"\x00" in data[:8192]:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


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
    base_symlinks: Path | None = None,
    head_symlinks: Path | None = None,
) -> tuple[ChangedFile, ...]:
    base_snapshot = _read_snapshot(base_dir, base_gitlinks, base_symlinks)
    head_snapshot = _read_snapshot(head_dir, head_gitlinks, head_symlinks)
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
    return tuple(
        rule
        for rule in policy.path_rules
        if _matches(path, rule.pattern)
        and not matches_any(path, rule.exclude_globs)
    )


def _scope_has_code_changes(
    scope: VerificationScope,
    files: Sequence[ChangedFile],
    scopes: Sequence[VerificationScope],
    *,
    test_globs: Sequence[str] = (),
) -> bool:
    return bool(_scope_code_change_paths(scope, files, scopes, test_globs=test_globs))


def _scope_code_change_paths(
    scope: VerificationScope,
    files: Sequence[ChangedFile],
    scopes: Sequence[VerificationScope],
    *,
    test_globs: Sequence[str] = (),
) -> tuple[str, ...]:
    paths: list[str] = []
    for changed_file in files:
        if not matches_any(changed_file.path, scope.code_globs):
            continue
        if matches_any(changed_file.path, test_globs):
            continue
        if matches_any(changed_file.path, scope.excluded_code_globs):
            continue
        if scope.fallback and any(
            other.name != scope.name
            and not other.fallback
            and matches_any(changed_file.path, other.code_globs)
            for other in scopes
        ):
            continue
        paths.append(changed_file.path)
    return tuple(paths)


def _scope_has_usable_test_change(
    scope: VerificationScope,
    files: Sequence[ChangedFile],
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    pure_rename_additions: frozenset[str],
    *,
    code_change_paths: Sequence[str],
) -> bool:
    def usable_test_matches(patterns: Sequence[str]) -> bool:
        return any(
            _is_usable_test_change(
                item,
                base_snapshot,
                head_snapshot,
                binary_test_globs=scope.binary_test_globs,
            )
            and matches_any(item.path, scope.test_globs)
            and matches_any(item.path, patterns)
            and item.path not in pure_rename_additions
            for item in files
        )

    if not scope.test_mappings:
        return usable_test_matches(scope.test_globs)

    required_mappings: set[VerificationMapping] = set()
    for code_path in code_change_paths:
        matching_mappings = tuple(
            mapping
            for mapping in scope.test_mappings
            if matches_any(code_path, mapping.code_globs)
        )
        if not matching_mappings:
            # A scoped code path without an explicit ownership mapping is
            # deliberately conservative: no unrelated test can satisfy it.
            return False
        required_mappings.update(matching_mappings)
    return all(usable_test_matches(mapping.test_globs) for mapping in required_mappings)


_DISABLED_TEST_CALL = re.compile(
    r"(?<![A-Za-z0-9_$?.'\"`])\b(?P<binding>test|it|describe|suite|specify|context)"
    r"(?:\s*(?:(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*|(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    r"\s*(?:(?:\.\s*|\?\.\s*)(?:skip|fixme|todo|skipIf|runIf|fail|fails)\b|(?:\?\.)?\s*\[\s*['\"`](?:skip|fixme|todo|skipIf|runIf|fail|fails)['\"`]\s*\])"
)
_JAVASCRIPT_TEST_INFO_MODIFIER_CALL = re.compile(
    r"\b(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*"
    r"(?:(?:\.\s*|\?\.\s*)(?:skip|fixme|fail)\b|"
    r"(?:\?\.)?\s*\[\s*['\"`](?:skip|fixme|fail)['\"`]\s*\])\s*\("
)
_JAVASCRIPT_DESTRUCTURED_TEST_CONTEXT_MODIFIER_CALL = re.compile(
    r"\b(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*\("
)
_JAVASCRIPT_SUITE_CALL = re.compile(
    r"(?<![A-Za-z0-9_$?.'\"`])(?:\b(?:describe|suite|context)|"
    r"\btest\s*(?:\.\s*|\?\.\s*)describe)"
    r"(?:(?:\s*(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*)"
    r"|(?:\s*(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    r"\s*\("
)
_JAVASCRIPT_PARAMETERIZED_SUITE_CALL = re.compile(
    r"(?<![A-Za-z0-9_$?.'\"`])(?:\b(?:describe|suite|context)|"
    r"\btest\s*(?:\.\s*|\?\.\s*)describe)"
    r"(?:(?:\s*(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*)"
    r"|(?:\s*(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    r"\s*(?:\.\s*|\?\.\s*)(?:each|for)\s*\("
)
_JAVASCRIPT_DISABLED_TEST_OPTION = re.compile(
    r"(?:^|[{,])\s*(?:(?:skip|todo|fails)|\[\s*['\"`](?:skip|todo|fails)['\"`]\s*\])"
    r"\s*:(?!\s*(?:false|0|null|undefined)\s*(?=[,}]))\s*"
)
_JAVASCRIPT_DISABLED_TEST_OPTION_SHORTHAND = re.compile(
    r"(?:^|[{,])\s*(?:skip|todo|fails)\s*(?=[,}])"
)
_JAVASCRIPT_OBJECT_VARIABLE = re.compile(
    r"\b(?:const|let|var)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{"
)
_JAVASCRIPT_OBJECT_ALIAS = re.compile(
    r"\b(?:const|let|var)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"
    r"(?P<source>[A-Za-z_$][A-Za-z0-9_$]*)\b"
)
_JAVASCRIPT_OBJECT_SPREAD = re.compile(
    r"(?:^|[{,])\s*\.\.\.\s*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\b"
)
_JAVASCRIPT_DISABLED_TEST_OPTION_ASSIGNMENT = re.compile(
    r"\b(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*"
    r"(?:\.\s*(?:skip|todo|fails)\b|\[\s*['\"`](?:skip|todo|fails)['\"`]\s*\])"
    r"\s*=\s*(?!\s*(?:false|0|null|undefined)\s*(?=[;,\r\n}]|$))"
)
_JAVASCRIPT_SUITE_IMPORT = re.compile(
    r"\bimport\s*\{(?P<specifiers>[^{}]*)\}\s*from\s*['\"`](?:vitest|@playwright/test)['\"`]"
)
_JAVASCRIPT_SUITE_NAMESPACE_IMPORT = re.compile(
    r"\bimport\s*\*\s*as\s+(?P<alias>[A-Za-z_$][A-Za-z0-9_$]*)\s*"
    r"from\s*['\"`](?:vitest|@playwright/test)['\"`]"
)


_PYTHON_DISABLED_DECORATORS = frozenset(
    {
        "skip",
        "skipIf",
        "skipUnless",
        "unittest.skip",
        "unittest.skipIf",
        "unittest.skipUnless",
        "pytest.mark.skip",
        "pytest.mark.skipif",
    }
)


def _python_disabled_decorators(data: bytes | None) -> tuple[str, ...]:
    if data is None or _is_binary(data):
        return ()
    text = data.decode("utf-8", errors="replace")
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (IndentationError, SyntaxError, tokenize.TokenError, ValueError):
        return ()

    decorators: list[str] = []
    for index, token in enumerate(tokens):
        if token.type != tokenize.OP or token.string != "@":
            continue
        parts: list[str] = []
        cursor = index + 1
        while cursor < len(tokens) and tokens[cursor].start[0] == token.start[0]:
            current = tokens[cursor]
            if current.type == tokenize.NAME:
                parts.append(current.string)
            elif current.type == tokenize.OP and current.string == ".":
                pass
            else:
                break
            cursor += 1
        decorator = ".".join(parts)
        if decorator in _PYTHON_DISABLED_DECORATORS:
            decorators.append(decorator)
    return tuple(decorators)


def _contains_disabled_test_call(
    base_data: bytes | None,
    head_data: bytes | None,
    *,
    language: str = "javascript",
) -> bool:
    """追加されたテスト行がskip/fixme/todoだけになる変更を検出する。"""

    if head_data is None or _is_binary(head_data):
        return False
    if language == "python":
        base_decorators = _python_disabled_decorators(base_data)
        head_decorators = _python_disabled_decorators(head_data)
        base_counts = {name: base_decorators.count(name) for name in set(base_decorators)}
        return any(
            head_decorators.count(name) > base_counts.get(name, 0)
            for name in set(head_decorators)
        )
    base_lines = (base_data or b"").decode("utf-8", errors="replace").splitlines()
    head_lines = head_data.decode("utf-8", errors="replace").splitlines()
    base_source = _strip_javascript_comments(base_data or b"")
    head_source = _strip_javascript_comments(head_data)
    if _javascript_disabled_test_feature_count(head_source) > _javascript_disabled_test_feature_count(
        base_source
    ):
        return True
    if (
        len(base_data or b"") > MAX_DIFF_BYTES
        or len(head_data) > MAX_DIFF_BYTES
        or len(base_lines) + len(head_lines) > MAX_DIFF_LINES
    ):
        return bool(
            _javascript_disabled_call_spans(head_source)
            or _javascript_test_info_modifier_count(head_source)
            or _javascript_disabled_test_option_count(head_source)
        )

    matcher = difflib.SequenceMatcher(a=base_lines, b=head_lines, autojunk=True)
    for tag, _, _, head_start, head_end in matcher.get_opcodes():
        changed_text = "\n".join(head_lines[head_start:head_end])
        changed_source = _strip_javascript_comments(changed_text.encode("utf-8"))
        if tag in {"replace", "insert"} and (
            _javascript_disabled_call_spans(changed_source)
            or _javascript_test_info_modifier_count(changed_source)
            or _javascript_disabled_test_option_count(changed_source) > 0
        ):
            return True
    return False


_REGEX_LITERAL_PRECEDING_WORDS = frozenset(
    {"await", "case", "delete", "in", "instanceof", "of", "return", "throw", "typeof", "void", "yield"}
)


def _can_start_regex_literal(text: str, index: int) -> bool:
    """現在位置の`/`が正規表現リテラルの開始らしいかを判定する。"""

    previous = index - 1
    while previous >= 0 and text[previous].isspace():
        previous -= 1
    if previous < 0 or text[previous] in "([{=,:;!&|?+-*%^~<>":
        return True
    if text[previous].isalnum() or text[previous] in "_$":
        end = previous + 1
        start = previous
        while start >= 0 and (text[start].isalnum() or text[start] in "_$"):
            start -= 1
        return text[start + 1 : end] in _REGEX_LITERAL_PRECEDING_WORDS
    return False


def _read_regex_literal(text: str, index: int) -> tuple[str, int, int] | None:
    """正規表現リテラル全体、終端slash、次の位置を返す。"""

    if index >= len(text) or text[index] != "/" or not _can_start_regex_literal(text, index):
        return None
    cursor = index + 1
    in_character_class = False
    while cursor < len(text):
        character = text[cursor]
        if character == "\\":
            cursor += 2
            continue
        if character == "[":
            in_character_class = True
        elif character == "]":
            in_character_class = False
        elif character == "/" and not in_character_class:
            close = cursor
            cursor += 1
            while cursor < len(text) and (text[cursor].isalpha() or text[cursor].isdigit()):
                cursor += 1
            return text[index:cursor], close, cursor
        elif character in "\r\n":
            return None
        cursor += 1
    return None


def _regex_for_fingerprint(
    text: str,
    index: int,
    *,
    preserve_literal_content: bool,
) -> tuple[str, int] | None:
    literal = _read_regex_literal(text, index)
    if literal is None:
        return None
    value, close, end = literal
    if preserve_literal_content:
        return value, end
    return f"/R/{value[close + 1 :]}", end


def _mask_javascript_literals(text: str) -> str:
    """文字列・template・正規表現の内容を隠し、コード構文だけを残す。"""

    def is_computed_property(index: int) -> bool:
        previous = index - 1
        while previous >= 0 and text[previous].isspace():
            previous -= 1
        return previous >= 0 and text[previous] == "["

    def mask_quoted(index: int, quote: str) -> tuple[str, int]:
        start = index
        index += 1
        while index < len(text):
            if text[index] == "\\":
                index += 2
                continue
            if text[index] == quote:
                index += 1
                break
            index += 1
        literal = text[start:index]
        value = literal[1:-1] if literal.endswith(quote) else literal[1:]
        if is_computed_property(start) and re.fullmatch(
            r"[A-Za-z_$][A-Za-z0-9_$]*",
            value,
        ):
            return literal, index
        return (
            "".join(item if item in "\r\n" or item == quote else " " for item in literal),
            index,
        )

    def mask_template(index: int) -> tuple[str, int]:
        start = index
        characters = ["`"]
        index += 1
        has_interpolation = False
        while index < len(text):
            character = text[index]
            next_character = text[index + 1] if index + 1 < len(text) else ""
            if character == "\\":
                escaped = text[index : min(index + 2, len(text))]
                characters.append("".join(item if item in "\r\n" else " " for item in escaped))
                index += len(escaped)
            elif character == "`":
                index += 1
                literal = text[start:index]
                value = literal[1:-1]
                if is_computed_property(start) and not has_interpolation and re.fullmatch(
                    r"[A-Za-z_$][A-Za-z0-9_$]*",
                    value,
                ):
                    return literal, index
                characters.append("`")
                return "".join(characters), index
            elif character == "$" and next_character == "{":
                has_interpolation = True
                characters.append("${")
                interpolation, index = mask_code(index + 2, stop_at_brace=True)
                characters.append(interpolation)
            else:
                characters.append(character if character in "\r\n" else " ")
                index += 1
        return "".join(characters), index

    def mask_code(index: int, *, stop_at_brace: bool) -> tuple[str, int]:
        characters: list[str] = []
        brace_depth = 0
        while index < len(text):
            character = text[index]
            if stop_at_brace and character == "}" and brace_depth == 0:
                characters.append(character)
                return "".join(characters), index + 1
            if stop_at_brace and character == "{":
                brace_depth += 1
                characters.append(character)
                index += 1
            elif stop_at_brace and character == "}":
                brace_depth -= 1
                characters.append(character)
                index += 1
            elif character in {"'", '"'}:
                quoted, index = mask_quoted(index, character)
                characters.append(quoted)
            elif character == "`":
                template, index = mask_template(index)
                characters.append(template)
            elif character == "/":
                regex = _read_regex_literal(text, index)
                if regex is not None:
                    literal, close, end = regex
                    characters.append(
                        "/"
                        + "".join(
                            item if item in "\r\n" else " "
                            for item in literal[1 : close - index]
                        )
                        + literal[close - index :]
                    )
                    index = end
                else:
                    characters.append(character)
                    index += 1
            else:
                characters.append(character)
                index += 1
        return "".join(characters), index

    masked, _ = mask_code(0, stop_at_brace=False)
    return masked


def _javascript_disabled_call_source(data: bytes | None) -> str:
    if data is None or _is_binary(data):
        return ""
    return _mask_javascript_literals(_strip_javascript_comments(data))


def _javascript_call_argument_span_index(
    source: str,
) -> dict[int, tuple[tuple[int, int], ...] | None]:
    """全呼び出しのトップレベル引数範囲を一度の走査で索引化する。"""

    # Each frame owns the bracket/brace depth inside its current call. Nested
    # calls are separate frames, so every source character is processed once
    # instead of rescanning the suffix for every opening parenthesis.
    frames: list[list[Any]] = []
    results: dict[int, tuple[tuple[int, int], ...] | None] = {}
    index = 0
    while index < len(source):
        character = source[index]
        if character in {"'", '"', "`"}:
            quote = character
            index += 1
            while index < len(source):
                if source[index] == "\\":
                    index += 2
                    continue
                if source[index] == quote:
                    index += 1
                    break
                index += 1
            continue
        if character == "/":
            regex = _read_regex_literal(source, index)
            if regex is not None:
                index = regex[2]
                continue
        if character == "(":
            # [open index, next argument start, spans, bracket depth,
            # brace depth, structurally valid]
            frames.append([index, index + 1, [], 0, 0, True])
        elif character == "[":
            if frames:
                frames[-1][3] += 1
        elif character == "]":
            if frames:
                if frames[-1][3] > 0:
                    frames[-1][3] -= 1
                else:
                    frames[-1][5] = False
        elif character == "{":
            if frames:
                frames[-1][4] += 1
        elif character == "}":
            if frames:
                if frames[-1][4] > 0:
                    frames[-1][4] -= 1
                else:
                    frames[-1][5] = False
        elif character == "," and frames:
            frame = frames[-1]
            if frame[3] == frame[4] == 0:
                frame[2].append((frame[1], index))
                frame[1] = index + 1
        elif character == ")" and frames:
            frame = frames[-1]
            if frame[3] == frame[4] == 0:
                frames.pop()
                if frame[5]:
                    frame[2].append((frame[1], index))
                    results[frame[0]] = tuple(frame[2])
                else:
                    results[frame[0]] = None
        index += 1

    for frame in frames:
        results[frame[0]] = None
    return results


def _javascript_call_argument_spans(
    source: str,
    open_index: int,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int], ...] | None:
    """JavaScript呼び出しのトップレベル引数のsource上の範囲を返す。"""

    if open_index >= len(source) or source[open_index] != "(":
        return None
    index = (
        _javascript_call_argument_span_index(source)
        if argument_span_index is None
        else argument_span_index
    )
    return index.get(open_index)


def _javascript_call_arguments(
    source: str,
    open_index: int,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[str, ...] | None:
    """JavaScript呼び出しのトップレベル引数を、文字列を跨がずに分割する。"""

    spans = _javascript_call_argument_spans(
        source,
        open_index,
        argument_span_index=argument_span_index,
    )
    if spans is None:
        return None
    return tuple(source[start:end] for start, end in spans)


def _javascript_parameter_name(parameter: str) -> str | None:
    """callback引数から単純な識別子だけを取り出す。"""

    candidate = parameter.strip()
    if "=" in candidate:
        candidate = candidate.split("=", 1)[0].strip()
    if ":" in candidate:
        candidate = candidate.split(":", 1)[0].strip()
    candidate = candidate.removesuffix("?").strip()
    if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", candidate):
        return candidate
    return None


def _javascript_callback_parameter_sources(callback: str) -> tuple[str, ...]:
    """callbackの先頭2引数を、文字列を跨がずに取り出す。"""

    masked_callback = _mask_javascript_literals(callback)
    arrow_index = masked_callback.find("=>")
    if arrow_index >= 0:
        parameter_source = re.sub(
            r"^async\s+",
            "",
            masked_callback[:arrow_index].strip(),
        )
        if parameter_source.startswith("("):
            spans = _javascript_call_argument_spans(
                parameter_source,
                0,
                argument_span_index=_javascript_call_argument_span_index(parameter_source),
            )
            if spans is None:
                return ()
            return tuple(parameter_source[start:end].strip() for start, end in spans[:2])
        return (parameter_source,) if _javascript_parameter_name(parameter_source) else ()

    function_match = re.search(
        r"\bfunction(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(",
        masked_callback,
    )
    if function_match is None:
        return ()
    open_index = function_match.end() - 1
    spans = _javascript_call_argument_spans(
        masked_callback,
        open_index,
        argument_span_index=_javascript_call_argument_span_index(masked_callback),
    )
    if spans is None:
        return ()
    return tuple(masked_callback[start:end].strip() for start, end in spans[:2])


def _javascript_callback_modifier_parameter_names(
    callback: str,
) -> tuple[frozenset[str], frozenset[str]]:
    """Vitest/Playwrightのruntime modifierを持つcallback引数名を返す。"""

    simple_names: set[str] = set()
    destructured_names: set[str] = set()
    for parameter in _javascript_callback_parameter_sources(callback):
        simple_name = _javascript_parameter_name(parameter)
        if simple_name is not None:
            simple_names.add(simple_name)
            continue
        candidate = parameter.strip()
        if not candidate.startswith("{") or "}" not in candidate:
            continue
        object_source = candidate[1 : candidate.rfind("}")]
        for match in re.finditer(
            r"(?:^|,)\s*(?P<property>skip|fixme|fail)\b"
            r"(?:\s*:\s*(?P<alias>[A-Za-z_$][A-Za-z0-9_$]*))?",
            object_source,
        ):
            destructured_names.add(match.group("alias") or match.group("property"))
    return frozenset(simple_names), frozenset(destructured_names)


def _javascript_braced_end_index(
    source: str,
    target_open_indexes: Iterable[int] | None,
) -> dict[int, int | None]:
    """object literalの閉じ括弧を一度の走査で索引化する。"""

    target_indexes = None if target_open_indexes is None else frozenset(target_open_indexes)
    openings: list[int] = []
    results: dict[int, int | None] = {}
    index = 0
    while index < len(source):
        character = source[index]
        next_character = source[index + 1] if index + 1 < len(source) else ""
        if character in {"'", '"', "`"}:
            quote = character
            index += 1
            while index < len(source):
                if source[index] == "\\":
                    index += 2
                    continue
                if source[index] == quote:
                    index += 1
                    break
                index += 1
            continue
        if character == "/" and next_character == "/":
            index += 2
            while index < len(source) and source[index] not in "\r\n":
                index += 1
            continue
        if character == "/" and next_character == "*":
            index += 2
            while index < len(source):
                if source[index] == "*" and index + 1 < len(source) and source[index + 1] == "/":
                    index += 2
                    break
                index += 1
            continue
        if character == "/":
            regex = _read_regex_literal(source, index)
            if regex is not None:
                index = regex[2]
                continue
        if character == "{":
            openings.append(index)
        elif character == "}" and openings:
            open_index = openings.pop()
            if target_indexes is None or open_index in target_indexes:
                results[open_index] = index + 1
        index += 1
    for open_index in openings:
        if target_indexes is None or open_index in target_indexes:
            results[open_index] = None
    return results


def _javascript_call_close_index(
    source: str,
    open_index: int,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None],
) -> int | None:
    spans = argument_span_index.get(open_index)
    if spans is None:
        return None
    close_index = spans[-1][1] if spans else open_index + 1
    while close_index < len(source) and source[close_index].isspace():
        close_index += 1
    if close_index >= len(source) or source[close_index] != ")":
        return None
    return close_index


def _javascript_parameter_binding_names(parameter: str) -> frozenset[str]:
    """function/arrow parameterから宣言されたbinding名を取り出す。"""

    candidate = re.sub(r"^\s*async\s+", "", parameter.strip())
    candidate = candidate.removeprefix("...").strip()
    simple_name = _javascript_parameter_name(candidate)
    if simple_name is not None:
        return frozenset({simple_name})

    names: set[str] = set()
    if candidate.startswith("{") and candidate.endswith("}"):
        for member in candidate[1:-1].split(","):
            member = member.strip().removeprefix("...").strip()
            if not member:
                continue
            parts = re.split(r"\s*:\s*", member, maxsplit=1)
            name = parts[-1].split("=", 1)[0].strip().removesuffix("?").strip()
            if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
                names.add(name)
    elif candidate.startswith("[") and candidate.endswith("]"):
        for member in candidate[1:-1].split(","):
            name = member.strip().removeprefix("...").split("=", 1)[0].strip()
            if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
                names.add(name)
    return frozenset(names)


def _javascript_arrow_expression_end(
    masked_source: str,
    start: int,
    end: int,
) -> int:
    """concise arrow bodyの終端を、外側のdelimiterまで走査する。"""

    parentheses = 0
    brackets = 0
    braces = 0
    index = start
    while index < end:
        character = masked_source[index]
        if character == "(":
            parentheses += 1
        elif character == ")":
            if parentheses == 0:
                return index
            parentheses -= 1
        elif character == "[":
            brackets += 1
        elif character == "]":
            if brackets == 0:
                return index
            brackets -= 1
        elif character == "{":
            braces += 1
        elif character == "}":
            if braces == 0:
                return index
            braces -= 1
        elif character in {",", ";"} and parentheses == brackets == braces == 0:
            return index
        index += 1
    return end


def _javascript_typed_arrow_parameter_open_index(
    masked_source: str,
    arrow_start: int,
    close_to_open: Mapping[int, int],
) -> int | None:
    """戻り値型を跨いでarrow parameterの閉じ括弧を探す。"""

    cursor = arrow_start - 1
    while cursor >= 0:
        if masked_source[cursor] == ")":
            parameter_open_index = close_to_open.get(cursor)
            annotation_start = cursor + 1
            while (
                annotation_start < arrow_start
                and masked_source[annotation_start].isspace()
            ):
                annotation_start += 1
            if (
                parameter_open_index is not None
                and annotation_start < arrow_start
                and masked_source[annotation_start] == ":"
            ):
                return parameter_open_index
        cursor -= 1
    return None


def _javascript_arrow_parameter_spans(
    masked_source: str,
    arrow_start: int,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None],
    close_to_open: Mapping[int, int],
) -> tuple[int, tuple[tuple[int, int], ...]] | None:
    """arrow直前のparameter範囲を、型注釈を跨いで後方走査する。"""

    previous = arrow_start - 1
    while previous >= 0 and masked_source[previous].isspace():
        previous -= 1

    parameter_open_index: int | None = None
    if previous >= 0 and masked_source[previous] == ")":
        candidate_open_index = close_to_open.get(previous)
        before_parameter = candidate_open_index - 1 if candidate_open_index is not None else -1
        while before_parameter >= 0 and masked_source[before_parameter].isspace():
            before_parameter -= 1
        if (
            candidate_open_index is not None
            and (
                before_parameter < 0
                or masked_source[before_parameter] != ":"
            )
        ):
            parameter_open_index = candidate_open_index
        elif candidate_open_index is not None:
            parameter_open_index = _javascript_typed_arrow_parameter_open_index(
                masked_source,
                arrow_start,
                close_to_open,
            )
    else:
        parameter_end = arrow_start
        while parameter_end > 0 and masked_source[parameter_end - 1].isspace():
            parameter_end -= 1
        parameter_start = parameter_end
        while parameter_start > 0 and (
            masked_source[parameter_start - 1].isalnum()
            or masked_source[parameter_start - 1] in "_$"
        ):
            parameter_start -= 1
        type_hint_cursor = parameter_start - 1
        while type_hint_cursor >= 0 and masked_source[type_hint_cursor].isspace():
            type_hint_cursor -= 1
        type_hint_before_parameter = (
            type_hint_cursor >= 0
            and masked_source[type_hint_cursor] in ":|&<>"
        )
        if parameter_start == parameter_end:
            if previous < 0 or masked_source[previous] not in "}]>":
                return None
            parameter_open_index = _javascript_typed_arrow_parameter_open_index(
                masked_source,
                arrow_start,
                close_to_open,
            )
        elif not type_hint_before_parameter:
            return parameter_start, ((parameter_start, parameter_end),)
        else:
            parameter_open_index = _javascript_typed_arrow_parameter_open_index(
                masked_source,
                arrow_start,
                close_to_open,
            )

    if parameter_open_index is not None:
        parameter_spans = argument_span_index.get(parameter_open_index)
        if parameter_spans is not None:
            return parameter_open_index, parameter_spans

    parameter_end = arrow_start
    while parameter_end > 0 and masked_source[parameter_end - 1].isspace():
        parameter_end -= 1
    parameter_start = parameter_end
    while parameter_start > 0 and (
        masked_source[parameter_start - 1].isalnum()
        or masked_source[parameter_start - 1] in "_$"
    ):
        parameter_start -= 1
    if parameter_start == parameter_end:
        return None
    return parameter_start, ((parameter_start, parameter_end),)


def _javascript_function_scopes(
    source: str,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int, int, frozenset[str]], ...]:
    """function/arrowのbody範囲とparameter bindingを一度の走査で返す。"""

    masked_source = _mask_javascript_literals(source)
    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    braced_end_index = _javascript_braced_end_index(masked_source, None)
    close_to_open: dict[int, int] = {}
    for open_index in argument_span_index:
        close_index = _javascript_call_close_index(
            source,
            open_index,
            argument_span_index,
        )
        if close_index is not None:
            close_to_open[close_index] = open_index

    scopes: list[tuple[int, int, int, frozenset[str]]] = []
    function_pattern = re.compile(
        r"\b(?:async\s+)?function(?:\s*\*)?"
        r"(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\("
    )
    for match in function_pattern.finditer(masked_source):
        open_index = match.end() - 1
        close_index = _javascript_call_close_index(
            source,
            open_index,
            argument_span_index,
        )
        if close_index is None:
            continue
        body_start = close_index + 1
        while body_start < len(source) and source[body_start].isspace():
            body_start += 1
        if body_start >= len(source) or source[body_start] != "{":
            continue
        body_end = braced_end_index.get(body_start)
        if body_end is None:
            continue
        parameter_spans = argument_span_index.get(open_index) or ()
        parameter_names = frozenset(
            name
            for parameter_start, parameter_end in parameter_spans
            for name in _javascript_parameter_binding_names(
                source[parameter_start:parameter_end]
            )
        )
        scopes.append((match.start(), body_start, body_end, parameter_names))

    for arrow in re.finditer(r"=>", masked_source):
        arrow_start = arrow.start()
        parameter_info = _javascript_arrow_parameter_spans(
            masked_source,
            arrow_start,
            argument_span_index,
            close_to_open,
        )
        if parameter_info is None:
            continue
        marker_start, parameter_spans = parameter_info
        body_start = arrow.end()
        while body_start < len(source) and source[body_start].isspace():
            body_start += 1
        if body_start >= len(source):
            continue
        if source[body_start] == "{":
            body_end = braced_end_index.get(body_start)
            if body_end is None:
                continue
        else:
            body_end = _javascript_arrow_expression_end(
                masked_source,
                body_start,
                len(source),
            )
            if body_end <= body_start:
                continue
        scopes.append(
            (
                marker_start,
                body_start,
                body_end,
                frozenset(
                    name
                    for parameter_start, parameter_end in parameter_spans
                    for name in _javascript_parameter_binding_names(
                        source[parameter_start:parameter_end]
                    )
                ),
            )
        )
    return tuple(sorted(scopes, key=lambda scope: (scope[0], scope[2])))


@lru_cache(maxsize=32)
def _javascript_function_scopes_cached(
    source: str,
) -> tuple[tuple[int, int, int, frozenset[str]], ...]:
    return _javascript_function_scopes(source)


def _javascript_binding_scope_index(
    function_scopes: Sequence[tuple[int, int, int, frozenset[str]]],
) -> dict[str, tuple[tuple[int, ...], tuple[int, ...]]]:
    """parameter bindingごとの包含scopeを位置検索できる形へ索引化する。"""

    intervals: dict[str, list[tuple[int, int]]] = {}
    for _, body_start, body_end, parameter_names in function_scopes:
        for binding in parameter_names:
            intervals.setdefault(binding, []).append((body_start, body_end))
    index: dict[str, tuple[tuple[int, ...], tuple[int, ...]]] = {}
    for binding, binding_intervals in intervals.items():
        starts: list[int] = []
        prefix_max_ends: list[int] = []
        maximum_end = -1
        for body_start, body_end in sorted(binding_intervals):
            starts.append(body_start)
            maximum_end = max(maximum_end, body_end)
            prefix_max_ends.append(maximum_end)
        index[binding] = (tuple(starts), tuple(prefix_max_ends))
    return index


def _javascript_function_scope_start_index(
    function_scopes: Sequence[tuple[int, int, int, frozenset[str]]],
) -> tuple[int, ...]:
    return tuple(scope[0] for scope in function_scopes)


def _javascript_binding_shadowed_at(
    source: str,
    position: int,
    binding: str,
    *,
    function_scopes: Sequence[tuple[int, int, int, frozenset[str]]] | None = None,
    binding_scope_index: Mapping[str, tuple[tuple[int, ...], tuple[int, ...]]] | None = None,
) -> bool:
    if function_scopes is None:
        function_scopes = _javascript_function_scopes_cached(source)
    if binding_scope_index is None:
        binding_scope_index = _javascript_binding_scope_index(function_scopes)
    interval_index = binding_scope_index.get(binding)
    if interval_index is None:
        return False
    starts, prefix_max_ends = interval_index
    previous_scope = bisect_right(starts, position) - 1
    return previous_scope >= 0 and prefix_max_ends[previous_scope] > position


_JAVASCRIPT_SYNCHRONOUS_CALLBACK_CALLEES = frozenset(
    {
        "every",
        "filter",
        "find",
        "findIndex",
        "flatMap",
        "forEach",
        "map",
        "reduce",
        "reduceRight",
        "some",
    }
)


def _javascript_call_callee_name(
    masked_source: str,
    open_index: int,
) -> str | None:
    cursor = open_index - 1
    while cursor >= 0 and masked_source[cursor].isspace():
        cursor -= 1
    end = cursor + 1
    while cursor >= 0 and (
        masked_source[cursor].isalnum()
        or masked_source[cursor] in "_$"
    ):
        cursor -= 1
    return masked_source[cursor + 1 : end] or None


def _javascript_direct_callback_callee_index(
    masked_source: str,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None],
) -> dict[int, str]:
    """直接callback引数の先頭位置からcallee名を引ける索引を作る。"""

    index: dict[int, str] = {}
    for open_index, argument_spans in argument_span_index.items():
        if argument_spans is None:
            continue
        callee = _javascript_call_callee_name(masked_source, open_index)
        if callee is None:
            continue
        for argument_start, argument_end in argument_spans:
            candidate = argument_start
            while candidate < argument_end and masked_source[candidate].isspace():
                candidate += 1
            if masked_source.startswith("async", candidate):
                async_end = candidate + len("async")
                if async_end >= argument_end or not (
                    masked_source[async_end].isalnum()
                    or masked_source[async_end] in "_$"
                ):
                    candidate = async_end
                    while (
                        candidate < argument_end
                        and masked_source[candidate].isspace()
                    ):
                        candidate += 1
            if candidate < argument_end:
                index.setdefault(candidate, callee)
    return index


def _javascript_function_scope_is_direct_call_argument(
    direct_callback_callee_index: Mapping[int, str],
    scope_start: int,
) -> bool:
    """既知の同期calleeの直接callback引数だけを実行済みと判定する。"""

    return (
        direct_callback_callee_index.get(scope_start)
        in _JAVASCRIPT_SYNCHRONOUS_CALLBACK_CALLEES
    )


def _javascript_named_function_scope_is_called(
    masked_source: str,
    scope_start: int,
    body_start: int,
    body_end: int,
    end: int,
) -> bool:
    header = masked_source[scope_start:body_start]
    name_match = re.match(
        r"(?:async\s+)?function\s*\*?\s*"
        r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*\(",
        header,
    )
    if name_match is None:
        return False
    call_pattern = re.compile(
        r"(?<![A-Za-z0-9_$?.])"
        + re.escape(name_match.group("name"))
        + r"\s*\("
    )
    return call_pattern.search(masked_source, body_end, end) is not None


def _javascript_nested_function_ranges(
    source: str,
    start: int,
    end: int,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
    function_scopes: Sequence[tuple[int, int, int, frozenset[str]]] | None = None,
    direct_callback_callee_index: Mapping[int, str] | None = None,
    function_scope_start_index: tuple[int, ...] | None = None,
    masked_source: str | None = None,
) -> tuple[tuple[int, int], ...]:
    """未呼出しのnested function bodyだけをassertion走査から除外する。"""

    if function_scopes is None:
        scopes = (
            _javascript_function_scopes_cached(source)
            if argument_span_index is None
            else _javascript_function_scopes(
                source,
                argument_span_index=argument_span_index,
            )
        )
    else:
        scopes = function_scopes
    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    if function_scope_start_index is None:
        function_scope_start_index = _javascript_function_scope_start_index(scopes)
    candidate_start = bisect_right(function_scope_start_index, start - 1)
    candidate_end = bisect_right(function_scope_start_index, end - 1)
    candidates = list(scopes[candidate_start:candidate_end])
    if not candidates:
        candidates = [
            scope
            for scope in scopes
            if scope[1] <= start and end <= scope[2]
        ]
    if not candidates:
        return ()
    outer = min(candidates, key=lambda scope: (scope[0], -scope[2]))
    scopes_to_check = candidates
    if masked_source is None:
        masked_source = _mask_javascript_literals(source)
    if direct_callback_callee_index is None:
        direct_callback_callee_index = _javascript_direct_callback_callee_index(
            masked_source,
            argument_span_index,
        )
    return tuple(
        (body_start, body_end)
        for scope_start, body_start, body_end, _ in scopes_to_check
        if scope_start != outer[0]
        and body_start < end
        and start < body_end
        and not _javascript_named_function_scope_is_called(
            masked_source,
            scope_start,
            body_start,
            body_end,
            end,
        )
        and not _javascript_function_scope_is_direct_call_argument(
            direct_callback_callee_index,
            scope_start,
        )
    )


def _javascript_suite_aliases(source: str) -> frozenset[str]:
    """Vitest/Playwright suite runnerのimport aliasを取り出す。"""

    aliases: set[str] = set()
    for match in _JAVASCRIPT_SUITE_IMPORT.finditer(source):
        for specifier in match.group("specifiers").split(","):
            parts = re.split(r"\s+as\s+", specifier.strip(), maxsplit=1)
            imported = parts[0].strip()
            local = parts[1].strip() if len(parts) == 2 else imported
            if imported in {"describe", "suite", "context"}:
                if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", local):
                    aliases.add(local)
    return frozenset(aliases)


def _javascript_suite_namespace_aliases(source: str) -> frozenset[str]:
    """Vitest/Playwright namespace importのlocal bindingを取り出す。"""

    return frozenset(
        match.group("alias")
        for match in _JAVASCRIPT_SUITE_NAMESPACE_IMPORT.finditer(source)
    )


def _javascript_suite_alias_call_pattern(
    aliases: Iterable[str],
    *,
    disabled: bool = False,
    parameterized: bool = False,
) -> re.Pattern[str] | None:
    names = sorted(
        {
            alias
            for alias in aliases
            if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", alias)
        }
    )
    if not names:
        return None
    prefix = (
        r"(?<![A-Za-z0-9_$?.'\"`])\b(?:"
        + "|".join(re.escape(name) for name in names)
        + r")"
    )
    chain = (
        r"(?:\s*(?:(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*|"
        r"(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    )
    if parameterized:
        return re.compile(
            prefix + chain + r"\s*(?:\.\s*|\?\.\s*)(?:each|for)\s*\("
        )
    if disabled:
        return re.compile(
            prefix
            + chain
            + r"\s*(?:(?:\.\s*|\?\.\s*)(?:skip|fixme|todo|skipIf|runIf|fail|fails)\b|"
            r"(?:\?\.)?\s*\[\s*['\"`](?:skip|fixme|todo|skipIf|runIf|fail|fails)['\"`]\s*\])"
        )
    return re.compile(prefix + chain + r"\s*\(")


def _javascript_suite_namespace_call_pattern(
    aliases: Iterable[str],
    *,
    disabled: bool = False,
    parameterized: bool = False,
) -> re.Pattern[str] | None:
    names = sorted(
        {
            alias
            for alias in aliases
            if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", alias)
        }
    )
    if not names:
        return None
    prefix = (
        r"(?<![A-Za-z0-9_$?.'\"`])\b(?:"
        + "|".join(re.escape(name) for name in names)
        + r")"
    )
    suite_root = (
        r"\s*(?:(?:\.\s*|\?\.\s*)(?:describe|suite|context)"
        r"|(?:\.\s*|\?\.\s*)test\s*(?:\.\s*|\?\.\s*)describe"
        r"|(?:\?\.)?\s*\[\s*['\"`](?:describe|suite|context)['\"`]\s*\]"
        r"|(?:\?\.)?\s*\[\s*['\"`]test['\"`]\s*\]"
        r"\s*(?:\.\s*|\?\.\s*)describe)"
    )
    chain = (
        r"(?:\s*(?:(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*|"
        r"(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    )
    if parameterized:
        return re.compile(
            prefix
            + suite_root
            + chain
            + r"\s*(?:\.\s*|\?\.\s*)(?:each|for)\s*\("
        )
    if disabled:
        return re.compile(
            prefix
            + suite_root
            + chain
            + r"\s*(?:(?:\.\s*|\?\.\s*)(?:skip|fixme|todo|skipIf|runIf|fail|fails)\b|"
            r"(?:\?\.)?\s*\[\s*['\"`](?:skip|fixme|todo|skipIf|runIf|fail|fails)['\"`]\s*\])"
        )
    return re.compile(prefix + suite_root + chain + r"\s*\(")


def _javascript_parameterized_suite_call_spans(source: str) -> tuple[tuple[int, int], ...]:
    """parameterized suiteが返す実際のsuite callback呼び出し範囲を返す。"""

    masked_source = _mask_javascript_literals(source)
    matches = list(_JAVASCRIPT_PARAMETERIZED_SUITE_CALL.finditer(masked_source))
    alias_pattern = _javascript_suite_alias_call_pattern(
        _javascript_suite_aliases(source),
        parameterized=True,
    )
    if alias_pattern is not None:
        matches.extend(alias_pattern.finditer(masked_source))
    namespace_pattern = _javascript_suite_namespace_call_pattern(
        _javascript_suite_namespace_aliases(source),
        parameterized=True,
    )
    if namespace_pattern is not None:
        matches.extend(namespace_pattern.finditer(masked_source))

    argument_span_index = _javascript_call_argument_span_index(source)
    spans: set[tuple[int, int]] = set()
    for match in matches:
        each_open_index = match.end() - 1
        each_argument_spans = argument_span_index.get(each_open_index)
        if each_argument_spans is None:
            continue
        if _javascript_parameterized_dataset_is_empty(
            source,
            each_argument_spans,
        ):
            continue
        each_close_index = (
            each_argument_spans[-1][1]
            if each_argument_spans
            else each_open_index + 1
        )
        while (
            each_close_index < len(masked_source)
            and masked_source[each_close_index].isspace()
        ):
            each_close_index += 1
        if (
            each_close_index >= len(masked_source)
            or masked_source[each_close_index] != ")"
        ):
            continue
        returned_open_index = each_close_index + 1
        while (
            returned_open_index < len(masked_source)
            and masked_source[returned_open_index].isspace()
        ):
            returned_open_index += 1
        if (
            returned_open_index < len(masked_source)
            and masked_source[returned_open_index] == "("
        ):
            spans.add((match.start(), returned_open_index))
    return tuple(sorted(spans))


def _javascript_suite_call_spans(source: str) -> tuple[tuple[int, int], ...]:
    """組み込み名とrunner import aliasのsuite呼び出し範囲を返す。"""

    masked_source = _mask_javascript_literals(source)
    spans = {
        (match.start(), match.end() - 1)
        for match in _JAVASCRIPT_SUITE_CALL.finditer(masked_source)
    }
    suite_call_starts = {start for start, _ in spans}
    alias_pattern = _javascript_suite_alias_call_pattern(_javascript_suite_aliases(source))
    if alias_pattern is not None:
        alias_matches = tuple(alias_pattern.finditer(masked_source))
        spans.update((match.start(), match.end() - 1) for match in alias_matches)
        suite_call_starts.update(match.start() for match in alias_matches)
    namespace_pattern = _javascript_suite_namespace_call_pattern(
        _javascript_suite_namespace_aliases(source)
    )
    if namespace_pattern is not None:
        namespace_matches = tuple(namespace_pattern.finditer(masked_source))
        spans.update((match.start(), match.end() - 1) for match in namespace_matches)
        suite_call_starts.update(match.start() for match in namespace_matches)
    spans.update(_javascript_parameterized_suite_call_spans(source))
    spans.update(
        _javascript_conditional_suite_return_spans(
            source,
            suite_call_starts,
        )
    )
    return tuple(sorted(spans))


def _javascript_disabled_call_spans(source: str) -> tuple[tuple[int, int], ...]:
    """組み込み名とsuite aliasのdisabled modifier呼び出し範囲を返す。"""

    masked_source = _mask_javascript_literals(source)
    test_bindings = _javascript_test_runner_bindings(
        source,
        masked_source=masked_source,
    )
    spans = set(_javascript_test_modifier_call_spans(source, test_bindings=test_bindings))
    alias_pattern = _javascript_suite_alias_call_pattern(
        _javascript_suite_aliases(source),
        disabled=True,
    )
    if alias_pattern is not None:
        spans.update(
            (match.start(), match.end())
            for match in alias_pattern.finditer(masked_source)
        )
    namespace_pattern = _javascript_suite_namespace_call_pattern(
        _javascript_suite_namespace_aliases(source),
        disabled=True,
    )
    if namespace_pattern is not None:
        spans.update(
            (match.start(), match.end())
            for match in namespace_pattern.finditer(masked_source)
        )
    return tuple(sorted(spans))


def _javascript_conditional_suite_modifier_call(
    source: str,
    call_start: int,
    call_end: int,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None],
) -> tuple[str, tuple[str, ...], int, int] | None:
    modifier_match = re.search(
        r"(?:\.\s*|\?\.\s*)(?P<dot>skipIf|runIf)\b"
        r"|(?:\?\.)?\s*\[\s*['\"`](?P<bracket>skipIf|runIf)['\"`]\s*\]",
        source[call_start:call_end],
    )
    if modifier_match is None:
        return None
    modifier = modifier_match.group("dot") or modifier_match.group("bracket")
    if modifier is None:
        return None
    open_index = call_end
    while open_index < len(source) and source[open_index].isspace():
        open_index += 1
    if open_index >= len(source) or source[open_index] != "(":
        return None
    argument_spans = argument_span_index.get(open_index)
    if argument_spans is None:
        return None
    close_index = argument_spans[-1][1] if argument_spans else open_index + 1
    while close_index < len(source) and source[close_index].isspace():
        close_index += 1
    if close_index >= len(source) or source[close_index] != ")":
        return None
    return (
        modifier,
        tuple(source[start:end] for start, end in argument_spans),
        open_index,
        close_index,
    )


def _javascript_conditional_suite_is_disabled(
    modifier: str,
    arguments: Sequence[str],
) -> bool:
    condition = arguments[0].strip() if arguments else ""
    return not (
        (modifier == "skipIf" and condition in {"false", "0"})
        or (modifier == "runIf" and condition in {"true", "1"})
    )


def _javascript_conditional_test_call_spans(
    source: str,
) -> tuple[tuple[int, int, bool, str], ...]:
    """conditional test modifierが返すtest callback呼び出し範囲を返す。"""

    argument_span_index = _javascript_call_argument_span_index(source)
    spans: set[tuple[int, int, bool, str]] = set()
    for match in _javascript_test_modifier_call_matches(source):
        call_start, call_end = match.start(), match.end()
        modifier_call = _javascript_conditional_suite_modifier_call(
            source,
            call_start,
            call_end,
            argument_span_index=argument_span_index,
        )
        if modifier_call is None:
            continue
        returned_open_index = modifier_call[3] + 1
        while returned_open_index < len(source) and source[returned_open_index].isspace():
            returned_open_index += 1
        if returned_open_index < len(source) and source[returned_open_index] == "(":
            spans.add(
                (
                    call_start,
                    returned_open_index,
                    _javascript_conditional_suite_is_disabled(
                        modifier_call[0],
                        modifier_call[1],
                    ),
                    match.group("binding"),
                )
            )
    return tuple(sorted(spans))


def _javascript_conditional_suite_return_spans(
    source: str,
    suite_call_starts: Iterable[int],
) -> tuple[tuple[int, int], ...]:
    """条件付きsuite modifierが返す実際のsuite callback呼び出し範囲を返す。"""

    argument_span_index = _javascript_call_argument_span_index(source)
    starts = frozenset(suite_call_starts)
    spans: set[tuple[int, int]] = set()
    for call_start, call_end in _javascript_disabled_call_spans(source):
        if call_start not in starts:
            continue
        modifier_call = _javascript_conditional_suite_modifier_call(
            source,
            call_start,
            call_end,
            argument_span_index=argument_span_index,
        )
        if modifier_call is None or not _javascript_conditional_suite_is_disabled(
            modifier_call[0],
            modifier_call[1],
        ):
            continue
        returned_open_index = modifier_call[3] + 1
        while returned_open_index < len(source) and source[returned_open_index].isspace():
            returned_open_index += 1
        if returned_open_index < len(source) and source[returned_open_index] == "(":
            spans.add((call_start, returned_open_index))
    return tuple(sorted(spans))


def _javascript_test_info_modifier_count(source: str) -> int:
    """各test callbackの第2引数に対するskip/fixme/fail呼び出し数を数える。"""

    masked_source = _mask_javascript_literals(source)
    argument_span_index = _javascript_call_argument_span_index(source)
    count = 0
    for _, open_index in _javascript_test_call_spans(source):
        argument_spans = _javascript_call_argument_spans(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if argument_spans is None:
            continue
        arguments = tuple(source[start:end] for start, end in argument_spans)
        body_index = _javascript_test_body_argument_index(arguments)
        if body_index is None:
            continue
        body_start, body_end = argument_spans[body_index]
        count += _javascript_callback_test_info_modifier_count(
            masked_source,
            arguments[body_index],
            body_start,
            body_end,
        )
    return count


def _javascript_callback_test_info_modifier_count(
    masked_source: str,
    callback: str,
    body_start: int,
    body_end: int,
) -> int:
    simple_parameters, destructured_parameters = _javascript_callback_modifier_parameter_names(
        callback
    )
    count = sum(
        match.group("name") in simple_parameters
        for match in _JAVASCRIPT_TEST_INFO_MODIFIER_CALL.finditer(
            masked_source,
            body_start,
            body_end,
        )
    )
    return count + sum(
        match.group("name") in destructured_parameters
        for match in _JAVASCRIPT_DESTRUCTURED_TEST_CONTEXT_MODIFIER_CALL.finditer(
            masked_source,
            body_start,
            body_end,
        )
    )


def _javascript_object_has_disabled_test_option(
    source: str,
    disabled_option_variables: Iterable[str] = (),
) -> bool:
    source = _mask_javascript_literals(source)
    if (
        _JAVASCRIPT_DISABLED_TEST_OPTION.search(source)
        or _JAVASCRIPT_DISABLED_TEST_OPTION_SHORTHAND.search(source)
    ):
        return True
    disabled_options = frozenset(disabled_option_variables)
    return any(
        match.group("name") in disabled_options
        for match in _JAVASCRIPT_OBJECT_SPREAD.finditer(source)
    )


def _javascript_object_direct_option_info(
    source: str,
    object_open_index: int,
    object_end_index: int,
    braced_end_index: Mapping[int, int | None],
) -> tuple[bool, tuple[str, ...]]:
    """objectの直下optionとspreadだけを、ネストを再走査せずに抽出する。"""

    close_index = object_end_index - 1
    member_start = object_open_index + 1
    index = member_start
    parenthesis_depth = 0
    bracket_depth = 0
    has_disabled_option = False
    spread_names: list[str] = []

    def inspect_member(start: int, end: int) -> None:
        nonlocal has_disabled_option
        member = "{" + source[start:end] + "}"
        if (
            _JAVASCRIPT_DISABLED_TEST_OPTION.search(member)
            or _JAVASCRIPT_DISABLED_TEST_OPTION_SHORTHAND.search(member)
        ):
            has_disabled_option = True
        spread_names.extend(
            match.group("name")
            for match in _JAVASCRIPT_OBJECT_SPREAD.finditer(member)
        )

    while index < close_index:
        character = source[index]
        if character == "{":
            nested_end_index = braced_end_index.get(index)
            if nested_end_index is None or nested_end_index > close_index:
                inspect_member(member_start, index)
                return has_disabled_option, tuple(spread_names)
            inspect_member(member_start, index)
            member_start = nested_end_index
            index = nested_end_index
            continue
        if character == "(":
            parenthesis_depth += 1
        elif character == ")" and parenthesis_depth:
            parenthesis_depth -= 1
        elif character == "[":
            bracket_depth += 1
        elif character == "]" and bracket_depth:
            bracket_depth -= 1
        elif character == "," and parenthesis_depth == bracket_depth == 0:
            inspect_member(member_start, index)
            member_start = index + 1
        index += 1
    inspect_member(member_start, close_index)
    return has_disabled_option, tuple(spread_names)


def _javascript_unwrap_parenthesized_expression(expression: str) -> str:
    """外側だけの括弧を対で剥がし、option変数の参照を解決できる形にする。"""

    expression = expression.strip()
    while expression.startswith("("):
        argument_spans = _javascript_call_argument_span_index(expression).get(0)
        if argument_spans is None or len(argument_spans) != 1:
            break
        inner_start, inner_end = argument_spans[0]
        if inner_start != 1 or expression[inner_end:].strip() != ")":
            break
        expression = expression[inner_start:inner_end].strip()
    return expression


def _javascript_options_argument_is_disabled(
    options: str,
    disabled_option_variables: Iterable[str],
) -> bool:
    options = _javascript_unwrap_parenthesized_expression(options)
    if options.startswith("{") and _javascript_object_has_disabled_test_option(
        options,
        disabled_option_variables,
    ):
        return True
    option_name = re.fullmatch(
        r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)"
        r"(?:\s*!+|\s+(?:as|satisfies)\b[\s\S]*)?",
        options,
    )
    return option_name is not None and option_name.group("name") in frozenset(
        disabled_option_variables
    )


def _javascript_disabled_test_option_variables(source: str) -> frozenset[str]:
    source = _mask_javascript_literals(source)
    object_info: dict[str, tuple[bool, tuple[str, ...]]] = {}
    object_matches = tuple(_JAVASCRIPT_OBJECT_VARIABLE.finditer(source))
    braced_end_index = _javascript_braced_end_index(source, None)
    for match in object_matches:
        object_open_index = match.end() - 1
        object_end = braced_end_index.get(object_open_index)
        if object_end is not None:
            object_info[match.group("name")] = _javascript_object_direct_option_info(
                source,
                object_open_index,
                object_end,
                braced_end_index,
            )

    object_aliases = tuple(_JAVASCRIPT_OBJECT_ALIAS.finditer(source))
    for match in object_aliases:
        object_info.setdefault(match.group("name"), (False, ()))

    disabled_variables = {
        name
        for name, (has_disabled_option, _) in object_info.items()
        if has_disabled_option
    }
    disabled_variables.update(
        match.group("name")
        for match in _JAVASCRIPT_DISABLED_TEST_OPTION_ASSIGNMENT.finditer(source)
        if match.group("name") in object_info
    )
    dependents: dict[str, set[str]] = {}
    for name, (_, spread_names) in object_info.items():
        for dependency in spread_names:
            dependents.setdefault(dependency, set()).add(name)
    for match in object_aliases:
        dependents.setdefault(match.group("source"), set()).add(match.group("name"))

    queue = list(disabled_variables)
    cursor = 0
    while cursor < len(queue):
        dependency = queue[cursor]
        cursor += 1
        for dependent in dependents.get(dependency, ()):
            if dependent not in disabled_variables:
                disabled_variables.add(dependent)
                queue.append(dependent)
    return frozenset(disabled_variables)


def _javascript_disabled_test_option_count(source: str) -> int:
    count = 0
    disabled_option_variables = _javascript_disabled_test_option_variables(source)
    argument_span_index = _javascript_call_argument_span_index(source)
    for _, open_index in _javascript_test_call_spans(source):
        arguments = _javascript_call_arguments(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if arguments is not None and len(arguments) >= 2 and _javascript_options_argument_is_disabled(
            arguments[1],
            disabled_option_variables,
        ):
            count += 1
    for _, open_index in _javascript_suite_call_spans(source):
        arguments = _javascript_call_arguments(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if arguments is not None and len(arguments) >= 2 and _javascript_options_argument_is_disabled(
            arguments[1],
            disabled_option_variables,
        ):
            count += 1
    return count


def _javascript_disabled_suite_option_ranges(
    source: str,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int], ...]:
    """skip/todo/fails optionを持つsuiteと、そのinline callbackの範囲を返す。"""

    disabled_option_variables = _javascript_disabled_test_option_variables(source)
    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    ranges: list[tuple[int, int]] = []
    for call_start, open_index in _javascript_suite_call_spans(source):
        argument_spans = _javascript_call_argument_spans(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if argument_spans is None or len(argument_spans) < 3:
            continue
        arguments = tuple(source[start:end] for start, end in argument_spans)
        if not _javascript_options_argument_is_disabled(
            arguments[1],
            disabled_option_variables,
        ):
            continue
        body_index = _javascript_test_body_argument_index(arguments)
        if body_index is None:
            continue
        _, body_end = argument_spans[body_index]
        ranges.append((call_start, body_end))
    return tuple(ranges)


def _javascript_disabled_test_feature_count(source: str) -> int:
    argument_span_index = _javascript_call_argument_span_index(source)
    disabled_call_count = 0
    for call_start, call_end in _javascript_disabled_call_spans(source):
        conditional_modifier = _javascript_conditional_suite_modifier_call(
            source,
            call_start,
            call_end,
            argument_span_index=argument_span_index,
        )
        if (
            conditional_modifier is not None
            and not _javascript_conditional_suite_is_disabled(
                conditional_modifier[0],
                conditional_modifier[1],
            )
        ):
            continue
        disabled_call_count += 1
    return (
        disabled_call_count
        + _javascript_test_info_modifier_count(source)
        + _javascript_disabled_test_option_count(source)
    )


def _disabled_javascript_call_ranges(source: str) -> tuple[tuple[int, int], ...]:
    """無効化modifierを持つ呼び出しの引数範囲を返す。"""

    argument_span_index = _javascript_call_argument_span_index(source)
    ranges: list[tuple[int, int]] = []
    for start, end in _javascript_disabled_call_spans(source):
        conditional_modifier = _javascript_conditional_suite_modifier_call(
            source,
            start,
            end,
            argument_span_index=argument_span_index,
        )
        if (
            conditional_modifier is not None
            and not _javascript_conditional_suite_is_disabled(
                conditional_modifier[0],
                conditional_modifier[1],
            )
        ):
            continue
        open_index = end
        while open_index < len(source) and source[open_index].isspace():
            open_index += 1
        if open_index >= len(source) or source[open_index] != "(":
            continue
        argument_spans = argument_span_index.get(open_index)
        if argument_spans is None:
            continue
        close_index = argument_spans[-1][1] if argument_spans else open_index + 1
        while close_index < len(source) and source[close_index].isspace():
            close_index += 1
        if close_index < len(source) and source[close_index] == ")":
            ranges.append((start, close_index + 1))
    for call_start, open_index, disabled, _ in _javascript_conditional_test_call_spans(
        source
    ):
        if not disabled:
            continue
        close_index = _javascript_call_close_index(
            source,
            open_index,
            argument_span_index,
        )
        if close_index is not None:
            ranges.append((call_start, close_index + 1))
    ranges.extend(
        _javascript_disabled_suite_option_ranges(
            source,
            argument_span_index=argument_span_index,
        )
    )
    return tuple(ranges)


def _is_inside_disabled_javascript_call(
    source: str,
    position: int,
    *,
    disabled_ranges: Sequence[tuple[int, int]] | None = None,
) -> bool:
    if disabled_ranges is None:
        disabled_ranges = _disabled_javascript_call_ranges(source)
    return any(start <= position < end for start, end in disabled_ranges)


def _is_inside_disabled_javascript_test_callback(
    callback_spans: Sequence[tuple[int, int, bool]],
    position: int,
) -> bool:
    return any(
        disabled and body_start <= position < body_end
        for body_start, body_end, disabled in callback_spans
    )


def _test_runner(path: str) -> str | None:
    """リポジトリ内でテストを実行するrunnerを、pathの規約から分類する。"""

    if path.endswith(".png") and "-snapshots/" in path:
        return "playwright"
    if path.endswith(".snap") and "/__snapshots__/" in path:
        owner_directory, snapshot_name = path.split("/__snapshots__/", 1)
        if snapshot_name.endswith(".snap"):
            return _test_runner(f"{owner_directory}/{snapshot_name[:-len('.snap')]}")
        return None
    if matches_any(path, ("tests/e2e/**/*.test.ts", "tests/e2e/**/*.spec.ts")):
        return "playwright"
    if matches_any(path, ("tests/playtest/**/*.test.ts",)):
        return "vitest-playtest"
    if matches_any(
        path,
        (
            "tests/unit/**/*.test.ts",
            "tests/unit/**/*.spec.ts",
            "src/**/*.test.ts",
            "src/**/*.spec.ts",
        ),
    ):
        return "vitest"
    if matches_any(path, (".github/**/test_*.py",)):
        return "python"
    return None


def _snapshot_owner(path: str) -> tuple[str, str, str] | None:
    """snapshot pathからrunner・所有テスト・snapshot名を取り出す。"""

    if path.endswith(".png") and "-snapshots/" in path:
        owner, snapshot_name = path.split("-snapshots/", 1)
        return "playwright", owner, snapshot_name
    if path.endswith(".snap") and "/__snapshots__/" in path:
        owner_directory, snapshot_name = path.split("/__snapshots__/", 1)
        if snapshot_name.endswith(".snap"):
            owner = f"{owner_directory}/{snapshot_name[:-len('.snap')]}"
            return "vitest", owner, snapshot_name
    return None


_PLAYWRIGHT_SCREENSHOT_CALL = re.compile(
    r"\.\s*toHaveScreenshot\s*\(\s*(['\"])(?P<name>[^'\"\r\n]+)\1"
)
_VITEST_SNAPSHOT_CALL = re.compile(r"\.\s*toMatchSnapshot\s*\(")
_VITEST_SNAPSHOT_KEY = re.compile(
    r"(?m)^exports\[\s*(['\"`])([^'\"`\r\n]+)\1\s*\]\s*="
)


def _javascript_static_test_title(arguments: Sequence[str]) -> str | None:
    """test callbackに対応付けられる静的なtitleだけを返す。"""

    if not arguments:
        return None
    match = re.fullmatch(
        r"(['\"`])(?P<title>[^'\"`\r\n]*)\1",
        arguments[0].strip(),
    )
    if match is None or "${" in match.group("title"):
        return None
    return match.group("title")


def _vitest_snapshot_key_matches_title(snapshot_key: str, title: str) -> bool:
    """Vitest標準keyの番号を除いた完全なtest titleと一致するか確認する。"""

    key_match = re.fullmatch(r"(?P<title>.+) (?P<index>[1-9][0-9]*)", snapshot_key)
    return key_match is not None and key_match.group("title") == title


def _vitest_snapshot_callback_records(source: str) -> tuple[tuple[str, bool], ...]:
    """snapshot呼び出しごとに、所有testのtitleと無効化状態を返す。"""

    masked_source = _mask_javascript_literals(source)
    records: list[tuple[str, bool]] = []
    for _, body_start, body_end, disabled, title in _javascript_test_callback_records(source):
        if title is None:
            continue
        if _VITEST_SNAPSHOT_CALL.search(masked_source, body_start, body_end):
            records.append((title, disabled))
    return tuple(records)


def _is_referenced_snapshot(path: str, head_snapshot: Mapping[str, SnapshotEntry]) -> bool:
    """snapshotが実在するtest runnerのbaselineとして参照されているか確認する。"""

    owner_info = _snapshot_owner(path)
    if owner_info is None:
        return False
    runner, owner_path, snapshot_name = owner_info
    owner = head_snapshot.get(owner_path)
    if owner is None or owner.kind != "blob":
        return False
    owner_runner = _test_runner(owner_path)
    if runner == "vitest":
        if owner_runner not in {"vitest", "vitest-playtest"}:
            return False
    elif owner_runner != runner:
        return False
    source = _strip_javascript_comments(owner.data)
    disabled_call_ranges = _disabled_javascript_call_ranges(source)
    test_callback_records = _javascript_test_callback_records(source)
    disabled_test_callbacks = tuple(
        (body_start, body_end, disabled)
        for _, body_start, body_end, disabled, _ in test_callback_records
    )

    if runner == "playwright":
        if not snapshot_name.endswith(".png"):
            return False
        snapshot_stem = snapshot_name[: -len(".png")]
        for match in _PLAYWRIGHT_SCREENSHOT_CALL.finditer(source):
            expected_name = match.group("name")
            if not expected_name.endswith(".png"):
                expected_name += ".png"
            expected_stem = expected_name[: -len(".png")]
            if snapshot_stem == f"{expected_stem}-chromium-linux":
                active_test_callback = any(
                    body_start <= match.start() < body_end and not disabled
                    for _, body_start, body_end, disabled, _ in test_callback_records
                )
                if active_test_callback and not _is_inside_disabled_javascript_call(
                    source,
                    match.start(),
                    disabled_ranges=disabled_call_ranges,
                ) and not (
                    _is_inside_disabled_javascript_test_callback(
                        disabled_test_callbacks,
                        match.start(),
                    )
                ):
                    return True
        return False

    if runner == "vitest":
        # Vitestのsnapshot fileは、各export keyが、そのkeyを生成した有効な
        # test callbackへ対応付けられる場合だけbaselineとして受け入れる。
        snapshot_entry = head_snapshot.get(path)
        if snapshot_entry is None or snapshot_entry.kind != "blob":
            return False
        snapshot_text = snapshot_entry.data.decode("utf-8", errors="replace")
        if not snapshot_text.startswith("// Vitest Snapshot v1"):
            return False
        keys = [match.group(2) for match in _VITEST_SNAPSHOT_KEY.finditer(snapshot_text)]
        snapshot_callbacks = _vitest_snapshot_callback_records(source)
        return bool(
            keys
            and snapshot_callbacks
            and all(
                any(
                    _vitest_snapshot_key_matches_title(key, title)
                    and not disabled
                    for title, disabled in snapshot_callbacks
                )
                and not any(
                    _vitest_snapshot_key_matches_title(key, title)
                    and disabled
                    for title, disabled in snapshot_callbacks
                )
                for key in keys
            )
        )

    return False


def _python_code_fingerprint(data: bytes | None, *, preserve_literal_content: bool) -> str:
    if data is None:
        return ""
    text = data.decode("utf-8", errors="replace")
    try:
        tokens = tokenize.generate_tokens(io.StringIO(text).readline)
        parts: list[str] = []
        ignored = {
            tokenize.COMMENT,
            tokenize.ENCODING,
            tokenize.ENDMARKER,
            tokenize.INDENT,
            tokenize.DEDENT,
            tokenize.NEWLINE,
            tokenize.NL,
        }
        for token in tokens:
            if token.type in ignored:
                continue
            if token.type == tokenize.STRING and not preserve_literal_content:
                parts.append("S")
            else:
                parts.append(token.string)
        return "\x1f".join(parts)
    except (IndentationError, SyntaxError, tokenize.TokenError, ValueError):
        return text


def _strip_javascript_comments(data: bytes) -> str:
    """文字列リテラルを保ちながらJavaScript/TypeScriptコメントを除去する。

    template literalのraw textは文字列として保持しつつ、`${...}`の中へ
    戻ったときは通常のJavaScript字句規則でコメントを除去する。
    """

    text = data.decode("utf-8", errors="replace")

    def copy_quoted(index: int, quote: str) -> tuple[str, int]:
        characters = [quote]
        index += 1
        while index < len(text):
            character = text[index]
            characters.append(character)
            index += 1
            if character == "\\" and index < len(text):
                characters.append(text[index])
                index += 1
            elif character == quote:
                break
        return "".join(characters), index

    def scan_template(index: int) -> tuple[str, int]:
        characters: list[str] = []
        while index < len(text):
            character = text[index]
            next_character = text[index + 1] if index + 1 < len(text) else ""
            if character == "\\":
                characters.append(character)
                index += 1
                if index < len(text):
                    characters.append(text[index])
                    index += 1
            elif character == "`":
                characters.append(character)
                return "".join(characters), index + 1
            elif character == "$" and next_character == "{":
                characters.append("${")
                interpolation, index = scan_code(index + 2, stop_at_brace=True)
                characters.append(interpolation)
            else:
                characters.append(character)
                index += 1
        return "".join(characters), index

    def scan_code(index: int, *, stop_at_brace: bool) -> tuple[str, int]:
        characters: list[str] = []
        brace_depth = 0
        while index < len(text):
            character = text[index]
            next_character = text[index + 1] if index + 1 < len(text) else ""
            if stop_at_brace and character == "}" and brace_depth == 0:
                characters.append(character)
                return "".join(characters), index + 1
            if stop_at_brace and character == "{":
                brace_depth += 1
                characters.append(character)
                index += 1
            elif stop_at_brace and character == "}":
                brace_depth -= 1
                characters.append(character)
                index += 1
            elif character in {"'", '"'}:
                quoted, index = copy_quoted(index, character)
                characters.append(quoted)
            elif character == "`":
                characters.append(character)
                template, index = scan_template(index + 1)
                characters.append(template)
            elif character == "/" and next_character == "/":
                index += 2
                while index < len(text) and text[index] not in "\r\n":
                    index += 1
            elif character == "/" and next_character == "*":
                index += 2
                while index < len(text):
                    if text[index] == "*" and index + 1 < len(text) and text[index + 1] == "/":
                        index += 2
                        break
                    index += 1
            elif character == "/":
                regex = _regex_for_fingerprint(
                    text,
                    index,
                    preserve_literal_content=True,
                )
                if regex is not None:
                    literal, index = regex
                    characters.append(literal)
                else:
                    characters.append(character)
                    index += 1
            else:
                characters.append(character)
                index += 1
        return "".join(characters), index

    stripped, _ = scan_code(0, stop_at_brace=False)
    return stripped


def _normalize_javascript_whitespace(
    text: str,
    *,
    preserve_literal_content: bool = True,
) -> str:
    """コード上の空白を除去し、必要に応じて文字列内容を保持する。"""

    def copy_quoted(index: int, quote: str) -> tuple[str, int]:
        if not preserve_literal_content:
            end = index + 1
            while end < len(text):
                character = text[end]
                end += 1
                if character == "\\" and end < len(text):
                    end += 1
                elif character == quote:
                    break
            return f"{quote}S{quote}", end

        characters = [quote]
        index += 1
        while index < len(text):
            character = text[index]
            characters.append(character)
            index += 1
            if character == "\\" and index < len(text):
                characters.append(text[index])
                index += 1
            elif character == quote:
                break
        return "".join(characters), index

    def scan_template(index: int) -> tuple[str, int]:
        characters: list[str] = []
        raw_content_added = False
        while index < len(text):
            character = text[index]
            if character == "\\":
                if preserve_literal_content:
                    characters.append(character)
                elif not raw_content_added:
                    characters.append("T")
                    raw_content_added = True
                index += 1
                if index < len(text):
                    if preserve_literal_content:
                        characters.append(text[index])
                    index += 1
            elif character == "`":
                characters.append(character)
                return "".join(characters), index + 1
            elif character == "$" and index + 1 < len(text) and text[index + 1] == "{":
                characters.append("${")
                interpolation, index = scan_code(index + 2, stop_at_brace=True)
                characters.append(interpolation)
            else:
                if preserve_literal_content:
                    characters.append(character)
                elif not raw_content_added:
                    characters.append("T")
                    raw_content_added = True
                index += 1
        return "".join(characters), index

    def scan_code(index: int, *, stop_at_brace: bool) -> tuple[str, int]:
        characters: list[str] = []
        brace_depth = 0
        while index < len(text):
            character = text[index]
            if stop_at_brace and character == "}" and brace_depth == 0:
                characters.append(character)
                return "".join(characters), index + 1
            if stop_at_brace and character == "{":
                brace_depth += 1
                characters.append(character)
                index += 1
            elif stop_at_brace and character == "}":
                brace_depth -= 1
                characters.append(character)
                index += 1
            elif character in {"'", '"'}:
                quoted, index = copy_quoted(index, character)
                characters.append(quoted)
            elif character == "`":
                characters.append(character)
                template, index = scan_template(index + 1)
                characters.append(template)
            elif character == "/":
                regex = _regex_for_fingerprint(
                    text,
                    index,
                    preserve_literal_content=preserve_literal_content,
                )
                if regex is not None:
                    literal, index = regex
                    characters.append(literal)
                else:
                    characters.append(character)
                    index += 1
            elif character.isspace():
                index += 1
            else:
                characters.append(character)
                index += 1
        return "".join(characters), index

    normalized, _ = scan_code(0, stop_at_brace=False)
    return normalized


def _test_language(path: str) -> str:
    return "python" if path.endswith(".py") else "javascript"


def _test_code_fingerprint(data: bytes | None, *, language: str = "javascript") -> str:
    if data is None:
        return ""
    if language == "python":
        return _python_code_fingerprint(data, preserve_literal_content=True)
    return _normalize_javascript_whitespace(_strip_javascript_comments(data))


def _test_code_structure_fingerprint(
    data: bytes | None,
    *,
    language: str = "javascript",
) -> str:
    if data is None:
        return ""
    if language == "python":
        return _python_code_fingerprint(data, preserve_literal_content=False)
    return _normalize_javascript_whitespace(
        _strip_javascript_comments(data),
        preserve_literal_content=False,
    )


def _vitest_snapshot_value_fingerprint(data: bytes | None) -> str:
    """Vitest snapshotの値だけを比較し、コメントとコード空白を無視する。"""

    if data is None:
        return ""
    text = data.decode("utf-8", errors="replace")
    key_matches = tuple(_VITEST_SNAPSHOT_KEY.finditer(text))
    if not key_matches:
        return ""
    values = []
    for index, match in enumerate(key_matches):
        value_end = key_matches[index + 1].start() if index + 1 < len(key_matches) else len(text)
        value = text[match.end() : value_end]
        values.append(
            _normalize_javascript_whitespace(
                _strip_javascript_comments(value.encode("utf-8")),
                preserve_literal_content=True,
            )
        )
    # export keyを除いて比較する場合でも、単なるexport順変更は値のmultisetが
    # 変わらないため、検証変更として扱わない。
    return "\x1e".join(sorted(values))


_JAVASCRIPT_ASSERTION = re.compile(
    r"(?<![A-Za-z0-9_$?.])\b(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)"
    r"(?:(?:\s*\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*)*\s*\("
)
_JAVASCRIPT_NODE_ASSERTION_CALL = re.compile(
    r"(?<![A-Za-z0-9_$?.])\b(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)\s*"
    r"(?:(?:\.\s*|\?\.\s*)(?P<dot>[A-Za-z_$][A-Za-z0-9_$]*)|"
    r"(?:\?\.)?\s*\[\s*['\"`](?P<bracket>[A-Za-z_$][A-Za-z0-9_$]*)['\"`]\s*\])\s*\("
)
_JAVASCRIPT_NODE_ASSERTION_METHODS = frozenset(
    {
        "deepEqual",
        "deepStrictEqual",
        "doesNotMatch",
        "doesNotReject",
        "doesNotThrow",
        "equal",
        "fail",
        "ifError",
        "match",
        "notDeepEqual",
        "notDeepStrictEqual",
        "notEqual",
        "notStrictEqual",
        "ok",
        "partialDeepStrictEqual",
        "rejects",
        "strictEqual",
        "throws",
    }
)
_JAVASCRIPT_NODE_ASSERT_NAMESPACE_IMPORT = re.compile(
    r"\bimport\s*\*\s*as\s+(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)\s+from\s*"
    r"(['\"])(?:assert|node:assert(?:/strict)?)\2"
)
_JAVASCRIPT_NODE_ASSERT_DEFAULT_IMPORT = re.compile(
    r"\bimport\s+(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)\s*"
    r"(?:,\s*(?:\{[^{}]*\}|\*\s*as\s+[A-Za-z_$][A-Za-z0-9_$]*))?\s+from\s*"
    r"(['\"])(?:assert|node:assert(?:/strict)?)\2"
)
_JAVASCRIPT_NODE_ASSERT_NAMED_IMPORT = re.compile(
    r"\bimport\s*\{(?P<specifiers>[^{}]*)\}\s*from\s*"
    r"(['\"])(?:assert|node:assert(?:/strict)?)\2"
)
_JAVASCRIPT_NODE_ASSERT_REQUIRE = re.compile(
    r"\b(?:const|let|var)\s+(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"
    r"require\s*\(\s*(['\"])(?:assert|node:assert(?:/strict)?)\2\s*\)"
)
_JAVASCRIPT_NODE_ASSERT_DESTRUCTURED_REQUIRE = re.compile(
    r"\b(?:const|let|var)\s*\{(?P<specifiers>[^{}]*)\}\s*=\s*require\s*\(\s*"
    r"(['\"])(?:assert|node:assert(?:/strict)?)\2\s*\)"
)
_JAVASCRIPT_NODE_ASSERT_TS_IMPORT = re.compile(
    r"\bimport\s+(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\s*\(\s*"
    r"(['\"])(?:assert|node:assert(?:/strict)?)\2\s*\)"
)
_JAVASCRIPT_EXPECT_NAMED_IMPORT = re.compile(
    r"\bimport\s*\{(?P<specifiers>[^{}]*)\}\s*from\s*"
    r"(?P<quote>['\"])(?P<module>[^'\"]+)(?P=quote)"
)
_JAVASCRIPT_EXPECT_REQUIRE = re.compile(
    r"\b(?:const|let|var)\s*\{(?P<specifiers>[^{}]*)\}\s*=\s*require\s*\(\s*"
    r"(?P<quote>['\"])(?P<module>[^'\"]+)(?P=quote)\s*\)"
)
_JAVASCRIPT_TEST_RUNNER_BINDING = frozenset({"test", "it", "specify"})
_JAVASCRIPT_EXPECT_SHADOW_DECLARATION = re.compile(
    r"\b(?:const|let|var|class|function)\s+(?P<binding>[A-Za-z_$][A-Za-z0-9_$]*)\b"
)
_JAVASCRIPT_OBJECT_METHODS = frozenset(
    {
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toJSON",
        "toLocaleString",
        "toString",
        "valueOf",
    }
)
_JAVASCRIPT_MATCHER_CALL = re.compile(
    r"(?P<chain>(?:(?:\s*\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*)+)\s*\("
)
_JAVASCRIPT_IDENTIFIER_AT_END = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*\s*$")


def _javascript_expect_module_is_known(module: str) -> bool:
    return module in {"vitest", "@playwright/test"} or re.fullmatch(
        r"(?:\.\.?/)+fixtures",
        module,
    ) is not None


def _javascript_test_runner_bindings(
    source: str,
    *,
    masked_source: str | None = None,
) -> frozenset[str]:
    """既知のtest runnerからimportされた未shadowのtest bindingを返す。"""

    if masked_source is None:
        masked_source = _mask_javascript_literals(source)

    def is_code_match(match: re.Match[str]) -> bool:
        return (
            match.start() < len(masked_source)
            and not masked_source[match.start()].isspace()
        )

    bindings: set[str] = set()
    for pattern in (_JAVASCRIPT_EXPECT_NAMED_IMPORT, _JAVASCRIPT_EXPECT_REQUIRE):
        for match in pattern.finditer(source):
            if not is_code_match(match) or not _javascript_expect_module_is_known(
                match.group("module")
            ):
                continue
            for specifier in match.group("specifiers").split(","):
                specifier = specifier.strip()
                if specifier.startswith("type "):
                    continue
                parts = re.split(r"\s+as\s+", specifier, maxsplit=1)
                imported = parts[0].strip()
                local = parts[-1].strip()
                if imported in _JAVASCRIPT_TEST_RUNNER_BINDING and re.fullmatch(
                    r"[A-Za-z_$][A-Za-z0-9_$]*",
                    local,
                ):
                    bindings.add(local)

    # A local declaration with the same name invalidates the imported runner
    # binding for this conservative static analysis. This also handles the
    # common failure mode where a no-op `test` replaces the real runner.
    declared_bindings = {
        match.group("binding")
        for match in _JAVASCRIPT_EXPECT_SHADOW_DECLARATION.finditer(masked_source)
        if match.group("binding") in bindings
    }
    return frozenset(bindings - declared_bindings)


def _javascript_expect_bindings(
    source: str,
    *,
    masked_source: str | None = None,
) -> frozenset[str]:
    """Vitest/Playwrightまたは既知のfixtureからimportされたexpect名を返す。"""

    if masked_source is None:
        masked_source = _mask_javascript_literals(source)

    def is_code_match(match: re.Match[str]) -> bool:
        return (
            match.start() < len(masked_source)
            and not masked_source[match.start()].isspace()
        )

    bindings: set[str] = set()
    for pattern in (_JAVASCRIPT_EXPECT_NAMED_IMPORT, _JAVASCRIPT_EXPECT_REQUIRE):
        for match in pattern.finditer(source):
            if not is_code_match(match) or not _javascript_expect_module_is_known(
                match.group("module")
            ):
                continue
            for specifier in match.group("specifiers").split(","):
                specifier = specifier.strip()
                if specifier.startswith("type "):
                    continue
                parts = re.split(r"\s+as\s+", specifier, maxsplit=1)
                imported = parts[0].strip()
                local = parts[-1].strip()
                if imported == "expect" and re.fullmatch(
                    r"[A-Za-z_$][A-Za-z0-9_$]*",
                    local,
                ):
                    bindings.add(local)
    return frozenset(bindings)


def _javascript_shadowed_expect_bindings(
    masked_source: str,
    start: int,
    end: int,
    expect_bindings: Iterable[str],
) -> frozenset[str]:
    return _javascript_shadowed_bindings_in_ranges(
        masked_source,
        ((start, end),),
        expect_bindings,
    )


def _javascript_shadowed_bindings_in_ranges(
    masked_source: str,
    ranges: Iterable[tuple[int, int]],
    bindings: Iterable[str],
) -> frozenset[str]:
    """複数のlexical scope内で宣言されたbindingをまとめて返す。"""

    expected = frozenset(bindings)
    return frozenset(
        match.group("binding")
        for start, end in ranges
        for match in _JAVASCRIPT_EXPECT_SHADOW_DECLARATION.finditer(masked_source, start, end)
        if match.group("binding") in expected
    )


def _javascript_shadowed_expect_bindings_for_test(
    masked_source: str,
    call_start: int,
    body_start: int,
    body_end: int,
    suite_records: Sequence[tuple[int, int, int, str | None]],
    expect_bindings: Iterable[str],
) -> frozenset[str]:
    """test本体と、それを含むsuite callbackのexpect shadowを返す。"""

    ranges = [(body_start, body_end)]
    ranges.extend(
        (suite_body_start, suite_body_end)
        for _, suite_body_start, suite_body_end, _ in suite_records
        if suite_body_start <= call_start < suite_body_end
    )
    return _javascript_shadowed_bindings_in_ranges(
        masked_source,
        ranges,
        expect_bindings,
    )


def _javascript_shadowed_node_assert_bindings_for_test(
    masked_source: str,
    call_start: int,
    body_start: int,
    body_end: int,
    suite_records: Sequence[tuple[int, int, int, str | None]],
    node_assert_bindings: Iterable[str],
) -> frozenset[str]:
    """test本体と包含suiteでshadowされたNode assert bindingを返す。"""

    ranges = [(body_start, body_end)]
    ranges.extend(
        (suite_body_start, suite_body_end)
        for _, suite_body_start, suite_body_end, _ in suite_records
        if suite_body_start <= call_start < suite_body_end
    )
    return _javascript_shadowed_bindings_in_ranges(
        masked_source,
        ranges,
        node_assert_bindings,
    )


def _javascript_node_assert_bindings(
    source: str,
    *,
    masked_source: str | None = None,
) -> frozenset[str]:
    """Node assertion APIからimport/requireされたbinding名を返す。"""

    if masked_source is None:
        masked_source = _mask_javascript_literals(source)

    def is_code_match(match: re.Match[str]) -> bool:
        return (
            match.start() < len(masked_source)
            and not masked_source[match.start()].isspace()
        )

    bindings: set[str] = set()
    bindings.update(
        match.group("binding")
        for pattern in (
            _JAVASCRIPT_NODE_ASSERT_NAMESPACE_IMPORT,
            _JAVASCRIPT_NODE_ASSERT_DEFAULT_IMPORT,
            _JAVASCRIPT_NODE_ASSERT_REQUIRE,
            _JAVASCRIPT_NODE_ASSERT_TS_IMPORT,
        )
        for match in pattern.finditer(source)
        if is_code_match(match)
    )
    for pattern in (
        _JAVASCRIPT_NODE_ASSERT_NAMED_IMPORT,
        _JAVASCRIPT_NODE_ASSERT_DESTRUCTURED_REQUIRE,
    ):
        for match in pattern.finditer(source):
            if not is_code_match(match):
                continue
            for specifier in match.group("specifiers").split(","):
                specifier = specifier.strip()
                if specifier.startswith("type "):
                    continue
                parts = re.split(r"\s+as\s+", specifier, maxsplit=1)
                imported = parts[0].strip()
                local = parts[-1].strip()
                if imported in {"default", "strict"} and re.fullmatch(
                    r"[A-Za-z_$][A-Za-z0-9_$]*",
                    local,
                ):
                    bindings.add(local)
    return frozenset(bindings)


def _javascript_assertion_count(
    source: str,
    start: int = 0,
    end: int | None = None,
    *,
    masked_source: str | None = None,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
    node_assert_bindings: frozenset[str] | None = None,
    shadowed_node_assert_bindings: frozenset[str] | None = None,
    expect_bindings: frozenset[str] | None = None,
    shadowed_expect_bindings: frozenset[str] | None = None,
    function_scopes: Sequence[tuple[int, int, int, frozenset[str]]] | None = None,
    binding_scope_index: Mapping[
        str,
        tuple[tuple[int, ...], tuple[int, ...]],
    ] | None = None,
    direct_callback_callee_index: Mapping[int, str] | None = None,
    function_scope_start_index: tuple[int, ...] | None = None,
) -> int:
    """検証runnerまたはNode assertion APIのassertion数を数える。"""

    if end is None:
        end = len(source)
    if masked_source is None:
        masked_source = _mask_javascript_literals(source)
    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    if function_scopes is None:
        function_scopes = _javascript_function_scopes_cached(source)
    if binding_scope_index is None:
        binding_scope_index = _javascript_binding_scope_index(function_scopes)
    if function_scope_start_index is None:
        function_scope_start_index = _javascript_function_scope_start_index(function_scopes)
    if direct_callback_callee_index is None:
        direct_callback_callee_index = _javascript_direct_callback_callee_index(
            masked_source,
            argument_span_index,
        )
    if node_assert_bindings is None:
        node_assert_bindings = _javascript_node_assert_bindings(
            source,
            masked_source=masked_source,
        )
    if shadowed_node_assert_bindings is None:
        shadowed_node_assert_bindings = _javascript_shadowed_bindings_in_ranges(
            masked_source,
            ((start, end),),
            node_assert_bindings,
        )
    if expect_bindings is None:
        expect_bindings = _javascript_expect_bindings(
            source,
            masked_source=masked_source,
        )
    if shadowed_expect_bindings is None:
        shadowed_expect_bindings = _javascript_shadowed_expect_bindings(
            masked_source,
            start,
            end,
            expect_bindings,
        )
    nested_function_ranges = _javascript_nested_function_ranges(
        source,
        start,
        end,
        argument_span_index=argument_span_index,
        function_scopes=function_scopes,
        direct_callback_callee_index=direct_callback_callee_index,
        function_scope_start_index=function_scope_start_index,
        masked_source=masked_source,
    )

    def is_nested_function_position(position: int) -> bool:
        return any(
            range_start <= position < range_end
            for range_start, range_end in nested_function_ranges
        )

    count = 0
    for match in _JAVASCRIPT_NODE_ASSERTION_CALL.finditer(masked_source, start, end):
        method = match.group("dot") or match.group("bracket")
        if (
            match.group("binding") in node_assert_bindings
            and match.group("binding") not in shadowed_node_assert_bindings
            and not _javascript_binding_shadowed_at(
                source,
                match.start(),
                match.group("binding"),
                function_scopes=function_scopes,
                binding_scope_index=binding_scope_index,
            )
            and method in _JAVASCRIPT_NODE_ASSERTION_METHODS
            and not is_nested_function_position(match.start())
        ):
            count += 1
    for match in _JAVASCRIPT_ASSERTION.finditer(masked_source, start, end):
        if (
            match.group("binding") not in expect_bindings
            or match.group("binding") in shadowed_expect_bindings
            or _javascript_binding_shadowed_at(
                source,
                match.start(),
                match.group("binding"),
                function_scopes=function_scopes,
                binding_scope_index=binding_scope_index,
            )
            or is_nested_function_position(match.start())
        ):
            continue
        open_index = match.end() - 1
        argument_spans = argument_span_index.get(open_index)
        if argument_spans is None:
            continue
        close_index = argument_spans[-1][1] if argument_spans else open_index + 1
        matcher_start = close_index + 1
        while matcher_start < end and masked_source[matcher_start].isspace():
            matcher_start += 1
        matcher_match = _JAVASCRIPT_MATCHER_CALL.match(masked_source, matcher_start, end)
        if matcher_match is None:
            continue
        method_match = _JAVASCRIPT_IDENTIFIER_AT_END.search(matcher_match.group("chain"))
        if (
            method_match is not None
            and method_match.group(0).strip().startswith("to")
            and method_match.group(0).strip() not in _JAVASCRIPT_OBJECT_METHODS
        ):
            count += 1
    return count


def _python_test_shape(data: bytes | None) -> tuple[int, int]:
    if data is None or _is_binary(data):
        return (0, 0)
    text = data.decode("utf-8", errors="replace")
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (IndentationError, SyntaxError, tokenize.TokenError, ValueError):
        return (
            len(re.findall(r"(?m)^\s*(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(", text)),
            len(re.findall(r"(?m)^\s*assert\b", text))
            + len(re.findall(r"\bself\s*\.\s*assert[A-Za-z0-9_]*\s*\(", text)),
        )

    meaningful = [
        token
        for token in tokens
        if token.type
        not in {
            tokenize.COMMENT,
            tokenize.ENCODING,
            tokenize.ENDMARKER,
            tokenize.INDENT,
            tokenize.DEDENT,
            tokenize.NEWLINE,
            tokenize.NL,
            tokenize.STRING,
        }
    ]
    declarations = 0
    assertions = 0
    for index, token in enumerate(meaningful):
        if token.type == tokenize.NAME and token.string == "def":
            if index + 1 < len(meaningful):
                name = meaningful[index + 1]
                if name.type == tokenize.NAME and name.string.startswith("test_"):
                    declarations += 1
        if token.type == tokenize.NAME and token.string == "assert":
            assertions += 1
        if (
            token.type == tokenize.NAME
            and token.string.startswith("assert")
            and index > 0
            and meaningful[index - 1].type == tokenize.OP
            and meaningful[index - 1].string == "."
        ):
            assertions += 1
    return declarations, assertions


def _test_shape(data: bytes | None, *, language: str) -> tuple[int, int]:
    if data is None:
        return (0, 0)
    if language == "python":
        return _python_test_shape(data)
    source = _strip_javascript_comments(data)
    masked_source = _mask_javascript_literals(source)
    argument_span_index = _javascript_call_argument_span_index(source)
    function_scopes = _javascript_function_scopes(
        source,
        argument_span_index=argument_span_index,
    )
    binding_scope_index = _javascript_binding_scope_index(function_scopes)
    function_scope_start_index = _javascript_function_scope_start_index(function_scopes)
    direct_callback_callee_index = _javascript_direct_callback_callee_index(
        masked_source,
        argument_span_index,
    )
    node_assert_bindings = _javascript_node_assert_bindings(
        source,
        masked_source=masked_source,
    )
    expect_bindings = _javascript_expect_bindings(
        source,
        masked_source=masked_source,
    )
    callbacks = _javascript_test_callback_records(source)
    suite_records = _javascript_suite_callback_records(
        source,
        argument_span_index=argument_span_index,
    )
    assertion_count = 0
    for call_start, body_start, body_end, disabled, _ in callbacks:
        if disabled:
            continue
        shadowed_expect_bindings = _javascript_shadowed_expect_bindings_for_test(
            masked_source,
            call_start,
            body_start,
            body_end,
            suite_records,
            expect_bindings,
        )
        shadowed_node_assert_bindings = _javascript_shadowed_node_assert_bindings_for_test(
            masked_source,
            call_start,
            body_start,
            body_end,
            suite_records,
            node_assert_bindings,
        )
        assertion_count += _javascript_assertion_count(
            source,
            body_start,
            body_end,
            masked_source=masked_source,
            argument_span_index=argument_span_index,
            node_assert_bindings=node_assert_bindings,
            shadowed_node_assert_bindings=shadowed_node_assert_bindings,
            expect_bindings=expect_bindings,
            shadowed_expect_bindings=shadowed_expect_bindings,
            function_scopes=function_scopes,
            binding_scope_index=binding_scope_index,
            direct_callback_callee_index=direct_callback_callee_index,
            function_scope_start_index=function_scope_start_index,
        )
    return len(callbacks), assertion_count


def _has_executable_test_reduction(
    base_data: bytes | None,
    head_data: bytes | None,
    *,
    language: str,
) -> bool:
    base_shape = _test_shape(base_data, language=language)
    head_shape = _test_shape(head_data, language=language)
    return any(head < base for base, head in zip(base_shape, head_shape))


def _javascript_test_behavior_fingerprint(data: bytes | None) -> tuple[str, ...]:
    return tuple(behavior for behavior, _ in _javascript_test_behavior_records(data))


def _javascript_test_body_argument_index(arguments: Sequence[str]) -> int | None:
    """test呼び出しのinline callback引数の位置を返す。"""

    for index in range(len(arguments) - 1, 0, -1):
        argument = arguments[index]
        candidate = argument.strip()
        if (
            "=>" in candidate
            or re.search(r"\bfunction\b", candidate)
        ):
            return index
    return None


def _javascript_test_body_argument(arguments: Sequence[str]) -> str | None:
    """test呼び出しからtitle/optionsを除いたinline callbackを取り出す。"""

    index = _javascript_test_body_argument_index(arguments)
    return arguments[index].strip() if index is not None else None


def _javascript_test_call_pattern(
    bindings: Iterable[str],
    *,
    disabled: bool = False,
    parameterized: bool = False,
) -> re.Pattern[str] | None:
    """runner binding名に対応するtest call patternを生成する。"""

    names = sorted(
        {
            binding
            for binding in bindings
            if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", binding)
        }
    )
    if not names:
        return None
    prefix = (
        r"(?<![A-Za-z0-9_$?.'\"`])\b(?P<binding>(?:"
        + "|".join(re.escape(name) for name in names)
        + r"))"
    )
    if disabled:
        disabled_chain = (
            r"(?:\s*(?:(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*|"
            r"(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
        )
        return re.compile(
            prefix
            + disabled_chain
            + r"\s*(?:(?:\.\s*|\?\.\s*)(?:skip|fixme|todo|skipIf|runIf|fail|fails)\b|"
            r"(?:\?\.)?\s*\[\s*['\"`](?:skip|fixme|todo|skipIf|runIf|fail|fails)['\"`]\s*\])"
        )
    if parameterized:
        return re.compile(
            prefix + r"\s*(?:\.\s*|\?\.\s*)each\s*\("
        )
    chain = (
        r"(?:(?:\s*(?:\.\s*|\?\.\s*)(?!(?:describe|suite)\b)"
        r"[A-Za-z_$][A-Za-z0-9_$]*)"
        r"|(?:\s*(?:\?\.)?\s*\[\s*['\"`](?!(?:describe|suite)['\"`])"
        r"[A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    )
    return re.compile(prefix + chain + r"\s*\(")


def _javascript_test_modifier_call_matches(
    source: str,
    *,
    test_bindings: frozenset[str] | None = None,
) -> tuple[re.Match[str], ...]:
    """import済みtest runnerのmodifier呼び出し範囲を返す。"""

    masked_source = _mask_javascript_literals(source)
    if test_bindings is None:
        test_bindings = _javascript_test_runner_bindings(
            source,
            masked_source=masked_source,
        )
    matches = [
        match
        for match in _DISABLED_TEST_CALL.finditer(masked_source)
        if match.group("binding") in test_bindings
    ]
    alias_pattern = _javascript_test_call_pattern(test_bindings, disabled=True)
    if alias_pattern is not None:
        matches.extend(alias_pattern.finditer(masked_source))
    unique_matches: dict[tuple[int, int], re.Match[str]] = {
        (match.start(), match.end()): match
        for match in matches
    }
    return tuple(unique_matches[key] for key in sorted(unique_matches))


def _javascript_test_modifier_call_spans(
    source: str,
    *,
    test_bindings: frozenset[str] | None = None,
) -> tuple[tuple[int, int], ...]:
    return tuple(
        (match.start(), match.end())
        for match in _javascript_test_modifier_call_matches(
            source,
            test_bindings=test_bindings,
        )
    )


def _javascript_parameterized_dataset_is_empty(
    source: str,
    argument_spans: Sequence[tuple[int, int]],
) -> bool:
    """静的に空と判定できるparameterized datasetを検出する。"""

    if not argument_spans:
        return False
    dataset = _mask_javascript_literals(
        source[argument_spans[0][0] : argument_spans[0][1]]
    ).strip()
    return re.fullmatch(r"\[\s*\](?:\s+as\s+const)?", dataset) is not None


def _javascript_empty_parameterized_suite_ranges(
    source: str,
) -> tuple[tuple[int, int], ...]:
    """空のparameterized suite callback内を検証対象から除外する。"""

    masked_source = _mask_javascript_literals(source)
    matches = list(_JAVASCRIPT_PARAMETERIZED_SUITE_CALL.finditer(masked_source))
    alias_pattern = _javascript_suite_alias_call_pattern(
        _javascript_suite_aliases(source),
        parameterized=True,
    )
    if alias_pattern is not None:
        matches.extend(alias_pattern.finditer(masked_source))
    namespace_pattern = _javascript_suite_namespace_call_pattern(
        _javascript_suite_namespace_aliases(source),
        parameterized=True,
    )
    if namespace_pattern is not None:
        matches.extend(namespace_pattern.finditer(masked_source))

    argument_span_index = _javascript_call_argument_span_index(source)
    ranges: set[tuple[int, int]] = set()
    for match in matches:
        each_open_index = match.end() - 1
        each_argument_spans = argument_span_index.get(each_open_index)
        if not each_argument_spans or not _javascript_parameterized_dataset_is_empty(
            source,
            each_argument_spans,
        ):
            continue
        each_close_index = each_argument_spans[-1][1]
        while each_close_index < len(source) and source[each_close_index].isspace():
            each_close_index += 1
        if each_close_index >= len(source) or source[each_close_index] != ")":
            continue
        returned_open_index = each_close_index + 1
        while returned_open_index < len(source) and source[returned_open_index].isspace():
            returned_open_index += 1
        if returned_open_index >= len(source) or source[returned_open_index] != "(":
            continue
        close_index = _javascript_call_close_index(
            source,
            returned_open_index,
            argument_span_index,
        )
        if close_index is not None:
            ranges.add((returned_open_index, close_index + 1))
    return tuple(sorted(ranges))


def _javascript_unreachable_test_ranges(
    source: str,
) -> tuple[tuple[int, int], ...]:
    """静的false分岐内のtest宣言範囲を検証対象から除外する。"""

    masked_source = _mask_javascript_literals(source)
    braced_end_index = _javascript_braced_end_index(masked_source, None)
    ranges: list[tuple[int, int]] = []
    for match in re.finditer(r"\bif\s*\(\s*(?:false|0)\s*\)", masked_source):
        body_start = match.end()
        while body_start < len(source) and source[body_start].isspace():
            body_start += 1
        if body_start >= len(source) or source[body_start] != "{":
            continue
        body_end = braced_end_index.get(body_start)
        if body_end is not None:
            ranges.append((body_start, body_end))
    return tuple(ranges)


def _javascript_test_call_spans(
    source: str,
    *,
    test_bindings: frozenset[str] | None = None,
) -> tuple[tuple[int, int], ...]:
    """通常・parameterized test呼び出しの開始位置と引数括弧位置を返す。"""

    if test_bindings is None:
        test_bindings = _javascript_test_runner_bindings(source)
    masked_source = _mask_javascript_literals(source)
    argument_span_index = _javascript_call_argument_span_index(source)
    test_call_pattern = _javascript_test_call_pattern(test_bindings)
    parameterized_test_pattern = _javascript_test_call_pattern(
        test_bindings,
        parameterized=True,
    )
    if test_call_pattern is None or parameterized_test_pattern is None:
        return ()
    function_scopes = _javascript_function_scopes(
        source,
        argument_span_index=argument_span_index,
    )
    binding_scope_index = _javascript_binding_scope_index(function_scopes)
    empty_parameterized_suite_ranges = _javascript_empty_parameterized_suite_ranges(source)
    unreachable_test_ranges = _javascript_unreachable_test_ranges(source)

    def is_shadowed(match: re.Match[str]) -> bool:
        return _javascript_binding_shadowed_at(
            source,
            match.start(),
            match.group("binding"),
            function_scopes=function_scopes,
            binding_scope_index=binding_scope_index,
        )

    def is_inside_empty_parameterized_suite(position: int) -> bool:
        return any(
            range_start <= position < range_end
            for range_start, range_end in empty_parameterized_suite_ranges
        )

    def is_inside_unreachable_test_range(position: int) -> bool:
        return any(
            range_start <= position < range_end
            for range_start, range_end in unreachable_test_ranges
        )

    parameterized_open_indexes = {
        match.end() - 1
        for match in parameterized_test_pattern.finditer(masked_source)
        if not is_shadowed(match)
        and not is_inside_empty_parameterized_suite(match.start())
        and not is_inside_unreachable_test_range(match.start())
    }
    calls: list[tuple[int, int]] = []
    for match in test_call_pattern.finditer(masked_source):
        if (
            match.end() - 1 in parameterized_open_indexes
            or is_shadowed(match)
            or is_inside_empty_parameterized_suite(match.start())
            or is_inside_unreachable_test_range(match.start())
        ):
            continue
        calls.append((match.start(), match.end() - 1))

    for match in parameterized_test_pattern.finditer(masked_source):
        if (
            is_shadowed(match)
            or is_inside_empty_parameterized_suite(match.start())
            or is_inside_unreachable_test_range(match.start())
        ):
            continue
        each_open_index = match.end() - 1
        each_argument_spans = argument_span_index.get(each_open_index)
        if each_argument_spans is None:
            continue
        if _javascript_parameterized_dataset_is_empty(
            source,
            each_argument_spans,
        ):
            continue
        each_close_index = each_argument_spans[-1][1] if each_argument_spans else each_open_index + 1
        while each_close_index < len(source) and source[each_close_index].isspace():
            each_close_index += 1
        if each_close_index >= len(source) or source[each_close_index] != ")":
            continue
        open_index = each_close_index + 1
        while open_index < len(source) and source[open_index].isspace():
            open_index += 1
        if open_index < len(source) and source[open_index] == "(":
            calls.append((match.start(), open_index))
    calls.extend(
        (call_start, open_index)
        for call_start, open_index, _, binding in _javascript_conditional_test_call_spans(source)
        if not _javascript_binding_shadowed_at(
            source,
            call_start,
            binding,
            function_scopes=function_scopes,
            binding_scope_index=binding_scope_index,
        )
        and not is_inside_empty_parameterized_suite(call_start)
        and not is_inside_unreachable_test_range(call_start)
    )
    return tuple(sorted(set(calls)))


def _javascript_suite_callback_records(
    source: str,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int, int, str | None], ...]:
    """suite呼び出しとinline callback、静的titleの範囲を返す。"""

    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    masked_source = _mask_javascript_literals(source)
    callbacks: list[tuple[int, int, int, str | None]] = []
    for call_start, open_index in _javascript_suite_call_spans(source):
        argument_spans = _javascript_call_argument_spans(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if argument_spans is None:
            continue
        arguments = tuple(source[start:end] for start, end in argument_spans)
        body_index = _javascript_test_body_argument_index(arguments)
        if body_index is None:
            continue
        body_start, body_end = argument_spans[body_index]
        callbacks.append(
            (
                call_start,
                body_start,
                body_end,
                _javascript_static_test_title(arguments),
            )
        )
    return tuple(callbacks)


def _javascript_suite_callback_spans(
    source: str,
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int, int], ...]:
    return tuple(
        (call_start, body_start, body_end)
        for call_start, body_start, body_end, _ in _javascript_suite_callback_records(
            source,
            argument_span_index=argument_span_index,
        )
    )


def _javascript_conditional_suite_scope_disabled_calls(
    source: str,
    suite_records: Sequence[tuple[int, int, int, str | None]],
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int, int], ...]:
    """条件付きsuite modifierの無効化を返却されたcallbackへ伝播する。"""

    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    suite_by_start = {
        call_start: (body_start, body_end)
        for call_start, body_start, body_end, _ in suite_records
    }
    disabled_calls: list[tuple[int, int, int]] = []
    for call_start, call_end in _javascript_disabled_call_spans(source):
        suite = suite_by_start.get(call_start)
        if suite is None:
            continue
        modifier_call = _javascript_conditional_suite_modifier_call(
            source,
            call_start,
            call_end,
            argument_span_index=argument_span_index,
        )
        if modifier_call is None or not _javascript_conditional_suite_is_disabled(
            modifier_call[0],
            modifier_call[1],
        ):
            continue
        body_start, body_end = suite
        disabled_calls.append((call_start, body_start, body_end))
    return tuple(disabled_calls)


def _javascript_unconditional_scope_disabled_calls(
    source: str,
    test_callbacks: Sequence[tuple[int, int, int]],
    suite_callbacks: Sequence[tuple[int, int, int]],
    *,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
) -> tuple[tuple[int, int | None, int | None], ...]:
    """file/suite scopeの無条件modifierを同じscopeのtestへ適用する。"""

    if argument_span_index is None:
        argument_span_index = _javascript_call_argument_span_index(source)
    disabled_calls: list[tuple[int, int | None, int | None]] = []
    for call_start, call_end in _javascript_disabled_call_spans(source):
        modifier_match = re.search(
            r"(?:\.\s*|\?\.\s*)(?P<dot>skip|fixme|todo|fail|fails)\b"
            r"|(?:\?\.)?\s*\[\s*['\"`](?P<bracket>skip|fixme|todo|fail|fails)['\"`]\s*\]",
            source[call_start:call_end],
        )
        if modifier_match is None:
            continue
        modifier = modifier_match.group("dot") or modifier_match.group("bracket")
        if modifier is None:
            continue
        open_index = call_end
        while open_index < len(source) and source[open_index].isspace():
            open_index += 1
        if open_index >= len(source) or source[open_index] != "(":
            continue
        arguments = _javascript_call_arguments(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if arguments is None:
            continue
        first_argument = arguments[0].strip() if arguments else ""
        if first_argument and first_argument not in {"true", "1"}:
            continue
        if any(body_start <= call_start < body_end for _, body_start, body_end in test_callbacks):
            continue
        containing_suites = [
            suite
            for suite in suite_callbacks
            if suite[1] <= call_start < suite[2]
        ]
        if containing_suites:
            _, body_start, body_end = min(
                containing_suites,
                key=lambda suite: suite[2] - suite[1],
            )
            disabled_calls.append((call_start, body_start, body_end))
        else:
            disabled_calls.append((call_start, None, None))
    return tuple(disabled_calls)


def _javascript_callback_has_scope_disabled_call(
    call_start: int,
    scope_disabled_calls: Sequence[tuple[int, int | None, int | None]],
) -> bool:
    return any(
        scope_start is None
        or (
            scope_end is not None
            and scope_start <= call_start < scope_end
        )
        for _, scope_start, scope_end in scope_disabled_calls
    )


def _javascript_callback_contains_disabled_call(
    disabled_ranges: Sequence[tuple[int, int]],
    body_start: int,
    body_end: int,
) -> bool:
    """callback内のruntime modifierを、そのtest全体の無効化として扱う。"""

    return any(body_start <= start < body_end for start, _ in disabled_ranges)


def _javascript_qualified_test_title(
    call_start: int,
    title: str | None,
    suite_callbacks: Sequence[tuple[int, int, int, str | None]],
) -> str | None:
    """test titleへ静的な親suite titleを付け、snapshot keyと同じ完全名にする。"""

    if title is None:
        return None
    containing_suites = [
        suite
        for suite in suite_callbacks
        if suite[1] <= call_start < suite[2]
    ]
    if any(suite[3] is None for suite in containing_suites):
        return None
    suite_titles = [
        suite[3]
        for suite in sorted(
            containing_suites,
            key=lambda suite: (-(suite[2] - suite[1]), suite[0]),
        )
    ]
    return " > ".join((*suite_titles, title))


def _javascript_test_callback_records(
    source: str,
) -> tuple[tuple[int, int, int, bool, str | None], ...]:
    """test callbackの位置、無効化状態、静的titleを返す。"""

    masked_source = _mask_javascript_literals(source)
    disabled_ranges = _disabled_javascript_call_ranges(source)
    argument_span_index = _javascript_call_argument_span_index(source)
    disabled_option_variables = _javascript_disabled_test_option_variables(source)
    suite_records = _javascript_suite_callback_records(source)
    raw_callbacks: list[tuple[int, int, int, str, bool, str | None]] = []
    for call_start, open_index in _javascript_test_call_spans(source):
        argument_spans = _javascript_call_argument_spans(
            source,
            open_index,
            argument_span_index=argument_span_index,
        )
        if argument_spans is None:
            continue
        arguments = tuple(source[start:end] for start, end in argument_spans)
        body_index = _javascript_test_body_argument_index(arguments)
        if body_index is None:
            continue
        body_start, body_end = argument_spans[body_index]
        raw_callbacks.append(
            (
                call_start,
                body_start,
                body_end,
                arguments[body_index],
                any(start <= call_start < end for start, end in disabled_ranges)
                or (
                    len(arguments) >= 2
                    and _javascript_options_argument_is_disabled(
                        arguments[1],
                        disabled_option_variables,
                    )
                )
                or _javascript_callback_contains_disabled_call(
                    disabled_ranges,
                    body_start,
                    body_end,
                ),
                _javascript_static_test_title(arguments),
            )
        )
    callback_spans = tuple(
        (body_start, body_end, disabled)
        for call_start, body_start, body_end, _, disabled, _ in raw_callbacks
    )
    if _javascript_test_callbacks_overlap(callback_spans):
        # 入れ子testは通常のrunner構文ではなく、callback引数の全文解析を
        # 続けると入力サイズに対して二次時間になるため、すべて無効化扱いにする。
        callbacks = [
            (call_start, body_start, body_end, True, title)
            for call_start, body_start, body_end, _, _, title in raw_callbacks
        ]
    else:
        callbacks = [
            (
                call_start,
                body_start,
                body_end,
                disabled
                or _javascript_callback_test_info_modifier_count(
                    masked_source,
                    callback,
                    body_start,
                    body_end,
                )
                > 0,
                title,
            )
            for call_start, body_start, body_end, callback, disabled, title in raw_callbacks
        ]
    suite_callbacks = tuple(
        (call_start, body_start, body_end)
        for call_start, body_start, body_end, _ in suite_records
    )
    scope_disabled_calls = _javascript_unconditional_scope_disabled_calls(
        source,
        tuple(
            (call_start, body_start, body_end)
        for call_start, body_start, body_end, _, _ in callbacks
        ),
        suite_callbacks,
        argument_span_index=argument_span_index,
    )
    scope_disabled_calls += _javascript_conditional_suite_scope_disabled_calls(
        source,
        suite_records,
        argument_span_index=argument_span_index,
    )
    return tuple(
        (
            call_start,
            body_start,
            body_end,
            disabled
            or _javascript_callback_has_scope_disabled_call(
                call_start,
                scope_disabled_calls,
            ),
            _javascript_qualified_test_title(call_start, title, suite_records),
        )
        for call_start, body_start, body_end, disabled, title in callbacks
    )


def _javascript_test_callback_spans(
    source: str,
) -> tuple[tuple[int, int, bool], ...]:
    return tuple(
        (body_start, body_end, disabled)
        for _, body_start, body_end, disabled, _ in _javascript_test_callback_records(source)
    )


def _javascript_test_callbacks_overlap(
    callback_spans: Sequence[tuple[int, int, bool]],
) -> bool:
    """入れ子test callbackを検出し、重複した全文走査を避ける。"""

    furthest_end = -1
    for body_start, body_end, _ in sorted(
        callback_spans,
        key=lambda span: (span[0], -span[1]),
    ):
        if body_start < furthest_end:
            return True
        furthest_end = max(furthest_end, body_end)
    return False


def _javascript_callback_has_executable_content(
    callback: str,
    *,
    source: str | None = None,
    start: int = 0,
    end: int | None = None,
    masked_source: str | None = None,
    argument_span_index: Mapping[int, tuple[tuple[int, int], ...] | None] | None = None,
    node_assert_bindings: frozenset[str] | None = None,
    shadowed_node_assert_bindings: frozenset[str] | None = None,
    expect_bindings: frozenset[str] | None = None,
    shadowed_expect_bindings: frozenset[str] | None = None,
    function_scopes: Sequence[tuple[int, int, int, frozenset[str]]] | None = None,
    binding_scope_index: Mapping[
        str,
        tuple[tuple[int, ...], tuple[int, ...]],
    ] | None = None,
    direct_callback_callee_index: Mapping[int, str] | None = None,
    function_scope_start_index: tuple[int, ...] | None = None,
) -> bool:
    """検証操作を含まないinline callbackをbehavior recordから除外する。"""

    normalized = _normalize_javascript_whitespace(
        callback.strip(),
        preserve_literal_content=False,
    )
    if not normalized or normalized.endswith("=>"):
        return False
    if re.search(r"=>\{\}$", normalized):
        return False
    if re.match(r"^(?:async)?function\b", normalized) and normalized.endswith("{}"):
        return False
    assertion_source = callback if source is None else source
    assertion_end = len(assertion_source) if end is None else end
    return (
        _javascript_assertion_count(
            assertion_source,
            start,
            assertion_end,
            masked_source=masked_source,
            argument_span_index=argument_span_index,
            node_assert_bindings=node_assert_bindings,
            shadowed_node_assert_bindings=shadowed_node_assert_bindings,
            expect_bindings=expect_bindings,
            shadowed_expect_bindings=shadowed_expect_bindings,
            function_scopes=function_scopes,
            binding_scope_index=binding_scope_index,
            direct_callback_callee_index=direct_callback_callee_index,
            function_scope_start_index=function_scope_start_index,
        )
        > 0
    )


def _javascript_test_behavior_records(
    data: bytes | None,
) -> tuple[tuple[str, bool], ...]:
    if data is None or _is_binary(data):
        return ()
    source = _strip_javascript_comments(data)
    callback_records = _javascript_test_callback_records(source)
    callback_spans = tuple(
        (body_start, body_end, disabled)
        for _, body_start, body_end, disabled, _ in callback_records
    )
    if _javascript_test_callbacks_overlap(callback_spans):
        # 入れ子testは通常のrunner構文ではなく、外側callbackと内側callbackの
        # 全文を重複して正規化すると入力サイズに対して二次時間になる。
        # Shadow Modeではbehavior changeを証明できない入力として扱う。
        return ()
    masked_source = _mask_javascript_literals(source)
    argument_span_index = _javascript_call_argument_span_index(source)
    function_scopes = _javascript_function_scopes(
        source,
        argument_span_index=argument_span_index,
    )
    binding_scope_index = _javascript_binding_scope_index(function_scopes)
    function_scope_start_index = _javascript_function_scope_start_index(function_scopes)
    direct_callback_callee_index = _javascript_direct_callback_callee_index(
        masked_source,
        argument_span_index,
    )
    node_assert_bindings = _javascript_node_assert_bindings(
        source,
        masked_source=masked_source,
    )
    expect_bindings = _javascript_expect_bindings(
        source,
        masked_source=masked_source,
    )
    suite_records = _javascript_suite_callback_records(
        source,
        argument_span_index=argument_span_index,
    )
    behaviors = []
    for call_start, body_start, body_end, disabled, _ in callback_records:
        callback = source[body_start:body_end].strip()
        shadowed_expect_bindings = _javascript_shadowed_expect_bindings_for_test(
            masked_source,
            call_start,
            body_start,
            body_end,
            suite_records,
            expect_bindings,
        )
        shadowed_node_assert_bindings = _javascript_shadowed_node_assert_bindings_for_test(
            masked_source,
            call_start,
            body_start,
            body_end,
            suite_records,
            node_assert_bindings,
        )
        if not _javascript_callback_has_executable_content(
            callback,
            source=source,
            start=body_start,
            end=body_end,
            masked_source=masked_source,
            argument_span_index=argument_span_index,
            node_assert_bindings=node_assert_bindings,
            shadowed_node_assert_bindings=shadowed_node_assert_bindings,
            expect_bindings=expect_bindings,
            shadowed_expect_bindings=shadowed_expect_bindings,
            function_scopes=function_scopes,
            binding_scope_index=binding_scope_index,
            direct_callback_callee_index=direct_callback_callee_index,
            function_scope_start_index=function_scope_start_index,
        ):
            continue
        behaviors.append(
            (_normalize_javascript_whitespace(callback), disabled)
        )
    return tuple(behaviors)


def _python_test_behavior_fingerprint(data: bytes | None) -> tuple[str, ...]:
    if data is None or _is_binary(data):
        return ()
    text = data.decode("utf-8", errors="replace")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return (_python_code_fingerprint(data, preserve_literal_content=True),)
    return tuple(
        ast.dump(ast.Module(body=node.body, type_ignores=[]), include_attributes=False)
        for node in ast.walk(tree)
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
        and node.name.startswith("test_")
    )


def _test_behavior_fingerprint(
    data: bytes | None,
    *,
    language: str,
) -> tuple[str, ...]:
    if language == "python":
        return _python_test_behavior_fingerprint(data)
    return _javascript_test_behavior_fingerprint(data)


def _has_test_behavior_change(
    base_data: bytes | None,
    head_data: bytes,
    *,
    language: str,
) -> bool:
    if language != "javascript":
        return _test_behavior_fingerprint(base_data, language=language) != _test_behavior_fingerprint(
            head_data,
            language=language,
        )
    base_records = _javascript_test_behavior_records(base_data)
    head_records = _javascript_test_behavior_records(head_data)
    base_behaviors = tuple(behavior for behavior, _ in base_records)
    head_behaviors = tuple(behavior for behavior, _ in head_records)
    if Counter(base_records) == Counter(head_records):
        return False
    if base_behaviors == head_behaviors:
        return False
    if (
        len(base_records) > MAX_TEST_BEHAVIOR_RECORDS
        or len(head_records) > MAX_TEST_BEHAVIOR_RECORDS
    ):
        # 大きな入力ではSequenceMatcherの二次時間を避け、対応関係を証明できない
        # 変更を検証済みとは扱わない。Shadow Modeでは人手レビュー側へ倒す。
        return False
    matcher = difflib.SequenceMatcher(
        a=base_behaviors,
        b=head_behaviors,
        autojunk=False,
    )
    return any(
        tag in {"replace", "insert"}
        and any(not disabled for _, disabled in head_records[head_start:head_end])
        for tag, _, _, head_start, head_end in matcher.get_opcodes()
    )


def _has_executable_test_change(
    base_data: bytes | None,
    head_data: bytes,
    *,
    language: str = "javascript",
) -> bool:
    """テストcase本体が実質変更された場合だけ検証追加として扱う。"""

    head_fingerprint = _test_code_fingerprint(head_data, language=language)
    return (
        bool(head_fingerprint)
        and _test_code_fingerprint(base_data, language=language) != head_fingerprint
        and _has_test_behavior_change(base_data, head_data, language=language)
    )


def _is_usable_test_change(
    item: ChangedFile,
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    *,
    binary_test_globs: Sequence[str] = (),
) -> bool:
    if item.status == "D" or item.additions <= 0:
        return False
    if item.binary and not matches_any(item.path, binary_test_globs):
        return False
    head_entry = head_snapshot.get(item.path)
    if head_entry is None or head_entry.kind != "blob":
        return False
    base_entry = base_snapshot.get(item.path)
    base_data = base_entry.data if base_entry is not None else None
    snapshot_owner = _snapshot_owner(item.path)
    if snapshot_owner is not None:
        runner, _, _ = snapshot_owner
        if (
            runner == "vitest"
            and _vitest_snapshot_value_fingerprint(base_data)
            == _vitest_snapshot_value_fingerprint(head_entry.data)
        ):
            return False
        return _is_referenced_snapshot(item.path, head_snapshot)
    if item.binary:
        return True
    language = _test_language(item.path)
    return (
        _test_shape(head_entry.data, language=language)[0] > 0
        and _has_executable_test_change(
            base_data,
            head_entry.data,
            language=language,
        )
        and not _contains_disabled_test_call(
            base_data,
            head_entry.data,
            language=language,
        )
        and not _has_executable_test_reduction(
            base_data,
            head_entry.data,
            language=language,
        )
    )


def _has_usable_test_change(
    files: Sequence[ChangedFile],
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    pure_rename_additions: frozenset[str],
    policy: Policy,
) -> bool:
    """コード変更の有無とは独立して、実質的なテスト変更を観測する。"""

    binary_test_globs = tuple(
        pattern
        for scope in policy.verification_scopes
        for pattern in scope.binary_test_globs
    )
    return any(
        matches_any(item.path, policy.test_globs)
        and item.path not in pure_rename_additions
        and _is_usable_test_change(
            item,
            base_snapshot,
            head_snapshot,
            binary_test_globs=binary_test_globs,
        )
        for item in files
    )


def _pure_test_rename_paths(
    files: Sequence[ChangedFile],
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    policy: Policy,
) -> tuple[frozenset[str], frozenset[str]]:
    """同内容のテスト追加・削除ペアを純粋なrenameとして対応付ける。"""

    added_by_content: dict[tuple[str, SnapshotEntry], list[str]] = {}
    deleted_by_content: dict[tuple[str, SnapshotEntry], list[str]] = {}
    for item in files:
        if not matches_any(item.path, policy.test_globs):
            continue
        runner = _test_runner(item.path)
        if runner is None:
            continue
        if item.status == "A":
            content = head_snapshot.get(item.path)
            if content is not None:
                added_by_content.setdefault((runner, content), []).append(item.path)
        elif item.status == "D":
            content = base_snapshot.get(item.path)
            if content is not None:
                deleted_by_content.setdefault((runner, content), []).append(item.path)

    paired_added: set[str] = set()
    paired_deleted: set[str] = set()
    for key, added_paths in added_by_content.items():
        deleted_paths = deleted_by_content.get(key, [])
        pair_count = min(len(added_paths), len(deleted_paths))
        paired_added.update(sorted(added_paths)[:pair_count])
        paired_deleted.update(sorted(deleted_paths)[:pair_count])
    return frozenset(paired_added), frozenset(paired_deleted)


def _has_test_removal(
    files: Sequence[ChangedFile],
    base_snapshot: Mapping[str, SnapshotEntry],
    head_snapshot: Mapping[str, SnapshotEntry],
    policy: Policy,
) -> bool:
    """テストの削除・純減を検出し、同内容の純粋なrenameは除外する。"""

    _, pure_rename_deletions = _pure_test_rename_paths(
        files,
        base_snapshot,
        head_snapshot,
        policy,
    )
    for item in files:
        if not matches_any(item.path, policy.test_globs):
            continue
        if item.status == "M":
            head_entry = head_snapshot.get(item.path)
            if head_entry is not None and head_entry.kind != "blob":
                return True
            base_entry = base_snapshot.get(item.path)
            if (
                item.binary
                and _snapshot_owner(item.path) is None
                and base_entry is not None
                and base_entry.kind == "blob"
            ):
                return True
            if _contains_disabled_test_call(
                base_entry.data if base_entry is not None else None,
                head_entry.data if head_entry is not None else None,
                language=_test_language(item.path),
            ):
                return True
            if (
                not item.binary
                and base_entry is not None
                and base_entry.kind == "blob"
                and head_entry is not None
                and head_entry.kind == "blob"
                and _has_executable_test_reduction(
                    base_entry.data,
                    head_entry.data,
                    language=_test_language(item.path),
                )
            ):
                return True
            if (
                not item.binary
                and base_entry is not None
                and base_entry.kind == "blob"
                and head_entry is not None
                and head_entry.kind == "blob"
                and len(
                    _test_code_structure_fingerprint(
                        head_entry.data,
                        language=_test_language(item.path),
                    )
                )
                < len(
                    _test_code_structure_fingerprint(
                        base_entry.data,
                        language=_test_language(item.path),
                    )
                )
            ):
                return True
        if item.status != "D" and item.additions >= item.deletions:
            continue
        if item.status == "D" and item.path in pure_rename_deletions:
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
    base_symlinks: Path | None = None,
    head_symlinks: Path | None = None,
) -> RiskAssessment:
    base_snapshot = _read_snapshot(base_dir, base_gitlinks, base_symlinks)
    head_snapshot = _read_snapshot(head_dir, head_gitlinks, head_symlinks)
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

    code_changes = any(
        matches_any(item.path, policy.code_globs)
        and not matches_any(item.path, policy.test_globs)
        for item in files
    )
    pure_rename_additions, _ = _pure_test_rename_paths(
        files,
        base_snapshot,
        head_snapshot,
        policy,
    )
    missing_test_scopes = tuple(
        scope.name
        for scope in policy.verification_scopes
        if (
            code_change_paths := _scope_code_change_paths(
                scope,
                files,
                policy.verification_scopes,
                test_globs=policy.test_globs,
            )
        )
        and not _scope_has_usable_test_change(
            scope,
            files,
            base_snapshot,
            head_snapshot,
            pure_rename_additions,
            code_change_paths=code_change_paths,
        )
    )
    test_changes = _has_usable_test_change(
        files,
        base_snapshot,
        head_snapshot,
        pure_rename_additions,
        policy,
    )
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
    parser.add_argument(
        "--base-symlinks",
        type=Path,
        help="比較baseのGit treeから抽出したsymlink manifest",
    )
    parser.add_argument(
        "--head-symlinks",
        type=Path,
        help="PR headのGit treeから抽出したsymlink manifest",
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
            base_symlinks=args.base_symlinks,
            head_symlinks=args.head_symlinks,
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
