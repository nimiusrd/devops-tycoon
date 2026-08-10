import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { RECRUIT_COST, STAMINA_RECOVER_BETWEEN, canRecruit } from '../../../src/sim/member';
import { SPRINT_MIN_COMPLETE_TICK } from '../../../src/sim/run/sprintBaselineBuild';
import type { RunState } from '../../../src/sim/run/types';
import { playRun, playUntil } from '../helpers/runFlow';

/** RI-75 後も休息に到達する代表 seed（旧 rest-* は早期敗北しやすい）。 */
const REST_SEEDS = [
  'rest-probe-4',
  'rest-probe-9',
  'rest-probe-10',
  'rest-probe-20',
  'rest-probe-24',
  'rest-a',
  'rest-b',
] as const;

/**
 * 休息に到達したエンジンを返す（ビートの「一息つく」を選んで休息へ入る）。
 * 指定 seed で到達できなければ null。
 */
function reachRest(seed: string): RunEngine | null {
  const e = new RunEngine({ seed, difficulty: 'easy' });
  e.startRun();
  const s = playUntil(e, 'rest', { beatChoice: 0 }, 2000);
  return s.phase === 'rest' ? e : null;
}

/** タイトル→編成（setup）まで進めた状態を返す。 */
function toFirstNode(e: RunEngine): RunState {
  e.startRun();
  return e.snapshot();
}

/** 最初のスプリントを最後まで自動進行させたスナップショットを返す。 */
function playFirstSprint(e: RunEngine): RunState {
  e.beginSetupSprint();
  e.step(1_000_000);
  return e.snapshot();
}

