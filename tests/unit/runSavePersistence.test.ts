import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { IndexedDbRunSaveStorage } from '../../src/state/runSavePersistence';

const databases: string[] = [];

function storage(): IndexedDbRunSaveStorage {
  const name = `devops-tycoon-runsave-${databases.length}`;
  databases.push(name);
  return new IndexedDbRunSaveStorage(name);
}

function blobFrom(engine: RunEngine) {
  const partial = engine.exportHydrateState();
  if (!partial) throw new Error('no export');
  return {
    ...partial,
    savedAt: Date.now(),
    game: { activeDailyDate: null as string | null, recorded: false },
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

describe('IndexedDB ランセーブ永続化（RI-58）', () => {
  it('保存を直列化し、最後の状態を往復できる', async () => {
    const store = storage();
    const engine = new RunEngine({ seed: 'idb-save', difficulty: 'easy' });
    engine.startRun('easy', [], 'idb-save');
    const first = blobFrom(engine);
    engine.applyOrgLever('standardize');
    const latest = blobFrom(engine);

    await Promise.all([store.save(first), store.save(latest)]);
    expect(await store.load()).toEqual(latest);
  });

  it('clear 後は null', async () => {
    const store = storage();
    const engine = new RunEngine({ seed: 'idb-clear', difficulty: 'easy' });
    engine.startRun('easy', [], 'idb-clear');
    await store.save(blobFrom(engine));
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('壊れたレコードは load で null', async () => {
    const store = storage();
    const engine = new RunEngine({ seed: 'idb-bad', difficulty: 'easy' });
    engine.startRun('easy', [], 'idb-bad');
    const blob = blobFrom(engine);
    await store.save({ ...blob, schemaVersion: 999 } as typeof blob);
    expect(await store.load()).toBeNull();
  });
});
