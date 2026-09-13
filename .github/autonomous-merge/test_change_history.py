"""変更間隔の境界・履歴の取得元・人間承認・artifactからの再評価を検証する。"""

import io
import json
import tempfile
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from collect import CollectionError, collect, main
from contracts import EvaluationError
from evaluate import assess, load_policy
from replay import replay
from report import markdown
from test_collect import FixtureAPI
from test_replay import archive_modules, recorded_git
from test_support import BASE, HEAD, facts, policy

AT = datetime(2026, 9, 11, 12, tzinfo=timezone.utc)
OLD = "d" * 40


def config():
    return {**policy(), "stale_change_review_days": 30}


def history_facts(age=timedelta(days=31)):
    data = facts()
    data["change_history"] = {"base_sha": BASE, "files": [{
        "path": "whatever.rs", "history_path": "whatever.rs",
        "last_commit_sha": OLD, "last_changed_at": (AT - age).isoformat(),
    }]}
    return data


def approval(**overrides):
    return {"id": 1, "author": "maintainer", "author_type": "User",
            "author_association": "COLLABORATOR", "state": "APPROVED",
            "commit_sha": HEAD, "submitted_at": AT.isoformat(), **overrides}


def history_condition(result):
    return next(c for c in result["conditions"] if c["name"] == "stale_change_review")


class HistoryAPI(FixtureAPI):
    prefix = "/repos/example/project"

    def __init__(self):
        super().__init__()
        self.history_requests = []
        self.history_failure = None
        self.commits = [{"sha": OLD, "commit": {
            "author": {"date": "2026-09-11T12:00:00Z", "email": "DO NOT SAVE"},
            "committer": {"date": "2026-08-11T12:00:00Z"},
            "message": "DO NOT SAVE COMMIT MESSAGE",
        }}]
        self.actor = "Bot"

    def request(self, path, body=None):
        self.history_requests.append(path)
        if self.history_failure:
            raise CollectionError(self.history_failure)
        return deepcopy(self.commits)

    def pages(self, path, key=None):
        values = super().pages(path, key)
        if path.endswith("/reviews"):
            for review in values:
                review["user"]["type"] = self.actor
                review["author_association"] = "OWNER"
        return values


def observe(api):
    with patch("collect.datetime") as clock:
        clock.now.return_value = AT
        return collect(api, 1, BASE, include_change_history=True)


