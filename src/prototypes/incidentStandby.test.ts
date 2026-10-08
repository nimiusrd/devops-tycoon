import { describe, expect, it } from 'vitest';
import {
  applyStandbyInput,
  compareStandbyStrategies,
  createStandbyPrototype,
  standbyCapacity,
  summarizeStandby,
} from './incidentStandby';
import comparison from '../../docs/prototypes/incident-standby-comparison.json';

describe('RI-170 障害対応の待機担当', () => {
  it('待機1枠の人物を通常Coding/Reviewから除き、交代で二重計上しない', () => {
    let state = createStandbyPrototype('RI-170');
    expect(standbyCapacity(state)).toEqual({ coding: 5, review: 5, standby: 0 });
    state = applyStandbyInput(state, { type: 'assign', id: 'ace', lane: 'standby' });
    expect(standbyCapacity(state)).toEqual({ coding: 2, review: 5, standby: 4 });
    state = applyStandbyInput(state, { type: 'assign', id: 'reviewer', lane: 'standby' });
    expect(standbyCapacity(state)).toEqual({ coding: 5, review: 0, standby: 1 });
    state = applyStandbyInput(state, { type: 'assign', id: 'coder', lane: 'standby' });
    expect(state.members.filter((m) => m.lane === 'standby')).toHaveLength(1);
    expect(standbyCapacity(state)).toEqual({ coding: 3, review: 5, standby: 2 });
    expect(state.focusSpent).toBe(3);
  });
  it('障害がない時も譲った容量が残り、待機者は応答疲労を消費しない', () => {
    let state = applyStandbyInput(createStandbyPrototype('RI-170'), {
      type: 'assign',
      id: 'coder',
      lane: 'standby',
    });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(state).toMatchObject({ value: 9, responseWork: 0, stoppedTicks: 0 });
    expect(state.members[0]).toMatchObject({ stamina: 12, responseSpent: 0 });
  });
  it('障害時だけ待機の応答力で復旧し、体力以上に働かない', () => {
    let state = applyStandbyInput(createStandbyPrototype('RI-170', true), {
      type: 'assign',
      id: 'ace',
      lane: 'standby',
    });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(state.incidents[0]).toMatchObject({ workLeft: 0, doneTick: 3 });
    expect(state.members[1]).toMatchObject({ stamina: 2, responseSpent: 6 });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(state.incidents[1].workLeft).toBe(4);
    expect(state.members[1]).toMatchObject({ stamina: 0, responseSpent: 8 });
    state = applyStandbyInput(state, { type: 'tick' });
    expect(state.stoppedTicks).toBe(1);
    expect(state.incidents[1]).toMatchObject({ workLeft: 4, mobilizationLeft: 1 });
  });
  it('bench回復と交代は進捗・累積疲労を消さず、通常工程との違いを保つ', () => {
    let state = applyStandbyInput(createStandbyPrototype('RI-170', true), {
      type: 'assign',
      id: 'ace',
      lane: 'standby',
    });
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    state = applyStandbyInput(state, { type: 'assign', id: 'coder', lane: 'standby' });
    expect(state.members[1]).toMatchObject({ lane: 'coding', stamina: 2, responseSpent: 6 });
    state = applyStandbyInput(state, { type: 'assign', id: 'ace', lane: 'bench' });
    state = applyStandbyInput(state, { type: 'tick' });
    expect(state.members[1]).toMatchObject({ lane: 'bench', stamina: 4, responseSpent: 6 });
    expect(standbyCapacity(state).coding).toBe(0);
    expect(state.incidents[0].doneTick).toBe(3);
  });
  it('対象なし・同じ配置・資源不足・期末は無消費で拒否する', () => {
    const initial = createStandbyPrototype('RI-170');
    const input = { type: 'assign', id: 'coder', lane: 'standby' } as const;
    expect(applyStandbyInput(initial, { ...input, id: 'missing' })).toBe(initial);
    expect(applyStandbyInput(initial, { ...input, lane: 'coding' })).toBe(initial);
    const poor = { ...initial, focus: 0 };
    expect(applyStandbyInput(poor, input)).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyStandbyInput(ended, input)).toBe(ended);
    expect(applyStandbyInput(ended, { type: 'tick' })).toBe(ended);
  });
  it('平穏時は全員通常、反復障害では待機が有利で、エース固定が最適にならない', () => {
    const rows = compareStandbyStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows.slice(0, 4).map((r) => r.result.netValue)).toEqual([50, 29, 19, 25]);
    expect(rows.slice(4).map((r) => r.result.netValue)).toEqual([8, 23, 4, 20]);
    expect(rows[6].result.stoppedTicks).toBe(4);
    expect(rows[7].result.stoppedTicks).toBe(0);
  });
  it('期末の未復旧工数を消さず、無介入でも自動招集で復旧できる', () => {
    let state = { ...createStandbyPrototype('RI-170', true), horizon: 3 };
    for (let i = 0; i < 3; i++) state = applyStandbyInput(state, { type: 'tick' });
    expect(summarizeStandby(state)).toMatchObject({ remainingWork: 6, customerLoss: 2 });
    state = applyStandbyInput({ ...state, horizon: 4 }, { type: 'tick' });
    expect(state.incidents[0].doneTick).toBe(4);
  });
  it('全比較を毎入力JSON保存再開・再生でき、元状態を変えない', () => {
    for (const row of compareStandbyStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(previous);
        live = applyStandbyInput(live, input);
        expect(previous).toEqual(before);
        saved = applyStandbyInput(JSON.parse(JSON.stringify(saved)), input);
        expect(saved).toEqual(live);
      }
      expect(summarizeStandby(live)).toEqual(row.result);
    }
  });
});
