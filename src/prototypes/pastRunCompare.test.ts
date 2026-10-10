import { describe, expect, it } from 'vitest';
import { RunEngine } from '../sim/run/engine';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../state/replay';
import {
  boundaryMetrics,
  checkIdentity,
  comparePastRuns,
  toComparableReplay,
  type ComparableReplay,
} from './pastRunCompare';
import data from '../../docs/prototypes/past-run-compare-fixtures.json';
import comparison from '../../docs/prototypes/past-run-compare-comparison.json';

const fixtures = data.fixtures as unknown as ComparableReplay[];
const [g1Plain, g1Skilled, g2Plain, g2Skilled] = fixtures;

function setupBlob(seed: string, id: string): ReplayBlob {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('export failed');
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id,
    seed,
    difficulty: 'normal',
    trials: [],
    finishedAt: 0,
    outcome: { status: 'lost', diagnosis: 'healthyAcceleration', score: 0 },
    keyframes: [{ phase: 'setup', frame }],
    ruleset: { version: 1, fingerprint: 'test-ruleset' },
    contentSnapshot: { cards: [], relics: [] },
  };
}

describe('RI-291 前回の自分との並走', () => {
  it('実際のReplayBlobをそのまま照合でき、同じ開始条件なら全項目が一致する', () => {
    const identity = checkIdentity(setupBlob('ghost', 'a'), setupBlob('ghost', 'b'));
    expect(identity.map((item) => item.field)).toEqual([
      'seed',
      'difficulty',
      'trials',
      'scenario',
      'runKind',
      'ruleset',
      'unlockPool',
    ]);
    expect(identity.every((item) => item.status === 'match')).toBe(true);
    expect(comparePastRuns(setupBlob('ghost', 'a'), setupBlob('ghost', 'b')).rows).toEqual([]);
  });

  it('seed以外の開始条件・ruleset・解放条件の違いや不足を比較不能にする', () => {
    const status = (b: ComparableReplay, field: string) =>
      checkIdentity(g1Plain, b).find((item) => item.field === field)!.status;
    const changed = structuredClone(g1Skilled);
    changed.trials = ['budget_cut'];
    changed.keyframes[0].frame.scenario = 'review_hell' as never;
    changed.keyframes[0].frame.extras!.allowedCards = ['pair_programming'];
    expect(status(changed, 'trials')).toBe('mismatch');
    expect(status(changed, 'scenario')).toBe('mismatch');
    expect(status(changed, 'unlockPool')).toBe('mismatch');
    expect(status({ ...g1Skilled, difficulty: 'hard' }, 'difficulty')).toBe('mismatch');
    expect(status({ ...g1Skilled, seed: 'g2' }, 'seed')).toBe('mismatch');
    const legacy = { ...g1Skilled, ruleset: null };
    expect(status(legacy, 'ruleset')).toBe('missing');
    const laterSetup = structuredClone(g1Skilled.keyframes[0]);
    laterSetup.frame.sprintsPlayed = 3;
    const noSetup = { ...g1Skilled, keyframes: [laterSetup, ...g1Skilled.keyframes.slice(1)] };
    for (const field of ['scenario', 'runKind', 'unlockPool'])
      expect(status(noSetup, field)).toBe('missing');
    for (const other of [changed, legacy, noSetup]) {
      const result = comparePastRuns(g1Plain, other);
      expect(result.comparable).toBe(false);
      expect(result.rows).toEqual([]);
      expect(result.bands).toBeNull();
    }
  });

  it('記録値の比較と明示し、総合点を持たず、元記録を変更しない', () => {
    const before = structuredClone(fixtures);
    const result = comparePastRuns(g2Plain, g2Skilled);
    expect(fixtures).toEqual(before);
    expect(result.source).toBe('recorded-boundaries');
    expect(result.liveSimulation).toBe(false);
    expect(Object.keys(result)).not.toContain('score');
    expect(result.rows.every((row) => !('score' in row))).toBe(true);
    expect(result.ends).toEqual({
      a: { status: 'lost', winType: null, loseReason: 'budgetExhausted', endedAfterSprint: 17 },
      b: { status: 'lost', winType: null, loseReason: 'seniorBurnout', endedAfterSprint: 4 },
    });
  });

  it('期間が違うときは共通区間と片方だけの区間を分け、片方だけの行には優劣を付けない', () => {
    const result = comparePastRuns(g2Plain, g2Skilled);
    expect(result.spans).toEqual({
      common: [1, 2, 3, 4],
      onlyA: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      onlyB: [],
    });
    for (const row of result.rows.filter((item) => item.span !== 'common')) {
      expect(row.b).toBeNull();
      expect(row.leads).toBeNull();
    }
    const swapped = comparePastRuns(g2Skilled, g2Plain);
    expect(swapped.spans!.onlyB).toEqual(result.spans!.onlyA);
    expect(swapped.bands!.shipping.a).toEqual(result.bands!.shipping.b);
  });

  it('出荷・滞留・消耗の得意な時間帯が別々に分かれる', () => {
    const g2 = comparePastRuns(g2Plain, g2Skilled);
    expect(g2.bands).toEqual({
      shipping: { a: [4], b: [1, 2, 3], tie: [] },
      backlog: { a: [], b: [1, 2, 4], tie: [3] },
      wear: { a: [2, 4], b: [1, 3], tie: [] },
    });
    const g1 = comparePastRuns(g1Plain, g1Skilled);
    expect(g1.spans).toEqual({ common: [1, 2, 3, 4, 5, 6, 7, 8], onlyA: [], onlyB: [] });
    expect(g1.bands!.shipping).toEqual({ a: [4, 7, 8], b: [1, 2, 3, 5, 6], tie: [] });
    expect(g1.bands!.wear).toEqual({ a: [5, 6], b: [1, 2, 3, 4, 7, 8], tie: [] });
  });

  it('ボス回は四半期レビューの境界で読み、ドラフトや途中敗北の終端を行に足さない', () => {
    const rows = boundaryMetrics(g1Plain);
    expect([...rows.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.get(6)!.phase).toBe('quarterReview');
    expect(rows.get(1)!.phase).toBe('result');
    const last = g1Plain.keyframes[g1Plain.keyframes.length - 1];
    expect(last.phase).toBe('lost');
    expect(last.frame.sprintsPlayed).toBe(8);
  });

  it('比較用の写しは境界と項目だけを残し、記録値を丸めない', () => {
    expect(fixtures.map(toComparableReplay)).toEqual(fixtures);
    const blob = setupBlob('ghost', 'a');
    const copy = toComparableReplay(blob);
    const frame = blob.keyframes[0].frame;
    expect(copy.keyframes[0].frame.org.seniorHp).toBe(frame.org.seniorHp);
    expect(copy.keyframes[0].frame.extras!.allowedCards).toEqual(frame.extras.allowedCards);
    expect(copy.keyframes[0].frame.extras!.allowedCards).not.toBe(frame.extras.allowedCards);
  });

  it('比較JSONと一致する', () => {
    expect([comparePastRuns(g1Plain, g1Skilled), comparePastRuns(g2Plain, g2Skilled)]).toEqual(
      JSON.parse(JSON.stringify(comparison.results)),
    );
  });
});