class ChangeAgeTests(unittest.TestCase):
    def test_thirty_days_is_inclusive_and_not_rounded_to_whole_days(self):
        for age, decision, status in [
            (timedelta(days=30) - timedelta(seconds=1), "SHADOW_CONDITIONS_MET", "within_threshold"),
            (timedelta(days=30), "SHADOW_CONDITIONS_MET", "within_threshold"),
            (timedelta(days=30, microseconds=1), "HUMAN_REVIEW_REQUIRED", "stale"),
        ]:
            with self.subTest(age=age):
                result = assess(history_facts(age), config())
                self.assertEqual(result["decision"], decision)
                detail = history_condition(result)["detail"]
                self.assertEqual(detail["files"][0]["age_seconds"], age.total_seconds())
                self.assertEqual(detail["files"][0]["status"], status)
                self.assertEqual(detail["threshold_days"], 30)

    def test_timestamp_offsets_are_compared_as_instants(self):
        data = history_facts()
        data["change_history"]["files"][0]["last_changed_at"] = "2026-08-12T21:00:00+09:00"
        self.assertEqual(assess(data, config())["decision"], "SHADOW_CONDITIONS_MET")

    def test_threshold_is_policy_controlled_and_old_policy_remains_compatible(self):
        data = history_facts(timedelta(days=20))
        self.assertEqual(assess(data, config())["decision"], "SHADOW_CONDITIONS_MET")
        strict = assess(data, {**config(), "stale_change_review_days": 14})
        self.assertEqual(strict["decision"], "HUMAN_REVIEW_REQUIRED")
        self.assertNotEqual(strict["policy_sha256"], assess(data, config())["policy_sha256"])
        legacy = assess(facts(), policy())
        self.assertEqual(legacy["decision"], "SHADOW_CONDITIONS_MET")
        self.assertFalse(any(c["name"] == "stale_change_review" for c in legacy["conditions"]))
        self.assertEqual(load_policy(Path(__file__).with_name("policy.toml"))["stale_change_review_days"], 30)
        for invalid in [0, -1, True, None, "30", 1.5]:
            with self.subTest(invalid=invalid), self.assertRaises(EvaluationError):
                assess(data, {**config(), "stale_change_review_days": invalid})

    def test_human_approval_must_be_current_and_from_a_repository_member(self):
        for change, expected in [
            ({}, "SHADOW_CONDITIONS_MET"),
            ({"author_association": "OWNER"}, "SHADOW_CONDITIONS_MET"),
            ({"author_association": "MEMBER"}, "SHADOW_CONDITIONS_MET"),
            ({"author_type": "Bot"}, "HUMAN_REVIEW_REQUIRED"),
            ({"author_association": "CONTRIBUTOR"}, "HUMAN_REVIEW_REQUIRED"),
            ({"author_association": "NONE"}, "HUMAN_REVIEW_REQUIRED"),
            ({"commit_sha": BASE}, "HUMAN_REVIEW_REQUIRED"),
            ({"state": "COMMENTED"}, "HUMAN_REVIEW_REQUIRED"),
            ({"state": "DISMISSED"}, "HUMAN_REVIEW_REQUIRED"),
            ({"state": "PENDING"}, "HUMAN_REVIEW_REQUIRED"),
        ]:
            with self.subTest(change=change):
                data = history_facts()
                data["reviews"] = [approval(**change)]
                result = assess(data, config())
                self.assertEqual(result["decision"], expected)
                self.assertEqual(history_condition(result)["detail"]["human_approval_review_ids"],
                                 [1] if expected == "SHADOW_CONDITIONS_MET" else [])

    def test_new_head_and_dismissal_require_a_new_approval(self):
        data = history_facts()
        data["reviews"] = [approval()]
        data["pr"]["head_sha"] = "e" * 40
        self.assertEqual(assess(data, config())["decision"], "HUMAN_REVIEW_REQUIRED")
        data = history_facts()
        data["reviews"] = [approval(), approval(id=2, state="COMMENTED")]
        self.assertEqual(assess(data, config())["decision"], "SHADOW_CONDITIONS_MET")
        data["reviews"][1]["state"] = "DISMISSED"
        self.assertEqual(assess(data, config())["decision"], "HUMAN_REVIEW_REQUIRED")

    def test_human_approval_does_not_override_other_conditions(self):
        for mutation, expected in [
            (lambda d: d["checks"][0].update(conclusion="failure"), "HUMAN_REVIEW_REQUIRED"),
            (lambda d: d.update(unresolved_threads=1), "HUMAN_REVIEW_REQUIRED"),
            (lambda d: d.update(checks=[]), "WAITING"),
            (lambda d: d.update(stable=False), "INSUFFICIENT_DATA"),
        ]:
            data = history_facts()
            data["reviews"] = [approval()]
            mutation(data)
            self.assertEqual(assess(data, config())["decision"], expected)
        data = history_facts()
        data["reviews"] = [approval()]
        self.assertEqual(assess(data, {**config(), "minimum_approvals": 2})["decision"], "WAITING")

    def test_missing_or_inconsistent_history_never_passes_even_with_approval(self):
        mutations = [
            lambda d: d.pop("change_history"),
            lambda d: d["change_history"].update(base_sha=HEAD),
            lambda d: d["change_history"].update(files=[]),
            lambda d: d["change_history"]["files"].append(deepcopy(d["change_history"]["files"][0])),
            lambda d: d["files"].append(deepcopy(d["files"][0])),
            lambda d: d["change"].update(changed_files=2),
            lambda d: d["change_history"]["files"][0].update(path="different.go"),
            lambda d: d["change_history"]["files"][0].update(history_path="different.go"),
            lambda d: d["change_history"]["files"][0].update(last_commit_sha=None),
            lambda d: d["change_history"]["files"][0].update(last_commit_sha="invalid"),
            lambda d: d["change_history"]["files"][0].update(last_changed_at=None),
            lambda d: d["change_history"]["files"][0].update(last_changed_at="2026-08-01"),
            lambda d: d["change_history"]["files"][0].update(last_changed_at="2026-08-01T00:00:00"),
            lambda d: d["change_history"]["files"][0].update(last_changed_at="2027-08-01T00:00:00Z"),
            lambda d: d.update(observed_at="invalid"),
            lambda d: d["files"][0].update(changeType="UNRECOGNIZED"),
            lambda d: d["reviews"][0].pop("author_type"),
            lambda d: d["reviews"][0].update(author_association=None),
        ]
        for index, mutation in enumerate(mutations):
            with self.subTest(index=index):
                data = history_facts()
                data["reviews"] = [approval()]
                mutation(data)
                self.assertEqual(assess(data, config())["decision"], "INSUFFICIENT_DATA")

    def test_new_files_and_renames_do_not_hide_an_old_existing_file(self):
        data = history_facts()
        data["files"][0].update(path="renamed.rs", changeType="RENAMED", previous_path="whatever.rs")
        data["change_history"]["files"][0]["path"] = "renamed.rs"
        data["files"].append({"path": "new.rs", "changeType": "ADDED", "additions": 0, "deletions": 0})
        data["change_history"]["files"].append({
            "path": "new.rs", "history_path": None, "last_commit_sha": None, "last_changed_at": None,
        })
        data["change"]["changed_files"] = 2
        result = assess(data, config())
        self.assertEqual(result["decision"], "HUMAN_REVIEW_REQUIRED")
        self.assertEqual([f["status"] for f in history_condition(result)["detail"]["files"]], ["new", "stale"])
        data["files"] = data["files"][1:]
        data["change_history"]["files"] = data["change_history"]["files"][1:]
        data["change"]["changed_files"] = 1
        result = assess(data, config())
        self.assertEqual(result["decision"], "SHADOW_CONDITIONS_MET")
        self.assertEqual(history_condition(result)["detail"]["required_human_approvals"], 0)
        data["change_history"]["files"][0]["last_commit_sha"] = OLD
        self.assertEqual(assess(data, config())["decision"], "INSUFFICIENT_DATA")


