import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RunEngine } from '../sim/run/engine';
import type { ReplayBlob } from '../state/replay';
import { parseReplayShare, serializeReplay } from '../state/replayShare';
import { recordTournamentReplay } from '../../tests/unit/helpers/localTournamentFixture';
import {
  compareLocalTournament,
  LOCAL_TOURNAMENT_LIMITS,
  type TournamentInput,
} from './localTournament';

let replays: ReplayBlob[];
const input = (replay: ReplayBlob, participantNote?: string): TournamentInput => ({
  json: serializeReplay(replay),
  participantNote,
});
const compare = (...records: ReplayBlob[]) => {
  const result = compareLocalTournament(records.map((record) => input(record)));
  if (!result.ok) throw new Error(result.reason);
  return result;
};

beforeAll(() => {
  replays = ['g1', 'g2'].flatMap((seed) =>
    [false, true].map((skilled) => recordTournamentReplay(seed, skilled)),
  );
});

describe('RI-299 ローカル大会の読み取り専用比較', () => {
  it('2〜4件の実エンジン終端を実parser経由で比較し、seedごとに分ける', () => {
    for (const replay of replays) expect(parseReplayShare(serializeReplay(replay)).ok).toBe(true);
    for (const count of [2, 3, 4]) {
      const result = compare(...replays.slice(0, count));
      expect(result.entries).toHaveLength(count);
      expect(result.groups).toEqual(
        count === 2
          ? [[0, 1]]
          : count === 3
            ? [[0, 1], [2]]
            : [
                [0, 1],
                [2, 3],
              ],
      );
      expect(
        result.entries.map(({ delivered, outcome }) => [
          delivered,
          outcome.winType,
          outcome.status,
        ]),
      ).toEqual(
        replays
          .slice(0, count)
          .map((replay) => [replay.outcome.score, replay.outcome.winType, replay.outcome.status]),
      );
      expect(result.entries.every((row) => row.issues.length === 0)).toBe(true);
      expect(result.ranking).toBe('none');
      expect(result.authenticity).toBe('unverified-local-records');
      expect(result.pairs.find((pair) => pair.a === 0 && pair.b === 1)?.status).toBe(
        'same-conditions',
      );
    }
  });

  it('同seed・固定方針の再記録とJSON往復が決定論的で、同じ入力を再集計しても増殖しない', () => {
    expect(recordTournamentReplay('g1', false)).toEqual(replays[0]);
    const inputs = replays.map((replay) => Object.freeze(input(replay)));
    expect(compareLocalTournament(inputs)).toEqual(compareLocalTournament(inputs));
    const result = compare(...replays);
    result.entries[0].outcome.score = -1;
    expect(compare(...replays).entries[0].outcome.score).toBe(replays[0].outcome.score);
  });

  it('空白・キー順・ID・時刻・表示ラベルと注記の差を除いて重複排除する', () => {
    const duplicate = structuredClone(replays[0]);
    duplicate.id = 'another-export';
    duplicate.finishedAt = 123456;
    duplicate.keyframes[0].label = 'local label';
    const raw = JSON.parse(serializeReplay(duplicate)) as Record<string, unknown>;
    raw.exportedAt = '2026-11-18T10:00:00Z';
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(raw).reverse()));
    const result = compareLocalTournament([
      input(replays[0], 'first'),
      { json: reordered, participantNote: 'second' },
      input(replays[1]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].participantNote).toBe('first');
    expect(result.imports[1]).toEqual({ index: 1, status: 'duplicate', duplicateOf: 0 });
    expect(result.groups).toEqual([[0, 2]]);
    const onlyDuplicate = compare(replays[0], duplicate);
    expect(onlyDuplicate.enoughParticipants).toBe(false);
    expect(onlyDuplicate.entries).toHaveLength(1);
  });

  it('同IDの異内容は全体拒否し、重複で別名登録されたIDの衝突も逃さない', () => {
    const alias = { ...replays[0], id: 'collision' };
    const collision = { ...replays[1], id: 'collision' };
    expect(compareLocalTournament([input(alias), input(collision)])).toEqual({
      ok: false,
      reason: 'id_collision',
      index: 1,
      replayId: 'collision',
    });
    expect(compareLocalTournament([input(replays[0]), input(alias), input(collision)])).toEqual({
      ok: false,
      reason: 'id_collision',
      index: 2,
      replayId: 'collision',
    });
  });

  it.each([
    'seed',
    'difficulty',
    'trials',
    'scenario',
    'runKind',
    'unlockPool',
    'preferredCards',
    'recordedStart',
  ])('%sが違う記録を別組にする', (field) => {
    const changed = structuredClone(replays[1]);
    if (field === 'seed') {
      changed.seed = 'other';
      for (const { frame } of changed.keyframes) frame.seed = 'other';
    }
    if (field === 'difficulty') {
      changed.difficulty = 'hard';
      for (const { frame } of changed.keyframes) frame.difficulty = 'hard';
    }
    if (field === 'trials') {
      changed.trials = ['low-focus'];
      for (const { frame } of changed.keyframes) frame.trials = ['low-focus'];
      changed.contentSnapshot!.trials = [
        { id: 'low-focus', label: 'test', description: '', budgetMul: 1 },
      ];
    }
    const start = changed.keyframes[0].frame;
    if (field === 'scenario') {
      start.scenario = 'copilot';
      start.extras.scenario = 'copilot';
    }
    if (field === 'runKind') {
      start.runKind = 'daily';
      start.dailyDate = '2026-11-18';
    }
    if (field === 'unlockPool') start.extras.allowedCards.push('review-bot');
    if (field === 'preferredCards') start.extras.preferredCardIds = ['review-bot'];
    if (field === 'recordedStart') start.budget += 1;
    expect(parseReplayShare(serializeReplay(changed)).ok).toBe(true);
    const result = compare(replays[0], changed);
    expect(result.pairs[0].status).toBe('different-conditions');
    expect(result.pairs[0].identity.find((item) => item.field === field)?.status).toBe('mismatch');
    expect(result.groups).toEqual([[0], [1]]);
  });

  it('旧形式の欠落・未知のruleset/試練/シナリオをdefault一致にしない', () => {
    const legacy = replays.slice(0, 2).map((replay) => {
      const raw = JSON.parse(serializeReplay(replay));
      raw.schemaVersion = 1;
      delete raw.ruleset;
      delete raw.contentSnapshot;
      delete raw.keyframes[0].frame.extras.preferredCardIds;
      delete raw.keyframes[0].frame.scenario;
      delete raw.keyframes[0].frame.extras.scenario;
      delete raw.keyframes[0].frame.runKind;
      return { json: JSON.stringify(raw) };
    });
    const unrecorded = JSON.parse(serializeReplay(replays[0]));
    unrecorded.id = 'unrecorded-goal';
    delete unrecorded.keyframes[0].frame.goalCarryoverId;
    delete unrecorded.keyframes[0].frame.extras.goalCarryoverId;
    const supplementary = compareLocalTournament([
      input(replays[0]),
      { json: JSON.stringify(unrecorded) },
    ]);
    expect(supplementary.ok && supplementary.entries[1].issues).toContainEqual({
      field: 'goalCarryoverId',
      reason: 'missing',
    });
    const extension = JSON.parse(serializeReplay(replays[1]));
    extension.challengeConditions = { anything: true };
    const unknown = compareLocalTournament([
      input(replays[0]),
      { json: JSON.stringify(extension) },
    ]);
    expect(unknown.ok && unknown.entries[1].issues).toContainEqual({
      field: 'unrecognizedFields',
      reason: 'unknown',
    });
    const old = compareLocalTournament(legacy);
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.groups).toEqual([]);
    expect(old.pairs[0].status).toBe('incomparable');
    for (const entry of old.entries)
      expect(entry.issues).toEqual(
        expect.arrayContaining([
          { field: 'ruleset', reason: 'missing' },
          { field: 'scenario', reason: 'missing' },
          { field: 'runKind', reason: 'missing' },
          { field: 'preferredCardIds', reason: 'missing' },
        ]),
      );
    for (const field of ['ruleset', 'trials', 'scenario']) {
      const changed = structuredClone(replays[1]);
      if (field === 'ruleset') changed.ruleset = { ...changed.ruleset!, fingerprint: 'unknown' };
      if (field === 'trials') {
        changed.trials = ['unknown'];
        for (const { frame } of changed.keyframes) frame.trials = ['unknown'];
        changed.contentSnapshot!.trials = [
          { id: 'unknown', label: '?', description: '', budgetMul: 1 },
        ];
      }
      if (field === 'scenario') {
        changed.keyframes[0].frame.scenario = 'unknown' as never;
        changed.keyframes[0].frame.extras.scenario = 'unknown' as never;
      }
      const result = compare(replays[0], changed);
      expect(result.pairs[0].status).toBe('incomparable');
      expect(result.entries[1].issues).toContainEqual({ field, reason: 'unknown' });
    }
  });

  it('開始・終端欠損や、出荷・勝利種別の矛盾を比較不能として残す', () => {
    const noStart = structuredClone(replays[1]);
    noStart.keyframes.shift();
    expect(compare(replays[0], noStart).entries[1].issues).toContainEqual({
      field: 'recordedStart',
      reason: 'missing',
    });
    const noEnd = structuredClone(replays[1]);
    noEnd.keyframes.pop();
    noEnd.contentSnapshot!.companyResult = undefined;
    expect(compare(replays[0], noEnd).entries[1].issues).toContainEqual({
      field: 'terminal',
      reason: 'missing',
    });
    const score = structuredClone(replays[1]);
    score.outcome.score += 1;
    score.contentSnapshot!.companyResult = undefined;
    const result = compare(replays[0], score);
    expect(result.entries[1].issues).toContainEqual({ field: 'delivered', reason: 'inconsistent' });
    expect(result.pairs[0].status).toBe('incomparable');
    const unknownPool = structuredClone(replays[1]);
    unknownPool.keyframes[0].frame.extras.allowedCards = ['unknown-card'];
    expect(compare(replays[0], unknownPool).entries[1].issues).toContainEqual({
      field: 'allowedCards',
      reason: 'unknown',
    });
    const malformed = structuredClone(replays[1]);
    malformed.keyframes[0].frame.extras.allowedCards = [{ toString: null }] as never;
    expect(compare(replays[0], malformed).imports[1]).toMatchObject({
      status: 'rejected',
      reason: 'condition_shape',
    });
    const win = structuredClone(replays[1]);
    win.outcome.winType = 'invented' as never;
    expect(compare(replays[0], win).entries[1].issues).toContainEqual({
      field: 'outcome',
      reason: 'inconsistent',
    });
  });

  it('読込失敗も既存ラン/RNG位置/保存先に触れず、既存比較結果を変更しない', () => {
    const engine = new RunEngine({ seed: 'untouched', difficulty: 'normal' });
    engine.startRun();
    engine.beginSetupSprint();
    engine.step(100);
    const before = engine.exportCounterfactualFrame();
    const previous = compare(...replays.slice(0, 2));
    const snapshot = structuredClone(previous);
    const storage = vi.fn(() => {
      throw new Error('storage access');
    });
    vi.stubGlobal('indexedDB', { open: storage, deleteDatabase: storage });
    vi.stubGlobal('localStorage', { getItem: storage, setItem: storage, removeItem: storage });
    try {
      const missing = JSON.parse(serializeReplay(replays[1]));
      delete missing.trials;
      for (const json of ['{', JSON.stringify({ schemaVersion: 99 }), JSON.stringify(missing)]) {
        const result = compareLocalTournament([input(replays[0]), { json }]);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.imports[1].status).toBe('rejected');
      }
      expect(storage).not.toHaveBeenCalled();
      expect(engine.exportCounterfactualFrame()).toEqual(before);
      expect(previous).toEqual(snapshot);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('件数・文字列・構造・フレーム数に上限を設け、失敗に入力を消費しない', () => {
    expect(compareLocalTournament([])).toEqual({ ok: false, reason: 'file_count' });
    expect(compareLocalTournament(Array(5).fill(input(replays[0])))).toEqual({
      ok: false,
      reason: 'file_count',
    });
    const tooMany = JSON.parse(serializeReplay(replays[1]));
    tooMany.keyframes = Array(LOCAL_TOURNAMENT_LIMITS.keyframes + 1).fill(tooMany.keyframes[0]);
    for (const invalid of [
      { json: ' '.repeat(LOCAL_TOURNAMENT_LIMITS.jsonCharacters + 1) },
      input(replays[1], 'x'.repeat(81)),
      { json: JSON.stringify(tooMany) },
      { json: JSON.stringify({ nested: Array(5001).fill(0) }) },
      { json: '{"value":1e309}' },
      { json: JSON.stringify({ text: 'x'.repeat(16001) }) },
    ]) {
      const result = compareLocalTournament([input(replays[0]), invalid]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.imports[1].status).toBe('rejected');
    }
  });
});
