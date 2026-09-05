import { expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';
import type { RunDiagnosticInfo } from '../../src/state/diagnosticInfo';
import type { ReplayBlob } from '../../src/state/replay';
import { REPLAY_SHARE_REASON_MESSAGE } from '../../src/state/replayShare';
import type { RunSaveSummary } from '../../src/state/runPersistence';
import { RUN_SAVE_SHARE_REASON_MESSAGE } from '../../src/state/runSaveShare';

type ShareGameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    phase(): string;
    resumeRun(): RunState | null;
    getRunSaveSummary(): RunSaveSummary | null;
    getDiagnosticInfo(): RunDiagnosticInfo;
    getMeta(): { points: number };
    listReplays(): ReplayBlob[];
    importReplay(blob: ReplayBlob): Promise<boolean>;
    engine: {
      exportReplayFrame(): ReplayBlob['keyframes'][number]['frame'] | null;
    };
  };
};

async function storedRunSeed(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![...db.objectStoreNames].includes('runSave')) {
      db.close();
      return null;
    }
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('runSave', 'readonly').objectStore('runSave').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!value || typeof value !== 'object') return null;
    const summary = (value as { summary?: { seed?: string } }).summary;
    return summary?.seed ?? null;
  });
}

async function persistSetupSave(
  page: import('@playwright/test').Page,
  seed: string,
): Promise<void> {
  await page.evaluate((nextSeed) => {
    const game = (window as ShareGameWindow).game;
    if (!game) throw new Error('game missing');
    game.startRun('easy', [], nextSeed);
  }, seed);
  await expect
    .poll(async () => page.evaluate(() => (window as ShareGameWindow).game?.phase()))
    .toBe('setup');
  await expect.poll(() => storedRunSeed(page)).toBe(seed);
}

test.describe('run / replay file share (RI-133)', () => {
  test('途中セーブをファイルで往復し、拒否時は既存セーブを残す', async ({ page }) => {
    await page.goto('/?seed=ri133-save');
    await expect(page.getByTestId('title')).toBeVisible();
    const pointsBefore = await page.evaluate(
      () => (window as ShareGameWindow).game?.getMeta().points ?? -1,
    );

    await persistSetupSave(page, 'ri133-save');
    await page.reload();
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('resume-run')).toBeVisible();
    await expect(page.getByTestId('run-save-download')).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('run-save-download').click(),
    ]);
    const savePath = await download.path();
    expect(savePath).toBeTruthy();
    await expect(page.getByTestId('run-save-share-status')).toHaveText(
      '途中セーブをファイルに保存しました。',
    );

    await page.getByTestId('run-save-file').setInputFiles({
      name: 'bad-run-save.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{', 'utf8'),
    });
    await expect(page.getByTestId('run-save-share-status')).toHaveText(
      RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    );
    await expect(page.getByTestId('resume-run')).toBeVisible();

    await page.getByTestId('run-save-file').setInputFiles(savePath!);
    await expect(page.getByTestId('run-save-share-status')).toHaveText(
      '途中セーブを読み込みました。再開できます。',
    );
    await expect(page.getByTestId('resume-run')).toBeVisible();
    await page.getByTestId('resume-run').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    expect(
      await page.evaluate(() => (window as ShareGameWindow).game?.getMeta().points ?? -1),
    ).toBe(pointsBefore);
  });

  test('未対応スキーマの途中セーブは理由付きで拒否する', async ({ page }) => {
    await page.goto('/?seed=ri133-unsupported');
    await expect(page.getByTestId('title')).toBeVisible();
    await persistSetupSave(page, 'ri133-unsupported');
    await page.reload();
    await expect(page.getByTestId('resume-run')).toBeVisible();

    await page.getByTestId('run-save-file').setInputFiles({
      name: 'unsupported-run-save.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 99, summary: {}, state: {} }), 'utf8'),
    });
    await expect(page.getByTestId('run-save-share-status')).toHaveText(
      RUN_SAVE_SHARE_REASON_MESSAGE.unsupported_version,
    );
    await expect(page.getByTestId('resume-run')).toBeVisible();
  });

  test('リプレイをファイルで往復し、拒否時は既存リプレイを残す', async ({ page }) => {
    await page.goto('/?seed=ri133-replay');
    await expect(page.getByTestId('title')).toBeVisible();

    const imported = await page.evaluate(async () => {
      const game = (window as ShareGameWindow).game;
      if (!game) throw new Error('game missing');
      game.startRun('easy', [], 'ri133-replay-frame');
      const frame = game.engine.exportReplayFrame();
      const ruleset = game.getDiagnosticInfo().ruleset;
      if (!frame || !ruleset) throw new Error('replay fixture missing');
      return game.importReplay({
        schemaVersion: 2,
        id: 'ri133-replay-export',
        seed: 'ri133-replay-frame',
        difficulty: 'easy',
        trials: [],
        finishedAt: 2000,
        outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 8 },
        keyframes: [{ phase: 'setup', frame }],
        ruleset,
        contentSnapshot: { cards: [], relics: [] },
      });
    });
    expect(imported).toBe(true);

    await page.goto('/?seed=ri133-replay');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as ShareGameWindow).game?.listReplays().length ?? 0))
      .toBeGreaterThan(0);

    await page.getByTestId('open-replays').click();
    await expect(page.getByTestId('replay-list')).toBeVisible();
    await expect(page.getByTestId('replay-download')).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('replay-download').click(),
    ]);
    const replayPath = await download.path();
    expect(replayPath).toBeTruthy();
    await expect(page.getByTestId('replay-share-status')).toHaveText(
      'リプレイをファイルに保存しました。',
    );

    await page.getByTestId('replay-file').setInputFiles({
      name: 'bad-replay.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{', 'utf8'),
    });
    await expect(page.getByTestId('replay-share-status')).toHaveText(
      REPLAY_SHARE_REASON_MESSAGE.corrupt,
    );
    await expect
      .poll(() => page.evaluate(() => (window as ShareGameWindow).game?.listReplays().length ?? 0))
      .toBeGreaterThan(0);

    await page.getByTestId('replay-file').setInputFiles(replayPath!);
    await expect(page.getByTestId('replay-share-status')).toHaveText('リプレイを読み込みました。');
    await expect(page.getByTestId('replay-item-ri133-replay-export')).toBeVisible();
  });
});
