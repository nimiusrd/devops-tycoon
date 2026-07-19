import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../src/game';
import { defaultMeta } from '../../src/state/meta';
import { IndexedDbRunSaveStorage } from '../../src/state/runSavePersistence';

const databases: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

describe('GameHandle ランセーブ（RI-58）', () => {
  it('setup セーブを continueRun で復帰できる', async () => {
    const name = `devops-tycoon-game-save-${databases.length}`;
    databases.push(name);
    const storage = new IndexedDbRunSaveStorage(name);
    const game = createGame({ seed: 'game-save', initialMeta: defaultMeta() });
    await game.attachRunSave(storage);

    game.startRun('easy', [], 'game-save');
    expect(game.phase()).toBe('setup');
    expect(game.hasRunSave()).toBe(true);
    // persist は非同期のため、IDB 反映を待ってから別ハンドルで読む。
    for (let i = 0; i < 30 && !(await storage.load()); i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await storage.load()).not.toBeNull();

    // 別ハンドルで同じ storage から続きへ。
    const game2 = createGame({ seed: 'other', initialMeta: defaultMeta() });
    await game2.attachRunSave(storage);
    expect(game2.hasRunSave()).toBe(true);
    const restored = game2.continueRun();
    expect(restored?.phase).toBe('setup');
    expect(restored?.seed).toBe('game-save');
  });

  it('newRun でセーブが消える', async () => {
    const name = `devops-tycoon-game-clear-${databases.length}`;
    databases.push(name);
    const storage = new IndexedDbRunSaveStorage(name);
    const game = createGame({ seed: 'game-clear', initialMeta: defaultMeta() });
    await game.attachRunSave(storage);
    game.startRun('easy', [], 'game-clear');
    expect(game.hasRunSave()).toBe(true);
    game.newRun();
    expect(game.phase()).toBe('title');
    expect(game.hasRunSave()).toBe(false);
  });
});
