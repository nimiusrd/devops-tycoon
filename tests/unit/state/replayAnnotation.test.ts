import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import {
  normalizeReplay,
  normalizeReplayKeyframes,
  REPLAY_ANNOTATION_MAX_LENGTH,
  snapshotReplayContent,
  withReplayAnnotation,
  type ReplayBlob,
} from '../../../src/state/replay';
import { IndexedDbReplayStorage, MemoryReplayStorage } from '../../../src/state/replayPersistence';
import { parseReplayShare, serializeReplay } from '../../../src/state/replayShare';
import { TabConflictError } from '../../../src/state/tabConflict';
import { CURRENT_RUN_RULESET } from '../../../src/state/runPersistence';
import { advance } from '../helpers/runFlow';

function fixture(): ReplayBlob {
  const engine = new RunEngine({ seed: 'annotation', difficulty: 'easy' });
  engine.startRun('easy', [], 'annotation');
  const start = engine.exportReplayFrame()!;
  const keyframes: ReplayBlob['keyframes'] = [
    { phase: 'setup', frame: start },
    { phase: 'setup', frame: structuredClone(start), label: '別の編成' },
  ];
  return {
    schemaVersion: 2,
    id: 'annotation:1',
    seed: 'annotation',
    difficulty: 'easy',
    trials: [],
    finishedAt: 1,
    outcome: { status: 'lost', diagnosis: 'healthyAcceleration', score: 0 },
    keyframes,
    ruleset: CURRENT_RUN_RULESET,
    contentSnapshot: snapshotReplayContent(keyframes),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RI-301 注釈の境界', () => {
  it('未保存の実ランは再試行を案内し、別タブの競合として扱わない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'annotation-pending' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'annotation-pending');
    for (let i = 0; i < 40000 && game.getState().status === 'playing'; i++) advance(game.engine);
    expect(game.getState().status).not.toBe('playing');
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('storage unavailable'));
    game.step(0);
    await vi.waitFor(() => expect(game.listReplays()).toHaveLength(1));
    const pending = game.listReplays()[0];
    expect((await game.saveReplayAnnotation(pending, 0, '理由')).message).toContain('保存を再試行');
    expect(game.hasTabConflict()).toBe(false);
    await game.retryPersistence();
    expect((await game.saveReplayAnnotation(game.listReplays()[0], 0, '理由')).ok).toBe(true);
  });
  it('旧v1/v2の読込みはIDも注釈も作らず、初回編集だけIDを永続化する', () => {
    const replay = fixture();
    const random = vi.spyOn(crypto, 'randomUUID');
    expect(normalizeReplay(replay)).toEqual(normalizeReplay(normalizeReplay(replay)));
    const legacy = { ...replay, schemaVersion: 1, ruleset: undefined, contentSnapshot: undefined };
    for (const raw of [legacy, replay]) {
      const parsed = parseReplayShare(JSON.stringify(raw));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.replay.annotation).toBeUndefined();
        expect(parsed.replay.keyframes.every((frame) => frame.id === undefined)).toBe(true);
      }
    }
    expect(random).not.toHaveBeenCalled();
    const edited = withReplayAnnotation(replay, 1, '<img src=x onerror=alert(1)> 理由')!;
    expect(random).toHaveBeenCalledTimes(2);
    const again = withReplayAnnotation(edited, 1, '次の理由')!;
    expect(again.keyframes.map((frame) => frame.id)).toEqual(
      edited.keyframes.map((frame) => frame.id),
    );
    expect(random).toHaveBeenCalledTimes(2);
    expect(replay).toEqual(fixture());
    const parsed = parseReplayShare(serializeReplay(edited));
    expect(parsed.ok && parsed.replay.annotation).toEqual(edited.annotation);
    const removed = withReplayAnnotation(edited, 1, '   ')!;
    expect(removed.annotation).toBeUndefined();
    expect(removed.keyframes.map((frame) => frame.id)).toEqual(
      edited.keyframes.map((frame) => frame.id),
    );
  });

  it('並び変更と別場面削除で移らず、対象削除・重複ID・不整合・上限超過を拒否する', () => {
    const replay = withReplayAnnotation(fixture(), 1, '対象')!;
    const reordered = { ...replay, keyframes: [...replay.keyframes].reverse() };
    expect(parseReplayShare(serializeReplay(reordered)).ok).toBe(true);
    expect(normalizeReplay(reordered)?.keyframes[0].id).toBe(replay.annotation?.keyframeId);
    expect(normalizeReplay({ ...replay, keyframes: [replay.keyframes[1]] })?.annotation).toEqual(
      replay.annotation,
    );
    const bad = [
      { ...replay, keyframes: [replay.keyframes[0]] },
      { ...replay, keyframes: [replay.keyframes[1], replay.keyframes[1]] },
      { ...replay, annotation: { ...replay.annotation, replayId: 'another' } },
      { ...replay, annotation: { ...replay.annotation, keyframeId: 'unknown' } },
      { ...replay, annotation: { ...replay.annotation, version: 2 } },
      {
        ...replay,
        annotation: { ...replay.annotation, text: 'x'.repeat(REPLAY_ANNOTATION_MAX_LENGTH + 1) },
      },
      { ...replay, keyframes: [{ ...replay.keyframes[0], id: {} }, replay.keyframes[1]] },
    ];
    for (const value of bad) {
      expect(normalizeReplay(value)).toBeNull();
      expect(parseReplayShare(JSON.stringify(value)).ok).toBe(false);
    }
    expect(normalizeReplayKeyframes([{ ...replay.keyframes[0], id: {} }])).toEqual([]);
    expect(withReplayAnnotation(replay, -1, '理由')).toBeNull();
    expect(withReplayAnnotation(replay, 0.5, '理由')).toBeNull();
    expect(
      withReplayAnnotation(replay, 0, 'x'.repeat(REPLAY_ANNOTATION_MAX_LENGTH)),
    ).not.toBeNull();
    expect(
      withReplayAnnotation(replay, 0, 'x'.repeat(REPLAY_ANNOTATION_MAX_LENGTH + 1)),
    ).toBeNull();
    expect(withReplayAnnotation(fixture(), 0, '理由', () => 'duplicate')).toBeNull();
  });

  for (const kind of ['memory', 'indexeddb'] as const) {
    it(`${kind}: 別インスタンスの更新・削除を古い編集で上書きしない`, async () => {
      const name = `annotation-${kind}`;
      const storage =
        kind === 'memory' ? new MemoryReplayStorage() : new IndexedDbReplayStorage(name);
      const other = kind === 'memory' ? storage : new IndexedDbReplayStorage(name);
      try {
        const original = fixture();
        await storage.save(original);
        const a = withReplayAnnotation(original, 0, '先のタブ')!;
        const b = withReplayAnnotation(original, 1, '古いタブ')!;
        const results = await Promise.allSettled([
          storage.save(a, { expectedPrevious: original }),
          other.save(b, { expectedPrevious: original }),
        ]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
        expect((await storage.get(original.id))?.annotation?.text).toBe('先のタブ');
        await storage.clear();
        await expect(storage.save(b, { expectedPrevious: original })).rejects.toBeInstanceOf(
          TabConflictError,
        );
        expect(await storage.list()).toEqual([]);
      } finally {
        if (kind === 'indexeddb') await deleteDB(name);
      }
    });
  }

  it('公開APIの保存・閲覧・再編集がsim/RNGを変更せず、失敗・競合を通知する', async () => {
    const storage = new MemoryReplayStorage();
    const original = fixture();
    await storage.save(original);
    const game = createGame({ seed: 'untouched' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'untouched');
    const state = game.getState();
    const checkpoint = game.engine.exportPersistState();
    const result = await game.saveReplayAnnotation(original, 1, '作者の理由');
    expect(result.ok).toBe(true);
    expect(game.getState()).toEqual(state);
    expect(game.engine.exportPersistState()).toEqual(checkpoint);
    const saved = game.listReplays()[0];
    game.openReplay(saved.id, 1);
    expect(game.getActiveReplayInfo()?.annotationText).toBe('作者の理由');
    game.openReplay(saved.id, 0);
    expect(game.getActiveReplayInfo()?.annotationText).toBeUndefined();
    game.exitReplay();
    const failed = vi
      .spyOn(storage, 'save')
      .mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect((await game.saveReplayAnnotation(saved, 1, '失敗する')).ok).toBe(false);
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.listReplays()[0].annotation?.text).toBe('作者の理由');
    failed.mockRestore();
    const unreadable = vi.spyOn(storage, 'list').mockRejectedValueOnce(new Error('read failed'));
    expect((await game.saveReplayAnnotation(saved, 1, '読込み失敗')).ok).toBe(false);
    unreadable.mockRestore();
    expect((await storage.get(saved.id))?.annotation?.text).toBe('作者の理由');
    await storage.save(withReplayAnnotation(saved, 1, '別タブの理由')!);
    expect((await game.saveReplayAnnotation(saved, 1, '古い編集')).ok).toBe(false);
    expect(game.hasTabConflict()).toBe(true);
    expect((await storage.get(saved.id))?.annotation?.text).toBe('別タブの理由');
  });

  it('ファイル取込みも別タブの注釈を上書きせず、セッション保存は端末成功を装わない', async () => {
    const storage = new MemoryReplayStorage();
    const original = fixture();
    await storage.save(original);
    const game = createGame();
    await game.attachReplay(storage);
    const remote = withReplayAnnotation(original, 1, '別タブの注釈')!;
    await storage.save(remote);
    expect((await game.importReplayText(serializeReplay(original))).ok).toBe(false);
    expect(await storage.get(original.id)).toEqual(remote);
    expect(game.hasTabConflict()).toBe(true);
    const session = createGame();
    await session.attachReplay(storage, { sessionOnly: true });
    const saved = await session.saveReplayAnnotation(remote, 0, 'セッション内');
    expect(saved.ok).toBe(true);
    expect(saved.message).toContain('端末への保存はできていません');
    expect(session.getPersistenceStatus().state).toBe('session');
  });
});
