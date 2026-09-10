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
class VerificationScope:
    name: str
    code_globs: tuple[str, ...]
    test_globs: tuple[str, ...]
    binary_test_globs: tuple[str, ...]
    fallback: bool
    excluded_code_globs: tuple[str, ...] = ()


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
        return True
    return False


_DISABLED_TEST_CALL = re.compile(
    r"\b(?:test(?:\s*\.\s*describe)?|it|describe|suite|specify|context)"
    r"(?:\s*(?:(?:\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*|(?:\?\.)?\s*\[\s*['\"`][A-Za-z_$][A-Za-z0-9_$]*['\"`]\s*\]))*"
    r"\s*(?:(?:\.\s*|\?\.\s*)(?:skip|fixme|todo|skipIf|runIf)\b|(?:\?\.)?\s*\[\s*['\"`](?:skip|fixme|todo|skipIf|runIf)['\"`]\s*\])"
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
    base_text = _javascript_disabled_call_source(base_data)
    head_text = _javascript_disabled_call_source(head_data)
    if len(list(_DISABLED_TEST_CALL.finditer(head_text))) > len(
        list(_DISABLED_TEST_CALL.finditer(base_text))
    ):
        return True
    if (
        len(base_data or b"") > MAX_DIFF_BYTES
        or len(head_data) > MAX_DIFF_BYTES
        or len(base_lines) + len(head_lines) > MAX_DIFF_LINES
    ):
        return _DISABLED_TEST_CALL.search(head_text) is not None

    matcher = difflib.SequenceMatcher(a=base_lines, b=head_lines, autojunk=True)
    for tag, _, _, head_start, head_end in matcher.get_opcodes():
        changed_text = "\n".join(head_lines[head_start:head_end])
        changed_source = _mask_javascript_literals(
            _strip_javascript_comments(changed_text.encode("utf-8"))
        )
        if tag in {"replace", "insert"} and _DISABLED_TEST_CALL.search(changed_source):
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

    characters: list[str] = []
    index = 0
    while index < len(text):
        character = text[index]
        if character in {"'", '"', "`"}:
            quote = character
            previous = index - 1
            while previous >= 0 and text[previous].isspace():
                previous -= 1
            computed_property = previous >= 0 and text[previous] == "["
            cursor = index + 1
            while cursor < len(text):
                if text[cursor] == "\\":
                    cursor += 2
                    continue
                if text[cursor] == quote:
                    cursor += 1
                    break
                cursor += 1
            literal = text[index:cursor]
            value = literal[1:-1] if literal.endswith(quote) else literal[1:]
            preserve = computed_property and re.fullmatch(
                r"[A-Za-z_$][A-Za-z0-9_$]*",
                value,
            )
            if preserve:
                characters.append(literal)
            else:
                characters.append(
                    "".join(
                        item if item in "\r\n" or item == quote else " "
                        for item in literal
                    )
                )
            index = cursor
            continue
        if character == "/":
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
                continue
        characters.append(character)
        index += 1
    return "".join(characters)


def _javascript_disabled_call_source(data: bytes | None) -> str:
    if data is None or _is_binary(data):
        return ""
    return _mask_javascript_literals(_strip_javascript_comments(data))


def _javascript_call_end(text: str, open_index: int) -> int | None:
    """開き括弧に対応するJavaScript呼び出しの終端を返す。"""

    depth = 0
    index = open_index
    while index < len(text):
        character = text[index]
        if character in {"'", '"', "`"}:
            quote = character
            index += 1
            while index < len(text):
                if text[index] == "\\":
                    index += 2
                    continue
                if text[index] == quote:
                    index += 1
                    break
                index += 1
            continue
        if character == "/":
            regex = _read_regex_literal(text, index)
            if regex is not None:
                index = regex[2]
                continue
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return None


def _disabled_javascript_call_ranges(source: str) -> tuple[tuple[int, int], ...]:
    """無効化modifierを持つ呼び出しの引数範囲を返す。"""

    source = _mask_javascript_literals(source)
    ranges: list[tuple[int, int]] = []
    for match in _DISABLED_TEST_CALL.finditer(source):
        open_index = match.end()
        while open_index < len(source) and source[open_index].isspace():
            open_index += 1
        if open_index >= len(source) or source[open_index] != "(":
            continue
        end = _javascript_call_end(source, open_index)
        if end is not None:
            ranges.append((match.start(), end))
    return tuple(ranges)


def _is_inside_disabled_javascript_call(source: str, position: int) -> bool:
    return any(start <= position < end for start, end in _disabled_javascript_call_ranges(source))


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
_VITEST_SNAPSHOT_KEY = re.compile(r"exports\[\s*(['\"`])([^'\"`\r\n]+)\1\s*\]\s*=")
_TEST_TITLE = re.compile(
    r"\b(?:test|it|describe|suite|context)\s*\(\s*(['\"])(?P<title>[^'\"\r\n]+)\1"
)


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
                if not _is_inside_disabled_javascript_call(source, match.start()):
                    return True
        return False

    if runner == "vitest":
        # Vitestのsnapshot fileは、所有testがあり、標準形式のexport keyが
        # そのtestの静的なタイトルを含む場合だけbaselineとして受け入れる。
        snapshot_entry = head_snapshot.get(path)
        if snapshot_entry is None or snapshot_entry.kind != "blob":
            return False
        snapshot_text = snapshot_entry.data.decode("utf-8", errors="replace")
        if not snapshot_text.startswith("// Vitest Snapshot v1"):
            return False
        keys = [match.group(2) for match in _VITEST_SNAPSHOT_KEY.finditer(snapshot_text)]
        titles = [match.group("title") for match in _TEST_TITLE.finditer(source)]
        return bool(
            any(
                not _is_inside_disabled_javascript_call(source, match.start())
                for match in _VITEST_SNAPSHOT_CALL.finditer(source)
            )
            and keys
            and titles
            and all(any(title and title in key for title in titles) for key in keys)
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


_JAVASCRIPT_TEST_DECLARATION = re.compile(
    r"\b(?:test|it|describe|suite|specify|context)"
    r"(?:(?:\s*\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*)*\s*\("
)
_JAVASCRIPT_ASSERTION = re.compile(
    r"\bexpect(?:(?:\s*\.\s*|\?\.\s*)[A-Za-z_$][A-Za-z0-9_$]*)*\s*\("
)


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
    normalized = _normalize_javascript_whitespace(
        _strip_javascript_comments(data),
        preserve_literal_content=False,
    )
    return (
        len(_JAVASCRIPT_TEST_DECLARATION.findall(normalized)),
        len(_JAVASCRIPT_ASSERTION.findall(normalized)),
    )


def _has_executable_test_reduction(
    base_data: bytes | None,
    head_data: bytes | None,
    *,
    language: str,
) -> bool:
    base_shape = _test_shape(base_data, language=language)
    head_shape = _test_shape(head_data, language=language)
    return any(head < base for base, head in zip(base_shape, head_shape))


def _has_executable_test_change(
    base_data: bytes | None,
    head_data: bytes,
    *,
    language: str = "javascript",
) -> bool:
    """コメント・空白だけのテスト変更を検証追加として扱わない。"""

    head_fingerprint = _test_code_fingerprint(head_data, language=language)
    return bool(head_fingerprint) and _test_code_fingerprint(
        base_data,
        language=language,
    ) != head_fingerprint


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
    if _snapshot_owner(item.path) is not None:
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
        if _scope_has_code_changes(
            scope,
            files,
            policy.verification_scopes,
            test_globs=policy.test_globs,
        )
        and not any(
            _is_usable_test_change(
                item,
                base_snapshot,
                head_snapshot,
                binary_test_globs=scope.binary_test_globs,
            )
            and matches_any(item.path, scope.test_globs)
            and item.path not in pure_rename_additions
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
