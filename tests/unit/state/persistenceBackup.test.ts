import { describe, expect, it } from 'vitest';
import {
  readPersistenceBackup,
  serializePersistenceBackup,
} from '../../../src/state/persistenceBackup';
import { parseRunSaveShare, serializeRunSave } from '../../../src/state/runSaveShare';
import { toRunSave } from '../../../src/state/runPersistence';
import { createRunEngine } from '../../../src/sim/run/engine';

function makeSave() {
  const engine = createRunEngine({ seed: 'backup-save' });
  engine.startRun('easy', [], 'backup-save');
  const state = engine.exportPersistState();
  const frame = engine.exportReplayFrame();
  if (!state || !frame) throw new Error('backup fixture export failed');
  return toRunSave(state, 1000, [{ phase: 'setup', frame }]);
}

describe('persistenceBackup', () => {
  it('途中セーブとリプレイを一つの JSON にまとめ、単体ファイルとは区別する', () => {
    const text = serializePersistenceBackup({
      runSave: '{"schemaVersion":1}\n',
      replays: ['{"id":"a"}\n', '{"id":"b"}\n'],
    });
    const backup = readPersistenceBackup(text);
    expect(backup?.runSave).toContain('schemaVersion');
    expect(backup?.replays).toEqual(['{"id":"a"}\n', '{"id":"b"}\n']);
    expect(readPersistenceBackup('{"schemaVersion":8}\n')).toBeNull();
    expect(readPersistenceBackup('not-json')).toBeNull();
  });

  it('まとめファイルの途中セーブを既存の読み込みで戻す', () => {
    const save = makeSave();
    const raw = serializePersistenceBackup({
      runSave: serializeRunSave(save),
      replays: [],
    });
    expect(parseRunSaveShare(raw)).toMatchObject({
      ok: true,
      save: { summary: { seed: 'backup-save' } },
    });
    expect(
      parseRunSaveShare(serializePersistenceBackup({ runSave: null, replays: [] })),
    ).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
  });
});
