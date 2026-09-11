"""ラベル付け替え・後着防止・書き込み失敗を、外部へ書き込まず検証する。"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from publish import (
    DECISION_LABELS,
    LABEL_DESCRIPTIONS,
    MANAGED_LABELS,
    PublishError,
    encoded_label,
    event_pr,
    has_newer_run,
    is_fresher,
    list_recent_runs,
    list_relevant_runs,
    load_reports,
    main,
    publish_pr,
    skip_reason,
    sync_labels,
)
from test_evaluate import BASE, HEAD

OTHER = "d" * 40
RUN_URL = "https://github.com/example/project/actions/runs/9"


def report(decision, head=HEAD, base=BASE, observed="2026-09-11T12:00:00+00:00"):
    return {
        "decision": decision,
        "observations": {
            "observed_at": observed,
            "pr": {
                "number": 1,
                "head_sha": head,
                "base_sha": base,
                "state": "OPEN",
                "draft": False,
                "base_ref": "trunk",
            },
        },
    }


def pull(labels=None, head=HEAD, base=BASE, state="open", merged=False, draft=False):
    return {
        "head": {"sha": head},
        "base": {"sha": base, "ref": "trunk"},
        "state": state,
        "merged": merged,
        "draft": draft,
        "labels": [{"name": name} for name in (labels or [])],
    }


class FixtureAPI:
    repository = "example/project"
    prefix = "/repos/example/project"

    def __init__(
        self, labels=None, head=HEAD, base=BASE, state="open", merged=False, draft=False
    ):
        self.pull = pull(labels, head, base, state, merged, draft)
        self.calls = []
        self.labels = {name: True for name in DECISION_LABELS.values()}
        self.workflow_pages = [{"workflow_runs": []}]

    def pages(self, path, key=None):
        self.calls.append(("GET", path, None))
        return []

    def request(self, path, body=None, method=None):
        verb = method or ("POST" if body is not None else "GET")
        self.calls.append((verb, path, body))
        if "/actions/workflows/" in path:
            if "status=" in path:
                return {"workflow_runs": []}
            if self.workflow_pages:
                return self.workflow_pages.pop(0)
            return {"workflow_runs": []}
        if path.endswith("/pulls/1"):
            return self.pull
        if "/labels/" in path and verb == "GET":
            name = path.rsplit("/", 1)[-1]
            if name in {encoded_label(item) for item in self.labels}:
                return {"name": name}
            raise PublishError(f"API GET {path}: HTTP 404")
        if path.endswith("/labels") and verb == "POST":
            if body and "name" in body:
                self.labels[body["name"]] = True
                return body
            if body and "labels" in body:
                names = [item["name"] for item in self.pull["labels"]]
                for label in body["labels"]:
                    if label not in names:
                        self.pull["labels"].append({"name": label})
                return body
        if verb == "DELETE" and "/labels/" in path:
            encoded = path.rsplit("/", 1)[-1]
            self.pull["labels"] = [
                item
                for item in self.pull["labels"]
                if encoded_label(item["name"]) != encoded
            ]
            return None
        return {}


class PublishTests(unittest.TestCase):
    def test_decision_labels_are_actionable_japanese_names(self):
        self.assertEqual(
            DECISION_LABELS,
            {
                "SHADOW_CONDITIONS_MET": "shadow/要マージ判断",
                "WAITING": "shadow/CI・レビュー待ち",
                "HUMAN_REVIEW_REQUIRED": "shadow/要対応",
                "INSUFFICIENT_DATA": "shadow/再観測が必要",
            },
        )
        for name, description in LABEL_DESCRIPTIONS.items():
            self.assertLessEqual(len(description), 100, name)
            self.assertTrue(name.startswith("shadow/"))

    def test_replaces_managed_label_and_keeps_unrelated_ones(self):
        api = FixtureAPI(["enhancement", "shadow/要マージ判断"])
        status = publish_pr(
            api, 1, report("WAITING"), 10, 1, [], None
        )
        self.assertEqual(status, "updated")
        names = [item["name"] for item in api.pull["labels"]]
        self.assertEqual(names.count("shadow/CI・レビュー待ち"), 1)
        self.assertIn("enhancement", names)
        self.assertNotIn("shadow/要マージ判断", names)
        self.assertTrue(
            any(
                call[0] == "DELETE" and encoded_label("shadow/要マージ判断") in call[1]
                for call in api.calls
            )
        )
        self.assertFalse(any(call[0] == "PUT" for call in api.calls))

    def test_all_decisions_are_published_idempotently(self):
        for decision, label in DECISION_LABELS.items():
            with self.subTest(decision=decision):
                api = FixtureAPI([label])
                status = publish_pr(api, 1, report(decision), 10, 1, [], None)
                self.assertEqual(status, "unchanged")
                names = [item["name"] for item in api.pull["labels"]]
                self.assertEqual([name for name in names if name in MANAGED_LABELS], [label])

    def test_stale_sha_does_not_overwrite_current_labels(self):
        api = FixtureAPI(["shadow/要対応"])
        status = publish_pr(
            api, 1, report("SHADOW_CONDITIONS_MET", head=OTHER), 10, 1, [], None
        )
        self.assertEqual(status, "skipped:stale_sha")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"]], ["shadow/要対応"]
        )
        self.assertFalse(
            any(call[0] in {"POST", "DELETE"} and "/issues/" in call[1] for call in api.calls)
        )

    def test_newer_run_id_or_observed_at_is_skipped(self):
        current = {
            "number": 1,
            "head_sha": HEAD,
            "base_sha": BASE,
            "base_ref": "trunk",
            "state": "open",
            "merged": False,
            "draft": False,
            "labels": ["shadow/CI・レビュー待ち"],
        }
        newer = [
            {
                "id": 20,
                "run_attempt": 1,
                "status": "completed",
                "event": "pull_request_target",
                "pull_requests": [{"number": 1}],
            }
        ]
        self.assertTrue(has_newer_run(newer, 1, 10, 1))
        self.assertEqual(
            skip_reason(report("SHADOW_CONDITIONS_MET"), current, newer, 10, 1),
            "newer_run",
        )
        older = [
            {
                "id": 8,
                "run_attempt": 1,
                "status": "completed",
                "event": "pull_request_target",
                "pull_requests": [{"number": 1}],
            }
        ]
        self.assertIsNone(
            skip_reason(report("SHADOW_CONDITIONS_MET"), current, older, 10, 1)
        )
        self.assertFalse(
            is_fresher(
                {
                    "observed_at": "2026-09-11T12:00:00+00:00",
                    "run_id": 10,
                    "run_attempt": 1,
                },
                {
                    "observed_at": "2026-09-11T13:00:00+00:00",
                    "run_id": 9,
                    "run_attempt": 1,
                },
            )
        )
        self.assertEqual(
            skip_reason(
                report("SHADOW_CONDITIONS_MET"),
                current,
                [],
                10,
                1,
                {
                    "observed_at": "2026-09-11T13:00:00+00:00",
                    "run_id": 11,
                    "run_attempt": 1,
                },
            ),
            "stale_receipt",
        )
        broadcast = [
            {
                "id": 30,
                "run_attempt": 1,
                "status": "in_progress",
                "event": "schedule",
                "pull_requests": [],
            }
        ]
        self.assertEqual(
            skip_reason(report("WAITING"), current, broadcast, 10, 1),
            "newer_run",
        )
        feature_push = [
            {
                "id": 40,
                "run_attempt": 1,
                "status": "completed",
                "conclusion": "success",
                "event": "push",
                "head_branch": "feature",
                "pull_requests": [],
            }
        ]
        self.assertFalse(has_newer_run(feature_push, 1, 10, 1, "trunk"))
        self.assertIsNone(
            skip_reason(
                report("WAITING"), current, feature_push, 10, 1, None, "trunk"
            )
        )
        default_push = [
            {
                "id": 40,
                "run_attempt": 1,
                "status": "in_progress",
                "conclusion": None,
                "event": "push",
                "head_branch": "trunk",
                "pull_requests": [],
            }
        ]
        self.assertEqual(
            skip_reason(
                report("WAITING"), current, default_push, 10, 1, None, "trunk"
            ),
            "newer_run",
        )
        dispatch_one = [
            {
                "id": 50,
                "run_attempt": 1,
                "status": "completed",
                "event": "workflow_dispatch",
                "display_title": "shadow-pr-1",
                "pull_requests": [],
            }
        ]
        self.assertTrue(has_newer_run(dispatch_one, 1, 10, 1))
        self.assertFalse(has_newer_run(dispatch_one, 2, 10, 1))
        invalid_dispatch = [
            {
                "id": 51,
                "run_attempt": 1,
                "status": "completed",
                "event": "workflow_dispatch",
                "display_title": "shadow-pr-123abc",
                "pull_requests": [],
            }
        ]
        self.assertFalse(has_newer_run(invalid_dispatch, 123, 10, 1))
        substring_all = [
            {
                "id": 52,
                "run_attempt": 1,
                "status": "in_progress",
                "event": "workflow_dispatch",
                "display_title": "retry-shadow-all-now",
                "pull_requests": [],
            }
        ]
        self.assertFalse(has_newer_run(substring_all, 2, 10, 1))
        associated_broadcast = [
            {
                "id": 53,
                "run_attempt": 1,
                "status": "in_progress",
                "event": "workflow_run",
                "pull_requests": [{"number": 1}],
            }
        ]
        self.assertTrue(has_newer_run(associated_broadcast, 2, 10, 1))
        dispatch_all = [
            {
                "id": 50,
                "run_attempt": 1,
                "status": "in_progress",
                "event": "workflow_dispatch",
                "display_title": "shadow-all",
                "pull_requests": [],
            }
        ]
        self.assertTrue(has_newer_run(dispatch_all, 2, 10, 1))
        closed = {**current, "state": "closed"}
        closed_report = report("HUMAN_REVIEW_REQUIRED")
        closed_report["observations"]["pr"]["state"] = "CLOSED"
        self.assertFalse(has_newer_run(broadcast, 1, 10, 1, pr_open=False))
        self.assertIsNone(skip_reason(closed_report, closed, broadcast, 10, 1))
        self.assertEqual(skip_reason(closed_report, closed, newer, 10, 1), "newer_run")
        rerun = {
            "id": 10,
            "run_attempt": 2,
            "status": "in_progress",
            "event": "workflow_dispatch",
            "display_title": "shadow-pr-1",
            "run_started_at": "2026-09-11T13:00:00Z",
            "pull_requests": [],
        }
        failed_newer_id = {
            "id": 11,
            "run_attempt": 1,
            "status": "completed",
            "event": "pull_request_target",
            "run_started_at": "2026-09-11T12:00:00Z",
            "pull_requests": [{"number": 1}],
        }
        self.assertFalse(has_newer_run([failed_newer_id, rerun], 1, 10, 2))
        self.assertIsNone(
            skip_reason(
                report("WAITING", observed="2026-09-11T13:00:00+00:00"),
                current,
                [failed_newer_id, rerun],
                10,
                2,
            )
        )
        later_start = {
            **failed_newer_id,
            "run_started_at": "2026-09-11T14:00:00Z",
        }
        self.assertTrue(has_newer_run([later_start, rerun], 1, 10, 2))
        earlier_start_later_observe = {
            "id": 10,
            "run_attempt": 1,
            "status": "in_progress",
            "event": "schedule",
            "run_started_at": "2026-09-11T12:00:00Z",
            "pull_requests": [],
        }
        later_start_peer = {
            "id": 11,
            "run_attempt": 1,
            "status": "completed",
            "event": "workflow_run",
            "run_started_at": "2026-09-11T12:05:00Z",
            "pull_requests": [{"number": 1}],
        }
        self.assertTrue(
            has_newer_run(
                [earlier_start_later_observe, later_start_peer],
                1,
                10,
                1,
                observed_at="2026-09-11T12:10:00+00:00",
            )
        )
        failed_collection = {
            "id": 60,
            "run_attempt": 1,
            "status": "completed",
            "conclusion": "failure",
            "event": "schedule",
            "run_started_at": "2026-09-11T14:00:00Z",
            "pull_requests": [],
        }
        self.assertTrue(has_newer_run([failed_collection], 1, 10, 1))
        self.assertEqual(
            skip_reason(report("WAITING"), current, [failed_collection], 10, 1),
            "newer_run",
        )
        completed_old_id = {
            "id": 5,
            "run_attempt": 2,
            "status": "completed",
            "conclusion": "success",
            "event": "workflow_dispatch",
            "display_title": "shadow-pr-1",
            "run_started_at": "2026-09-11T14:00:00Z",
            "pull_requests": [],
        }
        self.assertTrue(
            has_newer_run(
                [completed_old_id],
                1,
                200,
                1,
                observed_at="2026-09-11T12:00:00+00:00",
            )
        )
        self.assertIsNone(
            skip_reason(
                report("WAITING", observed="2026-09-11T12:00:00+00:00"),
                current,
                [
                    {
                        "id": 10,
                        "run_attempt": 2,
                        "status": "in_progress",
                        "event": "workflow_dispatch",
                        "display_title": "shadow-pr-1",
                        "run_started_at": "2026-09-11T14:00:00Z",
                    }
                ],
                10,
                1,
            )
        )

    def test_base_ref_mismatch_skips_without_sha_change(self):
        current = {
            "number": 1,
            "head_sha": HEAD,
            "base_sha": BASE,
            "base_ref": "release",
            "state": "open",
            "merged": False,
            "draft": False,
            "labels": ["shadow/要マージ判断"],
        }
        self.assertEqual(
            skip_reason(report("SHADOW_CONDITIONS_MET"), current, [], 10, 1),
            "stale_pr_state",
        )

    def test_draft_or_close_mismatch_skips_without_sha_change(self):
        current = {
            "number": 1,
            "head_sha": HEAD,
            "base_sha": BASE,
            "base_ref": "trunk",
            "state": "open",
            "merged": False,
            "draft": True,
            "labels": ["shadow/要マージ判断"],
        }
        self.assertEqual(
            skip_reason(report("SHADOW_CONDITIONS_MET"), current, [], 10, 1),
            "stale_pr_state",
        )
        current["draft"] = False
        current["state"] = "closed"
        self.assertEqual(
            skip_reason(report("SHADOW_CONDITIONS_MET"), current, [], 10, 1),
            "stale_pr_state",
        )
        api = FixtureAPI(["shadow/要マージ判断"], draft=True)
        status = publish_pr(api, 1, report("SHADOW_CONDITIONS_MET"), 10, 1, [])
        self.assertEqual(status, "skipped:stale_pr_state")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"]], ["shadow/要マージ判断"]
        )

    def test_relevant_runs_stop_after_reaching_current_id(self):
        pages = [
            {
                "workflow_runs": [
                    {"id": 20 + n, "run_attempt": 1} for n in range(100)
                ]
            },
            {
                "workflow_runs": [
                    {"id": 10, "run_attempt": 1},
                    {"id": 5, "run_attempt": 1},
                ]
            },
        ]

        class Paging:
            prefix = "/repos/example/project"
            calls = []

            def request(self, path, body=None, method=None):
                self.calls.append(path)
                if "status=" in path:
                    return {"workflow_runs": []}
                if not pages:
                    return {"workflow_runs": []}
                return pages.pop(0)

        runs = list_relevant_runs(Paging(), "autonomous-merge-shadow.yml", 10)
        self.assertEqual(len(runs), 102)
        self.assertEqual(
            [path for path in Paging.calls if "status=" not in path],
            [
                "/repos/example/project/actions/workflows/"
                "autonomous-merge-shadow.yml/runs?per_page=100&page=1",
                "/repos/example/project/actions/workflows/"
                "autonomous-merge-shadow.yml/runs?per_page=100&page=2",
            ],
        )

    def test_live_older_run_is_included_without_full_history(self):
        pages = [
            {"workflow_runs": [{"id": 5, "run_attempt": 2, "status": "in_progress"}]},
            {
                "workflow_runs": [
                    {"id": 20 + n, "run_attempt": 1} for n in range(100)
                ]
            },
        ]

        class Paging:
            prefix = "/repos/example/project"
            listed = False

            def request(self, path, body=None, method=None):
                if "status=in_progress" in path:
                    return pages[0]
                if "status=" in path:
                    return {"workflow_runs": []}
                if self.listed:
                    return {"workflow_runs": []}
                self.listed = True
                return pages[1]

        runs = list_relevant_runs(Paging(), "autonomous-merge-shadow.yml", 200)
        self.assertEqual({int(item["id"]) for item in runs}, {5, *range(20, 120)})

    def test_completed_older_rerun_is_listed_after_current_id(self):
        pages = [
            {
                "workflow_runs": [
                    {"id": 200 + n, "run_attempt": 1} for n in range(100)
                ]
            },
            {
                "workflow_runs": [
                    {
                        "id": 5,
                        "run_attempt": 2,
                        "status": "completed",
                        "run_started_at": "2026-09-11T14:00:00Z",
                    }
                ]
            },
        ]

        class Paging:
            prefix = "/repos/example/project"

            def request(self, path, body=None, method=None):
                if "status=" in path:
                    return {"workflow_runs": []}
                if not pages:
                    return {"workflow_runs": []}
                return pages.pop(0)

        runs = list_relevant_runs(Paging(), "autonomous-merge-shadow.yml", 200)
        self.assertIn(5, {int(item["id"]) for item in runs})

    def test_relevant_runs_fail_when_history_fills_page_limit(self):
        class Paging:
            prefix = "/repos/example/project"

            def request(self, path, body=None, method=None):
                if "status=" in path:
                    return {"workflow_runs": []}
                return {
                    "workflow_runs": [
                        {"id": 1000 + n, "run_attempt": 1} for n in range(100)
                    ]
                }

        with (
            patch("publish.MAX_PAGES", 1),
            self.assertRaises(PublishError) as error,
        ):
            list_relevant_runs(Paging(), "autonomous-merge-shadow.yml", 10)
        self.assertIn("pagination limit", str(error.exception))

    def test_recent_runs_prefer_refreshed_record_for_same_id(self):
        known = [
            {
                "id": 5,
                "run_attempt": 1,
                "status": "completed",
                "event": "schedule",
                "run_started_at": "2026-09-11T10:00:00Z",
                "pull_requests": [],
            },
            {
                "id": 12,
                "run_attempt": 1,
                "status": "in_progress",
                "event": "pull_request",
                "run_started_at": "2026-09-11T12:00:00Z",
                "pull_requests": [{"number": 1}],
            },
        ]
        refreshed = {
            "id": 5,
            "run_attempt": 2,
            "status": "in_progress",
            "event": "schedule",
            "run_started_at": "2026-09-11T14:00:00Z",
            "pull_requests": [],
        }

        class Paging:
            prefix = "/repos/example/project"

            def request(self, path, body=None, method=None):
                if "status=in_progress" in path or "status=" not in path:
                    return {"workflow_runs": [refreshed]}
                return {"workflow_runs": []}

        runs = list_recent_runs(Paging(), "autonomous-merge-shadow.yml", known)
        match = next(item for item in runs if int(item["id"]) == 5)
        self.assertEqual(match["run_attempt"], 2)
        self.assertEqual(match["run_started_at"], "2026-09-11T14:00:00Z")
        self.assertTrue(has_newer_run(runs, 1, 12, 1))
        self.assertFalse(has_newer_run(known, 1, 12, 1))

    def test_shared_history_is_refreshed_before_first_write(self):
        api = FixtureAPI(["enhancement"])
        api.workflow_pages = [
            {
                "workflow_runs": [
                    {
                        "id": 20,
                        "run_attempt": 1,
                        "status": "in_progress",
                        "event": "schedule",
                        "run_started_at": "2026-09-11T14:00:00Z",
                        "pull_requests": [],
                    }
                ]
            }
        ]
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "skipped:newer_run")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"]], ["enhancement"]
        )

    def test_write_is_skipped_when_newer_run_appears_before_labels(self):
        api = FixtureAPI(["enhancement"])
        api.workflow_pages = [
            {"workflow_runs": []},
            {
                "workflow_runs": [
                    {
                        "id": 20,
                        "run_attempt": 1,
                        "status": "in_progress",
                        "event": "schedule",
                        "pull_requests": [],
                    }
                ]
            },
        ]
        status = publish_pr(api, 1, report("WAITING"), 10, 1)
        self.assertEqual(status, "skipped:newer_run")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"]], ["enhancement"]
        )

    def test_collection_error_expires_merge_judgment_label(self):
        api = FixtureAPI(["enhancement", "shadow/要マージ判断"])
        status = publish_pr(
            api,
            1,
            {"decision": "INSUFFICIENT_DATA", "error": "API 403"},
            10,
            1,
            [],
            None,
        )
        self.assertEqual(status, "updated")
        names = [item["name"] for item in api.pull["labels"]]
        self.assertIn("shadow/再観測が必要", names)
        self.assertIn("enhancement", names)
        self.assertNotIn("shadow/要マージ判断", names)

    def test_closed_or_merged_pr_uses_human_review_label(self):
        api = FixtureAPI(["shadow/要マージ判断"], state="closed", merged=True)
        closed = report("HUMAN_REVIEW_REQUIRED")
        closed["observations"]["pr"]["state"] = "MERGED"
        status = publish_pr(api, 1, closed, 10, 1, [], None)
        self.assertEqual(status, "updated")
        names = [item["name"] for item in api.pull["labels"]]
        self.assertEqual(
            [name for name in names if name in MANAGED_LABELS], ["shadow/要対応"]
        )

    def test_write_failure_does_not_change_report_files(self):
        with tempfile.TemporaryDirectory() as directory:
            report_dir = Path(directory)
            payload = report("WAITING")
            (report_dir / "pr-1.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
            )
            before = (report_dir / "pr-1.json").read_text()
            event = report_dir / "event.json"
            event.write_text(json.dumps({"pull_request": {"number": 1}}))
            args = [
                "publish.py",
                "--repository",
                "example/project",
                "--report-dir",
                str(report_dir),
                "--run-id",
                "10",
                "--run-attempt",
                "1",
                "--run-url",
                RUN_URL,
                "--event",
                str(event),
            ]
            api = FixtureAPI(["enhancement"])
            original = api.request

            def failing(path, body=None, method=None):
                verb = method or ("POST" if body is not None else "GET")
                if verb == "POST" and path.endswith("/labels") and body and "labels" in body:
                    raise PublishError("API POST /labels: HTTP 403")
                return original(path, body, method)

            api.request = failing
            with patch("sys.argv", args), patch("publish.GitHub", return_value=api):
                self.assertEqual(main(), 1)
            self.assertEqual((report_dir / "pr-1.json").read_text(), before)
            self.assertEqual(
                [item["name"] for item in api.pull["labels"]], ["enhancement"]
            )

    def test_collection_error_without_pr_number_is_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            report_dir = Path(directory)
            (report_dir / "collection-error.json").write_text(
                json.dumps({"decision": "INSUFFICIENT_DATA", "error": "boom"})
            )
            self.assertEqual(load_reports(report_dir, {}), [])
            self.assertEqual(
                load_reports(report_dir, {"pull_request": {"number": 7}}),
                [(7, {"decision": "INSUFFICIENT_DATA", "error": "boom"})],
            )

    def test_event_pr_reads_dispatch_input(self):
        self.assertEqual(event_pr({"inputs": {"pr_number": "12"}}), 12)
        self.assertIsNone(event_pr({"inputs": {"pr_number": ""}}))

    def test_japanese_label_names_are_percent_encoded(self):
        self.assertEqual(
            encoded_label("shadow/要マージ判断"),
            "shadow%2F%E8%A6%81%E3%83%9E%E3%83%BC%E3%82%B8%E5%88%A4%E6%96%AD",
        )
        writes = []

        class Recording:
            prefix = "/repos/example/project"

            def request(self, path, body=None, method=None):
                writes.append(
                    (method or ("POST" if body is not None else "GET"), path, body)
                )
                return None

        sync_labels(
            Recording(),
            3,
            ["shadow/要マージ判断"],
            "shadow/再観測が必要",
        )
        self.assertTrue(
            any(
                item[0] == "POST"
                and item[2] == {"labels": ["shadow/再観測が必要"]}
                for item in writes
            )
        )
        delete = next(item for item in writes if item[0] == "DELETE")
        self.assertEqual(
            delete[1],
            "/repos/example/project/issues/3/labels/"
            + encoded_label("shadow/要マージ判断"),
        )

    def test_label_write_aborts_when_newer_run_appears_mid_sync(self):
        writes = []

        class Recording:
            prefix = "/repos/example/project"

            def request(self, path, body=None, method=None):
                writes.append(
                    (method or ("POST" if body is not None else "GET"), path, body)
                )
                return None

        checks = iter(["newer_run"])
        result, reason = sync_labels(
            Recording(),
            3,
            ["shadow/要マージ判断"],
            "shadow/再観測が必要",
            lambda: next(checks),
        )
        self.assertEqual(reason, "newer_run")
        self.assertEqual(result, [])
        self.assertFalse(any(item[0] in {"POST", "DELETE"} for item in writes))

    def test_started_sync_finishes_desired_label_despite_newer_run(self):
        writes = []

        class Recording:
            prefix = "/repos/example/project"

            def request(self, path, body=None, method=None):
                writes.append(
                    (method or ("POST" if body is not None else "GET"), path, body)
                )
                return None

        checks = iter([None, "newer_run"])
        result, reason = sync_labels(
            Recording(),
            3,
            ["shadow/要マージ判断"],
            "shadow/再観測が必要",
            lambda: next(checks),
        )
        self.assertIsNone(reason)
        self.assertEqual(
            result,
            ["add:shadow/再観測が必要", "remove:shadow/要マージ判断"],
        )
        self.assertEqual(
            [item[0] for item in writes if item[0] in {"POST", "DELETE"}],
            ["POST", "DELETE"],
        )

    def test_refresh_removes_managed_labels_added_by_a_peer(self):
        api = FixtureAPI(["shadow/要マージ判断"])
        original = api.request

        def peer(path, body=None, method=None):
            result = original(path, body, method)
            verb = method or ("POST" if body is not None else "GET")
            if verb == "POST" and body and "labels" in body:
                names = [item["name"] for item in api.pull["labels"]]
                if "shadow/要対応" not in names:
                    api.pull["labels"].append({"name": "shadow/要対応"})
            return result

        api.request = peer
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "updated")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"] if item["name"] in MANAGED_LABELS],
            ["shadow/CI・レビュー待ち"],
        )

    def test_final_pass_removes_peer_label_after_readd(self):
        api = FixtureAPI([])
        original = api.request
        deletes = {"n": 0}

        def competing_publisher(path, body=None, method=None):
            result = original(path, body, method)
            verb = method or ("POST" if body is not None else "GET")
            desired = "shadow/CI・レビュー待ち"
            peer = "shadow/要対応"
            names = [item["name"] for item in api.pull["labels"]]
            if verb == "POST" and body and "labels" in body and peer not in names:
                api.pull["labels"].append({"name": peer})
            if verb == "DELETE":
                deletes["n"] += 1
                if deletes["n"] == 1:
                    api.pull["labels"] = [
                        item
                        for item in api.pull["labels"]
                        if item["name"] != desired
                    ]
                    if not any(item["name"] == peer for item in api.pull["labels"]):
                        api.pull["labels"].append({"name": peer})
            return result

        api.request = competing_publisher
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "updated")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"] if item["name"] in MANAGED_LABELS],
            ["shadow/CI・レビュー待ち"],
        )

    def test_final_pass_readds_desired_after_peer_deletes_it(self):
        api = FixtureAPI([])
        original = api.request
        deletes = {"n": 0}

        def competing_publisher(path, body=None, method=None):
            result = original(path, body, method)
            verb = method or ("POST" if body is not None else "GET")
            desired = "shadow/CI・レビュー待ち"
            peer = "shadow/要対応"
            names = [item["name"] for item in api.pull["labels"]]
            if (
                verb == "POST"
                and body
                and "labels" in body
                and deletes["n"] < 2
                and peer not in names
            ):
                api.pull["labels"].append({"name": peer})
            if verb == "DELETE":
                deletes["n"] += 1
                api.pull["labels"] = [
                    item for item in api.pull["labels"] if item["name"] != desired
                ]
                if deletes["n"] == 1 and not any(
                    item["name"] == peer for item in api.pull["labels"]
                ):
                    api.pull["labels"].append({"name": peer})
            return result

        api.request = competing_publisher
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "updated")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"] if item["name"] in MANAGED_LABELS],
            ["shadow/CI・レビュー待ち"],
        )

    def test_sync_readds_desired_after_peer_removes_it(self):
        api = FixtureAPI(["shadow/要マージ判断"])
        original = api.request

        def wipe(path, body=None, method=None):
            result = original(path, body, method)
            verb = method or ("POST" if body is not None else "GET")
            if verb == "DELETE":
                api.pull["labels"] = [
                    item
                    for item in api.pull["labels"]
                    if item["name"] not in MANAGED_LABELS
                ]
            return result

        api.request = wipe
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "updated")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"] if item["name"] in MANAGED_LABELS],
            ["shadow/CI・レビュー待ち"],
        )

    def test_empty_remote_labels_are_not_replaced_by_cache(self):
        api = FixtureAPI(["shadow/CI・レビュー待ち"])
        original = api.request
        seen = {"n": 0}

        def emptied(path, body=None, method=None):
            result = original(path, body, method)
            if path.endswith("/pulls/1"):
                seen["n"] += 1
                if seen["n"] == 3:
                    return {**api.pull, "labels": []}
            return result

        api.request = emptied
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "updated")
        self.assertEqual(
            [item["name"] for item in api.pull["labels"] if item["name"] in MANAGED_LABELS],
            ["shadow/CI・レビュー待ち"],
        )

    def test_concurrent_label_create_422_is_reused(self):
        api = FixtureAPI([])
        api.labels = {}
        original = api.request

        def conflict(path, body=None, method=None):
            verb = method or ("POST" if body is not None else "GET")
            if path.endswith("/labels") and verb == "POST" and body and "name" in body:
                api.labels[body["name"]] = True
                raise PublishError(f"API POST {path}: HTTP 422")
            return original(path, body, method)

        api.request = conflict
        status = publish_pr(api, 1, report("WAITING"), 10, 1, [])
        self.assertEqual(status, "updated")
        self.assertIn("shadow/CI・レビュー待ち", [item["name"] for item in api.pull["labels"]])

    def test_missing_repo_labels_are_created_once(self):
        api = FixtureAPI([])
        api.labels = {}
        publish_pr(api, 1, report("WAITING"), 10, 1, [], None)
        created = [
            call[2]["name"]
            for call in api.calls
            if call[0] == "POST" and call[1].endswith("/labels") and call[2] and "name" in call[2]
        ]
        self.assertEqual(sorted(created), sorted(DECISION_LABELS.values()))

    def test_http_delete_uses_method_and_empty_body(self):
        from publish import GitHub

        api = GitHub("example/project")
        with patch("publish.urlopen", return_value=__import__("io").BytesIO(b"")) as request:
            self.assertIsNone(
                api.request(
                    "/repos/example/project/issues/1/labels/shadow%2Fwaiting",
                    method="DELETE",
                )
            )
            sent = request.call_args.args[0]
            self.assertEqual(sent.get_method(), "DELETE")
            self.assertIsNone(sent.data)

    def test_http_failure_is_not_treated_as_published(self):
        from publish import GitHub

        api = GitHub("example/project")
        with patch(
            "publish.urlopen",
            side_effect=HTTPError(
                "https://api.github.com/repos/example/project/labels",
                403,
                "forbidden",
                {},
                None,
            ),
        ):
            with self.assertRaisesRegex(PublishError, "HTTP 403"):
                api.request("/repos/example/project/labels", {"name": "shadow/要対応"})

    def test_cli_publishes_report_and_keeps_unrelated_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            report_dir = Path(directory)
            (report_dir / "pr-1.json").write_text(
                json.dumps(report("WAITING"), ensure_ascii=False) + "\n"
            )
            args = [
                "publish.py",
                "--repository",
                "example/project",
                "--report-dir",
                str(report_dir),
                "--run-id",
                "10",
                "--run-attempt",
                "1",
                "--run-url",
                RUN_URL,
            ]
            api = FixtureAPI(["enhancement"])
            with patch("sys.argv", args), patch("publish.GitHub", return_value=api):
                self.assertEqual(main(), 0)
            names = [item["name"] for item in api.pull["labels"]]
            self.assertIn("shadow/CI・レビュー待ち", names)
            self.assertIn("enhancement", names)

    def test_cli_pr_flag_skips_other_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            report_dir = Path(directory)
            (report_dir / "pr-1.json").write_text(
                json.dumps(report("WAITING"), ensure_ascii=False) + "\n"
            )
            (report_dir / "pr-2.json").write_text(
                json.dumps(report("HUMAN_REVIEW_REQUIRED"), ensure_ascii=False) + "\n"
            )
            args = [
                "publish.py",
                "--repository",
                "example/project",
                "--report-dir",
                str(report_dir),
                "--run-id",
                "10",
                "--run-attempt",
                "1",
                "--run-url",
                RUN_URL,
                "--pr",
                "1",
            ]
            api = FixtureAPI(["enhancement"])
            seen = []
            original = api.request

            def track(path, body=None, method=None):
                seen.append(path)
                return original(path, body, method)

            api.request = track
            with patch("sys.argv", args), patch("publish.GitHub", return_value=api):
                self.assertEqual(main(), 0)
            self.assertTrue(any("/pulls/1" in path for path in seen))
            self.assertFalse(any("/pulls/2" in path for path in seen))
            names = [item["name"] for item in api.pull["labels"]]
            self.assertIn("shadow/CI・レビュー待ち", names)
            self.assertNotIn("shadow/要対応", names)

    def test_cli_noops_without_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            args = [
                "publish.py",
                "--repository",
                "example/project",
                "--report-dir",
                directory,
                "--run-id",
                "10",
                "--run-attempt",
                "1",
                "--run-url",
                RUN_URL,
            ]
            with patch("sys.argv", args):
                self.assertEqual(main(), 0)


if __name__ == "__main__":
    unittest.main()
