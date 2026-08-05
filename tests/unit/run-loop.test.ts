import { describe, expect, it } from 'vitest';
import { EVENT_DEFS, effectiveKind, getEvent } from '../../src/data/events';
import { createOrgState } from '../../src/sim/org';
import { RunEngine, SPRINTS_PER_QUARTER } from '../../src/sim/run/engine';
import {
  applyEventOutcome,
  effectiveEventWeight,
  eventSignals,
  eventsOfKind,
  weightedEventPool,
} from '../../src/sim/run/events';
import { foldPassives } from '../../src/sim/run/effects';
import type { OrgState, SprintModifierDelta } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';
import { advance } from './helpers/runFlow';

const org = (o: Partial<OrgState> = {}): OrgState => ({ ...createOrgState('default', true), ...o });

describe('イベント種別と重み付け（SPEC 第9章）', () => {
  it('effectiveKind は kind 明示を優先し、未指定は choices 長で既定解決する', () => {
    for (const def of EVENT_DEFS) {
      const k = effectiveKind(def);
      if (def.kind) expect(k).toBe(def.kind);
      else expect(k).toBe(def.choices.length <= 1 ? 'judgment' : 'decision');
    }
    // judgment 定義は契約として kind を明示し、ちょうど 1 件の hidden choice を持つ。
    for (const def of EVENT_DEFS.filter((d) => effectiveKind(d) === 'judgment')) {
      expect(def.kind).toBe('judgment');
      expect(def.choices).toHaveLength(1);
    }
  });

  it('judgment と decision の両プールが空でない（混合抽選が成立する）', () => {
    expect(eventsOfKind(EVENT_DEFS, 'judgment').length).toBeGreaterThan(0);
    expect(eventsOfKind(EVENT_DEFS, 'decision').length).toBeGreaterThan(0);
  });

  it('tone: joke のネタイベントが decision / judgment の分類に乗る', () => {
    const jokeEvents = EVENT_DEFS.filter((def) => def.tone === 'joke');
    expect(jokeEvents.map((def) => def.id).sort()).toEqual([
      'emoji-policy-summit',
      'meeting-title-refactor',
      'readme-haiku',
      'standup-acronym-storm',
    ]);
    expect(
      eventsOfKind(jokeEvents, 'decision')
        .map((def) => def.id)
        .sort(),
    ).toEqual(['emoji-policy-summit', 'standup-acronym-storm']);
    expect(
      eventsOfKind(jokeEvents, 'judgment')
        .map((def) => def.id)
        .sort(),
    ).toEqual(['meeting-title-refactor', 'readme-haiku']);
  });

  it('技術的負債が高いほど debt 系判定イベントの重みが上がる（決定論）', () => {
    const debtIncident = getEvent('debt-incident')!;
    const healthy = effectiveEventWeight(debtIncident, eventSignals(org({ techDebt: 0 })));
    const heavy = effectiveEventWeight(debtIncident, eventSignals(org({ techDebt: 80 })));
    expect(heavy).toBeGreaterThan(healthy);
    // 同一 org なら完全再現。
    expect(effectiveEventWeight(debtIncident, eventSignals(org({ techDebt: 80 })))).toBe(heavy);
  });

  it('weightedEventPool は org 信号で重みをスケールする', () => {
    const pool = eventsOfKind(EVENT_DEFS, 'judgment');
    const heavy = weightedEventPool(org({ techDebt: 85 }), {} as never, pool);
    const debt = heavy.find((w) => w.def.id === 'debt-incident')!;
    const ci = heavy.find((w) => w.def.id === 'ci-improved')!;
    // 負債が高くテストカバレッジ低ければ debt-incident が ci-improved より重い。
    expect(debt.weight).toBeGreaterThan(ci.weight);
  });
});

describe('イベント効果の適用（applyEventOutcome 拡張）', () => {
  it('delivered / trust / forceLose / nextSprint を差分として返す', () => {
    const mods: SprintModifierDelta = { reviewLoadAdd: 4 };
    const res = applyEventOutcome(
      { delivered: 12, trust: { management: -8 }, forceLose: 'reviewFreeze', nextSprint: mods },
      org(),
      foldPassives([]),
    );
    expect(res.delivered).toBe(12);
    expect(res.trust).toEqual({ management: -8 });
    expect(res.forceLose).toBe('reviewFreeze');
    expect(res.nextSprint).toEqual(mods);
  });
});

