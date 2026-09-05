import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import { IndexedDbMetaStorage } from '../../../src/state/metaPersistence';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../../../src/state/replay';
import { IndexedDbReplayStorage } from '../../../src/state/replayPersistence';

import 'fake-indexeddb/auto';

const databases: string[] = [];

function nextDatabaseName(label: string): string {
  const name = `devops-tycoon-persistence-recovery-${label}-${databases.length}`;
  databases.push(name);
  return name;
}

function makeReplay(id: string, finishedAt: number): ReplayBlob {
  const engine = new RunEngine({ seed: id, difficulty: 'easy' });
  engine.startRun('easy', [], id);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('export failed');
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id,
    seed: id,
    difficulty: 'easy',
    trials: [],
    finishedAt,
    outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 10 },
    keyframes: [{ phase: 'setup', frame }],
    ruleset: { version: 1, fingerprint: 'persistence-recovery' },
    contentSnapshot: { cards: [], relics: [] },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

describe('IndexedDB の一過性エラーからの復旧', () => {
  it('メタ保存失敗は呼び出し元へ伝わり、保存済み進行と後続の保存・読み取りを維持する', async () => {
    const storage = new IndexedDbMetaStorage(nextDatabaseName('meta'));
    const persisted = { ...defaultMeta(), points: 25 };
    await storage.save(persisted);

    const failure = new DOMException('メタ保存容量不足', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw failure;
    });

    await expect(storage.save({ ...defaultMeta(), points: 50 })).rejects.toBe(failure);
    await expect(storage.load()).resolves.toEqual(persisted);

    const latest = { ...defaultMeta(), points: 100, achievements: ['first-clear'] };
    const nextSave = storage.save({ ...defaultMeta(), points: 75 });
    const latestSave = storage.save(latest);
    // load は呼び出し時点でキューにある保存が完了した状態を返す。
    await expect(storage.load()).resolves.toEqual(latest);
    await expect(nextSave).resolves.toBeUndefined();
    await expect(latestSave).resolves.toBeUndefined();
  });

  it('リプレイ全削除失敗は呼び出し元へ伝わり、既存レコードを残して保存・再削除を続行できる', async () => {
    const storage = new IndexedDbReplayStorage(nextDatabaseName('replay'));
    const persisted = makeReplay('before-clear-failure', 1000);
    await storage.save(persisted);

    const failure = new DOMException('リプレイ全削除失敗', 'InvalidStateError');
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementationOnce(() => {
      throw failure;
    });

    await expect(storage.clear()).rejects.toBe(failure);
    await expect(storage.list()).resolves.toEqual([persisted]);
    await expect(storage.get(persisted.id)).resolves.toEqual(persisted);

    const recovered = makeReplay('after-clear-failure', 2000);
    await expect(storage.save(recovered)).resolves.toBeUndefined();
    await expect(storage.list()).resolves.toEqual([recovered, persisted]);

    const cleared = storage.clear();
    await expect(storage.list()).resolves.toEqual([]);
    await expect(cleared).resolves.toBeUndefined();
    await expect(storage.get(persisted.id)).resolves.toBeNull();
    await expect(storage.get(recovered.id)).resolves.toBeNull();
  });
});
