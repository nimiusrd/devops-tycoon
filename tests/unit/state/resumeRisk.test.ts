import { describe, expect, it } from 'vitest';
import { BUDGET_EXHAUSTED_CAP, TECH_DEBT_CAP } from '../../../src/sim/outcome';
import { createRunEngine } from '../../../src/sim/run/engine';
import { createGame } from '../../../src/game';
import { assessResumeRisk } from '../../../src/state/resumeRisk';
import { MemoryRunStorage, toRunSave } from '../../../src/state/runPersistence';
import { makeOrg, zeroTotals } from '../helpers/runEngineFixtures';

describe('assessResumeRisk', () => {
  it('健全なセーブは警告しない', () => {
    expect(
      assessResumeRisk({
        org: makeOrg({ seniorHp: 80, morale: 70 }),
        totals: zeroTotals(),
        budget: BUDGET_EXHAUSTED_CAP + 30,
      }),
    ).toBeNull();
  });

  it('シニア体力 2% は燃え尽き寸前として確認を求める', () => {
    const risk = assessResumeRisk({
      org: makeOrg({ seniorHp: 2 }),
      totals: zeroTotals(),
      budget: BUDGET_EXHAUSTED_CAP + 30,
    });
    expect(risk).not.toBeNull();
    expect(risk?.requiresConfirm).toBe(true);
    expect(risk?.tone).toBe('danger');
    expect(risk?.seniorHpPct).toBe(2);
    expect(risk?.headline).toBe('燃え尽き寸前のセーブです');
    expect(risk?.body).toContain('シニア体力は 2%');
    expect(risk?.body).toContain('燃え尽き寸前');
    expect(risk?.body).toContain('継続不能');
    expect(risk?.flags.some((flag) => flag.chip === '燃え尽き危険')).toBe(true);
  });

  it('シニア体力 40% は注意表示だけで確認は求めない', () => {
    const risk = assessResumeRisk({
      org: makeOrg({ seniorHp: 40 }),
      totals: zeroTotals(),
      budget: BUDGET_EXHAUSTED_CAP + 30,
    });
    expect(risk?.requiresConfirm).toBe(false);
    expect(risk?.tone).toBe('watch');
    expect(risk?.headline).toBe('体力に注意が必要なセーブです');
    expect(risk?.flags.some((flag) => flag.chip === '体力注意')).toBe(true);
  });

  it('シニア体力が敗北閾値以下なら再開でゲームオーバーになると示す', () => {
    const risk = assessResumeRisk({
      org: makeOrg({ seniorHp: 1 }),
      totals: zeroTotals(),
      budget: BUDGET_EXHAUSTED_CAP + 30,
    });
    expect(risk?.requiresConfirm).toBe(true);
    expect(risk?.headline).toBe('再開するとゲームオーバーになります');
    expect(risk?.body).toContain('ゲームオーバー');
    expect(risk?.flags.some((flag) => flag.chip === '継続不能')).toBe(true);
  });

  it('技術的負債の継続不能も確認対象にする', () => {
    const risk = assessResumeRisk({
      org: makeOrg({ seniorHp: 80, techDebt: TECH_DEBT_CAP }),
      totals: zeroTotals(),
      budget: BUDGET_EXHAUSTED_CAP + 30,
    });
    expect(risk?.requiresConfirm).toBe(true);
    expect(risk?.headline).toBe('再開するとゲームオーバーになります');
    expect(risk?.body).toContain('技術的負債');
  });
});

describe('GameHandle の再開リスク', () => {
  it('シニア体力 2% のセーブは警告を返し、再開だけでは敗北しない', () => {
    const engine = createRunEngine({ seed: 'ri374-resume' });
    engine.startRun('easy', [], 'ri374-resume');
    const persist = engine.exportPersistState();
    if (!persist) throw new Error('persist missing');
    persist.org.seniorHp = 2;
    const save = toRunSave(persist);
    const game = createGame({
      seed: 'fresh',
      runStorage: new MemoryRunStorage(),
      initialRunSave: save,
      metaReady: true,
    });

    const risk = game.getResumeRisk();
    expect(risk?.requiresConfirm).toBe(true);
    expect(risk?.seniorHpPct).toBe(2);

    const resumed = game.resumeRun();
    expect(resumed?.phase).toBe('setup');
    expect(resumed?.status).toBe('playing');
    expect(resumed?.org.seniorHp).toBe(2);
    expect(game.phase()).not.toBe('lost');
  });
});
