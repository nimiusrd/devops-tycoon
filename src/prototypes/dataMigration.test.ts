import { describe, expect, it } from 'vitest';
import {
  applyDataMigration as apply,
  chooseDataMigrationAction,
  compareDataMigration,
  createDataMigration as create,
  summarizeDataMigration,
  viewDataMigration,
} from './dataMigration';
import comparison from '../../docs/prototypes/data-migration-comparison.json';

describe('RI-256 データ移行', () => {
  it('二重費用と未検証リスクを先に示し、選択だけでは切り替えない', () => {
    const first = create('RI-256', 'trusted');
    expect(create('RI-256', 'trusted')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewDataMigration(first);
    for (let i = 0; i < 8; i++) expect(viewDataMigration(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(apply(first, { type: 'repair' })).toBe(first);
    expect(blank).toMatchObject({
      total: 4,
      slots: 2,
      dualRate: 6,
      riskRate: 1,
      rosterChanged: false,
      existingBossWeights: 'unchanged',
      achievementCompat: 'unseen-until-new-ruleset',
      choices: ['early', 'prepare'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score, item.risk])).toEqual([
      ['early', 4, 4],
      ['prepare', -4, 0],
    ]);
    const chosen = apply(first, { type: 'early' });
    expect(chosen).toMatchObject({ strategy: 'early', switched: false, postProcess: 0 });
    expect(apply(chosen, { type: 'prepare' })).toBe(chosen);
    expect(viewDataMigration(chosen).choices).toEqual([]);
    expect(
      viewDataMigration(create('RI-256', 'sensitive')).forecasts.map((item) => item.score),
    ).toEqual([-16, 12]);
  });

  it('リスクが小さい盤面は早期切替、リスクが大きい盤面は検証延長が上回る', () => {
    const rows = compareDataMigration(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('trusted', 'early').result).toMatchObject({
      score: 4,
      ship: 20,
      dualSpent: 12,
      risk: 4,
      verified: 0,
      postProcess: 1,
      appliedId: 'migrated-batch',
      lost: false,
    });
    expect(row('trusted', 'prepare').result).toMatchObject({
      score: -4,
      dualSpent: 24,
      risk: 0,
      verified: 4,
      postProcess: 1,
    });
    expect(row('sensitive', 'prepare').result).toMatchObject({
      score: 12,
      dualSpent: 8,
      risk: 0,
      verified: 4,
    });
    expect(row('sensitive', 'early').result).toMatchObject({
      score: -16,
      dualSpent: 4,
      risk: 32,
      verified: 0,
    });
    expect(row('trusted', 'early').result.score).toBeGreaterThan(
      row('trusted', 'prepare').result.score,
    );
    expect(row('sensitive', 'prepare').result.score).toBeGreaterThan(
      row('sensitive', 'early').result.score,
    );
    for (const item of rows) {
      expect(item.result.lost).toBe(false);
      expect(item.result.rosterChanged).toBe(false);
      expect(item.result.postProcess).toBe(1);
      expect(item.result.switched).toBe(true);
    }
  });

  it('未移行分は確認できず、切替後の修復は後処理を重ねない', () => {
    const fresh = create('RI-256', 'trusted');
    expect(apply(fresh, { type: 'assign', migrate: 2, verify: 1 })).toBe(fresh);
    expect(apply(fresh, { type: 'assign', migrate: 0, verify: 2 })).toBe(fresh);
    const started = apply(fresh, { type: 'prepare' });
    const stalled = apply(started, { type: 'assign', migrate: 0, verify: 2 });
    expect(stalled).toMatchObject({
      migrated: 0,
      verified: 0,
      postProcess: 0,
      switched: false,
      dualSpent: 6,
    });
    const moved = apply(started, { type: 'assign', migrate: 1, verify: 0 });
    const capped = apply(moved, { type: 'assign', migrate: 0, verify: 2 });
    expect(capped).toMatchObject({
      migrated: 1,
      verified: 1,
      postProcess: 0,
      switched: false,
      dualSpent: 12,
    });
    let assigned = apply(fresh, { type: 'early' });
    assigned = apply(assigned, { type: 'assign', migrate: 2, verify: 0 });
    assigned = apply(assigned, { type: 'assign', migrate: 2, verify: 0 });
    expect(assigned).toMatchObject({
      switched: true,
      postProcess: 1,
      migrated: 4,
      verified: 0,
      dualSpent: 12,
      risk: 4,
      appliedId: 'migrated-batch',
    });
    expect(apply(assigned, { type: 'assign', migrate: 2, verify: 0 })).toBe(assigned);
    let prepared = apply(fresh, { type: 'prepare' });
    for (let i = 0; i < 4; i++)
      prepared = apply(prepared, { type: 'assign', migrate: 1, verify: 1 });
    expect(prepared).toMatchObject({
      switched: true,
      verified: 4,
      dualSpent: 24,
      ship: 20,
      postProcess: 1,
    });

    let early = apply(apply(fresh, { type: 'early' }), { type: 'work' });
    early = apply(early, { type: 'work' });
    expect(early).toMatchObject({
      switched: true,
      postProcess: 1,
      verified: 0,
      risk: 4,
      dualSpent: 12,
      appliedId: 'migrated-batch',
    });
    const repaired = apply(early, { type: 'repair' });
    expect(repaired).toMatchObject({
      verified: 1,
      postProcess: 1,
      risk: 4,
      dualSpent: 12,
      appliedId: 'migrated-batch',
    });
    let cursor = repaired;
    for (let i = 0; i < 3; i++) cursor = apply(cursor, { type: 'repair' });
    expect(cursor.verified).toBe(4);
    expect(cursor.postProcess).toBe(1);
    expect(apply(cursor, { type: 'repair' })).toBe(cursor);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareDataMigration(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseDataMigrationAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(live.verified).toBeLessThanOrEqual(live.migrated);
        expect(live.postProcess).toBeLessThanOrEqual(1);
      }
      expect(summarizeDataMigration(live)).toEqual(row.result);
    }
  });
});
