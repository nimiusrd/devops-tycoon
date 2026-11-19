import { describe, expect, it } from 'vitest';
import { InheritedCompanyRun, previewInheritedCompany } from './inheritedCompany';
import { RunEngine } from '../sim/run/engine';
import { MemoryRunStorage, parseRunSave, toRunSave } from '../state/runPersistence';
import { parseRunSaveShare, serializeRunSave } from '../state/runSaveShare';

describe('RI-272 途中会社の引き継ぎ試作', () => {
  it('開始前に残り期間と会社状態、選択の費用、架空の引き継ぎメモを読める', () => {
    const preview = previewInheritedCompany();
    expect(preview.currentState).toMatchObject({
      quarter: { number: 2, completedSprints: 4, totalSprints: 6, remainingSprints: 2 },
      budget: 26,
      org: { techDebt: 32, seniorHp: 68 },
      sprintConfig: { codingSlots: 5, focusMax: 12 },
      activePolicies: {
        reviewAutomation: { reviewEfficiencyMul: 1.2 },
        autonomousCoding: { codingSpeedMul: 1.25, reworkRateAdd: 0.06 },
      },
    });
    expect(preview.fictionalHistory).toContain('納期');
    expect(preview.decisions).toEqual({
      maintain: { budget: 0, firstSprintCodingSlots: 0 },
      remove: { budget: 10, firstSprintCodingSlots: 1 },
    });
    preview.currentState.org.techDebt = 0;
    expect(previewInheritedCompany().currentState.org.techDebt).toBe(32);
  });

  it('同じ状態・seedから進め、撤去費と実装枠の削減を一度だけ適用する', () => {
    const retain = InheritedCompanyRun.start('maintain');
    const retire = InheritedCompanyRun.start('remove');
    expect(retain.snapshot()).toMatchObject({ budget: 26, outcomes: [], rewardsEligible: false });
    expect(retire.snapshot()).toMatchObject({ budget: 16, outcomes: [], rewardsEligible: false });
    for (const run of [retain, retire]) {
      expect(run.advanceSprint()).toBe(true);
      expect(run.advanceSprint()).toBe(true);
      const atDeadline = run.snapshot();
      expect(run.advanceSprint()).toBe(false);
      expect(run.snapshot()).toEqual(atDeadline);
    }

    const [retainFirst, retainSecond] = retain.snapshot().outcomes;
    const [retireFirst, retireSecond] = retire.snapshot().outcomes;
    expect(retainFirst.startOrg).toEqual(previewInheritedCompany().currentState.org);
    expect(retainFirst.startOrg).toEqual(retireFirst.startOrg);
    expect(retainFirst.seed).toBe(retireFirst.seed);
    expect(retainSecond.seed).toBe(retireSecond.seed);
    expect(retireFirst.config.codingSlots).toBe(4);
    expect(retireSecond.config.codingSlots).toBe(retainSecond.config.codingSlots);
    expect(retireFirst.effects).toMatchObject({
      reviewEfficiencyMul: 1.2,
      codingSpeedMul: 1,
      reworkRateAdd: 0,
    });
    expect(retireSecond.effects).toEqual(retireFirst.effects);
    expect(retainFirst.delivered).toBeGreaterThan(retireFirst.delivered);
    expect(retireSecond.rework).toBeLessThan(retainSecond.rework);
    expect(retireSecond.startOrg).toEqual(retireFirst.endOrg);
    expect(retainSecond.startOrg).toEqual(retainFirst.endOrg);
    expect(retire.snapshot().budget).toBe(16);
  });

  it.each(['maintain', 'remove'] as const)('%sのすべての境界から同じ結果を再現する', (decision) => {
    const run = InheritedCompanyRun.start(decision, 'RI-272:2');
    const initial = InheritedCompanyRun.resume(run.checkpoint())!;
    expect(initial.snapshot()).toEqual(run.snapshot());
    run.advanceSprint();
    const halfway = InheritedCompanyRun.resume(run.checkpoint())!;
    expect(halfway.snapshot()).toEqual(run.snapshot());
    run.advanceSprint();
    initial.advanceSprint();
    initial.advanceSprint();
    halfway.advanceSprint();
    expect(initial.snapshot()).toEqual(run.snapshot());
    expect(halfway.snapshot()).toEqual(run.snapshot());
    expect(InheritedCompanyRun.resume(run.checkpoint())?.snapshot()).toEqual(run.snapshot());
  });

  it.each([
    { kind: 'scenario-authoring-checkpoint' },
    { version: 2 },
    { ruleset: 'outdated' },
    { scenarioId: 'other-company' },
    { seed: ' ' },
    { seed: 'a'.repeat(129) },
    { decision: 'unknown' },
    { completedSprints: -1 },
    { completedSprints: 1.5 },
    { completedSprints: 3 },
    { state: { techDebt: 0 } },
  ])('不明・未対応の保存項目を拒否する %o', (change) => {
    const checkpoint = JSON.parse(InheritedCompanyRun.start('maintain').checkpoint());
    expect(InheritedCompanyRun.resume(JSON.stringify({ ...checkpoint, ...change }))).toBeNull();
  });

  it('通常セーブと互いの入口で拒否し、既存の通常セーブを維持する', async () => {
    const engine = new RunEngine();
    engine.startRun('normal', [], 'player-original');
    const original = toRunSave(engine.exportPersistState()!, 1);
    const storage = new MemoryRunStorage();
    await storage.save(original);
    const share = serializeRunSave(original);
    expect(parseRunSaveShare(share).ok).toBe(true);
    expect(InheritedCompanyRun.resume(share)).toBeNull();

    const run = InheritedCompanyRun.start('remove');
    run.advanceSprint();
    const checkpoint = run.checkpoint();
    expect(parseRunSave(JSON.parse(checkpoint))).toBeNull();
    expect(parseRunSaveShare(checkpoint)).toMatchObject({ ok: false });
    const resumed = InheritedCompanyRun.resume(checkpoint)!;
    resumed.advanceSprint();
    expect(await storage.load()).toEqual(original);
  });
});
