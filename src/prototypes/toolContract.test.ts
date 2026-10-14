import { describe, expect, it } from 'vitest';
import {
  applyToolContract as apply,
  chooseToolContractAction,
  compareToolContracts,
  createToolContract as create,
  summarizeToolContract,
  viewToolContract,
} from './toolContract';
import comparison from '../../docs/prototypes/tool-contract-comparison.json';

describe('RI-249 ツール契約の更新', () => {
  it('更新前に旧条件と移行費用を示し、選択だけでは課金しない', () => {
    const first = create('RI-249', 'steady');
    expect(create('RI-249', 'steady')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewToolContract(first);
    for (let i = 0; i < 8; i++) expect(viewToolContract(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      notice: 'renewal-announced',
      renewalAfterTicks: 2,
      postTicks: 3,
      asset: 9,
      budget: 12,
      slack: true,
      old: { automation: 5, fee: 1 },
      continued: { automation: 5, fee: 2 },
      transferred: { automation: 4, fee: 2 },
      shrink: { automation: 3, fee: 1 },
      migrationWork: 1,
      migrationEffect: 'neither',
      choices: ['continue', 'migrate', 'shrink'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score])).toEqual([
      ['continue', 17],
      ['migrate', 12],
      ['shrink', 14],
    ]);
    const chosen = apply(first, { type: 'migrate' });
    expect(chosen.net).toBe(0);
    expect(chosen.migrationLeft).toBe(1);
    expect(chosen.periods[0]).toMatchObject({ tool: 'none', automation: 0, fee: 0 });
    expect(apply(chosen, { type: 'continue' })).toBe(chosen);
    expect(viewToolContract(chosen).choices).toEqual([]);
  });

  it('値上げの小ささ・資産の厚み・資産の薄さで継続・移行・縮小が入れ替わる', () => {
    const rows = compareToolContracts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('steady', 'continue').result).toMatchObject({
      score: 17,
      path: [0, 4, 8, 11, 14, 17],
    });
    for (const board of ['steady', 'heavy', 'light'] as const) {
      const continued = row(board, 'continue').result.billing.filter(
        (entry) => entry.tool === 'continued',
      );
      expect(continued.map((entry) => entry.automation)).toEqual([5, 5, 5]);
    }
    expect(row('heavy', 'migrate').result).toMatchObject({
      score: 20,
      migrationLeft: 0,
      path: [0, 4, 8, 8, 14, 20],
    });
    expect(row('light', 'shrink').result).toMatchObject({
      score: 14,
      asset: 4,
      budget: 4,
      slack: false,
      path: [0, 4, 8, 10, 12, 14],
    });
    for (const item of rows) {
      expect(item.result.path.slice(0, 3)).toEqual([0, 4, 8]);
      expect(item.result.lost).toBe(false);
      const migrating = item.result.billing.filter((entry) => entry.tool === 'migrating');
      for (const entry of migrating)
        expect(entry).toEqual({ tool: 'migrating', automation: 0, fee: 0 });
      const names = item.result.billing.map((entry) => entry.tool);
      expect(names.includes('old') && names.includes('transferred')).toBe(
        item.strategy === 'migrate',
      );
    }
    expect(row('heavy', 'migrate').result.billing.map((entry) => entry.tool)).toEqual([
      'none',
      'old',
      'old',
      'migrating',
      'transferred',
      'transferred',
    ]);
    expect(row('steady', 'continue').result.score).toBeGreaterThan(
      row('steady', 'shrink').result.score,
    );
    expect(row('heavy', 'migrate').result.score).toBeGreaterThan(
      row('heavy', 'continue').result.score,
    );
    expect(row('light', 'shrink').result.score).toBeGreaterThan(
      row('light', 'migrate').result.score,
    );
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareToolContracts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseToolContractAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeToolContract(live)).toEqual(row.result);
    }
  });
});
