import { describe, expect, it } from 'vitest';
import {
  applyRetryMove as apply,
  branchAtMove,
  branchFromSetup,
  checkBranch,
  compareRetryBranches,
  createRetryPrototype as create,
  createRetryRecord,
  restorableTicks,
  restoreBefore,
  runRetryMoves,
  settleBranch,
  summarizeRetry,
  type RetryRecord,
} from './oneMoveRetry';
import comparison from '../../docs/prototypes/one-move-retry-comparison.json';

const net = (seed: number, scenario: string, to: string, followUp: string) =>
  compareRetryBranches()
    .find((row) => row.seed === seed && row.scenario === scenario)!
    .branches.find((branch) => branch.to === to && branch.followUp === followUp)!.result.netValue;

describe('RI-290 一手だけ変える再挑戦', () => {
  it('同じseedの初期状態は一致し、乱数は手に関わらず1tick1回だけ進む', () => {
    expect(create(1)).toEqual(create(1));
    expect(create(2).rngState).not.toBe(create(1).rngState);
    const setup = create(1);
    const states = (['code', 'review', 'rest'] as const).map((move) => apply(setup, move));
    expect(new Set(states.map((state) => state.rngState)).size).toBe(1);
    expect(states.map((state) => state.incidents)).toEqual([0, 0, 0]);
  });

  it('分岐は元記録のsetupと入力列を変更せず、親と変えた手を記録する', () => {
    const record = createRetryRecord('jam');
    const before = structuredClone(record);
    const branch = branchAtMove(record, 3, 'review', 'fixed')!;
    expect(record).toEqual(before);
    expect(branch.parentId).toBe('jam-1');
    expect(branch.changed).toEqual({ index: 3, from: 'code', to: 'review' });
    expect(branch.state.moves.slice(0, 3)).toEqual(record.moves!.slice(0, 3));
    expect(branch.state.moves[3]).toBe('review');
    expect(branch.state.moves.slice(4)).toEqual(record.moves!.slice(4));
    branch.state.moves[0] = 'rest';
    expect(record.moves![0]).toBe('code');
  });

  it('入力ログがあれば各手の直前を復元でき、旧キーフレーム形式はsetupだけを複製できる', () => {
    const record = createRetryRecord('fatigue');
    expect(restorableTicks(record)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(restoreBefore(record, 5)).toEqual(
      runRetryMoves(record.setup, record.moves!.slice(0, 5)),
    );
    const legacy: RetryRecord = { ...record, moves: null };
    expect(restorableTicks(legacy)).toEqual([0]);
    expect(restoreBefore(legacy, 0)).toBeNull();
    expect(checkBranch(legacy, 0, 'rest')).toEqual({ ok: false, reason: 'no-input-log' });
    expect(branchAtMove(legacy, 0, 'rest', 'fixed')).toBeNull();
    const clone = branchFromSetup(legacy)!;
    expect(clone.changed).toBeNull();
    expect(clone.followUp).toBe('free');
    expect(clone.state.tick).toBe(clone.state.horizon);
  });

  it('ruleset不一致・範囲外・同じ手の分岐を拒否する', () => {
    const record = createRetryRecord('jam');
    expect(checkBranch(record, 3, 'review', 'retry-proto-2')).toEqual({
      ok: false,
      reason: 'ruleset-mismatch',
    });
    expect(branchAtMove(record, 3, 'review', 'fixed', 'retry-proto-2')).toBeNull();
    expect(branchFromSetup(record, 'retry-proto-2')).toBeNull();
    for (const index of [-1, 12, 1.5])
      expect(checkBranch(record, index, 'rest')).toEqual({ ok: false, reason: 'out-of-range' });
    expect(checkBranch(record, 3, 'code')).toEqual({ ok: false, reason: 'same-move' });
    expect(checkBranch(record, 3, 'rest')).toEqual({ ok: true });
  });

  it('同じ分岐状態と変更入力は同じ結果になり、報酬・デイリーには数えない', () => {
    const record = createRetryRecord('fatigue', 2);
    for (const followUp of ['fixed', 'free'] as const) {
      const first = branchAtMove(record, 3, 'rest', followUp)!;
      const second = branchAtMove(structuredClone(record), 3, 'rest', followUp)!;
      expect(second).toEqual(first);
      expect(runRetryMoves(record.setup, first.state.moves)).toEqual(first.state);
      const settled = settleBranch(first);
      expect(settled.rewardEligible).toBe(false);
      expect(settled.metaReward).toBe(0);
      expect(settled.dailyReward).toBe(0);
    }
  });

  it('固定継続では転機の種類で有利な一手が入れ替わり、後続の無効手が残る', () => {
    expect(net(1, 'jam', 'review', 'fixed')).toBe(12);
    expect(net(1, 'jam', 'rest', 'fixed')).toBe(9);
    expect(net(1, 'fatigue', 'rest', 'fixed')).toBe(9);
    expect(net(1, 'fatigue', 'review', 'fixed')).toBe(5);
    const rows = compareRetryBranches();
    const seed1 = rows.find((row) => row.seed === 1 && row.scenario === 'jam')!;
    expect(seed1.original.netValue).toBe(-12);
    expect(seed1.turning).toEqual({ index: 3, kind: 'jam' });
    const fixed = seed1.branches.find((b) => b.to === 'review' && b.followUp === 'fixed')!;
    expect(fixed.result.invalidMoves).toBeGreaterThan(0);
  });

  it('seedで渋滞の有利手が変わり、自由継続は方針の差に寄る', () => {
    const jamWinners = [1, 2, 3, 4, 5].map((seed) =>
      net(seed, 'jam', 'review', 'fixed') > net(seed, 'jam', 'rest', 'fixed') ? 'review' : 'rest',
    );
    expect(jamWinners).toEqual(['review', 'review', 'rest', 'rest', 'review']);
    for (const seed of [1, 2, 3, 4, 5])
      expect(net(seed, 'fatigue', 'rest', 'fixed')).toBeGreaterThan(
        net(seed, 'fatigue', 'review', 'fixed'),
      );
    expect(net(1, 'jam', 'review', 'free')).toBe(18);
    expect(net(1, 'jam', 'rest', 'free')).toBe(18);
    for (const row of compareRetryBranches())
      for (const branch of row.branches.filter((b) => b.followUp === 'free'))
        expect(branch.result.invalidMoves).toBeLessThanOrEqual(1);
  });

  it('比較JSONと一致し、全入力の再生と毎入力JSON保存再開が一致する', () => {
    const rows = compareRetryBranches();
    expect(rows).toEqual(comparison.results);
    for (const row of rows)
      for (const branch of row.branches) {
        let live = row.record.setup;
        let saved = structuredClone(live);
        for (const move of branch.moves) {
          const previous = live;
          const before = structuredClone(live);
          live = apply(live, move);
          saved = apply(JSON.parse(JSON.stringify(saved)), move);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
        }
        expect(summarizeRetry(live)).toEqual(branch.result);
      }
  });

  it('期末後の入力は無変化で返す', () => {
    const ended = { ...create(1), tick: 12 };
    for (const move of ['code', 'review', 'rest'] as const) expect(apply(ended, move)).toBe(ended);
  });
});
