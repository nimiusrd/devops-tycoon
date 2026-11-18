import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/boss-gauntlet-comparison.json';
import { BOSS_DEFS } from '../data/bosses';
import { evaluateBoss } from '../sim/outcome';
import { summarizeSprint } from '../sim/sprint';
import {
  GAUNTLET_RULES,
  applyGauntletInput as apply,
  createBossGauntlet as create,
  gauntletPreset,
  restoreBossGauntlet as restore,
  runGauntletPolicy as run,
  saveBossGauntlet as save,
  summarizeGauntlet,
  validateGauntletImport,
  type GauntletState,
} from './bossGauntlet';

const start = () => create(gauntletPreset('resilient'), 'RI-267:1');
function firstBattle(state = start()): GauntletState {
  while (state.phase === 'battle') state = apply(state, 'tick');
  return state;
}
const policy = { reserve: 'second', recovery: 'recover' } as const;

describe('RI-267 固定ビルドの実simボス連戦', () => {
  it('持込みは全項目一致した独立の固定2ビルドだけを受け付ける', () => {
    for (const build of ['speed', 'resilient'] as const) {
      const preset = gauntletPreset(build);
      expect(validateGauntletImport(JSON.parse(JSON.stringify(preset)))).toBe(true);
      expect(validateGauntletImport({ ...preset, org: { ...preset.org, seniorHp: 100 } })).toBe(
        false,
      );
      expect(
        validateGauntletImport({ ...preset, policies: [...preset.policies, preset.policies[0]] }),
      ).toBe(false);
      expect(validateGauntletImport({ ...preset, budgetCents: Infinity })).toBe(false);
      expect(validateGauntletImport({ ...preset, reserveUses: 2 })).toBe(false);
      expect(validateGauntletImport({ ...preset, quarterNumber: 1 })).toBe(false);
    }
    for (const value of [null, {}, { org: gauntletPreset('speed').org }, { build: 'normal' }])
      expect(() => create(value, 'seed')).toThrow();
    const preset = gauntletPreset('speed');
    const state = create(preset, 'seed');
    preset.org.techDebt = 100;
    expect(state.org.techDebt).toBe(22);
  });

  it('係数・seedの非有限、端数、範囲外や余計なキーを拒否する', () => {
    for (const rules of [
      { ...GAUNTLET_RULES, taskCount: 0 },
      { ...GAUNTLET_RULES, maxTicks: NaN },
      { ...GAUNTLET_RULES, recoveryHp: 101 },
      { ...GAUNTLET_RULES, tickCostCents: -1 },
      { ...GAUNTLET_RULES, recoveryCostCents: 1.5 },
      { ...GAUNTLET_RULES, reward: 1 },
    ])
      expect(() => create(gauntletPreset('speed'), 'seed', rules)).toThrow();
    expect(() => create(gauntletPreset('speed'), '')).toThrow();
  });

  it('実simを進め、既存ボス判定・実出荷・乱数消費を使う', () => {
    const initial = start();
    const ticked = apply(initial, 'tick');
    expect(ticked.rngState).not.toBe(initial.rngState);
    expect(ticked.sprint.tasks).not.toEqual(initial.sprint.tasks);
    const first = firstBattle(initial);
    const result = summarizeSprint(first.sprint, first.org);
    expect(first.battles[0].delivered).toBe(result.delivered);
    expect(first.battles[0].cleared).toBe(
      evaluateBoss({
        boss: BOSS_DEFS.find((boss) => boss.id === 'big-release')!,
        result,
        org: first.org,
        bossTargetMul: 1,
      }),
    );
    expect(first.battles[0].done).toBe(36);
    expect(initial.inputs).toEqual([]);
    expect(initial.org).toEqual(gauntletPreset('resilient').org);
  });

  it('戦間回復を一度だけ課金・適用し、負債・消耗・切り札を持ち越す', () => {
    const first = firstBattle(apply(start(), 'reserve'));
    expect(first.phase).toBe('between');
    const next = apply(first, 'recover');
    expect(next.stage).toBe(1);
    expect(next.org).toEqual({ ...first.org, seniorHp: Math.min(100, first.org.seniorHp + 20) });
    expect(next.battleStartBudgetCents).toBe(first.budgetCents - 800);
    expect(next.budgetCents).toBeLessThan(next.battleStartBudgetCents);
    expect(next.reserveUsed).toBe(true);
    expect(next.recoveryUsed).toBe(true);
    expect(next.recoveryCostCents).toBe(800);
    for (const input of ['recover', 'skip', 'reserve'] as const)
      expect(apply(next, input)).toBe(next);
    expect(next.tick).toBe(0);
    expect(next.sprint.focus).toBe(8);
    expect(next.sprint.cooldowns).toEqual({});
    expect(next.sprint.modifiers.overtimeUntilTick).toBe(0);
    expect(next.sprint.metrics.delivered).toBe(0);
    expect(next.sprint.metrics.seniorHpStart).toBe(next.org.seniorHp);
    expect(next.sprint.tasks.every((task) => task.lane === 'backlog')).toBe(true);
    expect(next.sprint.cardPiles.played).toEqual([]);
    expect(first.stage).toBe(0);
  });

  it('回復を見送ると自然な戦間回復・負債返済・基準効果の再加算をしない', () => {
    const first = firstBattle();
    const next = apply(first, 'skip');
    expect(next.org).toEqual(first.org);
    expect(next.recoveryUsed).toBe(false);
    expect(next.battleStartBudgetCents).toBe(first.budgetCents);
    expect(next.org.quality).toBe(gauntletPreset('resilient').org.quality);
  });

  it('回復予算が足りないと変化せず、回復量はHP上限で止める', () => {
    const unaffordable = firstBattle(
      create(gauntletPreset('resilient'), 'RI-267:1', {
        ...GAUNTLET_RULES,
        recoveryCostCents: 6000,
      }),
    );
    expect(unaffordable.phase).toBe('between');
    expect(apply(unaffordable, 'recover')).toBe(unaffordable);
    expect(apply(unaffordable, 'skip').stage).toBe(1);
    const heal = firstBattle(
      create(gauntletPreset('resilient'), 'RI-267:1', {
        ...GAUNTLET_RULES,
        recoveryHp: 100,
      }),
    );
    const recovered = apply(heal, 'recover');
    expect(recovered.org.seniorHp).toBe(100);
    expect(restore(save(recovered))).toEqual(recovered);
  });

  it('無効な対象やフェーズでは費用・入力ログ・RNGを変えない', () => {
    const initial = start();
    for (const input of ['recover', 'skip', 'firefight', 'interruptReview'] as const)
      expect(apply(initial, input)).toBe(initial);
    const first = firstBattle();
    for (const input of ['tick', 'reserve', 'firefight'] as const)
      expect(apply(first, input)).toBe(first);
    const used = apply(initial, 'reserve');
    expect(used.reserveUsed).toBe(true);
    expect(apply(used, 'reserve')).toBe(used);
  });

  it('時間切れ・資金枯渇・ボス条件失敗のあとに進行・回復できない', () => {
    const timeout = firstBattle(
      create(gauntletPreset('speed'), 'seed', { ...GAUNTLET_RULES, maxTicks: 1 }),
    );
    expect(timeout.phase).toBe('lost');
    expect(timeout.battles[0].reason).toBe('timedOut');
    const bankrupt = firstBattle(
      create(gauntletPreset('resilient'), 'seed', { ...GAUNTLET_RULES, tickCostCents: 1000 }),
    );
    expect(bankrupt.phase).toBe('lost');
    expect(bankrupt.battles[0].reason).toBe('budgetExhausted');
    expect(bankrupt.tick).toBeLessThan(36);
    const failed = firstBattle(
      create(gauntletPreset('speed'), 'seed', { ...GAUNTLET_RULES, taskCount: 1 }),
    );
    expect(failed.battles[0].reason).toBe('bossFailed');
    for (const state of [timeout, bankrupt, failed]) {
      for (const input of ['tick', 'recover', 'skip', 'reserve'] as const)
        expect(apply(state, input)).toBe(state);
      expect(restore(save(state))).toEqual(state);
      expect(state.battles).toHaveLength(1);
    }
  });

  it('進行中・戦間・回復直後・決着のJSON保存再開がRNGを含め一致する', () => {
    const first = firstBattle();
    const checkpoints = [
      start(),
      apply(apply(start(), 'tick'), 'tick'),
      first,
      apply(first, 'recover'),
      run(start(), policy),
    ];
    for (const checkpoint of checkpoints) {
      const resumed = restore(save(checkpoint));
      expect(resumed).toEqual(checkpoint);
      expect(run(resumed!, policy)).toEqual(run(checkpoint, policy));
    }
    expect(run(start(), policy)).toEqual(run(start(), policy));
  });

  it('通常セーブ・別ruleset・不正な回復/費用/RNG/入力/報酬の保存を拒否する', () => {
    const state = apply(firstBattle(), 'recover');
    for (const change of [
      { mode: 'normal' },
      { version: 2 },
      { ruleset: 'future' },
      { rngState: state.rngState + 1 },
      { org: { ...state.org, seniorHp: 100 } },
      { recoveryUsed: false },
      { budgetCents: 6000 },
      { stage: 0 },
      { inputs: [...state.inputs, 'recover'] },
      { inputs: ['unknown'] },
      { rewardEligible: true },
      { rules: { ...state.rules, taskCount: 1 } },
    ])
      expect(restore(JSON.stringify({ ...state, ...change }))).toBeNull();
    for (const json of ['null', '{}', 'bad json']) expect(restore(json)).toBeNull();
  });

  it('比較記録の入力列から、両ビルドの成果と費用を再現できる', () => {
    for (const build of ['speed', 'resilient'] as const) {
      const row = comparison.results.find(
        (row) => row[0] === 'baseline' && row[1] === 'RI-267:1' && row[2] === build && row[3] === 3,
      )!;
      let state = create(gauntletPreset(build), 'RI-267:1');
      for (const input of String(row[10]).split(' ')) {
        const next = apply(state, input as Parameters<typeof apply>[1]);
        expect(next).not.toBe(state);
        state = next;
      }
      const summary = summarizeGauntlet(state);
      expect([
        summary.phase,
        summary.totalCostCents,
        summary.recoveryCostCents,
        summary.budgetCents,
        summary.reserveUsed,
        summary.recoveryUsed,
      ]).toEqual(row.slice(4, 10));
      const battles = row[11] as unknown as unknown[][];
      expect(
        state.battles.map((battle) => [
          battle.boss,
          battle.cleared,
          battle.reason,
          battle.ticks,
          battle.delivered,
          battle.done,
          battle.rework,
          battle.incidents,
          battle.spread,
          battle.focusSpent,
          battle.focusRemaining,
          battle.costCents,
          Object.values(battle.before),
          Object.values(battle.after),
        ]),
      ).toEqual(battles);
    }
  });

  it('各戦の実費+回復費が総費用と一致し、決着の再適用でも通常報酬はゼロ', () => {
    const final = run(start(), policy);
    const summary = summarizeGauntlet(final);
    expect(final.battles).toHaveLength(2);
    expect(summary.totalCostCents).toBe(
      final.battles.reduce((cost, battle) => cost + battle.costCents, 0) +
        summary.recoveryCostCents,
    );
    expect(summary).toMatchObject({ rewardEligible: false, metaReward: 0, dailyReward: 0 });
    expect(apply(final, 'tick')).toBe(final);
    expect(summarizeGauntlet(restore(save(final))!)).toEqual(summary);
    expect(final.sprint.metrics.delivered).toBe(final.battles[1].delivered);
    expect(final.org.deliveryScore).toBeCloseTo(
      final.battles.reduce((sum, battle) => sum + battle.delivered, 0),
    );
  });
});
