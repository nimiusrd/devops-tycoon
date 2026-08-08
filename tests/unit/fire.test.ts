import { describe, expect, it } from 'vitest';
import { applyAction, mostUrgentIncident } from '../../src/sim/actions';
import {
  BURN_TICKS,
  DEBT_PER_SPREAD,
  IDENTITY_CARD_EFFECTS,
  INCIDENT_CONTAIN_HP,
  INCIDENT_HP_COST,
} from '../../src/sim/model';
import { createOrgState } from '../../src/sim/org';
import { reviewOne, stepSprint } from '../../src/sim/sprint';
import { burningTask, makeSprint, makeTask } from './helpers/sprintFixtures';

describe('炎上タイマー: 点火（第6.3）', () => {
  it('Review 落ちの障害は即決着せず、タイマー付きで点火する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    // rng=0 で incident 判定に必ず当てる。
    reviewOne(sprint.tasks[0], sprint, org, () => 0);
    const t = sprint.tasks[0];
    expect(t.incident).toBe(true);
    expect(t.lane).toBe('rework');
    expect(t.burnTicksLeft).toBe(BURN_TICKS);
    expect(sprint.metrics.incidentCount).toBe(1);
    // 点火の時点では鎮火/延焼は未決着。
    expect(sprint.metrics.contained).toBe(0);
    expect(sprint.metrics.spread).toBe(0);
  });

  it('燃えている間は Rework が進まない（火が消えるまで手が付けられない）', () => {
    const org = createOrgState('default', false);
    org.seniorHp = 80;
    const sprint = makeSprint(org, [burningTask(0, 10)]);
    stepSprint(sprint, org, () => 0.99, 0);
    expect(sprint.tasks[0].progress).toBe(0);
    expect(sprint.tasks[0].burnTicksLeft).toBe(9);
  });
});

describe('炎上タイマー: 緊急対応による鎮火（第6.3）', () => {
  it('タイマー内の緊急対応は安く鎮火でき、コンボも守られる', () => {
    const org = createOrgState('default', true);
    org.seniorHp = 60;
    const sprint = makeSprint(org, [burningTask(0)]);
    sprint.metrics.combo = 6;
    const outcome = applyAction('firefight', sprint, org, () => 0.99, 0);
    expect(outcome.ok).toBe(true);
    expect(outcome.effect?.containedTaskId).toBe(0);
    const t = sprint.tasks[0];
    expect(t.incident).toBe(false);
    expect(t.burnTicksLeft).toBeUndefined();
    expect(t.lane).toBe('review');
    expect(sprint.metrics.contained).toBe(1);
    expect(sprint.metrics.combo).toBe(6);
    // 自動鎮火（INCIDENT_HP_COST）より大幅に安い。
    expect(60 - org.seniorHp).toBeLessThan(INCIDENT_HP_COST);
  });

  it('緊急対応は最も延焼が近い火から消す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0, 20), burningTask(1, 5)]);
    expect(mostUrgentIncident(sprint)?.id).toBe(1);
    applyAction('firefight', sprint, org, () => 0.99, 0);
    expect(sprint.tasks[1].incident).toBe(false);
    expect(sprint.tasks[0].incident).toBe(true);
  });
});

describe('炎上タイマー: 時間切れの解決（第6.3）', () => {
  it('シニアに余力があれば自動鎮火するが、高くつきコンボも途切れる', () => {
    const org = createOrgState('default', true);
    org.seniorHp = 80;
    const sprint = makeSprint(org, [burningTask(0, 1)]);
    sprint.metrics.combo = 6;
    stepSprint(sprint, org, () => 0.99, 0);
    const t = sprint.tasks[0];
    expect(t.incident).toBe(false);
    expect(t.burnTicksLeft).toBeUndefined();
    expect(sprint.metrics.contained).toBe(1);
    expect(sprint.metrics.spread).toBe(0);
    expect(sprint.metrics.combo).toBe(0);
    expect(org.seniorHp).toBeLessThanOrEqual(80 - INCIDENT_HP_COST + 1);
  });

  it('シニアに余力がなければ延焼し、Review 待ちの隣の PR へ燃え移る（延焼の連鎖）', () => {
    const org = createOrgState('default', true);
    org.seniorHp = INCIDENT_CONTAIN_HP - 2;
    const debt0 = org.techDebt;
    const morale0 = org.morale;
    const neighbor = makeTask(1);
    const sprint = makeSprint(org, [burningTask(0, 1), neighbor]);
    stepSprint(sprint, org, () => 0.99, 0);
    expect(sprint.metrics.spread).toBe(1);
    expect(sprint.tasks[0].debt).toBe(true);
    expect(org.techDebt).toBe(debt0 + DEBT_PER_SPREAD);
    expect(org.morale).toBeLessThan(morale0);
    // 連鎖着火: 隣の PR が新たな障害として燃え始める。
    expect(neighbor.incident).toBe(true);
    expect(neighbor.lane).toBe('rework');
    expect(neighbor.burnTicksLeft).toBe(BURN_TICKS);
    expect(sprint.metrics.incidentCount).toBe(1);
  });

  it('RI-73: seniorHpCostMul 時は割引後コスト以上なら自動鎮火できる', () => {
    const org = createOrgState('default', true);
    // 既定閾値 12 未満だが、mul=0.5 ならコスト 6 なので鎮火できる帯。
    org.seniorHp = 10;
    const sprint = makeSprint(org, [burningTask(0, 1)]);
    sprint.cardEffects = { ...IDENTITY_CARD_EFFECTS, seniorHpCostMul: 0.5 };
    stepSprint(sprint, org, () => 0.99, 0);
    expect(sprint.metrics.contained).toBe(1);
    expect(sprint.metrics.spread).toBe(0);
    const contain = sprint.events.find((e) => e.kind === 'auto-contain');
    expect(contain && 'hpCost' in contain ? contain.hpCost : undefined).toBeCloseTo(
      INCIDENT_HP_COST * 0.5,
      5,
    );
  });
});

describe('介入内訳の集計（第4.6 / RI-29）', () => {
  it('発動したアクションが種類別にカウントされる', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0)]);
    applyAction('firefight', sprint, org, () => 0.99, 0);
    applyAction('andon', sprint, org, () => 0.99, 0);
    expect(sprint.metrics.actionCounts.firefight).toBe(1);
    expect(sprint.metrics.actionCounts.andon).toBe(1);
  });
});
