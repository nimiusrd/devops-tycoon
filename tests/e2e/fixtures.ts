/**
 * E2E 共通 fixture（RI-60）。
 *
 * 初回ガイドがアクションバー操作を遮らないよう、明示の `?tutorial=` が無い
 * goto には `tutorial=off` を付与する。チュートリアル専用テストは `1` / `force` /
 * `help` を明示する。
 */
import { test as base, expect } from '@playwright/test';
import { ensureTutorialQuery } from '../../src/ui/tutorial';

export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);
    page.goto = ((url, options) =>
      originalGoto(ensureTutorialQuery(String(url ?? ''), 'off'), options)) as typeof page.goto;
    await use(page);
  },
});

export { expect };
