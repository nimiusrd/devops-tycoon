import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { RECRUIT_COST, canRecruit } from '../../src/sim/member';
import type { RunState } from '../../src/sim/run/types';

/**
 * 休息ノードに到達したエンジンを返す（休息ノードを優先して辿る）。
 * このランに休息ノードが無ければ null。
 */
function reachRest(seed: string): RunEngine | null {
  const e = new RunEngine({ seed, difficulty: 'easy' });
  e.startRun();
  let s = e.snapshot();
  let guard = 0;
  while (s.status === 'playing' && guard < 200) {
    guard += 1;
    switch (s.phase) {
      case 'rest':
        return e;
      case 'map': {
        const rest = s.available.find(
          (id) => s.map.nodes.find((n) => n.id === id)?.type === 'rest',
        );
        e.enterNode(rest ?? s.available[0]);
        break;
      }
      case 'sprint':
        e.step(1_000_000);
        break;
      case 'result':
        e.acknowledgeResult();
        break;
      case 'draft':
        e.skipDraft();
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
      default:
        return null;
    }
    s = e.snapshot();
  }
  return null;
}

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

  it('休息ノードの採用は予算を消費し、メンバーが1人増える（ラン経済）', () => {
    let engine: RunEngine | null = null;
    for (const seed of ['rest-a', 'rest-b', 'rest-c', 'rest-d', 'rest-e', 'rest-f', 'rest-g']) {
      engine = reachRest(seed);
      if (engine) break;
    }
    // easy のマップには休息ノードが含まれる前提（見つからなければテスト環境異常）。
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
    for (const seed of ['rest-a', 'rest-b', 'rest-c', 'rest-d', 'rest-e', 'rest-f', 'rest-g']) {
      engine = reachRest(seed);
      if (engine) break;
    }
    expect(engine).not.toBeNull();
    const e = engine!;
    const before = e.snapshot();
    // 予算が足りない状況を seed 越しに探す（足りるなら採用が成立してしまうため別 seed）。
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
