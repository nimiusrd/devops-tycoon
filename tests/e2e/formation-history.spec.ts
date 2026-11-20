import type { Page } from '@playwright/test';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../../src/state/replay';
import type { RunSave } from '../../src/state/runPersistence';
import { expect, test } from './fixtures';

test.use({ hasTouch: true });

const SEED = 'ri213-formation-history';
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

async function resumeFixture(page: Page, legacy = false) {
  await page.goto(`/?renderer=pixi&seed=${SEED}`);
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();

  const imported = await page.evaluate(async (legacySave) => {
    const game = window.game!;
    const raw = game.exportRunSaveText();
    if (!raw) throw new Error('編成セーブがありません');
    const save: RunSave = JSON.parse(raw);
    const [first, second] = save.state.roster.members;
    first.name = second.name = '現在の同じ名前';
    first.rank = 'senior';
    save.state.sprintsPlayed = save.summary.sprintsPlayed = 7;
    if (legacySave) {
      delete save.state.memberHistory;
    } else {
      const teamId = game.getState().activeTeamId;
      const otherTeamId = game.getState().teams.find((team) => team.id !== teamId)?.id;
      if (!otherTeamId) throw new Error('比較用の別チームがありません');
      save.state.memberHistory = {
        startedAfterSprint: 4,
        events: [
          {
            id: first.id,
            name: '記録当時の長い名前'.repeat(4),
            teamId,
            sprintNumber: 5,
            kind: 'promotion',
            to: 'middle',
          },
          {
            id: first.id,
            name: '別チームの同じID',
            teamId: otherTeamId,
            sprintNumber: 6,
            kind: 'promotion',
            to: 'senior',
          },
          { id: first.id, name: '復帰時の名前', teamId, sprintNumber: 7, kind: 'return' },
          {
            id: first.id,
            name: '休職時の名前',
            teamId,
            sprintNumber: 7,
            kind: 'leave',
            reason: 'reorganization',
          },
        ],
      };
    }
    return (await game.importRunSaveText(JSON.stringify(save))).ok;
  }, legacy);
  expect(imported).toBe(true);
  await page.reload();
  await page.getByTestId('resume-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();
}

async function viewState(page: Page) {
  return page.evaluate(() => {
    const { budget, roster, phase, sprintsPlayed, memberHistory } = window.game!.getState();
    return { budget, roster, phase, sprintsPlayed, memberHistory };
  });
}

test('編成で経歴を発生順に開き、5画面幅で配置や継続ボタンを操作できる', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await resumeFixture(page);
  const setup = page.getByTestId('setup');
  const first = setup.getByTestId('formation-member-m0');
  const second = setup.getByTestId('formation-member-m1');
  const history = first.getByTestId('formation-history-m0');
  const summary = history.locator('summary');
  const events = history.locator('li');
  const original = await viewState(page);
  await expect(first.locator('.fm-name')).toHaveText('現在の同じ名前');
  await expect(second.locator('.fm-name')).toHaveText('現在の同じ名前');
  await expect(second.locator('details')).toHaveCount(0);
  await expect(setup.getByTestId('formation-history-start')).toContainText('スプリント4の完了時点');
  await expect(history).not.toHaveAttribute('open', '');

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      await summary.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(summary).toBeFocused();
      await expect(summary).toHaveCSS('outline-style', 'solid');
      expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      if (reducedMotion === 'no-preference') {
        await testInfo.attach(`history-${viewport.width}-closed`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
      await page.keyboard.press('Enter');
      await expect(history).toHaveAttribute('open', '');
      await expect(events).toHaveText([
        /通算スプリント5 · 記録当時の長い名前.+ · 初昇格（ミドル）/,
        '通算スプリント7 · 復帰時の名前 · 復帰',
        '通算スプリント7 · 休職時の名前 · 休職（組織再編）',
      ]);
      expect(
        await setup
          .locator('.formation-panel')
          .evaluate((panel) => panel.scrollWidth - panel.clientWidth),
      ).toBeLessThanOrEqual(1);
      await events.last().scrollIntoViewIfNeeded();
      await expect(events.last()).toBeInViewport();
      await testInfo.attach(`history-${viewport.width}-${reducedMotion}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await page.keyboard.press('Space');
      await expect(history).not.toHaveAttribute('open', '');
    }
    if (viewport.width === 320) {
      await summary.tap();
      await expect(history).toHaveAttribute('open', '');
      await summary.tap();
      await expect(history).not.toHaveAttribute('open', '');
    }
  }
  expect(await viewState(page)).toEqual(original);
  const bench = first.getByTestId('assign-m0-bench');
  await bench.click();
  await expect(bench).toHaveAttribute('aria-pressed', 'true');
  await setup.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
    timeout: 30_000,
  });
  await page.evaluate(() => window.game!.pause());
  const opener = page.getByTestId('open-formation');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('formation');
  const dialogSummary = dialog.getByTestId('formation-history-m0').locator('summary');
  await expect(dialog).toBeFocused();
  await dialogSummary.focus();
  await page.keyboard.press('Tab');
  await expect(dialogSummary).not.toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialogSummary).toBeFocused();
  await page.keyboard.press('Space');
  await expect(
    dialog.getByText('通算スプリント7 · 復帰時の名前 · 復帰', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByTestId('assign-m0-bench')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('旧セーブは再開時の記録開始を示し、現在の階級から経歴を補わない', async ({ page }) => {
  await resumeFixture(page, true);
  const setup = page.getByTestId('setup');
  await expect(setup.getByTestId('formation-member-m0').locator('.fm-rank')).toContainText(
    'シニア',
  );
  await expect(setup.getByTestId('formation-history-start')).toContainText('スプリント7の完了時点');
  await expect(setup.locator('.fm-history')).toHaveCount(0);
});

test('リプレイでは選択中のフレームの経歴だけを読み取れる', async ({ page }) => {
  await page.goto(`/?renderer=pixi&seed=${SEED}-replay`);
  await expect(page.getByTestId('title')).toBeVisible();
  const imported = await page.evaluate(async (schemaVersion) => {
    const game = window.game!;
    const seed = 'ri213-formation-history-replay';
    game.startRun('easy', [], seed);
    const frame = game.engine.exportReplayFrame();
    if (!frame) throw new Error('編成フレームがありません');
    const legacy = structuredClone(frame);
    delete legacy.memberHistory;
    frame.sprintsPlayed = 2;
    frame.memberHistory = {
      startedAfterSprint: 0,
      events: [
        {
          id: frame.roster.members[0].id,
          name: 'リプレイ記録時の名前',
          teamId: game.getState().activeTeamId,
          sprintNumber: 2,
          kind: 'promotion',
          to: 'middle',
        },
      ],
    };
    const replay: ReplayBlob = {
      schemaVersion,
      id: `${seed}:1`,
      seed,
      difficulty: 'easy',
      trials: [],
      finishedAt: 3_000_001,
      outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 20 },
      ruleset: game.getDiagnosticInfo().ruleset,
      contentSnapshot: { cards: [], relics: [] },
      keyframes: [
        { phase: 'setup', frame, label: '経歴のある編成' },
        { phase: 'setup', frame: legacy, label: '経歴のない編成' },
      ],
    };
    return game.importReplay(replay);
  }, REPLAY_SCHEMA_VERSION);
  expect(imported).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.game?.listReplays().length)).toBe(1);
  await page.getByTestId('open-replays').click();
  await page.getByTestId('replay-keyframe-0').click();
  const setup = page.getByTestId('setup');
  const history = setup.getByTestId('formation-history-m0');
  await history.locator('summary').click();
  await expect(history.locator('li')).toHaveText(
    '通算スプリント2 · リプレイ記録時の名前 · 初昇格（ミドル）',
  );
  await expect(setup.getByTestId('assign-m0-bench')).toBeDisabled();
  await expect(setup.getByTestId('begin-sprint')).toBeDisabled();
  // 別フレームを開いても現行ランや以前の閲覧フレームから記録を補わない。
  await page.getByTestId('exit-replay').click();
  await page.getByTestId('open-replays').click();
  await page.getByTestId('replay-keyframe-1').click();
  await expect(setup).toBeVisible();
  await expect(setup.locator('.fm-history')).toHaveCount(0);
  await expect(setup.getByTestId('formation-history-start')).toHaveCount(0);
});
