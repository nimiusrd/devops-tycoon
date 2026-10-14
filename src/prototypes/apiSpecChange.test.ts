import { describe, expect, it } from 'vitest';
import {
  applyApiSpecChange as apply,
  chooseApiSpecAction,
  compareApiSpecChanges,
  createApiSpecChange as create,
  summarizeApiSpecChange,
  viewApiSpecChange,
} from './apiSpecChange';
import comparison from '../../docs/prototypes/api-spec-change-comparison.json';

describe('RI-247 利用APIの仕様変更', () => {
  it('影響領域と期限を先に示し、選択だけでは出荷しない', () => {
    const first = create('RI-247', 'narrow-long');
    expect(create('RI-247', 'narrow-long')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewApiSpecChange(first);
    for (let i = 0; i < 8; i++) expect(viewApiSpecChange(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      domain: 'billing',
      unrelatedDomain: 'other',
      deadlineTicks: 3,
      capacity: 4,
      reason: 'api-spec-change',
      followWork: 4,
      replaceWork: 8,
      featureValue: 16,
      followResidual: 2,
      unrelated: { left: 6, total: 6, valuePer: 4 },
      choices: ['follow', 'replace', 'stop'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score])).toEqual([
      ['follow', 38],
      ['replace', 32],
      ['stop', 24],
    ]);
    const chosen = apply(first, { type: 'follow' });
    expect(chosen.featurePaid).toBe(false);
    expect(chosen.unrelatedDone).toBe(0);
    expect(chosen.migrationLeft).toBe(4);
    expect(apply(chosen, { type: 'follow' })).toBe(chosen);
    expect(apply(chosen, { type: 'stop' })).toBe(chosen);
    expect(viewApiSpecChange(chosen).choices).toEqual([]);
  });

  it('依存の広さと残り期間で追従・代替・停止の優位が入れ替わる', () => {
    const rows = compareApiSpecChanges(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('narrow-long', 'follow').result).toMatchObject({
      score: 38,
      featurePaid: true,
      residual: 2,
      unrelatedDone: 6,
      path: [0, 14, 30, 38],
    });
    expect(row('wide-long', 'replace').result).toMatchObject({
      score: 32,
      featurePaid: true,
      residual: 0,
      unrelatedDone: 4,
      migrationLeft: 0,
    });
    expect(row('wide-short', 'stop').result).toMatchObject({
      score: 24,
      featurePaid: false,
      residual: 0,
      unrelatedDone: 6,
      unrelatedValue: 4,
    });
    expect(row('wide-short', 'replace').result).toMatchObject({
      score: -8,
      featurePaid: false,
      residual: 8,
      migrationLeft: 4,
      unrelatedDone: 0,
    });
    expect(row('narrow-long', 'follow').result.score).toBeGreaterThan(
      row('narrow-long', 'replace').result.score,
    );
    expect(row('wide-long', 'replace').result.score).toBeGreaterThan(
      row('wide-long', 'follow').result.score,
    );
    expect(row('wide-short', 'stop').result.score).toBeGreaterThan(
      row('wide-short', 'follow').result.score,
    );
    for (const item of rows) {
      expect(item.result.lost).toBe(false);
      expect(item.result.unrelatedValue).toBe(4);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareApiSpecChanges(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseApiSpecAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeApiSpecChange(live)).toEqual(row.result);
    }
  });
});
