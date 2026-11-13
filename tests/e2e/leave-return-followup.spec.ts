import { expect, test } from './fixtures';
import type { RunSave } from '../../src/state/runPersistence';

type GameWindow = Window & {
  game?: {
    pause(): void;
    exportRunSaveText(): string | null;
    importRunSaveText(raw: string): Promise<{ ok: boolean }>;
    resumeRun(): { phase: string } | null;
    getState(): { activeTeamId: string; orgScale?: { departments: { teams: { id: string }[] }[] } };
    enterTeam(id: string): void;
    focusTeam(id: string): void;
    zoomTo(level: string): void;
  };
};

function withLeaveReturns(saved: string, returns: boolean, kind: 'boss' | 'elite' = 'boss') {
  const save = JSON.parse(saved) as RunSave;
  save.state.pendingSprintKind = kind;
  const teamId = save.state.extras.activeTeamId;
  if (!teamId) throw new Error('選択中チームがない');
  if (returns) {
    save.state.extras.pendingLeaveReturns = {
      [teamId]: save.state.roster.members.slice(0, 2).map((member) => ({
        id: member.id,
        name: member.name,
      })),
    };
  } else {
    delete save.state.extras.pendingLeaveReturns;
  }
  return JSON.stringify(save);
}

async function openBossSetup(
  page: import('@playwright/test').Page,
  saved: string,
  boot: string,
  watchSpeech = false,
) {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?renderer=pixi&tutorial=off&seed=leave-return-notice&boot=${boot}`);
  await page.getByTestId('difficulty-easy').waitFor();
  if (watchSpeech) {
    await page.evaluate(() => {
      const log: string[] = [];
      const mark = () => {
        const status = document.querySelector('[data-testid="leave-return-status"]');
        if (!status) return;
        const text = status.textContent ?? '';
        if (log.length === 0 || log[log.length - 1] !== text) log.push(text);
      };
      new MutationObserver(mark).observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      (window as unknown as { __leaveReturnLiveLog: string[] }).__leaveReturnLiveLog = log;
    });
  }
  await page.evaluate(async (text) => {
    const game = (window as GameWindow).game!;
    const result = await game.importRunSaveText(text);
    if (!result.ok || game.resumeRun()?.phase !== 'setup') {
      throw new Error('準備画面を開けない');
    }
    game.pause();
  }, saved);
  const setup = page.getByTestId('setup');
  await expect(setup).toBeVisible();
  await expect(setup.getByTestId('formation-forecast')).toHaveAttribute(
    'data-what-if-status',
    'ready',
    {
      timeout: 15_000,
    },
  );
  await page.evaluate(() => document.fonts.ready);
  return setup;
}

test('320×568 で警告と復帰があるとき開始ボタンが画面内に収まる（#1031）', async ({ page }) => {
  await page.goto('/?renderer=pixi&tutorial=off&seed=leave-return-notice');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const raw = await page.evaluate(() => {
    const text = (window as GameWindow).game!.exportRunSaveText();
    if (!text) throw new Error('セーブを取得できない');
    return text;
  });
  const setup = await openBossSetup(page, withLeaveReturns(raw, true), '1031-boss-return');
  const begin = setup.getByTestId('begin-sprint');
  const box = await begin.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
});

test('復帰が無いとき開始ボタンは復帰余白導入前と 0.5px 以内で一致する（#1031）', async ({
  page,
}) => {
  await page.goto('/?renderer=pixi&tutorial=off&seed=leave-return-notice');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const raw = await page.evaluate(() => {
    const text = (window as GameWindow).game!.exportRunSaveText();
    if (!text) throw new Error('セーブを取得できない');
    return text;
  });
  const plain = await openBossSetup(page, withLeaveReturns(raw, false), '1031-plain-a');
  await expect(plain.locator('.formation-setup-copy')).not.toHaveAttribute('data-reserve', 'true');
  const before = await plain.getByTestId('begin-sprint').boundingBox();
  const again = await openBossSetup(page, withLeaveReturns(raw, false), '1031-plain-b');
  const after = await again.getByTestId('begin-sprint').boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(before!.height - after!.height)).toBeLessThanOrEqual(0.5);
});

async function otherTeamId(page: import('@playwright/test').Page, home: string) {
  return page.evaluate((homeId) => {
    const game = (window as GameWindow).game!;
    game.zoomTo('company');
    const state = game.getState();
    const id = state.orgScale?.departments
      .flatMap((dept) => dept.teams)
      .find((team) => team.id !== homeId)?.id;
    if (!id) throw new Error('別チームが無い');
    return id;
  }, home);
}

test('チーム A→B→A で同じ復帰通知の読み上げは1回だけ（#1031）', async ({ page }) => {
  await page.goto('/?renderer=pixi&tutorial=off&seed=company-guidance-teams');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const raw = await page.evaluate(() => {
    const text = (window as GameWindow).game!.exportRunSaveText();
    if (!text) throw new Error('セーブを取得できない');
    return text;
  });
  const save = JSON.parse(withLeaveReturns(raw, true)) as RunSave;
  const homeId = save.state.extras.activeTeamId!;
  const setup = await openBossSetup(page, JSON.stringify(save), '1031-ab-a', true);
  const names = save.state.extras.pendingLeaveReturns![homeId]!.map((p) => p.name);
  const speech = names.map((name) => `${name}が復帰しました（ベンチ）`).join('');
  await expect(setup.getByTestId('leave-return-status')).toHaveText(speech);
  const home = save.state.extras.activeTeamId!;
  const other = await otherTeamId(page, home);
  await page.evaluate((id) => (window as GameWindow).game!.enterTeam(id), other);
  await page.evaluate((id) => (window as GameWindow).game!.focusTeam(id), other);
  await page.evaluate((id) => (window as GameWindow).game!.enterTeam(id), home);
  await page.evaluate((id) => (window as GameWindow).game!.focusTeam(id), home);
  const liveLog = await page.evaluate(
    () => (window as unknown as { __leaveReturnLiveLog?: string[] }).__leaveReturnLiveLog ?? [],
  );
  expect(liveLog.filter((entry) => entry.length > 0)).toEqual([speech]);
});

test('320 でチーム切替後も開始ボタンが見える（#1031）', async ({ page }) => {
  await page.goto('/?renderer=pixi&tutorial=off&seed=company-guidance-teams');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const raw = await page.evaluate(() => {
    const text = (window as GameWindow).game!.exportRunSaveText();
    if (!text) throw new Error('セーブを取得できない');
    return text;
  });
  const save = JSON.parse(withLeaveReturns(raw, true)) as RunSave;
  const homeId = save.state.extras.activeTeamId!;
  const other = await otherTeamId(page, homeId);
  save.state.extras.pendingLeaveReturns = {
    ...(save.state.extras.pendingLeaveReturns ?? {}),
    [other]: save.state.roster.members.slice(0, 2).map((member) => ({
      id: member.id,
      name: member.name,
    })),
  };
  const setup = await openBossSetup(page, JSON.stringify(save), '1031-switch');
  await page.evaluate((id) => {
    const game = (window as GameWindow).game!;
    game.enterTeam(id);
    game.focusTeam(id);
  }, other);
  await expect(setup).toBeVisible();
  const begin = setup.getByTestId('begin-sprint');
  const box = await begin.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
});