class HistoryCollectionTests(unittest.TestCase):
    def test_base_and_rename_source_are_pinned_and_query_values_are_encoded(self):
        api = HistoryAPI()
        previous = "古い dir/a&b?#.go"
        api.files[0].update(filename="new.go", status="renamed", previous_filename=previous)
        data = observe(api)
        self.assertEqual(len(api.history_requests), 1)
        url = urlsplit(api.history_requests[0])
        self.assertEqual(url.path, "/repos/example/project/commits")
        self.assertEqual(parse_qs(url.query), {"sha": [BASE], "path": [previous], "per_page": ["1"]})
        self.assertEqual(data["change_history"], {"base_sha": BASE, "files": [{
            "path": "new.go", "history_path": previous, "last_commit_sha": OLD,
            "last_changed_at": "2026-08-11T12:00:00Z",
        }]})
        self.assertNotIn("DO NOT SAVE", json.dumps(data))
        result = assess(data, config())
        self.assertEqual(result["decision"], "HUMAN_REVIEW_REQUIRED")
        self.assertEqual(history_condition(result)["detail"]["files"][0]["age_seconds"], 31 * 86400)

    def test_added_files_skip_history_but_missing_existing_history_is_an_error(self):
        for status in ["added", "copied", "modified", "removed"]:
            with self.subTest(status=status):
                api = HistoryAPI()
                api.files[0]["status"] = status
                api.commits = []
                data = observe(api)
                expected = "SHADOW_CONDITIONS_MET" if status in {"added", "copied"} else "INSUFFICIENT_DATA"
                self.assertEqual(assess(data, config())["decision"], expected)
                self.assertEqual(len(api.history_requests), 0 if status in {"added", "copied"} else 1)

    def test_history_failure_limit_and_invalid_responses_are_information_gaps(self):
        for response in [[], {}, [{}, {}], [{"sha": "invalid"}],
                         [{"sha": OLD, "commit": {"committer": {"date": None}}}]]:
            with self.subTest(response=response):
                api = HistoryAPI()
                api.commits = response
                data = observe(api)
                self.assertTrue(data["collection_errors"])
                self.assertEqual(assess(data, config())["decision"], "INSUFFICIENT_DATA")
        api = HistoryAPI()
        api.history_failure = "API history: HTTP 403"
        self.assertEqual(assess(observe(api), config())["decision"], "INSUFFICIENT_DATA")
        api = HistoryAPI()
        with patch("collect.MAX_HISTORY_FILES", 0):
            data = observe(api)
        self.assertIn("change history file limit exceeded", data["collection_errors"])
        self.assertEqual(api.history_requests, [])

    def test_base_changes_and_reviewer_identity_changes_invalidate_observation(self):
        api = HistoryAPI()
        api.drift = {"baseRefOid": "e" * 40}
        self.assertEqual(assess(observe(api), config())["decision"], "INSUFFICIENT_DATA")
        api = HistoryAPI()
        original = api.pages

        def changed_identity(path, key=None):
            values = original(path, key)
            if path.endswith("/reviews") and api.paths.count(path) == 2:
                values[0]["user"]["type"] = "User"
            return values

        api.pages = changed_identity
        data = observe(api)
        self.assertFalse(data["rechecked"]["reviews"])
        self.assertEqual(data["observation_changes"][0]["field"], "author_type")
        self.assertEqual(assess(data, config())["decision"], "INSUFFICIENT_DATA")

    def test_cli_artifact_replays_offline_using_saved_time_policy_and_history(self):
        for actor, expected in [("Bot", "HUMAN_REVIEW_REQUIRED"), ("User", "SHADOW_CONDITIONS_MET")]:
            with self.subTest(actor=actor), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "policy.toml").write_text(
                    'version=2\nmode="shadow"\nminimum_approvals=0\nrequire_resolved_threads=true\n'
                    'stale_change_review_days=30\n[[required_checks]]\nkind="check_run"\nname="Test"\napp_id=1\n'
                )
                api = HistoryAPI()
                api.actor = actor
                output = root / "artifact"
                args = ["collect.py", "--repository", api.repository, "--pr", "1",
                        "--policy", str(root / "policy.toml"), "--output", str(output),
                        "--evaluator-sha", BASE]
                with (patch("sys.argv", args), patch("collect.GitHub", return_value=api),
                      patch("collect.datetime") as clock, patch("sys.stdout", io.StringIO())):
                    clock.now.return_value = AT
                    self.assertEqual(main(), 0)
                report = json.loads((output / "pr-1.json").read_text())
                self.assertEqual(report["decision"], expected)
                self.assertEqual(report["policy"]["stale_change_review_days"], 30)
                self.assertEqual(json.loads((output / "manifest.json").read_text())["reports"], [1])
                summary = (output / "summary.md").read_text()
                self.assertIn("前回変更", summary)
                self.assertIn("anything.go", summary)
                self.assertIn("last_changed_at", summary)
                self.assertEqual(summary, markdown(report))
                source = Path(__file__).with_name("evaluate.py").read_text()
                source += '\nimport socket\ndef denied(*args, **kwargs):\n    raise AssertionError("network forbidden")\nsocket.socket.connect = denied\nsocket.getaddrinfo = denied\n'
                # 現在時刻や追加API取得が不要なことを別Pythonプロセスで確認する。
                with recorded_git(archive_modules({"evaluate.py": source})):
                    self.assertEqual(replay(report, BASE), report)
                    damaged = deepcopy(report)
                    damaged["observations"]["change_history"]["files"][0]["last_changed_at"] = AT.isoformat()
                    self.assertNotEqual(replay(damaged, BASE), damaged)
