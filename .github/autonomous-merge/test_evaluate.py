import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evaluate import (
    EvaluationError,
    MAX_TEST_BEHAVIOR_RECORDS,
    MAX_SNAPSHOT_FILE_BYTES,
    _ensure_within_base,
    _escape_markdown,
    _disabled_javascript_call_ranges,
    _has_executable_test_reduction,
    _has_test_behavior_change,
    _javascript_call_argument_span_index,
    _javascript_disabled_test_option_variables,
    _javascript_assertion_count,
    _javascript_test_call_spans,
    _javascript_test_behavior_records,
    _line_changes,
    _markdown,
    _read_snapshot,
    assess,
    load_policy,
    main,
)


ROOT = Path(__file__).resolve().parents[2]
POLICY = load_policy(ROOT / ".github" / "autonomous-merge" / "policy.toml")


def write_snapshot(root: Path, files: dict[str, str | bytes]) -> None:
    for relative_path, contents in files.items():
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(contents, bytes):
            path.write_bytes(contents)
        else:
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
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', () => expect(page).toBeHidden());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = () => <div>new</div>;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders new', () => expect(page).toBeVisible());\n"
                    ),
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

    def test_meta_shop_ui_requires_its_corresponding_e2e_spec(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/MetaShopScreen.tsx": "export const MetaShopScreen = 1;\n",
                    "tests/e2e/smoke.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('smoke', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/MetaShopScreen.tsx": "export const MetaShopScreen = 2;\n",
                    "tests/e2e/smoke.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('smoke updated', () => expect(page).toHaveTitle('Tycoon'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("meta-shop-visual", result.missing_test_scopes)
            self.assertTrue(result.test_changes)

    def test_achievement_collection_ui_requires_its_corresponding_e2e_spec(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/AchievementCollectionScreen.tsx": "export const AchievementCollectionScreen = 1;\n",
                    "tests/e2e/smoke.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('smoke', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/AchievementCollectionScreen.tsx": "export const AchievementCollectionScreen = 2;\n",
                    "tests/e2e/smoke.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('smoke updated', () => expect(page).toHaveTitle('Tycoon'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("achievement-visual", result.missing_test_scopes)
            self.assertTrue(result.test_changes)

    def test_test_only_pr_records_usable_test_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base.mkdir()
            write_snapshot(
                head,
                {
                    "tests/unit/utils/new-behavior.test.ts": (
                        "import { expect, it } from 'vitest';\n"
                        "it('covers the new behavior', () => expect(value).toBe(1));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertFalse(result.code_changes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.missing_test_scopes, ())

    def test_new_spec_without_test_declaration_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": "export const helper = 1;\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

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

    def test_replacing_a_test_with_a_longer_helper_adds_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/assetUrl.test.ts": (
                        "import { expect, it } from 'vitest';\n"
                        "it('builds the URL', () => expect(buildUrl('/')).toBe('/'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/assetUrl.test.ts": (
                        "const renderFixture = {\n"
                        "  component: 'asset-url',\n"
                        "  label: 'builds the URL',\n"
                        "};\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)
            self.assertFalse(result.test_changes)
            self.assertIn("src-fallback", result.missing_test_scopes)

    def test_disabling_a_test_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { it } from 'vitest';\n"
                        "it('builds the URL', () => {});\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { it } from 'vitest';\n"
                        "it.skip('builds the URL', () => {});\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_conditional_test_disabling_does_not_satisfy_verification(self) -> None:
        for disabled_call in ("test.skipIf(true)", "test.runIf(false)"):
            with self.subTest(disabled_call=disabled_call):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { test } from 'vitest';\n"
                                "test('builds the URL', () => {});\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { test } from 'vitest';\n"
                                f"{disabled_call}('builds the URL', () => {{}});\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_imported_test_alias_modifier_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, test as check } from 'vitest';\n"
                        "check('builds', () => expect(url).toBe('/'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, test as check } from 'vitest';\n"
                        "check.skip('builds', () => expect(url).toBe('/app/'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_disabled_test_option_alias_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, test } from 'vitest';\n"
                        "test('builds', () => expect(url).toBe('/'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, test } from 'vitest';\n"
                        "const skipped = { skip: true };\n"
                        "const opts = skipped;\n"
                        "test('builds', opts, () => expect(url).toBe('/app/'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_runner_parameter_shadowing_does_not_register_fake_tests(self) -> None:
        source = (
            "import { expect, test as runner } from 'vitest';\n"
            "function register(runner) {\n"
            "  runner('fake', () => expect(value).toBe(1));\n"
            "}\n"
        )

        self.assertEqual(_javascript_test_call_spans(source), ())
        self.assertEqual(_javascript_test_behavior_records(source.encode()), ())

    def test_node_assert_shadowing_does_not_satisfy_verification(self) -> None:
        source = (
            "import { strict as assert } from 'node:assert/strict';\n"
            "import { test } from 'vitest';\n"
            "test('fake', () => {\n"
            "  const assert = { equal() {} };\n"
            "  assert.equal(value, value);\n"
            "});\n"
        )

        self.assertEqual(_javascript_test_behavior_records(source.encode()), ())

    def test_assertions_in_uncalled_nested_functions_do_not_satisfy_verification(
        self,
    ) -> None:
        source = (
            "import { expect, test } from 'vitest';\n"
            "test('unused', () => {\n"
            "  function unused() {\n"
            "    expect(value).toBe(1);\n"
            "  }\n"
            "});\n"
        )
        active_source = source.replace(
            "  }\n});\n",
            "  }\n  expect(value).toBe(1);\n});\n",
        )

        self.assertEqual(_javascript_test_behavior_records(source.encode()), ())
        self.assertEqual(len(_javascript_test_behavior_records(active_source.encode())), 1)

    def test_empty_parameterized_tests_and_suites_do_not_satisfy_verification(self) -> None:
        empty_test = (
            "import { expect, test } from 'vitest';\n"
            "test.each([])('empty', () => expect(value).toBe(1));\n"
        )
        empty_suite = (
            "import { expect, test, describe } from 'vitest';\n"
            "describe.each([])('empty', () => {\n"
            "  test('never runs', () => expect(value).toBe(1));\n"
            "});\n"
        )

        self.assertEqual(_javascript_test_call_spans(empty_test), ())
        self.assertEqual(_javascript_test_behavior_records(empty_test.encode()), ())
        self.assertEqual(_javascript_test_behavior_records(empty_suite.encode()), ())

    def test_active_conditional_tests_satisfy_verification(self) -> None:
        for conditional_call in ("test.skipIf(false)", "test.runIf(true)"):
            with self.subTest(conditional_call=conditional_call):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                "test('builds', () => expect(url).toBe('/'));\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                f"{conditional_call}('builds', () => expect(url).toBe('/app/'));\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertNotIn("src-fallback", result.missing_test_scopes)
                    self.assertTrue(result.test_changes)
                    self.assertEqual(result.verification_risk, 0)

    def test_dynamic_conditional_tests_are_treated_as_disabled(self) -> None:
        for conditional_call in (
            "test.skipIf(process.env.CI)",
            "test.runIf(process.env.CI)",
        ):
            with self.subTest(conditional_call=conditional_call):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                "test('builds', () => expect(url).toBe('/'));\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                f"{conditional_call}('builds', () => expect(url).toBe('/app/'));\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_called_nested_helpers_and_callbacks_contribute_assertions(self) -> None:
        source = (
            "import { expect, test } from 'vitest';\n"
            "test('runs', () => {\n"
            "  function verify() {\n"
            "    expect(value).toBe(1);\n"
            "  }\n"
            "  verify();\n"
            "  [value].forEach(() => expect(value).toBe(1));\n"
            "});\n"
        )

        self.assertEqual(len(_javascript_test_behavior_records(source.encode())), 1)

    def test_typed_arrow_parameter_shadowing_does_not_register_fake_tests(self) -> None:
        source = (
            "import { expect, test as runner } from 'vitest';\n"
            "const register = (runner: typeof test): void => {\n"
            "  runner('fake', () => expect(value).toBe(1));\n"
            "};\n"
            "runner('real', () => expect(value).toBe(1));\n"
        )

        calls = _javascript_test_call_spans(source)

        self.assertEqual(len(calls), 1)

    def test_playwright_test_info_alias_modifiers_do_not_satisfy_verification(self) -> None:
        for modifier in ("skip", "fixme", "fail"):
            with self.subTest(modifier=modifier), tempfile.TemporaryDirectory() as directory:
                base = Path(directory) / "base"
                head = Path(directory) / "head"
                write_snapshot(
                    base,
                    {
                        "src/ui/Widget.tsx": "export const Widget = 1;\n",
                        "tests/e2e/widget.spec.ts": (
                            "import { expect, test } from '@playwright/test';\n"
                            "test('renders', async ({ page }, info) => "
                            "expect(page).toBeVisible());\n"
                        ),
                    },
                )
                write_snapshot(
                    head,
                    {
                        "src/ui/Widget.tsx": "export const Widget = 2;\n",
                        "tests/e2e/widget.spec.ts": (
                            "import { expect, test } from '@playwright/test';\n"
                            "test('renders', async ({ page }, info) => {\n"
                            f"  info.{modifier}('temporarily disabled');\n"
                            "  expect(page).toBeVisible();\n"
                            "});\n"
                        ),
                    },
                )

                result = assess(base, head, POLICY)

                self.assertIn("visual", result.missing_test_scopes)
                self.assertFalse(result.test_changes)
                self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_chained_test_disabling_does_not_satisfy_verification(self) -> None:
        for disabled_call in (
            "test.concurrent.skip",
            "test.skip.concurrent",
            "test.describe.concurrent.skip",
            "test\n  .skip",
        ):
            with self.subTest(disabled_call=disabled_call):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { test } from 'vitest';\n"
                                "test('builds the URL', () => {});\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { test } from 'vitest';\n"
                                f"{disabled_call}('builds the URL', () => {{}});\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_vitest_test_options_disabling_does_not_satisfy_verification(self) -> None:
        for option in ("skip", "todo", "fails"):
            with self.subTest(option=option):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                "test('builds the URL', () => expect(url).toBe('/'));\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                "test(\n"
                                "  'builds the URL',\n"
                                f"  {{ {option}: true }},\n"
                                "  () => expect(url).toBe('/app/'),\n"
                                ");\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_vitest_disabled_suite_options_do_not_satisfy_verification(self) -> None:
        for suite_name in ("describe", "suite"):
            with self.subTest(suite_name=suite_name):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                f"{suite_name}('URL', () => "
                                "test('builds the URL', () => expect(url).toBe('/')));\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                f"{suite_name}(\n"
                                "  'URL',\n"
                                "  { skip: true },\n"
                                "  () => test('builds the URL', () => expect(url).toBe('/app/')),\n"
                                ");\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_vitest_suite_alias_skip_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { describe as group } from 'vitest';\n"
                        "group('URL', () => test('builds the URL', () => expect(url).toBe('/')));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { describe as group } from 'vitest';\n"
                        "group.skip('URL', () => test('builds the URL', () => expect(url).toBe('/app/')));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_vitest_namespace_suite_skip_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { test } from 'vitest';\n"
                        "import * as v from 'vitest';\n"
                        "v.describe('URL', () => test('builds', () => expect(url).toBe('/')));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { test } from 'vitest';\n"
                        "import * as v from 'vitest';\n"
                        "v.describe.skip('URL', () => test('builds', () => expect(url).toBe('/app/')));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_vitest_false_skip_option_keeps_test_usable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, test } from 'vitest';\n"
                        "test('builds the URL', () => expect(url).toBe('/'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, test } from 'vitest';\n"
                        "test('builds the URL', { skip: false }, () => expect(url).toBe('/app/'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("src-fallback", result.missing_test_scopes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.test_removal_risk, 0)

    def test_vitest_complex_falsey_options_do_not_satisfy_verification(self) -> None:
        for expression in ("false || true", "0 || 1", "undefined ?? true"):
            with self.subTest(expression=expression), tempfile.TemporaryDirectory() as directory:
                base = Path(directory) / "base"
                head = Path(directory) / "head"
                write_snapshot(
                    base,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "import { expect, test } from 'vitest';\n"
                            "test('builds the URL', () => expect(url).toBe('/'));\n"
                        ),
                    },
                )
                write_snapshot(
                    head,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "test('builds the URL', { skip: "
                            f"{expression} }}, () => expect(url).toBe('/app/'));\n"
                        ),
                    },
                )

                result = assess(base, head, POLICY)

                self.assertIn("src-fallback", result.missing_test_scopes)
                self.assertFalse(result.test_changes)
                self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_vitest_complex_falsey_option_assignments_do_not_satisfy_verification(self) -> None:
        for expression in ("false || true", "0 || 1", "undefined ?? true"):
            with self.subTest(expression=expression), tempfile.TemporaryDirectory() as directory:
                base = Path(directory) / "base"
                head = Path(directory) / "head"
                write_snapshot(
                    base,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "test('builds the URL', () => expect(url).toBe('/'));\n"
                        ),
                    },
                )
                write_snapshot(
                    head,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "import { expect, test } from 'vitest';\n"
                            "const options = {};\n"
                            f"options.skip = {expression};\n"
                            "test('builds the URL', options, () => expect(url).toBe('/app/'));\n"
                        ),
                    },
                )

                result = assess(base, head, POLICY)

                self.assertIn("src-fallback", result.missing_test_scopes)
                self.assertFalse(result.test_changes)
                self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_assertion_reduction_is_scoped_to_executable_test_callbacks(self) -> None:
        base = (
            "import { expect, test } from 'vitest';\n"
            "test('runs', () => expect(run()).toBe(1));\n"
        ).encode("utf-8")
        head = (
            "import { expect, test } from 'vitest';\n"
            "const unused = () => expect(run()).toBe(2);\n"
            "test('runs', () => run());\n"
        ).encode("utf-8")

        self.assertTrue(_has_executable_test_reduction(base, head, language="javascript"))

    def test_expect_shadowing_in_enclosing_suite_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner_base = (
                "import { expect, test } from '@playwright/test';\n"
                "test.describe('group', () => {\n"
                "  test('renders', () => expect(page).toBeVisible());\n"
                "});\n"
            )
            owner_head = (
                "import { expect, test } from '@playwright/test';\n"
                "test.describe('group', () => {\n"
                "  const expect = () => ({ toBeVisible() {} });\n"
                "  test('renders', () => expect(page).toBeVisible());\n"
                "});\n"
            )
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner_base,
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner_head,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_vitest_shorthand_and_variable_options_do_not_satisfy_verification(self) -> None:
        for declaration, options in (
            ("const skip = true;\n", "{ skip }"),
            ("const todo = true;\n", "{ todo }"),
            ("const options = { skip: true };\n", "options"),
            ("const options = { todo: true };\n", "options"),
            ("const options = { skip: true };\n", "options satisfies { skip: boolean }"),
            ("const options = { skip: true };\n", "options as TestOptions"),
            ("const options = { skip: true };\n", "options!"),
            ("const options = { skip: true };\n", "(options)"),
            ("const options = { skip: true };\n", "((options))"),
            ("const options = { skip: false };\noptions.skip = true;\n", "options"),
            ("const options = { skip: false };\noptions['skip'] = true;\n", "options"),
            ("const skip = true;\nconst options = { skip };\n", "options"),
            ("", "{ ['skip']: true }"),
            ("", '{ ["todo"]: true }'),
            ("const disabled = { skip: true };\n", "{ ...disabled }"),
            ("const disabled = { todo: true };\n", "{ ...disabled }"),
            (
                "const disabled = { skip: true };\nconst options = { ...disabled };\n",
                "options",
            ),
        ):
            with self.subTest(declaration=declaration, options=options):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                "test('builds the URL', () => expect(url).toBe('/'));\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { expect, test } from 'vitest';\n"
                                f"{declaration}"
                                "test(\n"
                                "  'builds the URL',\n"
                                f"  {options},\n"
                                "  () => expect(url).toBe('/app/'),\n"
                                ");\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_disabled_test_option_is_tracked_per_callback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "const disabled = { skip: true };\n"
                        "test('first', disabled, () => expect(url).toBe('/first'));\n"
                        "test('second', () => expect(url).toBe('/second'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "const disabled = { skip: true };\n"
                        "test('first', () => expect(url).toBe('/first'));\n"
                        "test('second', disabled, () => expect(url).toBe('/app/second'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)


    def test_computed_property_test_disabling_does_not_satisfy_verification(self) -> None:
        for disabled_call in (
            "test['skip']",
            'it["todo"]',
            "test['concurrent']['skip']",
            "test[`skip`]",
            "test?.skip",
        ):
            with self.subTest(disabled_call=disabled_call):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { test } from 'vitest';\n"
                                "test('builds the URL', () => {});\n"
                            ),
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                            "tests/unit/utils/publicUrl.test.ts": (
                                "import { test } from 'vitest';\n"
                                f"{disabled_call}('builds the URL', () => {{}});\n"
                            ),
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("src-fallback", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_comment_inside_template_interpolation_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": "test(`widget ${value}`, () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": "test(`widget ${/* only a comment */ value}`, () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, 0)

    def test_skip_text_in_comments_and_strings_is_not_a_disabled_test_call(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "// test.skip is rejected elsewhere\n"
                        "const note = 'documents test.skip behavior';\n"
                        "import { expect, test } from '@playwright/test';\n"
                        "test('documents test.skip behavior', () => expect(page).toHaveText('updated'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertTrue(result.test_changes)
            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertEqual(result.test_removal_risk, 0)

    def test_empty_test_suite_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": "test.describe('group', () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_javascript_method_call_does_not_satisfy_verification(self) -> None:
        for expression in ("/widget/.test('widget');", "widget.test('widget');"):
            with self.subTest(expression=expression):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
                    write_snapshot(
                        head,
                        {
                            "src/ui/Widget.tsx": "export const Widget = 2;\n",
                            "tests/e2e/widget.spec.ts": f"const matches = {expression}\n",
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("visual", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)

    def test_helper_only_test_file_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test('renders', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "const unrelatedHelper = 1;\n"
                        "test('renders', () => expect(page).toBeVisible());\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_test_title_only_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test('renders the widget', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test('renders the updated widget', () => expect(page).toBeVisible());\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_existing_skipped_test_body_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test.skip(\n"
                        "  'renders the widget',\n"
                        "  () => expect(page).toBeVisible(),\n"
                        ");\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test.skip(\n"
                        "  'renders the widget',\n"
                        "  () => expect(page).toHaveText('updated'),\n"
                        ");\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_runtime_skip_inside_test_body_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner_base = (
                "test('renders', () => {\n"
                "  test.skip(true, 'temporarily disabled');\n"
                "  expect(page).toBeVisible();\n"
                "});\n"
            )
            owner_head = owner_base.replace("toBeVisible()", "toHaveText('updated')")
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner_base,
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner_head,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_test_info_skip_inside_test_body_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner_base = (
                "test('renders', async ({ page }, testInfo) => {\n"
                "  await expect(page).toBeVisible();\n"
                "});\n"
            )
            owner_head = (
                "test('renders', async ({ page }, testInfo) => {\n"
                "  testInfo.skip();\n"
                "  await expect(page).toHaveText('updated');\n"
                "});\n"
            )
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n", "tests/e2e/widget.spec.ts": owner_base})
            write_snapshot(head, {"src/ui/Widget.tsx": "export const Widget = 2;\n", "tests/e2e/widget.spec.ts": owner_head})

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_vitest_test_context_modifiers_do_not_satisfy_verification(self) -> None:
        callbacks = (
            "(ctx) => {\n"
            "  ctx.skip();\n"
            "  expect(page).toHaveText('updated');\n"
            "}",
            "({ skip }) => {\n"
            "  skip();\n"
            "  expect(page).toHaveText('updated');\n"
            "}",
            "({ skip: skipTest }) => {\n"
            "  skipTest();\n"
            "  expect(page).toHaveText('updated');\n"
            "}",
        )
        for callback in callbacks:
            with self.subTest(callback=callback), tempfile.TemporaryDirectory() as directory:
                base = Path(directory) / "base"
                head = Path(directory) / "head"
                write_snapshot(
                    base,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "import { expect, test } from 'vitest';\n"
                            "test('renders', () => expect(page).toHaveText('old'));\n"
                        ),
                    },
                )
                write_snapshot(
                    head,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "import { expect, test } from 'vitest';\n"
                            "test('renders', " + callback + ");\n"
                        ),
                    },
                )

                result = assess(base, head, POLICY)

                self.assertIn("src-fallback", result.missing_test_scopes)
                self.assertFalse(result.test_changes)
                self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_conditional_suite_modifiers_do_not_satisfy_verification(self) -> None:
        for modifier in ("describe.skipIf(true)", "describe.runIf(false)"):
            with self.subTest(modifier=modifier), tempfile.TemporaryDirectory() as directory:
                base = Path(directory) / "base"
                head = Path(directory) / "head"
                write_snapshot(
                    base,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "import { expect, test, describe } from 'vitest';\n"
                            "describe('group', () => {\n"
                            "  test('renders', () => expect(url).toBe('/'));\n"
                            "});\n"
                        ),
                    },
                )
                write_snapshot(
                    head,
                    {
                        "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                        "tests/unit/utils/publicUrl.test.ts": (
                            "import { expect, test, describe } from 'vitest';\n"
                            f"{modifier}('group', () => {{\n"
                            "  test('renders', () => expect(url).toBe('/app/'));\n"
                            "});\n"
                        ),
                    },
                )

                result = assess(base, head, POLICY)

                self.assertIn("src-fallback", result.missing_test_scopes)
                self.assertFalse(result.test_changes)
                self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_template_interpolation_runtime_skip_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test('renders', () => {\n"
                        "  expect(page).toBeVisible();\n"
                        "});\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test('renders', () => {\n"
                        "  `${test.skip(true, 'temporarily disabled')}`;\n"
                        "  expect(page).toHaveText('updated');\n"
                        "});\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_suite_scope_runtime_modifier_does_not_satisfy_verification(self) -> None:
        for modifier in ("test.skip(true, 'off')", "test.fail()"):
            with self.subTest(modifier=modifier):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    owner_base = (
                        "test.describe('group', () => {\n"
                        f"  {modifier};\n"
                        "  test('renders', () => expect(page).toBeVisible());\n"
                        "});\n"
                    )
                    owner_head = owner_base.replace(
                        "toBeVisible()",
                        "toHaveText('updated')",
                    )
                    write_snapshot(
                        base,
                        {
                            "src/ui/Widget.tsx": "export const Widget = 1;\n",
                            "tests/e2e/widget.spec.ts": owner_base,
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/ui/Widget.tsx": "export const Widget = 2;\n",
                            "tests/e2e/widget.spec.ts": owner_head,
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("visual", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)

    def test_suite_hook_modifier_after_test_declaration_does_not_satisfy_verification(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner_base = (
                "import { expect, test } from '@playwright/test';\n"
                "test.describe('group', () => {\n"
                "  test('renders', () => expect(page).toBeVisible());\n"
                "});\n"
            )
            owner_head = (
                "import { expect, test } from '@playwright/test';\n"
                "test.describe('group', () => {\n"
                "  test('renders', () => expect(page).toHaveText('updated'));\n"
                "  test.beforeEach(() => test.skip(true, 'temporarily disabled'));\n"
                "});\n"
            )
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner_base,
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner_head,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_expected_failure_test_does_not_satisfy_verification(self) -> None:
        for test_call in ("test.fail", "it.fails"):
            with self.subTest(test_call=test_call):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    owner_base = (
                        f"{test_call}('renders', () => expect(page).toBeVisible());\n"
                    )
                    owner_head = owner_base.replace(
                        "toBeVisible()",
                        "toHaveText('updated')",
                    )
                    write_snapshot(
                        base,
                        {
                            "src/ui/Widget.tsx": "export const Widget = 1;\n",
                            "tests/e2e/widget.spec.ts": owner_base,
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            "src/ui/Widget.tsx": "export const Widget = 2;\n",
                            "tests/e2e/widget.spec.ts": owner_head,
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("visual", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)

    def test_parameterized_test_callback_satisfies_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, it } from 'vitest';\n"
                        "it.each([['old']])('builds', (value) => expect(value).toBe('old'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { expect, it } from 'vitest';\n"
                        "it.each([['new']])('builds', (value) => expect(value).toBe('new'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("src-fallback", result.missing_test_scopes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.verification_risk, 0)

    def test_parameterized_test_disabled_option_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "it.each([['old']])('builds', (value) => expect(value).toBe('old'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "it.each([['new']])('builds', { skip: true }, "
                        "(value) => expect(value).toBe('new'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_empty_javascript_callback_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { test } from '@playwright/test';\n"
                        "test('renders', () => {});\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_callback_without_assertion_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "test('renders', async () => { await Promise.resolve(); });\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_expect_without_matcher_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/ui/Widget.tsx": "export const Widget = 1;\n"})
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": "test('renders', () => { expect(1); });\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_node_assertion_satisfies_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { strict as assert } from 'node:assert/strict';\n"
                        "import { test } from 'vitest';\n"
                        "test('builds', () => { assert.equal('/old', '/old'); });\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "import { strict as assert } from 'node:assert/strict';\n"
                        "import { test } from 'vitest';\n"
                        "test('builds', () => { assert.equal('/new', '/new'); });\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("src-fallback", result.missing_test_scopes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.verification_risk, 0)

    def test_unbound_or_non_assertion_node_calls_do_not_satisfy_verification(self) -> None:
        self.assertEqual(
            _javascript_assertion_count(
                "const assert = console; assert.equal(1, 1);"
            ),
            0,
        )
        self.assertEqual(
            _javascript_assertion_count(
                "import { strict as assert } from 'node:assert/strict'; "
                "assert.log(1);"
            ),
            0,
        )
        self.assertEqual(
            _javascript_assertion_count(
                "import { strict as assert } from 'node:assert/strict'; "
                "assert.equal(1, 1);"
            ),
            1,
        )

    def test_unclosed_disabled_calls_are_indexed_without_suffix_rescans(self) -> None:
        source = "test.skip(\n" * 2000

        self.assertEqual(_disabled_javascript_call_ranges(source), ())

    def test_parameterized_suite_disabled_option_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "describe.each([['old']])('group', { skip: false }, () => {\n"
                        "  test('builds', () => expect(url).toBe('old'));\n"
                        "});\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "describe.each([['new']])('group', { skip: true }, () => {\n"
                        "  test('builds', () => expect(url).toBe('new'));\n"
                        "});\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_parameterized_suite_for_disabled_option_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "describe.for([['old']])('group', { skip: false }, () => {\n"
                        "  test('builds', () => expect(url).toBe('old'));\n"
                        "});\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": (
                        "describe.for([['new']])('group', { skip: true }, () => {\n"
                        "  test('builds', () => expect(url).toBe('new'));\n"
                        "});\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_disabled_option_spread_resolution_is_linear_for_reverse_chain(self) -> None:
        source = "\n".join(
            f"const options_{index} = {{ ...options_{index + 1} }};"
            for index in range(999, -1, -1)
        )
        source += "\nconst options_1000 = { skip: true };\n"

        disabled_variables = _javascript_disabled_test_option_variables(source)

        self.assertIn("options_0", disabled_variables)
        self.assertIn("options_999", disabled_variables)

    def test_unclosed_test_calls_are_indexed_without_repeated_scans(self) -> None:
        source = "test(\n" * 2000

        argument_span_index = _javascript_call_argument_span_index(source)

        self.assertEqual(len(argument_span_index), 2000)
        self.assertTrue(all(spans is None for spans in argument_span_index.values()))
        self.assertEqual(_javascript_test_behavior_records(source.encode("utf-8")), ())

    def test_many_unclosed_option_objects_are_indexed_in_one_scan(self) -> None:
        source = "\n".join(f"const options_{index} = {{" for index in range(2000))

        self.assertEqual(_javascript_disabled_test_option_variables(source), frozenset())

    def test_nested_option_objects_do_not_rescan_containing_sources(self) -> None:
        nesting = 400
        lines = ["const options_0 = {"]
        for index in range(nesting):
            lines.extend(
                (
                    f"  get nested_{index}() {{",
                    f"    const options_{index + 1} = {{",
                )
            )
        lines.extend(("      skip: true,", "};"))
        for index in reversed(range(nesting)):
            lines.extend(
                (
                    f"    return options_{index + 1};",
                    "  },",
                    "};",
                )
            )

        disabled_variables = _javascript_disabled_test_option_variables("\n".join(lines))

        self.assertEqual(disabled_variables, {f"options_{nesting}"})

    def test_many_parameterized_calls_are_indexed_without_suffix_rescans(self) -> None:
        source = "import { expect, test } from 'vitest';\n" + "\n".join(
            "test.each([1])('case', () => expect(value).toBe(1));" for _ in range(4000)
        )

        calls = _javascript_test_call_spans(source)

        self.assertEqual(len(calls), 4000)

    def test_object_methods_are_not_counted_as_expect_matchers(self) -> None:
        import_source = "import { expect } from 'vitest'; "
        self.assertEqual(
            _javascript_assertion_count(import_source + "expect(value).toString();"),
            0,
        )
        self.assertEqual(
            _javascript_assertion_count(import_source + "expect(value).toBe(1);"),
            1,
        )
        self.assertEqual(
            _javascript_assertion_count(
                "const expect = () => ({ toBe() {} }); "
                "test('fake', () => expect(value).toBe(1));"
            ),
            0,
        )
        self.assertEqual(
            _javascript_assertion_count(
                "import { expect as check } from './fixtures'; "
                "check(value).toBe(1);"
            ),
            1,
        )
        self.assertEqual(
            _javascript_assertion_count(
                "const note = \"import { expect } from 'vitest'\"; "
                "expect(value).toBe(1);"
            ),
            0,
        )

    def test_test_callbacks_require_imported_unshadowed_runner_bindings(self) -> None:
        source = (
            "import { expect, it as caseTest } from 'vitest';\n"
            "const test = () => {};\n"
            "test('fake', () => expect(value).toBe(1));\n"
            "caseTest('real', () => expect(value).toBe(1));\n"
        )

        calls = _javascript_test_call_spans(source)

        self.assertEqual(len(calls), 1)
        self.assertEqual(
            _javascript_test_call_spans(
                "test('unbound', () => expect(value).toBe(1));"
            ),
            (),
        )

    def test_nested_test_callbacks_fail_closed_before_behavior_scan(self) -> None:
        source = (
            "test('outer', () => {\n"
            + "".join(
                "  test('inner', () => expect(value).toBe(1));\n"
                for _ in range(400)
            )
            + "});\n"
        )

        self.assertEqual(_javascript_test_behavior_records(source.encode("utf-8")), ())

    def test_callback_alias_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "const oldCallback = () => expect(page).toBeVisible();\n"
                        "test('renders', oldCallback);\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "const newCallback = () => expect(page).toBeVisible();\n"
                        "test('renders', newCallback);\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_large_test_behavior_change_fails_closed_before_sequence_matching(self) -> None:
        base_text = "\n".join(
            "test('generated', () => expect(page).toBeVisible());"
            for _ in range(MAX_TEST_BEHAVIOR_RECORDS + 1)
        )
        head_text = base_text.replace("toBeVisible()", "toHaveText('updated')", 1)

        self.assertFalse(
            _has_test_behavior_change(
                base_text.encode("utf-8"),
                head_text.encode("utf-8"),
                language="javascript",
            )
        )

    def test_reordering_unchanged_test_callbacks_does_not_satisfy_verification(self) -> None:
        base = (
            "test('first', () => expect(page).toBeVisible());\n"
            "test('second', () => expect(page).toBeHidden());\n"
        )
        head = (
            "test('second', () => expect(page).toBeHidden());\n"
            "test('first', () => expect(page).toBeVisible());\n"
        )

        self.assertFalse(
            _has_test_behavior_change(
                base.encode("utf-8"),
                head.encode("utf-8"),
                language="javascript",
            )
        )

    def test_string_literal_whitespace_is_part_of_test_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', () => expect(page).toHaveText('hello world'));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', () => expect(page).toHaveText('helloworld'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertTrue(result.test_changes)
            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)

    def test_regex_literal_whitespace_is_part_of_test_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', () => expect(page).toHaveText(/hello world/));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', () => expect(page).toHaveText(/helloworld/));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertTrue(result.test_changes)
            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)

    def test_python_comment_only_test_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    ".github/autonomous-merge/check.py": "def check():\n    return True\n",
                    ".github/autonomous-merge/test_check.py": "def test_check():\n    assert check()\n# old explanation\n",
                },
            )
            write_snapshot(
                head,
                {
                    ".github/autonomous-merge/check.py": "def check():\n    return False\n",
                    ".github/autonomous-merge/test_check.py": "def test_check():\n    assert check()\n# new explanation\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("automation", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_unexecuted_python_test_path_does_not_satisfy_automation_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".github/tools/check.py": "def check():\n    return True\n"})
            write_snapshot(
                head,
                {
                    ".github/tools/check.py": "def check():\n    return False\n",
                    ".github/tools/test_check.py": "def test_check():\n    assert check()\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("automation", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_python_skip_decorator_does_not_satisfy_verification(self) -> None:
        for decorator in (
            "@unittest.skip('not ready')",
            "@unittest.skipIf(True, 'not ready')",
            "@unittest.skipUnless(False, 'not ready')",
            "@pytest.mark.skip",
            "@pytest.mark.skipif(True)",
        ):
            with self.subTest(decorator=decorator):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(
                        base,
                        {
                            ".github/autonomous-merge/check.py": "def check():\n    return True\n",
                            ".github/autonomous-merge/test_check.py": "def test_check():\n    assert check()\n",
                        },
                    )
                    write_snapshot(
                        head,
                        {
                            ".github/autonomous-merge/check.py": "def check():\n    return False\n",
                            ".github/autonomous-merge/test_check.py": f"{decorator}\ndef test_check():\n    assert check()\n",
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertIn("automation", result.missing_test_scopes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

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

    def test_binary_visual_snapshot_satisfies_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', async () => expect(page).toHaveScreenshot('widget.png'));\n"
                    ),
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('renders', async () => expect(page).toHaveScreenshot('widget.png'));\n"
                    ),
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nnew",
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)
            self.assertEqual(result.decision, "ELIGIBLE_FOR_AUTONOMOUS_MERGE")

    def test_binary_visual_test_file_does_not_satisfy_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": b"test('renders', () => {});\xff",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": b"test('renders new', () => {});\xfe",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertEqual(
                result.verification_risk,
                POLICY.missing_test_risk + POLICY.test_removal_risk,
            )
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_comment_only_test_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": "test('renders', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": "test('renders', () => {});\n// explain the fixture\n\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_commenting_out_a_test_adds_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": "test('renders', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": "// test('renders', () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

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
            markdown = _markdown(result, POLICY, Path("base/policy.toml"))
            self.assertIn("| Verification | 0 |", markdown)
            self.assertIn(f"| Test removal | {POLICY.test_removal_risk} |", markdown)

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

    def test_pure_test_rename_across_runners_keeps_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            test_contents = "it('runs', () => {});\n"
            write_snapshot(base, {"tests/e2e/old.spec.ts": test_contents})
            write_snapshot(head, {"tests/unit/old.test.ts": test_contents})

            result = assess(base, head, POLICY)

            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)
            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")

    def test_pure_test_rename_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            test_contents = "it('runs', () => {});\n"
            write_snapshot(
                base,
                {
                    "src/sim/engine.ts": "export const value = 1;\n",
                    "tests/unit/sim/old.test.ts": test_contents,
                },
            )
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/unit/sim/new.test.ts": test_contents,
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.test_removal_risk, 0)
            self.assertIn("simulation", result.missing_test_scopes)
            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")

    def test_rename_to_non_test_path_keeps_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            test_contents = "it('runs', () => {});\n"
            write_snapshot(base, {"tests/unit/sim/guard.test.ts": test_contents})
            write_snapshot(head, {"tests/unit/sim/guard.ts": test_contents})

            result = assess(base, head, POLICY)

            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)
            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")

    def test_unclassified_src_code_has_fallback_path_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/utils/assetUrl.ts": "export const url = '/';\n"})
            write_snapshot(head, {"src/utils/assetUrl.ts": "export const url = '/app/';\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertEqual(result.path_assessments[0].risk, 10)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_src_fallback_accepts_src_test_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/utils/assetUrl.ts": "export const url = '/';\n"})
            write_snapshot(
                head,
                {
                    "src/utils/assetUrl.ts": "export const url = '/app/';\n",
                    "src/utils/publicUrl.test.ts": (
                        "import { expect, it } from 'vitest';\n"
                        "it('builds the public URL', () => expect(url).toBe('/app/'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("src-fallback", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)
            self.assertEqual(result.test_changes, True)

    def test_shared_public_url_helper_requires_visual_and_audio_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/publicUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": "it('builds the URL', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/utils/publicUrl.ts": "export const url = '/app/';\n",
                    "tests/unit/utils/publicUrl.test.ts": "it('builds the app URL', () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertIn("audio", result.missing_test_scopes)
            self.assertNotIn("src-fallback", result.missing_test_scopes)

    def test_static_asset_change_requires_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for relative_path in ("public/assets/devops-command-center.jpg", "public/favicon.svg"):
                with self.subTest(relative_path=relative_path):
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "old asset\n"})
                    write_snapshot(head, {relative_path: "new asset\n"})

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    self.assertTrue(result.code_changes)
                    self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_audio_asset_uses_audio_verification_not_visual(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "public/assets/audio/sfx-ship.wav": b"RIFFold",
                    "tests/e2e/widget.spec.ts": "test('renders', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "public/assets/audio/sfx-ship.wav": b"RIFFnew",
                    "tests/e2e/widget.spec.ts": "test('renders new', () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertIn("audio", result.missing_test_scopes)

    def test_audio_asset_with_audio_test_satisfies_audio_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "public/assets/audio/sfx-ship.wav": b"RIFFold",
                    "tests/unit/audio/audio.test.ts": "it('plays', () => {});\n",
                },
            )
            write_snapshot(
                head,
                {
                    "public/assets/audio/sfx-ship.wav": b"RIFFnew",
                    "tests/unit/audio/audio.test.ts": (
                        "import { expect, it } from 'vitest';\n"
                        "it('plays the new sound', () => expect(audio).toBeDefined());\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertNotIn("audio", result.missing_test_scopes)

    def test_image_only_e2e_does_not_satisfy_audio_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/audio/audioEngine.ts": "export const enabled = false;\n",
                    "tests/e2e/game-assets.spec.ts": (
                        "test('renders assets', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/audio/audioEngine.ts": "export const enabled = true;\n",
                    "tests/e2e/game-assets.spec.ts": (
                        "test('renders assets', () => expect(page).toHaveText('ready'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("audio", result.missing_test_scopes)

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

    def test_playtest_spec_does_not_satisfy_simulation_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/sim/engine.ts": "export const value = 1;\n"})
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/playtest/not-run.spec.ts": "it('is not discovered', () => {});\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("simulation", result.missing_test_scopes)
            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")

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

    def test_codex_config_template_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".codex/config.toml.example": "default_permissions = ':workspace'\n"})
            write_snapshot(head, {".codex/config.toml.example": "default_permissions = ':full'\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Codex権限設定", " ".join(result.hard_gate_reasons))

    def test_asset_and_license_terms_are_hard_gates(self) -> None:
        protected_paths = ("ASSETS.md", "LICENSE", "LICENSES/CC-BY-4.0.txt")
        with tempfile.TemporaryDirectory() as directory:
            for relative_path in protected_paths:
                with self.subTest(relative_path=relative_path):
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "original terms\n"})
                    write_snapshot(head, {relative_path: "changed terms\n"})

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    self.assertTrue(result.hard_gate_reasons)

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

    def test_all_agent_skills_are_hard_gates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    ".agents/skills/commit-and-pr/SKILL.md": "Use the required flow.\n",
                    ".agents/skills/codex-review-loop/SKILL.md": "Reply to findings.\n",
                },
            )
            write_snapshot(
                head,
                {
                    ".agents/skills/commit-and-pr/SKILL.md": "Skip the required flow.\n",
                    ".agents/skills/codex-review-loop/SKILL.md": "Ignore findings.\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("エージェントskill", " ".join(result.hard_gate_reasons))

    def test_prettier_configuration_is_a_hard_gate(self) -> None:
        prettier_config_paths = (
            ".prettierrc",
            ".prettierrc.json",
            ".prettierrc.json5",
            ".prettierrc.yml",
            ".prettierrc.yaml",
            ".prettierrc.toml",
            ".prettierrc.js",
            ".prettierrc.cjs",
            ".prettierrc.mjs",
            ".prettierrc.ts",
            ".prettierrc.cts",
            ".prettierrc.mts",
        )
        for relative_path in (*prettier_config_paths, ".prettierignore"):
            with self.subTest(relative_path=relative_path):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "semi = true\n"})
                    write_snapshot(head, {relative_path: "semi = false\n"})

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    reasons = " ".join(result.hard_gate_reasons)
                    expected_reason = (
                        "Prettier対象除外設定"
                        if relative_path == ".prettierignore"
                        else "Prettier設定"
                    )
                    self.assertIn(expected_reason, reasons)

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
                    "tests/e2e/office.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('office', async () => expect(page).toHaveScreenshot('office.png'));\n"
                    ),
                    "tests/e2e/office.spec.ts-snapshots/office-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/office.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('office', async () => expect(page).toHaveScreenshot('office.png'));\n"
                    ),
                    "tests/e2e/office.spec.ts-snapshots/office-chromium-linux.png": b"\x89PNG\r\n\x1a\nnew",
                },
            )

            result = assess(base, head, POLICY)

            self.assertTrue(result.code_changes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.verification_risk, 0)

    def test_unrelated_e2e_test_does_not_satisfy_pixi_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/render/boardScene.ts": "export const boardScene = 1;\n",
                    "tests/e2e/org-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('org', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/render/boardScene.ts": "export const boardScene = 2;\n",
                    "tests/e2e/org-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('org', () => expect(page).toHaveText('updated'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.missing_test_scopes, ("pixi-visual",))
            self.assertTrue(result.test_changes)

    def test_industry_dom_scene_requires_org_scale_e2e(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/render/industryBoardScene.ts": "export const scene = 1;\n",
                    "tests/e2e/org-scale.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('industry', () => expect(page.getByTestId('industry-screen')).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/render/industryBoardScene.ts": "export const scene = 2;\n",
                    "tests/e2e/org-scale.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('industry', () => expect(page.getByTestId('industry-skyline')).toBeVisible());\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("industry-visual", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)

    def test_pixi_visual_snapshot_satisfies_pixi_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "import { expect, test } from '@playwright/test';\n"
                "test('board', async () => expect(page).toHaveScreenshot('board.png'));\n"
            )
            write_snapshot(
                base,
                {
                    "src/render/boardScene.ts": "export const boardScene = 1;\n",
                    "tests/e2e/sprint-pixi-visual.spec.ts": owner,
                    "tests/e2e/sprint-pixi-visual.spec.ts-snapshots/board-chromium-linux.png": (
                        b"\x89PNG\r\n\x1a\nold"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/render/boardScene.ts": "export const boardScene = 2;\n",
                    "tests/e2e/sprint-pixi-visual.spec.ts": owner,
                    "tests/e2e/sprint-pixi-visual.spec.ts-snapshots/board-chromium-linux.png": (
                        b"\x89PNG\r\n\x1a\nnew"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("pixi-visual", result.missing_test_scopes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.verification_risk, 0)

    def test_shared_pixi_path_requires_all_screen_visual_regressions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/render/gameAssetView.ts": "export const asset = 1;\n",
                    "tests/e2e/sprint-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('sprint', () => expect(page).toBeVisible());\n"
                    ),
                    "tests/e2e/dept-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('dept', () => expect(page).toBeVisible());\n"
                    ),
                    "tests/e2e/org-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('org', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/render/gameAssetView.ts": "export const asset = 2;\n",
                    "tests/e2e/sprint-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('sprint', () => expect(page).toHaveText('updated'));\n"
                    ),
                    "tests/e2e/dept-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('dept', () => expect(page).toBeVisible());\n"
                    ),
                    "tests/e2e/org-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('org', () => expect(page).toBeVisible());\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("pixi-visual", result.missing_test_scopes)
            self.assertTrue(result.test_changes)

    def test_webgl_overlay_requires_webgl_availability_e2e(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/WebglStatusOverlay.tsx": "export const label = 'old';\n",
                    "tests/e2e/sprint-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('pixi', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/WebglStatusOverlay.tsx": "export const label = 'new';\n",
                    "tests/e2e/sprint-pixi-visual.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('pixi', () => expect(page).toHaveText('updated'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("webgl-availability", result.missing_test_scopes)
            self.assertTrue(result.test_changes)

    def test_suffixless_e2e_helper_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"tests/e2e/sessionFixture.ts": "export const seed = 1;\n"})
            write_snapshot(head, {"tests/e2e/sessionFixture.ts": "export const seed = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertTrue(
                any("共有E2E helper・fixture" in reason for reason in result.hard_gate_reasons)
            )

    def test_webgl_availability_e2e_satisfies_webgl_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/WebglStatusOverlay.tsx": "export const label = 'old';\n",
                    "tests/e2e/webgl-availability.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('shows WebGL status', () => expect(page).toBeVisible());\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/WebglStatusOverlay.tsx": "export const label = 'new';\n",
                    "tests/e2e/webgl-availability.spec.ts": (
                        "import { expect, test } from '@playwright/test';\n"
                        "test('shows WebGL status', () => expect(page).toHaveText('available'));\n"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("webgl-availability", result.missing_test_scopes)
            self.assertTrue(result.test_changes)
            self.assertEqual(result.verification_risk, 0)

    def test_arbitrary_snapshot_text_does_not_satisfy_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts-snapshots/README.md": "old notes\n",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts-snapshots/README.md": "new notes\n",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_unreferenced_playwright_snapshot_does_not_satisfy_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": "test('renders', async () => expect(page).toHaveScreenshot('widget.png'));\n",
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": "test('renders', async () => expect(page).toHaveScreenshot('widget.png'));\n",
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                    "tests/e2e/widget.spec.ts-snapshots/not-used-by-any-test-chromium-linux.png": b"\x89PNG\r\n\x1a\nnew",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.verification_risk, POLICY.missing_test_risk)

    def test_unused_playwright_screenshot_helper_does_not_satisfy_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "import { expect, test } from '@playwright/test';\n"
                "function unusedCapture(page) {\n"
                "  return expect(page).toHaveScreenshot('widget.png');\n"
                "}\n"
                "test('smoke', () => expect(page).toBeVisible());\n"
            )
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": (
                        b"\x89PNG\r\n\x1a\nold"
                    ),
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": (
                        b"\x89PNG\r\n\x1a\nnew"
                    ),
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_referenced_vitest_snapshot_satisfies_simulation_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "import { expect, it } from 'vitest';\n"
                "it('captures', () => expect({ value: 1 }).toMatchSnapshot());\n"
            )
            base_snapshot = "// Vitest Snapshot v1\n\nexports[`captures 1`] = `value: 1`;\n"
            head_snapshot = "// Vitest Snapshot v1\n\nexports[`captures 1`] = `value: 2`;\n"
            write_snapshot(
                base,
                {
                    "src/sim/engine.ts": "export const value = 1;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": base_snapshot,
                },
            )
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": head_snapshot,
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("simulation", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)

    def test_vitest_snapshot_comment_only_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = "it('captures', () => expect({ value: 1 }).toMatchSnapshot());\n"
            base_snapshot = "// Vitest Snapshot v1\n\nexports[`captures 1`] = `value: 1`;\n"
            head_snapshot = (
                "// Vitest Snapshot v1\n"
                "// regenerated without changing the captured value\n\n"
                "exports[`captures 1`] = `value: 1`;\n"
            )
            write_snapshot(
                base,
                {
                    "src/sim/engine.ts": "export const value = 1;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": base_snapshot,
                },
            )
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": head_snapshot,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("simulation", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_vitest_snapshot_export_reorder_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "import { expect, it } from 'vitest';\n"
                "it('first', () => expect({ value: 1 }).toMatchSnapshot());\n"
                "it('second', () => expect({ value: 2 }).toMatchSnapshot());\n"
            )
            base_snapshot = (
                "// Vitest Snapshot v1\n\n"
                "exports[`first 1`] = `value: 1`;\n\n"
                "exports[`second 1`] = `value: 2`;\n"
            )
            head_snapshot = (
                "// Vitest Snapshot v1\n\n"
                "exports[`second 1`] = `value: 2`;\n\n"
                "exports[`first 1`] = `value: 1`;\n"
            )
            write_snapshot(
                base,
                {
                    "src/sim/engine.ts": "export const value = 1;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": base_snapshot,
                },
            )
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": head_snapshot,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("simulation", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_vitest_snapshot_key_only_change_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base_owner = "it('captures old', () => expect({ value: 1 }).toMatchSnapshot());\n"
            head_owner = "it('captures new', () => expect({ value: 1 }).toMatchSnapshot());\n"
            base_snapshot = "// Vitest Snapshot v1\n\nexports[`captures old 1`] = `value: 1`;\n"
            head_snapshot = "// Vitest Snapshot v1\n\nexports[`captures new 1`] = `value: 1`;\n"
            write_snapshot(
                base,
                {
                    "src/sim/engine.ts": "export const value = 1;\n",
                    "tests/playtest/engine.test.ts": base_owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": base_snapshot,
                },
            )
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/playtest/engine.test.ts": head_owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": head_snapshot,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("simulation", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_vitest_snapshot_key_owned_by_skipped_test_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "const disabled = { skip: true };\n"
                "describe('suite', () => {\n"
                "  it('foo bar', disabled, () => expect({ value: 1 }).toMatchSnapshot());\n"
                "  it('foo', () => expect({ value: 1 }).toMatchSnapshot());\n"
                "});\n"
            )
            base_snapshot = (
                "// Vitest Snapshot v1\n\n"
                "exports[`suite > foo bar 1`] = `value: 1`;\n"
                "\nexports[`suite > foo 1`] = `value: 1`;\n"
            )
            head_snapshot = base_snapshot.replace("value: 1", "value: 2")
            write_snapshot(
                base,
                {
                    "src/sim/engine.ts": "export const value = 1;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": base_snapshot,
                },
            )
            write_snapshot(
                head,
                {
                    "src/sim/engine.ts": "export const value = 2;\n",
                    "tests/playtest/engine.test.ts": owner,
                    "tests/playtest/__snapshots__/engine.test.ts.snap": head_snapshot,
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("simulation", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_conditional_suite_skip_does_not_invalidate_active_visual_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "import { expect, test } from '@playwright/test';\n"
                "const pixiE2e = process.env.PIXI_E2E !== '0';\n"
                "test.skip(!pixiE2e, 'Pixi is disabled');\n"
                "test('renders', async () => "
                "expect(page).toHaveScreenshot('widget.png'));\n"
            )
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nnew",
                },
            )

            result = assess(base, head, POLICY)

            self.assertNotIn("visual", result.missing_test_scopes)
            self.assertEqual(result.verification_risk, 0)

    def test_skipped_playwright_snapshot_does_not_satisfy_visual_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = "test.skip('renders', async () => expect(page).toHaveScreenshot('widget.png'));\n"
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nnew",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_runtime_skipped_playwright_snapshot_does_not_satisfy_visual_verification(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            owner = (
                "test('renders', () => {\n"
                "  test.skip(true, 'temporarily disabled');\n"
                "  expect(page).toHaveScreenshot('widget.png');\n"
                "});\n"
            )
            write_snapshot(
                base,
                {
                    "src/ui/Widget.tsx": "export const Widget = 1;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nold",
                },
            )
            write_snapshot(
                head,
                {
                    "src/ui/Widget.tsx": "export const Widget = 2;\n",
                    "tests/e2e/widget.spec.ts": owner,
                    "tests/e2e/widget.spec.ts-snapshots/widget-chromium-linux.png": b"\x89PNG\r\n\x1a\nnew",
                },
            )

            result = assess(base, head, POLICY)

            self.assertIn("visual", result.missing_test_scopes)
            self.assertFalse(result.test_changes)

    def test_nvmrc_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".nvmrc": "24\n"})
            write_snapshot(head, {".nvmrc": "22\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Node.js実行バージョン", result.hard_gate_reasons[0])

    def test_dependabot_configuration_is_a_hard_gate(self) -> None:
        for relative_path in (".github/dependabot.yml", ".github/dependabot.yaml"):
            with self.subTest(relative_path=relative_path):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "version: 2\n"})
                    write_snapshot(
                        head,
                        {
                            relative_path: (
                                "version: 2\n"
                                "updates:\n"
                                "  - package-ecosystem: npm\n"
                            )
                        },
                    )

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    self.assertIn("Dependabot設定", " ".join(result.hard_gate_reasons))

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

    def test_shared_visual_tokens_are_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"src/render/visualTokens.ts": "export const color = 1;\n"})
            write_snapshot(head, {"src/render/visualTokens.ts": "export const color = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("DOM・Pixi共有visual token", " ".join(result.hard_gate_reasons))

    def test_policy_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".github/autonomous-merge/policy.toml": "version = 1\n"})
            write_snapshot(head, {".github/autonomous-merge/policy.toml": "version = 2\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("評価器・policyの変更", result.hard_gate_reasons[0])

    def test_local_github_action_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".github/actions/check/action.yml": "runs: {}\n"})
            write_snapshot(head, {".github/actions/check/action.yml": "runs: changed\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("local action", " ".join(result.hard_gate_reasons))

    def test_gitmodules_change_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".gitmodules": '[submodule "vendor/dep"]\n'})
            write_snapshot(head, {".gitmodules": '[submodule "vendor/new-dep"]\n'})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("Git submodule構成", " ".join(result.hard_gate_reasons))

    def test_shared_test_support_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for relative_path, reason in (
                ("tests/e2e/fixtures.ts", "共有E2E fixture"),
                ("tests/e2e/seedMeta.ts", "共有E2Eメタ状態fixture"),
                ("tests/playtest/harness.ts", "共有playtest測定基盤"),
                ("tests/playtest/globalSetup.ts", "playtest共通setup"),
                ("tests/unit/helpers/property.ts", "共有unit test基盤"),
                ("tests/unit/helpers/fastProperty.ts", "共有unit test基盤"),
            ):
                with self.subTest(relative_path=relative_path):
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "export const value = 1;\n"})
                    write_snapshot(head, {relative_path: "export const value = 2;\n"})

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    self.assertIn(reason, " ".join(result.hard_gate_reasons))

    def test_shared_test_helpers_have_dedicated_path_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for relative_path in (
                "tests/playtest/f9Representative.ts",
                "tests/fixtures/orgSceneTeams.ts",
            ):
                with self.subTest(relative_path=relative_path):
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "export const value = 1;\n"})
                    write_snapshot(head, {relative_path: "export const value = 2;\n"})

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    self.assertEqual(result.path_assessments[0].risk, 25)
                    self.assertFalse(result.hard_gate_reasons)

    def test_regular_helper_test_is_not_a_shared_unit_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"tests/unit/helpers/runFlow.test.ts": "it('runs', () => {});\n"})
            write_snapshot(head, {"tests/unit/helpers/runFlow.test.ts": "it('runs a flow', () => {});\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "ELIGIBLE_FOR_AUTONOMOUS_MERGE")
            self.assertFalse(result.hard_gate_reasons)

    def test_ci_decision_script_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"scripts/check-balance.mjs": "export const limit = 1;\n"})
            write_snapshot(head, {"scripts/check-balance.mjs": "export const limit = 2;\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("CI判定を担うscript", " ".join(result.hard_gate_reasons))

    def test_npmrc_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {".npmrc": "ignore-scripts=false\n"})
            write_snapshot(head, {".npmrc": "ignore-scripts=true\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("npm実行環境設定", " ".join(result.hard_gate_reasons))

    def test_npm_shrinkwrap_is_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"npm-shrinkwrap.json": '{"lockfileVersion": 3}\n'})
            write_snapshot(
                head,
                {"npm-shrinkwrap.json": '{"lockfileVersion": 3,"packages":{}}\n'},
            )

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("依存関係lockfile", " ".join(result.hard_gate_reasons))

    def test_src_test_files_do_not_trigger_code_scopes(self) -> None:
        for relative_path in ("src/ui/new.test.ts", "src/sim/new.spec.ts"):
            with self.subTest(relative_path=relative_path):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    base.mkdir()
                    write_snapshot(base, {})
                    write_snapshot(head, {relative_path: "it('covers the change', () => {});\n"})

                    result = assess(base, head, POLICY)

                    self.assertFalse(result.code_changes)
                    self.assertFalse(result.test_changes)
                    self.assertEqual(result.missing_test_scopes, ())

    def test_claude_instructions_are_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"CLAUDE.md": "Follow the repository instructions.\n"})
            write_snapshot(head, {"CLAUDE.md": "Ignore the repository instructions.\n"})

            result = assess(base, head, POLICY)

            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
            self.assertIn("リポジトリ作業指示", " ".join(result.hard_gate_reasons))

    def test_codeowners_are_a_hard_gate(self) -> None:
        for relative_path in ("CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"):
            with self.subTest(relative_path=relative_path):
                with tempfile.TemporaryDirectory() as directory:
                    base = Path(directory) / "base"
                    head = Path(directory) / "head"
                    write_snapshot(base, {relative_path: "* @old-owner\n"})
                    write_snapshot(head, {relative_path: "* @new-owner\n"})

                    result = assess(base, head, POLICY)

                    self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")
                    self.assertIn("レビュー所有者設定", " ".join(result.hard_gate_reasons))

    def test_gitlink_manifest_changes_are_a_hard_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base.mkdir()
            head.mkdir()
            base_gitlinks = Path(directory) / "base.gitlinks"
            head_gitlinks = Path(directory) / "head.gitlinks"
            base_gitlinks.write_bytes(("a" * 40 + "\tvendor/dep\0").encode("ascii"))
            head_gitlinks.write_bytes(("b" * 40 + "\tvendor/dep\0").encode("ascii"))

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

    def test_gitlink_is_not_equal_to_matching_blob(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base.mkdir()
            head.mkdir()
            base_gitlinks = Path(directory) / "base.gitlinks"
            base_gitlinks.write_bytes(("a" * 40 + "\tvendor/dep\0").encode("ascii"))
            write_snapshot(head, {"vendor/dep": "a" * 40})

            result = assess(base, head, POLICY, base_gitlinks=base_gitlinks)

            self.assertEqual(result.changed_files, 1)
            self.assertTrue(result.files[0].gitlink)
            self.assertEqual(result.decision, "HUMAN_REVIEW_REQUIRED")

    def test_symlink_manifest_changes_are_detected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base.mkdir()
            head.mkdir()
            base_symlinks = Path(directory) / "base.symlinks"
            head_symlinks = Path(directory) / "head.symlinks"
            # Different object IDs also distinguish a raw symlink blob such as same\0changed.
            base_symlinks.write_bytes(("a" * 40 + "\tlink\0").encode("ascii"))
            head_symlinks.write_bytes(("b" * 40 + "\tlink\0").encode("ascii"))

            result = assess(
                base,
                head,
                POLICY,
                base_symlinks=base_symlinks,
                head_symlinks=head_symlinks,
            )

            self.assertEqual(result.changed_files, 1)
            self.assertEqual(result.files[0].path, "link")
            self.assertEqual(result.files[0].status, "M")
            self.assertFalse(result.files[0].gitlink)

    def test_symlink_manifest_preserves_carriage_return_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            base.mkdir()
            head.mkdir()
            base_symlinks = Path(directory) / "base.symlinks"
            head_symlinks = Path(directory) / "head.symlinks"
            base_symlinks.write_bytes(("a" * 40 + "\tsrc/module.ts\r\0").encode("ascii"))
            head_symlinks.write_bytes(("a" * 40 + "\tsrc/module.ts\0").encode("ascii"))

            result = assess(
                base,
                head,
                POLICY,
                base_symlinks=base_symlinks,
                head_symlinks=head_symlinks,
            )

            self.assertEqual(result.changed_files, 2)
            self.assertIn("src/module.ts\r", {item.path for item in result.files})
            self.assertIn("src/module.ts", {item.path for item in result.files})

    def test_symlink_test_does_not_satisfy_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "src/utils/assetUrl.ts": "export const url = '/';\n",
                    "tests/unit/utils/publicUrl.test.ts": "it('builds the URL', () => {});\n",
                },
            )
            write_snapshot(head, {"src/utils/assetUrl.ts": "export const url = '/app/';\n"})
            head_symlinks = Path(directory) / "head.symlinks"
            head_symlinks.write_bytes(
                ("a" * 40 + "\ttests/unit/utils/publicUrl.test.ts\0").encode("ascii")
            )

            result = assess(base, head, POLICY, head_symlinks=head_symlinks)

            self.assertIn("src-fallback", result.missing_test_scopes)
            self.assertFalse(result.test_changes)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

    def test_snapshot_file_size_is_bounded_before_reading(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshot"
            root.mkdir()
            oversized = root / "oversized.bin"
            with oversized.open("wb") as file:
                file.truncate(MAX_SNAPSHOT_FILE_BYTES + 1)

            with self.assertRaises(EvaluationError):
                _read_snapshot(root)

    def test_snapshot_total_read_size_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshot"
            write_snapshot(root, {"first.txt": "123456", "second.txt": "123456"})

            with patch("evaluate.MAX_SNAPSHOT_FILE_BYTES", 8), patch(
                "evaluate.MAX_SNAPSHOT_TOTAL_BYTES", 10
            ), self.assertRaises(EvaluationError):
                _read_snapshot(root)

    def test_snapshot_file_count_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshot"
            write_snapshot(root, {"first.txt": "", "second.txt": "", "third.txt": ""})

            with patch("evaluate.MAX_SNAPSHOT_FILES", 2), self.assertRaises(EvaluationError):
                _read_snapshot(root)

    def test_executable_mode_change_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(base, {"docs/mode-sensitive.txt": "same content\n"})
            write_snapshot(head, {"docs/mode-sensitive.txt": "same content\n"})
            (head / "docs/mode-sensitive.txt").chmod(0o755)

            result = assess(base, head, POLICY)

            self.assertEqual(result.changed_files, 1)
            self.assertEqual(result.files[0].path, "docs/mode-sensitive.txt")
            self.assertEqual(result.files[0].status, "M")
            self.assertEqual(result.files[0].changed_lines, 0)

    def test_invalid_utf8_diff_is_treated_as_binary(self) -> None:
        additions, deletions, binary = _line_changes(b"\xff\n", b"\xfe\n")

        self.assertEqual(additions, 1)
        self.assertEqual(deletions, 1)
        self.assertTrue(binary)

    def test_binary_conversion_of_a_test_adds_removal_risk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            head = Path(directory) / "head"
            write_snapshot(
                base,
                {
                    "tests/unit/sim/engine.test.ts": (
                        "it('runs', () => expect(run()).toBe(true));\n"
                    ),
                },
            )
            write_snapshot(
                head,
                {"tests/unit/sim/engine.test.ts": b"\x00binary test\n"},
            )

            result = assess(base, head, POLICY)

            self.assertTrue(result.files[0].binary)
            self.assertEqual(result.test_removal_risk, POLICY.test_removal_risk)

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
