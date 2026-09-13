"""保存policy・信頼済みSHAの依存モジュールによる再現を確認する。"""

import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evaluate import assess
from replay import main, replay
from test_support import BASE, facts, policy

RUN = subprocess.run


def archive_modules(overrides=None):
    modules = {
        name: Path(__file__).with_name(name).read_text()
        for name in ("evaluate.py", "contracts.py", "report.py")
    }
    modules.update(overrides or {})
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, source in modules.items():
            if source is None:
                continue
            data = source.encode()
            entry = tarfile.TarInfo(".github/autonomous-merge/" + name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


def recorded_git(archive):
    def run(args, **kwargs):
        if args[0] == "git":
            if args != ["git", "archive", "--format=tar", BASE, ".github/autonomous-merge/"]:
                raise AssertionError(args)
            return subprocess.CompletedProcess(args, 0, archive)
        return RUN(args, **kwargs)
    return patch("replay.subprocess.run", side_effect=run)


class ReplayTests(unittest.TestCase):
    def test_replay_uses_embedded_policy_without_network(self):
        report = assess(facts(), policy())
        # 再評価先プロセスでもネットワーク呼出しを禁止する。
        source = Path(__file__).with_name("evaluate.py").read_text()
        source += '\nimport socket\ndef denied(*args, **kwargs):\n    raise AssertionError("network forbidden")\nsocket.socket.connect = denied\nsocket.getaddrinfo = denied\n'
        with recorded_git(archive_modules({"evaluate.py": source})) as git:
            self.assertEqual(replay(report, BASE), report)
            self.assertEqual(git.call_args_list[0].args[0],
                             ["git", "archive", "--format=tar", BASE, ".github/autonomous-merge/"])

    def test_untrusted_sha_is_rejected_before_loading_code(self):
        with patch("replay.subprocess.run") as git:
            with self.assertRaisesRegex(ValueError, "trusted SHA"):
                replay(assess(facts(), policy()), "d" * 40)
            git.assert_not_called()

    def test_saved_missing_check_identity_replays_as_json_array(self):
        saved_facts = facts()
        saved_facts["checks"] = []
        report = json.loads(json.dumps(assess(saved_facts, policy())))
        self.assertEqual(report["decision"], "WAITING")
        with recorded_git(archive_modules()):
            self.assertEqual(replay(report, BASE), report)

    def test_tampered_decision_conditions_or_fingerprint_fail_cli(self):
        for change in ({"decision": "WAITING"}, {"conditions": []}, {"policy_sha256": "wrong"}):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "pr-1.json"
                path.write_text(json.dumps({**assess(facts(), policy()), **change}))
                with patch("sys.argv", ["replay.py", "--report", str(path), "--evaluator-sha", BASE]), recorded_git(archive_modules()):
                    self.assertEqual(main(), 1)

    def test_dependency_comes_from_recorded_sha_and_does_not_leak_between_replays(self):
        source = Path(__file__).with_name("contracts.py").read_text()
        source += '\ndef integer(value, name):\n    raise EvaluationError("recorded validator")\n'
        # policy検証の失敗を、現在のcheckoutのintegerで救済しない。
        report = assess(facts(), policy())
        with recorded_git(archive_modules({"contracts.py": source})):
            with self.assertRaises(subprocess.CalledProcessError) as error:
                replay(report, BASE)
            self.assertIn("recorded validator", error.exception.stderr)
        with recorded_git(archive_modules()):
            self.assertEqual(replay(report, BASE), report)

    def test_missing_dependency_does_not_fall_back_to_current_checkout(self):
        with recorded_git(archive_modules({"contracts.py": None})):
            with self.assertRaises(subprocess.CalledProcessError):
                replay(assess(facts(), policy()), BASE)

    def test_self_contained_legacy_evaluator_needs_no_new_modules(self):
        source = 'def assess(facts, policy):\n    return {"observations": facts, "policy": policy, "decision": "legacy"}\n'
        report = assess(facts(), policy())
        with recorded_git(archive_modules({"evaluate.py": source, "contracts.py": None, "report.py": None})):
            result = replay(report, BASE)
            self.assertEqual(result, {"observations": report["observations"],
                                      "policy": report["policy"], "decision": "legacy"})

    def test_invalid_or_unavailable_archive_fails_without_evaluation(self):
        with recorded_git(b"invalid tar"):
            with self.assertRaises(tarfile.TarError):
                replay(assess(facts(), policy()), BASE)
        with patch("replay.subprocess.run", side_effect=subprocess.CalledProcessError(128, ["git"])) as git:
            with self.assertRaises(subprocess.CalledProcessError):
                replay(assess(facts(), policy()), BASE)
            self.assertEqual(git.call_count, 1)