/** ランを回し、各スプリントの (四半期, index, 種別) を記録する（skilled で長く生存）。 */
function recordSprints(seed: string, difficulty: RunState['difficulty']) {
  const e = new RunEngine({ seed, difficulty });
  e.startRun();
  const records: { quarter: number; index: number; kind: string }[] = [];
  const seen = new Set<string>();
  let s = e.snapshot();
  let guard = 0;
  while (s.status === 'playing' && guard < 40_000) {
    guard += 1;
    if (s.phase === 'sprint' && s.currentSprintId && !seen.has(s.currentSprintId)) {
      seen.add(s.currentSprintId);
      records.push({
        quarter: s.quarterNumber,
        index: s.sprintIndexInQuarter,
        kind: s.currentSprintKind,
      });
      // 一回消費: スプリント中は pendingSprintKind/Modifiers が消費済み（normal / 空）。
      expect(s.pendingSprintKind).toBe('normal');
      expect(s.pendingSprintModifiers).toEqual({});
    }
    if (!advance(e, { skilled: true })) break;
    s = e.snapshot();
  }
  return records;
}

describe('固定トラックの不変条件（SPEC 第3章 / 第10章）', () => {
  it('各四半期の最終インデックスは必ず boss、boss は最終のみ、elite は非最終のみ', () => {
    // 介入で捌くプレイで少なくとも 1 四半期（ボス）まで到達させる。
    const records = recordSprints('boss-seek-0', 'easy');
    for (const r of records) {
      if (r.index === SPRINTS_PER_QUARTER) {
        expect(r.kind).toBe('boss');
      } else {
        expect(r.kind).not.toBe('boss');
      }
      if (r.kind === 'elite') expect(r.index).toBeLessThan(SPRINTS_PER_QUARTER);
    }
    // 少なくとも 1 本のボススプリント（最終インデックス）に到達している。
    expect(records.some((r) => r.kind === 'boss' && r.index === SPRINTS_PER_QUARTER)).toBe(true);
  });

  it('同一 seed・同一選択ならトラックの種別列が完全再現する（決定論）', () => {
    expect(recordSprints('track-det', 'normal')).toEqual(recordSprints('track-det', 'normal'));
  });
});

describe('ビートの遷移とリスク/リターン（SPEC 第9章）', () => {
  it('「一息つく」を取ると次スプリントの出荷ペナルティ（taskCountMul<1）が積まれる', () => {
    let engine: RunEngine | null = null;
    // RI-75: タスク床・量増で旧 rest-* は休息前に敗北しやすい。到達確認済み seed を先に試す。
    for (const seed of [
      'rest-probe-4',
      'rest-probe-9',
      'rest-probe-10',
      'rest-probe-20',
      'rest-a',
      'rest-b',
      'rest-c',
    ]) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && s.phase !== 'rest' && guard < 2000) {
        guard += 1;
        if (!advance(e, { beatChoice: 0 })) break;
        s = e.snapshot();
      }
      if (s.phase === 'rest') {
        engine = e;
        break;
      }
    }
    expect(engine).not.toBeNull();
    // 休息に入った時点で、当該スプリントの出荷を手放す代償が積まれている。
    // （taskFloor で実タスク数が減らない場合もあるため、modifier 自体を検証する）
    const mods = engine!.snapshot().pendingSprintModifiers;
    expect(mods.taskCountMul).toBeDefined();
    expect(mods.taskCountMul!).toBeLessThan(1);
  });

  it('ビートで出荷を取ると当期 quarterTotals.delivered が前進する', () => {
    // 出荷を伴う選択肢が出るビートまで進め、その選択を取って当期出荷の増加を確認する。
    const tryFind = (seed: string): boolean => {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        if (s.phase === 'beat' && s.beat && s.beat.kind === 'decision') {
          const def = getEvent(s.beat.eventId)!;
          const idx = def.choices.findIndex((c) => (c.outcome.delivered ?? 0) > 0);
          if (idx >= 0) {
            const before = s.quarterTotals.delivered;
            e.resolveBeat(idx);
            expect(e.snapshot().quarterTotals.delivered).toBeGreaterThan(before);
            return true;
          }
        }
        if (!advance(e, { skilled: true })) break;
        s = e.snapshot();
      }
      return false;
    };
    const found = ['bd-1', 'bd-2', 'bd-3', 'bd-4', 'bd-5', 'bd-6'].some(tryFind);
    expect(found).toBe(true);
  });
});
