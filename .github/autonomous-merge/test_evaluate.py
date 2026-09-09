import tempfile
import unittest
from pathlib import Path

from evaluate import EvaluationError, _ensure_within_base, assess, load_policy


ROOT = Path(__file__).resolve().parents[2]
POLICY = load_policy(ROOT / ".github" / "autonomous-merge" / "policy.toml")


def write_snapshot(root: Path, files: dict[str, str]) -> None:
    for relative_path, contents in files.items():
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")


class EvaluateTests(unittest.TestCase):
    def test_small_ui_change_with_test_is_eligible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = () => <div>old</div>;\n",
                    "tests/unit/ui/widget.test.ts": "it('renders', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = () => <div>new</div>;\n",
                    "tests/unit/ui/widget.test.ts": "it('renders new', () => {});\n",
                },
            )

            result = assess(base, head, POLICY, base_sha="base", head_sha="head")

            self.assertEqual(result.decision, "ELIGIBLE_FOR_AUTONOMOUS_MERGE")
            self.assertEqual(result.risk, 25)
            self.assertEqual(result.verification_risk, 0)

    def test_missing_test_adds_verification_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(head, {"src/ui/Widget.tsx": "export const Widget = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)
            self.assertIn("テスト変更がなく", " ".join(result.reasons))

    def test_deleted_test_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/unit/ui/widget.test.ts": "it('renders', () => {});\n",
                },
            )
            write_snapshot(head, {"src/ui/Widget.tsx": "export const Widget = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertFalse(result.test_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_css_change_is_subject_to_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/styles.css": ".office { color: blue; }\n"})
            write_snapshot(head, {"src/styles.css": ".office { color: red; }\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertTrue(result.code_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_visual_snapshots_count_as_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/office.spec.ts-snapshots/office.png": "old image\n",
                    "tests/playtest/__snapshots__/result.snap": "old snapshot\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/office.spec.ts-snapshots/office.png": "new image\n",
                    "tests/playtest/__snapshots__/result.snap": "new snapshot\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertTrue(result.code_changes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.verification_risk, 0)

    def test_nvmrc_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".nvmrc": "24\n"})
            write_snapshot(head, {".nvmrc": "22\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Node.js実行バージョン", result.hard_gate_reasons[0])

    def test_game_facade_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/game.ts": "export const game = 1;\n"})
            write_snapshot(head, {"src/game.ts": "export const game = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("ゲーム中核ファサード", result.hard_gate_reasons[0])

    def test_state_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/state/runPersistence.ts": "export const version = 1;\n"})
            write_snapshot(head, {"src/state/runPersistence.ts": "export const version = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertTrue(result.hard_gate_reasons)
            self.assertIn("セーブ・永続化・状態遷移", result.hard_gate_reasons[0])

    def test_policy_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".github/autonomous-merge/policy.toml": "version = 1\n"})
            write_snapshot(head, {".github/autonomous-merge/policy.toml": "version = 2\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("評価器・policyの変更", result.hard_gate_reasons[0])

    def test_assessment_is_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(head, {"src/ui/Widget.tsx": "export const Widget = 2;\n"})

            first = assess(base, head, POLICY)
            second = assess(base, head, POLICY)

            self.assertEqual(first, second)

    def test_cli_sources_must_be_inside_base_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            base.mkdir()

            with self.assertRaises(EvaluationError):
                _ensure_within_base(
                    base,
                    ROOT / ".github" / "autonomous-merge" / "policy.toml",
                    "policy",
                )


if __name__ == "__main__":
    unittest.main()
