"""保存policy・信頼済み評価器のSHAによる再現と、不一致時の失敗を確認する。"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evaluate import assess
from replay import main, replay
from test_evaluate import BASE, facts, policy


class ReplayTests(unittest.TestCase):
    def test_replay_uses_embedded_policy_without_network(self):
        source = Path(__file__).with_name("evaluate.py").read_text()
        report = assess(facts(), policy())
        with (
            patch("replay.subprocess.run", return_value=subprocess.CompletedProcess([], 0, source)) as git,
            patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")),
        ):
            self.assertEqual(replay(report, BASE), report)
            self.assertEqual(git.call_args.args[0], ["git", "show", f"{BASE}:.github/autonomous-merge/evaluate.py"])

    def test_untrusted_sha_is_rejected_before_loading_code(self):
        with patch("replay.subprocess.run") as git:
            with self.assertRaisesRegex(ValueError, "trusted SHA"):
                replay(assess(facts(), policy()), "d" * 40)
            git.assert_not_called()

    def test_tampered_decision_conditions_or_fingerprint_fail_cli(self):
        source = Path(__file__).with_name("evaluate.py").read_text()
        for change in ({"decision": "WAITING"}, {"conditions": []}, {"policy_sha256": "wrong"}):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "pr-1.json"
                path.write_text(json.dumps({**assess(facts(), policy()), **change}))
                with patch("sys.argv", ["replay.py", "--report", str(path), "--evaluator-sha", BASE]), patch(
                    "replay.subprocess.run", return_value=subprocess.CompletedProcess([], 0, source)
                ):
                    self.assertEqual(main(), 1)
