import { describe, expect, it } from 'vitest';
import {
  FINAL_PHASES,
  RUN_EVENT_TYPES,
  RUN_PHASES,
  RUN_PHASE_TRANSITIONS,
  canTransition,
  type RunEventType,
} from '../../../src/sim/run/phases';
import type { RunPhase } from '../../../src/sim/run/types';

/** 正本の表でイベント列をたどる。不正イベントを no-op として扱わない。 */
function followPath(events: readonly RunEventType[]): RunPhase[] {
  const phases: RunPhase[] = ['title'];
  for (const event of events) {
    const from = phases[phases.length - 1]!;
    const next = RUN_PHASE_TRANSITIONS[from][event];
    if (!next) throw new Error(`不正なイベント: ${from} / ${event}`);
    phases.push(next);
  }
  return phases;
}

const TO_BEAT = ['START', 'BEGIN', 'SPRINT_DONE', 'ACK', 'NEXT', 'FINISH'] as const;

describe('フェーズ遷移表（単一の真実源 / RI-39）', () => {
  it('全フェーズが遷移表の行として網羅されている', () => {
    expect(Object.keys(RUN_PHASE_TRANSITIONS).sort()).toEqual([...RUN_PHASES].sort());
    // 重複なし（RUN_PHASES 自体が集合であること）。
    expect(new Set(RUN_PHASES).size).toBe(RUN_PHASES.length);
  });

  it('遷移先とイベント名はすべて既知の値である', () => {
    const phases = new Set<string>(RUN_PHASES);
    const events = new Set<string>(RUN_EVENT_TYPES);
    for (const from of RUN_PHASES) {
      for (const [event, to] of Object.entries(RUN_PHASE_TRANSITIONS[from])) {
        expect(events.has(event), `${from} の ${event}`).toBe(true);
        expect(phases.has(to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('終端フェーズ（won / lost）は出エッジを持たない', () => {
    for (const phase of FINAL_PHASES) {
      expect(RUN_PHASE_TRANSITIONS[phase]).toEqual({});
    }
  });

  it('進行中の全フェーズが LOST → lost を持つ（title と終端を除く）', () => {
    for (const from of RUN_PHASES) {
      if (from === 'title' || FINAL_PHASES.has(from)) continue;
      expect(RUN_PHASE_TRANSITIONS[from].LOST, from).toBe('lost');
    }
  });

  it('title から全フェーズへ到達できる（BFS）', () => {
    const reached = new Set<RunPhase>(['title']);
    const queue: RunPhase[] = ['title'];
    while (queue.length > 0) {
      const from = queue.shift()!;
      for (const to of Object.values(RUN_PHASE_TRANSITIONS[from])) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    expect([...reached].sort()).toEqual([...RUN_PHASES].sort());
  });

  it('通常スプリントはリザルト・ドラフト・進化・ビートを経て編成へ戻る', () => {
    expect(followPath([...TO_BEAT, 'ENTER_SPRINT', 'BEGIN'])).toEqual([
      'title',
      'setup',
      'sprint',
      'result',
      'draft',
      'evolution',
      'beat',
      'setup',
      'sprint',
    ]);
  });

  it.each([
    ['ENTER_SHOP', 'shop'],
    ['ENTER_REST', 'rest'],
    ['ENTER_RECRUIT', 'recruit'],
  ] as const)('ビートの %s は %s から編成を経て次スプリントへ進む', (event, phase) => {
    expect(followPath([...TO_BEAT, event, 'RESOLVE', 'BEGIN']).slice(-4)).toEqual([
      'beat',
      phase,
      'setup',
      'sprint',
    ]);
  });

  it('即時採用成功などの RESOLVE はビートから直接編成へ戻る', () => {
    expect(followPath([...TO_BEAT, 'RESOLVE']).slice(-2)).toEqual(['beat', 'setup']);
  });

  it.each([
    ['REVIEW_WON', 'won'],
    ['REVIEW_CONTINUE', 'setup'],
    ['REVIEW_LOST', 'lost'],
  ] as const)('ボス完了後の四半期レビューは %s で %s へ分岐する', (event, phase) => {
    expect(followPath(['START', 'BEGIN', 'BOSS_REVIEW', event])).toEqual([
      'title',
      'setup',
      'sprint',
      'quarterReview',
      phase,
    ]);
  });

  it('title では BEGIN が定義されず、編成を迂回してスプリントに入れない', () => {
    expect(RUN_PHASE_TRANSITIONS.title.BEGIN).toBeUndefined();
    expect(canTransition('title', 'sprint')).toBe(false);
  });

  it('canTransition は表のエッジのみ許可する', () => {
    // 正例（代表的な経路）。
    expect(canTransition('title', 'setup')).toBe(true);
    expect(canTransition('setup', 'sprint')).toBe(true);
    expect(canTransition('sprint', 'quarterReview')).toBe(true);
    expect(canTransition('beat', 'shop')).toBe(true);
    expect(canTransition('quarterReview', 'won')).toBe(true);
    expect(canTransition('result', 'lost')).toBe(true);
    // 負例（逆行・スキップ・終端からの脱出・自己遷移）。
    expect(canTransition('setup', 'title')).toBe(false);
    expect(canTransition('setup', 'result')).toBe(false);
    expect(canTransition('sprint', 'draft')).toBe(false);
    expect(canTransition('won', 'setup')).toBe(false);
    expect(canTransition('lost', 'title')).toBe(false);
    expect(canTransition('sprint', 'sprint')).toBe(false);
  });
});
