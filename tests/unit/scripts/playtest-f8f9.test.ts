import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateF8F9,
  F8_MAX_GAP_P50,
  F9_MIN_DISTINCT_SETS,
  F9_MIN_REASON_N,
  F9_POLICIES,
  findingsF8F9Problems,
  formatF8AcceptanceLine,
  formatF9AcceptanceLine,
  quantile,
  recoveryGapOf,
  stableEffectiveActionId,
} from '../../../scripts/playtest-f8f9.mjs';
import { currentGeneration } from '../../../scripts/playtest-generation.mjs';
import { invalidatePlaytestOut } from '../../../scripts/playtest-out.mjs';

const defaultCohort = {
  difficulties: ['easy', 'normal', 'hard', 'nightmare'],
  policies: F9_POLICIES,
  seeds: ['pt-1'],
  meta: 'fresh',
  isDefault: true,
};

function lostRun(overrides: Record<string, unknown> = {}) {
  return {
    meta: 'fresh',
    difficulty: 'easy',
    policy: 'naive',
    seed: 'pt-1',
    status: 'lost',
    loseReason: 'seniorBurnout',
    sprintsPlayed: 4,
    lostPhase: 'sprint',
    lostSprintCompleted: true,
    effectiveActionsInDanger: ['firefight'],
    lastEffectiveActionsAt: { sprintsPlayed: 3, actions: ['firefight'] },
    ...overrides,
  };
}

function loaded(runs: unknown[], extra: Record<string, unknown> = {}) {
  return { generation: 'test', cohort: defaultCohort, runs, ...extra };
}

function many(
  count: number,
  reason: string,
  actions: string[],
  policy = 'naive',
  start = 0,
): ReturnType<typeof lostRun>[] {
  return Array.from({ length: count }, (_, i) =>
    lostRun({
      policy,
      seed: `pt-${start + i + 1}`,
      loseReason: reason,
      effectiveActionsInDanger: actions,
      lastEffectiveActionsAt: { sprintsPlayed: 3, actions },
    }),
  );
}

