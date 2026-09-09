import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from evaluate import (
    EvaluationError,
    _ensure_within_base,
    _escape_markdown,
    _line_changes,
    _markdown,
    assess,
    load_policy,
    main,
)


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
                    "tests/e2e/widget.spec.ts": "test('renders', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = () => <div>new</div>;\n",
                    "tests/e2e/widget.spec.ts": "test('renders new', () => {});\n",
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

    def test_emptying_a_test_does_not_satisfy_verification(self) -> None:
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
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/unit/ui/widget.test.ts": "",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertFalse(result.test_changes)
            self.assertEqual(
                result.verification_risk,
                POLICY.missing_test_risk + POLICY.test_removal_risk,
            )

    def test_unrelated_unit_test_does_not_satisfy_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/styles.css": ".office { color: blue; }\n",
                    "tests/unit/sim/engine.test.ts": "it('runs', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/styles.css": ".office { color: red; }\n",
                    "tests/unit/sim/engine.test.ts": "it('runs with a new case', () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertFalse(result.test_changes)
            self.assertEqual(result.missing_test_scopes, ("visual",))
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_test_only_deletion_adds_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"tests/unit/sim/engine.test.ts": "it('runs', () => {});\n"})
            head.mkdir()
            write_snapshot(head, {})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertFalse(result.code_changes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)
            self.assertIn("テストの削除・純減", " ".join(result.reasons))

    def test_pure_test_rename_does_not_add_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            test_contents = "it('runs', () => {});\n"
            write_snapshot(base, {"tests/unit/sim/old.test.ts": test_contents})
            write_snapshot(head, {"tests/unit/sim/new.test.ts": test_contents})

            result = assess(base, head, POLICY)

            self.assertEqual(result.test_removal_risk, 0)
            self.assertEqual(result.decision, "ELIGIBLE_FOR_AUTONOMOUS_MERGE")

    def test_unclassified_src_code_has_fallback_path_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/utils/publicUrl.ts": "export const url = '/';\n"})
            write_snapshot(head, {"src/utils/publicUrl.ts": "export const url = '/app/';\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertEqual(result.path_assessments[0].risk, 10)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_static_asset_change_requires_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"public/assets/devops-command-center.jpg": "old asset\n"})
            write_snapshot(head, {"public/assets/devops-command-center.jpg": "new asset\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertTrue(result.code_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

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
            self.assertEqual(
                result.verification_risk,
                POLICY.missing_test_risk + POLICY.test_removal_risk,
            )

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

    def test_html_entry_change_is_subject_to_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"index.html": "<div id=\"root\"></div>\n"})
            write_snapshot(head, {"index.html": "<main></main>\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertTrue(result.code_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_root_react_entries_have_ui_path_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/App.tsx": "export const App = 1;\n",
                    "src/main.tsx": "render(1);\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/App.tsx": "export const App = 2;\n",
                    "src/main.tsx": "render(2);\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertEqual(
                {item.path: item.risk for item in result.path_assessments},
                {"src/App.tsx": 15, "src/main.tsx": 15},
            )

    def test_agents_instructions_are_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"AGENTS.md": "Run the required checks.\n"})
            write_snapshot(head, {"AGENTS.md": "Skip the required checks.\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("リポジトリ作業指示", result.hard_gate_reasons[0])

    def test_codex_environment_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".codex/environments/environment.toml": "mode = 'safe'\n"})
            write_snapshot(head, {".codex/environments/environment.toml": "mode = 'unsafe'\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Codex実行環境", " ".join(result.hard_gate_reasons))

    def test_codex_config_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".codex/config.toml": "default_permissions = 'safe'\n"})
            write_snapshot(head, {".codex/config.toml": "default_permissions = 'full'\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Codex権限設定", " ".join(result.hard_gate_reasons))

    def test_nested_agents_instructions_are_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/AGENTS.md": "Run the required checks.\n"})
            write_snapshot(head, {"src/AGENTS.md": "Skip the required checks.\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("リポジトリ作業指示", " ".join(result.hard_gate_reasons))

    def test_ui_design_system_contracts_are_hard_gates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "docs/design-system.md": "Use the design tokens.\n",
                    ".agents/skills/devops-tycoon-design-system/SKILL.md": "Follow the design system.\n",
                },
            )
            write_snapshot(
                head,
                {
                    "docs/design-system.md": "Ignore the design tokens.\n",
                    ".agents/skills/devops-tycoon-design-system/SKILL.md": "Ignore the design system.\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            reasons = " ".join(result.hard_gate_reasons)
            self.assertIn("UIデザインシステム制約", reasons)
            self.assertIn("UIデザインシステム入口", reasons)

    def test_prettier_configuration_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    ".prettierrc.json": '{"semi": true}\n',
                    ".prettierignore": "dist\n",
                },
            )
            write_snapshot(
                head,
                {
                    ".prettierrc.json": '{"semi": false}\n',
                    ".prettierignore": "**\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            reasons = " ".join(result.hard_gate_reasons)
            self.assertIn("Prettier設定", reasons)
            self.assertIn("Prettier対象除外設定", reasons)

    def test_webgl_build_helper_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"vite.webglModules.ts": "export const modules = [];\n"})
            write_snapshot(head, {"vite.webglModules.ts": "export const modules = ['office'];\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("WebGLビルド設定", result.hard_gate_reasons[0])

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

    def test_gitmodules_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".gitmodules": '[submodule "vendor/dep"]\n'})
            write_snapshot(head, {".gitmodules": '[submodule "vendor/new-dep"]\n'})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Git submodule構成", " ".join(result.hard_gate_reasons))

    def test_gitlink_manifest_changes_are_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base.mkdir()
            head.mkdir()
            base_gitlinks = Path(directory) / "base.gitlinks"
            head_gitlinks = Path(directory) / "head.gitlinks"
            base_gitlinks.write_text("a" * 40 + "\tvendor/dep\n", encoding="utf-8")
            head_gitlinks.write_text("b" * 40 + "\tvendor/dep\n", encoding="utf-8")

            result = assess(
                base,
                head,
                POLICY,
                base_gitlinks=base_gitlinks,
                head_gitlinks=head_gitlinks,
            )

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertEqual(result.files[0].path, "vendor/dep")
            self.assertTrue(result.files[0].gitlink)
            self.assertIn("Git submodule参照", result.hard_gate_reasons[0])

    def test_large_text_diff_uses_bounded_conservative_counts(self) -> None:
        base_data = ("repeat\n" * 2500).encode("utf-8")
        head_data = ("repeat\n" * 2501).encode("utf-8")

        additions, deletions, binary = _line_changes(base_data, head_data)

        self.assertEqual(additions, 2501)
        self.assertEqual(deletions, 2500)
        self.assertFalse(binary)

    def test_path_rule_hard_gate_requires_a_boolean(self) -> None:
        policy_path = ROOT / ".github" / "autonomous-merge" / "policy.toml"
        policy_text = policy_path.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as directory:
            invalid_policies = (
                policy_text.replace("hard_gate = true", 'hard_gate = "true"', 1),
                policy_text.replace("hard_gate = true", "hard_gate = 1", 1),
                policy_text.replace("hard_gate = true\n", "", 1),
            )
            for index, invalid_policy in enumerate(invalid_policies):
                invalid_path = Path(directory) / f"invalid-{index}.toml"
                invalid_path.write_text(invalid_policy, encoding="utf-8")

                with self.subTest(index=index), self.assertRaises(EvaluationError):
                    load_policy(invalid_path)

    def test_markdown_output_escapes_untrusted_path_characters(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            malicious_path = "src/ui/evil`[link](https://example.com)|.tsx"
            write_snapshot(base, {malicious_path: "export const value = 1;\n"})
            write_snapshot(head, {malicious_path: "export const value = 2;\n"})

            result = assess(base, head, POLICY)
            markdown = _markdown(result, POLICY, Path("base/policy.toml"))

            self.assertNotIn("`[link](https://example.com)", markdown)
            self.assertNotIn("|.tsx", markdown)
            self.assertIn("&#96;", markdown)
            self.assertIn("&#91;", markdown)
            self.assertIn("&#124;", markdown)
            self.assertIn("<code>", markdown)
            self.assertNotIn("\\`", _escape_markdown("`"))

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

    def test_cli_can_use_trusted_base_separately_from_comparison_base(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            comparison_base = Path(directory) / "comparison-base"
            head = Path(directory) / "head"
            comparison_base.mkdir()
            head.mkdir()
            output = io.StringIO()

            with contextlib.redirect_stdout(output):
                result = main(
                    [
                        "--base-dir",
                        str(comparison_base),
                        "--head-dir",
                        str(head),
                        "--policy",
                        str(ROOT / ".github" / "autonomous-merge" / "policy.toml"),
                        "--trusted-base-dir",
                        str(ROOT),
                        "--format",
                        "json",
                    ]
                )

            self.assertEqual(result, 0)
            self.assertIn('"risk": 0', output.getvalue())


if __name__ == "__main__":
    unittest.main()
