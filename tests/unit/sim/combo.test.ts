import { describe, expect, it } from 'vitest';
import {
  COMBO_BONUS_CAP,
  STABILITY_COMBO_CAP,
  STABILITY_COMBO_TAIL_MUL,
  comboMultiplier,
  deliveryComboMultiplier,
} from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import { createSprint, resolveSprintConfig, reviewOne } from '../../../src/sim/sprint';
import type { Task } from '../../../src/sim/types';

const reviewTask = (id: number): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'review',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
});

describe('comboMultiplier（第6.2）', () => {
  it('コンボ 0 で 1.0、段が上がるほど増える', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(5)).toBeGreaterThan(comboMultiplier(0));
    expect(comboMultiplier(10)).toBeGreaterThan(comboMultiplier(5));
  });

  it('上限で頭打ちになる', () => {
    expect(comboMultiplier(1000)).toBeCloseTo(1 + COMBO_BONUS_CAP);
  });

  it('運用安定中は基準段数を揃え、上限超過分だけ上振れを残す', () => {
    const combo = STABILITY_COMBO_CAP + 1;
    const cap = comboMultiplier(STABILITY_COMBO_CAP);
    const raw = comboMultiplier(combo);

    expect(deliveryComboMultiplier(combo, true)).toBeCloseTo(
      cap + (raw - cap) * STABILITY_COMBO_TAIL_MUL,
    );
    expect(deliveryComboMultiplier(combo, false)).toBe(comboMultiplier(combo));
  });
});

describe('コンボが出荷ポイントに倍率として乗る（第6.2 / 第18.2）', () => {
  it('連続 Done が伸びるほど 1 件あたりの出荷が増える', () => {
    // rng が常に 0.99 を返せば incident/rework 判定は必ず外れ、必ず Done になる。
    const rng = () => 0.99;
    const org = createOrgState('default', false);
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    sprint.tasks = Array.from({ length: 5 }, (_, i) => reviewTask(i));

    const deltas: number[] = [];
    let last = 0;
    for (const t of sprint.tasks) {
      reviewOne(t, sprint, org, rng);
      deltas.push(sprint.metrics.delivered - last);
      last = sprint.metrics.delivered;
    }

    expect(sprint.metrics.combo).toBe(5);
    expect(sprint.metrics.maxCombo).toBe(5);
    expect(sprint.tasks.every((t) => t.lane === 'done')).toBe(true);
    // 倍率が伸びるので 1 件あたりの出荷は非減少、かつ最後は最初より大きい。
    for (let i = 1; i < deltas.length; i += 1) {
      expect(deltas[i]).toBeGreaterThanOrEqual(deltas[i - 1]);
    }
    expect(deltas[deltas.length - 1]).toBeGreaterThan(deltas[0]);
  });

  it('手戻りでコンボが途切れる', () => {
    // 1 回目の乱数（incident 判定）は外し、2 回目（rework 判定）に必ず当てる。
    const values = [0.99, 0];
    let i = 0;
    const rng = () => values[Math.min(i++, values.length - 1)];
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    sprint.tasks = [reviewTask(0)];
    sprint.metrics.combo = 4;
    reviewOne(sprint.tasks[0], sprint, org, rng);
    expect(sprint.tasks[0].lane).toBe('rework');
    expect(sprint.metrics.combo).toBe(0);
  });

  it('点火（炎上の始まり）ではコンボは途切れない——延焼/自動鎮火まで悪化したときに途切れる', () => {
    // rng=0 なら incident 判定に必ず当たり、タスクに点火する（第6.3）。
    const rng = () => 0;
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    sprint.tasks = [reviewTask(0)];
    sprint.metrics.combo = 4;
    reviewOne(sprint.tasks[0], sprint, org, rng);
    expect(sprint.tasks[0].incident).toBe(true);
    expect(sprint.metrics.combo).toBe(4);
  });
});
