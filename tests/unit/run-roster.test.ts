import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import type { RunState } from '../../src/sim/run/types';

/** タイトル→マップまで進め、最初のスプリントノードへ入る直前の状態を返す。 */
function toFirstNode(e: RunEngine): RunState {
  e.startRun();
  return e.snapshot();
}

/** 最初のスプリントを最後まで自動進行させたスナップショットを返す。 */
function playFirstSprint(e: RunEngine, nodeId: string): RunState {
  e.enterNode(nodeId);
  e.step(1_000_000);
  return e.snapshot();
}

describe('ロスターのラン統合（MVP4 / 第12章）', () => {
  it('ラン開始時にロスター（個体メンバー）がスナップショットに含まれる', () => {
    const e = new RunEngine({ seed: 'roster-run', difficulty: 'normal' });
    const s = toFirstNode(e);
    expect(s.roster.members.length).toBe(3);
    expect(s.roster.members.every((m) => m.stamina === m.staminaMax)).toBe(true);
  });

  it('編成を変えるとスプリント結果が変わる（DoD: 編成が結果に影響する）', () => {
    const base = new RunEngine({ seed: 'formation-cmp', difficulty: 'normal' });
    const s0 = toFirstNode(base);
    const node = s0.available[0];
    expect(base.snapshot().roster.members.find((m) => m.id === 'm2')?.assignment).toBe('review');
    const baseResult = playFirstSprint(base, node).lastResult!;

    // 同一 seed・同一ノードでレビュアー(m2)をコーディングへ移すと、レビューが詰まる。
    const moved = new RunEngine({ seed: 'formation-cmp', difficulty: 'normal' });
    toFirstNode(moved);
    moved.assignMember('m2', 'coding');
    const movedResult = playFirstSprint(moved, node).lastResult!;

    const differs =
      baseResult.delivered !== movedResult.delivered ||
      baseResult.reviewQueueMax !== movedResult.reviewQueueMax ||
      baseResult.rework !== movedResult.rework;
    expect(differs).toBe(true);
  });

  it('スプリント中は編成を変更できない', () => {
    const e = new RunEngine({ seed: 'mid-sprint', difficulty: 'normal' });
    const s = toFirstNode(e);
    e.enterNode(s.available[0]);
    e.step(200); // スプリント進行中
    expect(e.snapshot().phase).toBe('sprint');
    const before = e.snapshot().roster.members.find((m) => m.id === 'm0')!.assignment;
    e.assignMember('m0', 'bench');
    expect(e.snapshot().roster.members.find((m) => m.id === 'm0')!.assignment).toBe(before);
  });

  it('スプリント完了で成長結果が記録され、配置メンバーが経験値を得る', () => {
    const e = new RunEngine({ seed: 'growth-run', difficulty: 'easy' });
    const s = toFirstNode(e);
    const before = e.snapshot().roster.members.map((m) => ({ id: m.id, xp: m.xp, level: m.level }));
    const after = playFirstSprint(e, s.available[0]);
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
    const play = (seed: string): RunState => {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        switch (s.phase) {
          case 'map':
            e.enterNode(s.available[0]);
            break;
          case 'sprint':
            e.step(1_000_000);
            break;
          case 'result':
            e.acknowledgeResult();
            break;
          case 'draft':
            if (s.draft && s.draft.length > 0) e.chooseCard(s.draft[0]);
            else e.skipDraft();
            break;
          case 'evolution':
            e.finishEvolution();
            break;
          case 'event':
            e.chooseEvent(0);
            break;
          case 'shop':
            e.leaveShop();
            break;
          case 'rest':
            e.restChoose('recruit');
            break;
          default:
            guard = 40_000;
            break;
        }
        s = e.snapshot();
      }
      return s;
    };
    const a = play('roster-determinism');
    const b = play('roster-determinism');
    expect(a.roster).toEqual(b.roster);
    expect(['won', 'lost']).toContain(a.status);
    // 数スプリント回せば、いずれかのメンバーがレベル1から成長しているはず。
    const anyGrowth = a.roster.members.some((m) => m.level > 1 || m.xp > 0 || m.onLeave);
    expect(anyGrowth).toBe(true);
  });
});
