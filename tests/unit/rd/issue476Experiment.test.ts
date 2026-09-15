import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIFFICULTY_DEFS, getDifficulty } from '../../../src/data/difficulties';
import {
  issue476Knobs,
  resolveIssue476Variant,
  resolveIssue476VariantFromLocation,
  subscribeIssue476Variant,
  writeIssue476VariantToLocation,
} from '../../../src/rd/issue476Experiment';
import { normalTaskFloor } from '../../../src/sim/run/sprintBaselineBuild';
import { evaluateSprintGrade } from '../../../src/sim/sprintGrade';

const location = { search: '' };

function setRd(search: string): void {
  location.search = search;
  vi.stubGlobal('window', {
    location,
    history: { state: null, replaceState() {} },
  });
}

afterEach(() => {
  location.search = '';
  vi.unstubAllGlobals();
});

/** delivered=200, rework=1 → 健全比 0.975。baseline S(0.955) 以上、実験 S(0.99) 未満。 */
const midSInput = {
  delivered: 200,
  reworkCount: 1,
  incidentCount: 0,
  spread: 0,
  hpLoss: 0,
  stabilizingGrants: 0,
};

describe('Issue #476 R&D variants', () => {
  it('resolves aliases and defaults unknown values to baseline', () => {
    expect(resolveIssue476Variant('')).toBe('baseline');
    expect(resolveIssue476Variant('?rd=threshold-only')).toBe('threshold');
    expect(resolveIssue476Variant('?rd=pace-only')).toBe('pace');
    expect(resolveIssue476Variant('?rd=nope')).toBe('baseline');
  });

  it('keeps the unused knob at baseline for each variant', () => {
    const baseline = issue476Knobs('baseline');
    const threshold = issue476Knobs('threshold');
    const pace = issue476Knobs('pace');

    expect(threshold.gradeThresholdS).toBe(0.99);
    expect(threshold.easyNormalTaskFloor).toBe(baseline.easyNormalTaskFloor);
    expect(threshold.easyTaskCountMul).toBe(baseline.easyTaskCountMul);

    expect(pace.gradeThresholdS).toBe(baseline.gradeThresholdS);
    expect(pace.easyNormalTaskFloor).toBe(50);
    expect(pace.easyTaskCountMul).toBe(1.65);

    expect(baseline.gradeThresholdS).toBe(0.955);
    expect(baseline.easyNormalTaskFloor).toBe(58);
    expect(baseline.easyTaskCountMul).toBe(1.85);
  });

  it('wires S threshold and Easy pace to different live getters', () => {
    setRd('');
    expect(evaluateSprintGrade(midSInput).grade).toBe('S');
    expect(normalTaskFloor('easy')).toBe(58);
    expect(getDifficulty('easy').taskCountMul).toBe(1.85);

    setRd('?rd=threshold');
    expect(evaluateSprintGrade(midSInput).ratio).toBeCloseTo(0.975, 5);
    expect(evaluateSprintGrade(midSInput).grade).toBe('A');
    expect(normalTaskFloor('easy')).toBe(58);
    expect(getDifficulty('easy').taskCountMul).toBe(1.85);

    setRd('?rd=pace');
    expect(evaluateSprintGrade(midSInput).grade).toBe('S');
    expect(normalTaskFloor('easy')).toBe(50);
    expect(getDifficulty('easy').taskCountMul).toBe(1.65);
    expect(getDifficulty('easy').aiDependencyPerTask).toBe(
      DIFFICULTY_DEFS.easy.aiDependencyPerTask,
    );
  });

  it('notifies subscribers when the title picker writes ?rd=', () => {
    let href = 'http://localhost/?seed=devops-tycoon';
    vi.stubGlobal('window', {
      location: {
        get href() {
          return href;
        },
        get search() {
          return new URL(href).search;
        },
      },
      history: {
        state: null,
        replaceState(_state: unknown, _title: string, next: string) {
          href = `http://localhost${next}`;
        },
      },
    });
    const seen: string[] = [];
    const unsubscribe = subscribeIssue476Variant(() => {
      seen.push(resolveIssue476VariantFromLocation());
    });
    writeIssue476VariantToLocation('threshold');
    writeIssue476VariantToLocation('pace');
    writeIssue476VariantToLocation('baseline');
    unsubscribe();
    expect(seen).toEqual(['threshold', 'pace', 'baseline']);
  });
});