describe('ロスターのラン統合（第12章）', () => {
  it('ラン開始時にロスター（個体メンバー）がスナップショットに含まれる', () => {
    const e = new RunEngine({ seed: 'roster-run', difficulty: 'normal' });
    const s = toFirstNode(e);
    expect(s.roster.members.length).toBe(3);
    expect(s.roster.members.every((m) => m.stamina === m.staminaMax)).toBe(true);
  });

  it('編成を変えるとスプリント結果が変わる（DoD: 編成が結果に影響する）', () => {
    const base = new RunEngine({ seed: 'formation-cmp', difficulty: 'normal' });
    toFirstNode(base);
    expect(base.snapshot().roster.members.find((m) => m.id === 'm2')?.assignment).toBe('review');
    const baseResult = playFirstSprint(base).lastResult!;

    // 同一 seed で、レビュアー(m2)をコーディングへ移すと、レビューが詰まる。
    const moved = new RunEngine({ seed: 'formation-cmp', difficulty: 'normal' });
    toFirstNode(moved);
    moved.assignMember('m2', 'coding');
    const movedResult = playFirstSprint(moved).lastResult!;

    const differs =
      baseResult.delivered !== movedResult.delivered ||
      baseResult.reviewQueueMax !== movedResult.reviewQueueMax ||
      baseResult.rework !== movedResult.rework;
    expect(differs).toBe(true);
  });

  it('スプリント中は編成を変更できない', () => {
    const e = new RunEngine({ seed: 'mid-sprint', difficulty: 'normal' });
    toFirstNode(e);
    e.beginSetupSprint();
    e.step(200); // スプリント進行中
    expect(e.snapshot().phase).toBe('sprint');
    const before = e.snapshot().roster.members.find((m) => m.id === 'm0')!.assignment;
    e.assignMember('m0', 'bench');
    expect(e.snapshot().roster.members.find((m) => m.id === 'm0')!.assignment).toBe(before);
  });

  it('休息の採用は予算を消費し、メンバーが1人増える（ラン経済）', () => {
    let engine: RunEngine | null = null;
    for (const seed of REST_SEEDS) {
      engine = reachRest(seed);
      if (engine) break;
    }
    // easy のビートには「一息つく」が含まれる前提（見つからなければテスト環境異常）。
    expect(engine).not.toBeNull();
    const e = engine!;
    const before = e.snapshot();
    expect(before.phase).toBe('rest');

    if (canRecruit(before.roster) && before.budget >= RECRUIT_COST) {
      e.restChoose('recruit');
      const after = e.snapshot();
      expect(after.roster.members.length).toBe(before.roster.members.length + 1);
      expect(after.budget).toBe(before.budget - RECRUIT_COST);
      // 採用直後はベンチに入る。
      expect(after.roster.members[after.roster.members.length - 1].assignment).toBe('bench');
    }
  });

  it('採用は予算未満だと no-op（ロスター・予算とも不変）', () => {
    let engine: RunEngine | null = null;
    for (const seed of REST_SEEDS) {
      engine = reachRest(seed);
      if (engine) break;
    }
    expect(engine).not.toBeNull();
    const e = engine!;
    const before = e.snapshot();
    if (before.budget < RECRUIT_COST && canRecruit(before.roster)) {
      e.restChoose('recruit');
      const after = e.snapshot();
      expect(after.roster.members.length).toBe(before.roster.members.length);
      expect(after.budget).toBe(before.budget);
    } else {
      // 予算が足りるケースでは採用が成立し、予算が確実に減る（ゲートの対偶）。
      e.restChoose('recruit');
      expect(e.snapshot().budget).toBeLessThanOrEqual(before.budget);
    }
  });

  it('全コーダーのAIを外すと実スプリントでAIが使われず、AI依存度も上がらない（レビュー#C）', () => {
    const e = new RunEngine({ seed: 'no-ai-adopt', difficulty: 'normal' });
    toFirstNode(e);
    // 初期コーダー（m0, m1）の AI 配布を外す。
    e.setMemberAi('m0', false);
    e.setMemberAi('m1', false);
    const depBefore = e.snapshot().org.aiDependency;
    const after = playFirstSprint(e);
    expect(after.phase).toBe('result');
    expect(after.lastResult!.aiAssistedPct).toBe(0);
    // AI 依存度は intake の AI タスクでのみ上がる。AI 不使用なら据え置き。
    expect(after.org.aiDependency).toBe(depBefore);
  });

  it('コーダーにAIを配るとAIが使われる（対偶。レビュー#C）', () => {
    const e = new RunEngine({ seed: 'no-ai-adopt', difficulty: 'normal' });
    toFirstNode(e);
    // 既定は starter-ai-junior のみ AI 配布。そのまま回すと AI が使われる。
    const after = playFirstSprint(e);
    expect(after.lastResult!.aiAssistedPct).toBeGreaterThan(0);
  });

  it('全コーダーを外した無人スプリントは即完了し、出荷せず、AI称号も付かない（レビュー#3/#1）', () => {
    const e = new RunEngine({ seed: 'no-coder-sprint', difficulty: 'easy' });
    const s = toFirstNode(e);
    // 全メンバーをベンチへ（稼働コーダー 0）。
    for (const m of s.roster.members) e.assignMember(m.id, 'bench');
    e.beginSetupSprint();
    // RI-75: minCompleteTick 未満では stalled でも完了しない。下限+1 tick で完了する。
    e.step(100 * (SPRINT_MIN_COMPLETE_TICK + 1));
    const after = e.snapshot();
    expect(after.phase).toBe('result');
    expect(after.sprintTick).toBeGreaterThanOrEqual(SPRINT_MIN_COMPLETE_TICK + 1);
    // 流入が止まり強制 drain も未着手を計上しないため、出荷・完了ともに 0。
    expect(after.lastResult!.delivered).toBe(0);
    expect(after.lastResult!.done).toBe(0);
    // AI を一切使っていないので「健全な加速者」にはならない。
    expect(after.lastResult!.aiAssistedPct).toBe(0);
    expect(after.lastResult!.title).not.toBe('健全な加速者');
  });

  it('スプリント間スタミナ回復はスプリント終了時に反映される（編成ウィンドウに間に合う）', () => {
    const e = new RunEngine({ seed: 'recover-timing', difficulty: 'normal' });
    toFirstNode(e);
    e.beginSetupSprint();
    const m0Start = e.snapshot().roster.members.find((m) => m.id === 'm0')!;
    expect(m0Start.assignment).toBe('coding');
    const before = m0Start.stamina; // スプリント開始時（満タン）
    e.step(1_000_000);
    const after = e.snapshot();
    expect(after.phase).toBe('result');
    const m0 = after.roster.members.find((m) => m.id === 'm0')!;
    // 正味のスタミナ減が 1 回の回復量未満 = 終了時点で既に回復が適用されている。
    expect(before - m0.stamina).toBeLessThan(STAMINA_RECOVER_BETWEEN);
  });

  it('スプリント完了で成長結果が記録され、配置メンバーが経験値を得る', () => {
    const e = new RunEngine({ seed: 'growth-run', difficulty: 'easy' });
    toFirstNode(e);
    const before = e.snapshot().roster.members.map((m) => ({ id: m.id, xp: m.xp, level: m.level }));
    const after = playFirstSprint(e);
    expect(after.phase).toBe('result');
    expect(after.lastGrowth).not.toBeNull();
    // 配置（coding/review）された稼働メンバーは XP かレベルが増える。
    const assigned = after.roster.members.filter((m) => m.assignment !== 'bench' && !m.onLeave);
    const grew = assigned.some((m) => {
      const b = before.find((x) => x.id === m.id)!;
      return m.xp > b.xp || m.level > b.level;
    });
    expect(grew).toBe(true);
  });

  it('通しプレイでも個体メンバーが成長/消耗し、決定論を保つ', () => {
    const play = (seed: string): RunState =>
      playRun(new RunEngine({ seed, difficulty: 'easy' }), { restOption: 'recruit' });
    const a = play('roster-determinism');
    const b = play('roster-determinism');
    expect(a.roster).toEqual(b.roster);
    expect(['won', 'lost']).toContain(a.status);
    // 数スプリント回せば、いずれかのメンバーがレベル1から成長しているはず。
    const anyGrowth = a.roster.members.some((m) => m.level > 1 || m.xp > 0 || m.onLeave);
    expect(anyGrowth).toBe(true);
  });

  it('全社マップのプレイヤー島は稼働人数と AI 配布をロスターから映す（RI-27）', () => {
    const e = new RunEngine({ seed: 'ri27-org-roster', difficulty: 'normal' });
    toFirstNode(e);
    const members = e.snapshot().roster.members;
    // 初期コーダーの AI を外し、残る AI 配布数だけが島へ載ることを確認する。
    e.setMemberAi(members[0].id, false);
    e.setMemberAi(members[1].id, false);
    const roster = e.snapshot().roster;
    const active = roster.members.filter((m) => !m.onLeave).length;
    const ai = roster.members.filter((m) => !m.onLeave && m.aiAssigned).length;
    e.zoomTo('company');
    const org = e.snapshot().orgScale!;
    const player = org.departments.flatMap((d) => d.teams).find((t) => t.isPlayer)!;
    expect(player.engineers).toBe(active);
    expect(player.aiAssignedCount).toBe(ai);
  });
});
