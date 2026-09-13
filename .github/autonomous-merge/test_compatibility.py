"""#486分割前のCLI出力とartifactを、時刻を固定してバイト単位で比較する。"""

import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import collect
import evaluate
from test_collect import FixtureAPI
from test_support import BASE, facts, policy

ROOT = Path(__file__).parent
SNAPSHOTS = ROOT / "fixtures" / "compatibility-486.json"
AT = datetime(2026, 9, 11, 12, tzinfo=timezone.utc)
POLICY = 'version=2\nmode="shadow"\nminimum_approvals=0\nrequire_resolved_threads=true\n[[required_checks]]\nkind="check_run"\nname="Test"\napp_id=1\n'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def cli_outputs():
    values = {}
    for name in ("legacy", "null", "empty", "drift", "waiting", "human", "missing", "invalid"):
        data = facts()
        if name == "null":
            data["observation_changes"] = None
        elif name == "empty":
            data["observation_changes"] = []
        elif name == "drift":
            data.update(stable=False, observation_changes=[{
                "group": "pr", "identity": None, "field": "base_ref",
                "before": "main", "after": "<script>変更</script>",
            }])
        elif name == "waiting":
            data["checks"] = []
        elif name == "human":
            data["checks"][0]["conclusion"] = "failure"
        elif name == "missing":
            del data["pr"]
        elif name == "invalid":
            data["pr"]["head_sha"] = "invalid"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "facts.json").write_text(json.dumps(data))
            (root / "policy.toml").write_text(POLICY)
            for format in ("json", "markdown"):
                run = subprocess.run([
                    sys.executable, "-B", evaluate.__file__, "--facts", str(root / "facts.json"),
                    "--policy", str(root / "policy.toml"), "--format", format,
                ], capture_output=True, text=True)
                values[name + "/" + format] = {
                    "exit_code": run.returncode, "stdout_sha256": digest(run.stdout),
                    "stderr": run.stderr,
                }
    return values


def collector_outputs():
    values = {}
    for scenario in ("stable", "waiting", "human", "drift", "api", "no_targets", "target_error"):
        api = FixtureAPI()
        if scenario == "waiting":
            api.state["isDraft"] = True
        elif scenario == "human":
            api.state["mergeable"] = "CONFLICTING"
        elif scenario == "drift":
            api.drift = {"updatedAt": "2026-09-11T13:00:00Z"}
        elif scenario == "api":
            api.failure = "API 403"
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event = root / "event.json"
            event.write_text('{}')
            destination = root / "reports"
            args = ["collect.py", "--repository", api.repository,
                    "--event", str(event), "--policy", str(ROOT / "policy.toml"),
                    "--output", str(destination), "--evaluator-sha", BASE]
            numbers = [] if scenario == "no_targets" else [1]
            with (
                patch("sys.argv", args), patch("collect.GitHub", return_value=api),
                patch("collect.load_policy", return_value=policy()),
                patch("collect.targets", return_value=numbers,
                      side_effect=collect.CollectionError("API 403") if scenario == "target_error" else None),
                patch("collect.datetime") as clock, patch("sys.stdout", output),
                patch.dict(os.environ, {"GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "2"}),
            ):
                clock.now.return_value = AT
                code = collect.main()
            values[scenario] = {
                "exit_code": code, "stdout_sha256": digest(output.getvalue()),
                "files": {p.name: digest(p.read_text()) for p in sorted(destination.iterdir())},
            }
    return values


class CompatibilityTests(unittest.TestCase):
    def test_evaluate_cli_json_markdown_and_exit_codes_match_before_split(self):
        expected = json.loads(SNAPSHOTS.read_text())["evaluate_cli"]
        actual = cli_outputs()
        for name in expected:
            with self.subTest(case=name):
                self.assertEqual(actual[name], expected[name])

    def test_collector_artifacts_logs_and_exit_codes_match_before_split(self):
        expected = json.loads(SNAPSHOTS.read_text())["collector"]
        actual = collector_outputs()
        for name in expected:
            with self.subTest(case=name):
                self.assertEqual(actual[name], expected[name])