describe('playtest-f8f9', () => {
  it('安定キーはデッキ位置と task ID を落とす', () => {
    expect(stableEffectiveActionId('card:copilot:2')).toBe('card:copilot');
    expect(stableEffectiveActionId('assignTask:t12:senior')).toBe('assignTask:senior');
    expect(stableEffectiveActionId('splitPr:abc')).toBe('splitPr');
    expect(stableEffectiveActionId('firefight')).toBe('firefight');
  });

  it('quantile は Infinity を末尾に置く', () => {
    expect(quantile([0, 0, 1], 0.5)).toBe(0);
    expect(quantile([0, Number.POSITIVE_INFINITY], 0.5)).toBe(Number.POSITIVE_INFINITY);
    expect(quantile([0, 0, 0, Number.POSITIVE_INFINITY], 0.5)).toBe(0);
  });

  it('有効手が無いランのギャップは Infinity', () => {
    expect(recoveryGapOf(lostRun({ lastEffectiveActionsAt: undefined }))).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      recoveryGapOf(
        lostRun({
          lastEffectiveActionsAt: { sprintsPlayed: 3, actions: ['firefight'] },
          lostSprintCompleted: true,
          sprintsPlayed: 4,
        }),
      ),
    ).toBe(0);
  });

  it('既定コホートでない・CFなし・STALE・partial は未計測', () => {
    const runs = many(10, 'seniorBurnout', ['firefight']);
    expect(
      evaluateF8F9(loaded(runs, { cohort: { ...defaultCohort, isDefault: false } }), {
        stale: false,
      }).f8.verdict,
    ).toBe('未計測');
    expect(
      evaluateF8F9(
        loaded(
          runs.map((r) => {
            const copy = { ...r };
            delete copy.effectiveActionsInDanger;
            delete copy.lastEffectiveActionsAt;
            return copy;
          }),
        ),
        { stale: false },
      ).f8.verdict,
    ).toBe('未計測');
    expect(evaluateF8F9(loaded(runs), { stale: '世代不一致' }).f8.verdict).toBe('未計測');
    expect(evaluateF8F9(loaded(runs, { partial: true }), { stale: false }).f8.verdict).toBe(
      '未計測',
    );
  });

  it('F-8 は p50≤1 なら PASS、半数以上が Inf なら FAIL', () => {
    const passRuns = [
      ...many(10, 'seniorBurnout', ['firefight'], 'naive', 0),
      ...many(10, 'moraleCollapse', ['overtime'], 'skilledNoHire', 10),
    ];
    const pass = evaluateF8F9(loaded(passRuns), { stale: false });
    expect(pass.f8.verdict).toBe('PASS');
    expect(pass.f8.p50).toBeLessThanOrEqual(F8_MAX_GAP_P50);

    const failRuns = passRuns.map((r, i) =>
      i < 11 ? { ...r, lastEffectiveActionsAt: undefined, effectiveActionsInDanger: [] } : r,
    );
    const fail = evaluateF8F9(loaded(failRuns), { stale: false });
    expect(fail.f8.verdict).toBe('FAIL');
    expect(fail.f8.p50).toBe(Number.POSITIVE_INFINITY);
  });

  it('F-9 は資格敗因の集合差が最低種類数以上なら PASS', () => {
    const passRuns = [
      ...many(F9_MIN_REASON_N, 'seniorBurnout', ['firefight'], 'naive', 0),
      ...many(F9_MIN_REASON_N, 'moraleCollapse', ['overtime'], 'skilledNoHire', 20),
    ];
    const pass = evaluateF8F9(loaded(passRuns), { stale: false });
    expect(pass.f9.verdict).toBe('PASS');
    expect(pass.f9.distinctEffectiveSetCount).toBeGreaterThanOrEqual(F9_MIN_DISTINCT_SETS);

    const sameSet = [
      ...many(F9_MIN_REASON_N, 'seniorBurnout', ['firefight'], 'naive', 0),
      ...many(F9_MIN_REASON_N, 'moraleCollapse', ['firefight'], 'skilledNoHire', 20),
    ];
    const fail = evaluateF8F9(loaded(sameSet), { stale: false });
    expect(fail.f9.verdict).toBe('FAIL');
    expect(fail.f9.distinctEffectiveSetCount).toBe(1);
  });

  it('F-9 は資格敗因が2未満なら未計測（F-8 は判定する）', () => {
    const runs = many(F9_MIN_REASON_N, 'seniorBurnout', ['firefight']);
    const result = evaluateF8F9(loaded(runs), { stale: false });
    expect(result.f8.verdict).toBe('PASS');
    expect(result.f9.verdict).toBe('未計測');
  });

  it('不完全評価でも lastEffectiveActionsAt があれば F-8 ギャップに含める', () => {
    const runs = [
      lostRun({
        counterfactualIncomplete: true,
        lastEffectiveActionsAt: { sprintsPlayed: 3, actions: ['andon'] },
        effectiveActionsInDanger: [],
      }),
      lostRun({
        policy: 'skilledNoHire',
        seed: 'pt-2',
        loseReason: 'moraleCollapse',
        counterfactualIncomplete: true,
        lastEffectiveActionsAt: { sprintsPlayed: 3, actions: ['overtime'] },
        effectiveActionsInDanger: [],
      }),
    ];
    const result = evaluateF8F9(loaded(runs), { stale: false });
    expect(result.f8.n).toBe(2);
    expect(result.f8.p50).toBe(0);
    expect(result.f8.verdict).toBe('PASS');
    expect(result.f9.verdict).toBe('未計測');
  });

  it('所見の固定行と実測を突き合わせる', () => {
    const runs = [
      ...many(F9_MIN_REASON_N, 'seniorBurnout', ['firefight'], 'naive', 0),
      ...many(F9_MIN_REASON_N, 'moraleCollapse', ['overtime'], 'skilledNoHire', 20),
    ];
    const result = evaluateF8F9(loaded(runs), { stale: false });
    const body = `${formatF8AcceptanceLine(result)}\n${formatF9AcceptanceLine(result)}\n`;
    expect(findingsF8F9Problems(body, result)).toEqual([]);
    expect(
      findingsF8F9Problems(
        'F-8 受入（RI-132）: 未計測 — 反実仮想評価が無い\nF-9 受入（RI-132）: 未計測 — 反実仮想評価が無い\n',
        result,
      ),
    ).toEqual([
      `F-8 受入（RI-132）が未計測と書かれているが実測は ${result.f8.verdict}`,
      `F-9 受入（RI-132）が未計測と書かれているが実測は ${result.f9.verdict}`,
    ]);
    expect(findingsF8F9Problems('', result)[0]).toMatch(/F-8 受入/);
  });
});

describe('playtest-out invalidate', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('同じ世代の partial は残し、完了済みと世代違いと壊れた出力は消す', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-out-'));
    dirs.push(dir);
    const generation = currentGeneration();
    const keep = join(dir, 'keep.json');
    const done = join(dir, 'done.json');
    const stale = join(dir, 'stale.json');
    const broken = join(dir, 'broken.json');
    writeFileSync(
      keep,
      JSON.stringify({ generation, partial: true, cohort: defaultCohort, runs: [] }),
    );
    writeFileSync(done, JSON.stringify({ generation, cohort: defaultCohort, runs: [] }));
    writeFileSync(
      stale,
      JSON.stringify({ generation: 'old', partial: true, cohort: defaultCohort, runs: [] }),
    );
    writeFileSync(broken, '{');
    expect(invalidatePlaytestOut(keep)).toBe('keep-partial');
    expect(existsSync(keep)).toBe(true);
    expect(invalidatePlaytestOut(done)).toBe('deleted');
    expect(existsSync(done)).toBe(false);
    expect(invalidatePlaytestOut(stale)).toBe('deleted');
    expect(existsSync(stale)).toBe(false);
    expect(invalidatePlaytestOut(broken)).toBe('deleted');
    expect(existsSync(broken)).toBe(false);
    expect(readFileSync(keep, 'utf8')).toContain('"partial":true');
  });
});
