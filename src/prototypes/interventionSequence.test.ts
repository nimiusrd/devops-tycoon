import { describe, expect, it } from 'vitest';
import {
  createSequencePrototype,
  applySequenceInput,
  baselineSequenceRules,
  compareSequenceStrategies,
  compareSequenceFactorMoves,
  summarizeSequence,
  type SequenceFactorRow,
  type SequenceInput,
  type SequenceRules,
} from './interventionSequence';
import comparison from '../../docs/prototypes/intervention-sequence-comparison.json';
import factors from '../../docs/prototypes/intervention-sequence-factor-comparison.json';
describe('RI-168 原因に沿った2手介入', () => {
  it('同系統の分割後レビューだけが統合失敗を防ぎ、逆順・別対象では変わらない', () => {
    const initial = createSequencePrototype('RI-168');
    const split = applySequenceInput(initial, { type: 'split', id: 'parent' });
    const reviewed = applySequenceInput(split, { type: 'pairReview', id: 'split-1' });
    expect(reviewed.board.integrationFails).toBe(false);
    expect(reviewed.board.focusSpent).toBe(4);
    expect(reviewed.board.tick).toBe(1);
    expect(split.board.integrationFails).toBe(true);
    const reverse = applySequenceInput(
      applySequenceInput(initial, { type: 'pairReview', id: 'parent' }),
      { type: 'split', id: 'parent' },
    );
    expect(reverse.board.integrationFails).toBe(true);
    expect(
      applySequenceInput(split, { type: 'pairReview', id: 'other' }).board.integrationFails,
    ).toBe(true);
  });
  it('同系統での連打を無消費で拒否し、期限後の確認には連携効果がない', () => {
    let state = applySequenceInput(createSequencePrototype('RI-168'), {
      type: 'split',
      id: 'parent',
    });
    const reviewed = applySequenceInput(state, { type: 'pairReview', id: 'split-1' });
    expect(applySequenceInput(reviewed, { type: 'pairReview', id: 'split-2' })).toBe(reviewed);
    for (let i = 0; i < 3; i++) state = applySequenceInput(state, { type: 'wait' });
    const late = applySequenceInput(state, { type: 'pairReview', id: 'split-1' });
    expect(late.board.integrationFails).toBe(true);
    expect(late.board.focusSpent).toBe(4);
  });
  it('未知・退役・Done・資源不足・期末を拒否する', () => {
    const initial = createSequencePrototype('RI-168');
    expect(applySequenceInput(initial, { type: 'pairReview', id: 'missing' })).toBe(initial);
    const split = applySequenceInput(initial, { type: 'split', id: 'parent' });
    expect(applySequenceInput(split, { type: 'pairReview', id: 'parent' })).toBe(split);
    expect(applySequenceInput(split, { type: 'pairReview', id: 'split-3' })).toBe(split);
    const poor = { ...split, board: { ...split.board, focus: 1 } };
    expect(applySequenceInput(poor, { type: 'pairReview', id: 'split-1' })).toBe(poor);
    const ended = { ...split, board: { ...split.board, tick: split.board.horizon } };
    expect(applySequenceInput(ended, { type: 'pairReview', id: 'split-1' })).toBe(ended);
    let done = split;
    for (let i = 0; i < 3; i++) done = applySequenceInput(done, { type: 'work', id: 'split-1' });
    expect(applySequenceInput(done, { type: 'pairReview', id: 'split-1' })).toBe(done);
  });
  it('連携の余裕があれば有効だが、緊急時は分割だけの即時対応が有力', () => {
    const rows = compareSequenceStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows[0].result.netValue).toBeGreaterThan(rows[1].result.netValue);
    expect(rows[5].result.netValue).toBeGreaterThan(rows[4].result.netValue);
    expect(rows[5].result.netValue).toBeGreaterThan(rows[6].result.netValue);
    expect(rows[6].result.focusSpent).toBe(rows[5].result.focusSpent);
  });
  it('確認完了tickが2なら有効、3なら無効になる', () => {
    const split = applySequenceInput(createSequencePrototype('RI-168'), {
      type: 'split',
      id: 'parent',
    });
    const atOne = applySequenceInput(split, { type: 'wait' });
    const onTime = applySequenceInput(atOne, { type: 'pairReview', id: 'split-1' });
    expect(onTime.board.tick).toBe(2);
    expect(onTime.board.integrationFails).toBe(false);
    const atTwo = applySequenceInput(atOne, { type: 'wait' });
    const late = applySequenceInput(atTwo, { type: 'pairReview', id: 'split-1' });
    expect(late.board.tick).toBe(3);
    expect(late.board.integrationFails).toBe(true);
    expect(late.board.focusSpent).toBe(4);
  });
  it('対照otherの分割は確認の前後でも無消費で拒否する', () => {
    const initial = createSequencePrototype('RI-168');
    const split = applySequenceInput(initial, { type: 'split', id: 'parent' });
    const reviewed = applySequenceInput(split, { type: 'pairReview', id: 'split-1' });
    for (const state of [initial, split, reviewed]) {
      expect(applySequenceInput(state, { type: 'split', id: 'other' })).toBe(state);
      expect(
        state.board.tasks
          .filter((t) => t.kind === 'integration')
          .every((t) => t.parentId === 'parent'),
      ).toBe(true);
    }
  });
  it('集計結果の配列と要素を書き換えても状態や重複確認の拒否を変えない', () => {
    const split = applySequenceInput(createSequencePrototype('RI-168'), {
      type: 'split',
      id: 'parent',
    });
    const reviewed = applySequenceInput(split, { type: 'pairReview', id: 'split-1' });
    const before = structuredClone(reviewed);
    const summary = summarizeSequence(reviewed);
    summary.reviewed[0].rootId = 'other';
    summary.reviewed.splice(0);
    expect(reviewed).toEqual(before);
    expect(applySequenceInput(reviewed, { type: 'pairReview', id: 'split-2' })).toBe(reviewed);
  });
  it('毎入力のJSON保存再開と再生が一致し、元状態を変更しない', () => {
    for (const row of compareSequenceStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applySequenceInput(live, input);
        expect(previous).toEqual(before);
        restored = applySequenceInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizeSequence(live)).toEqual(row.result);
    }
  });
});

function legacyNet(horizon: number, strategy: string) {
  const found = comparison.results.find(
    (candidate) => candidate.horizon === horizon && candidate.strategy === strategy,
  );
  if (!found) throw new Error(`${horizon} ${strategy}`);
  return found;
}

function factorRow(factor: string, step: string, horizon: number, strategy: string) {
  const found = (factors.moves as SequenceFactorRow[]).find(
    (candidate) =>
      candidate.factor === factor &&
      candidate.step === step &&
      candidate.horizon === horizon &&
      candidate.strategy === strategy,
  );
  if (!found) throw new Error(`${factor} ${step} ${horizon} ${strategy}`);
  return found;
}

describe('RI-168 要因を一つずつ動かした比較', () => {
  it('初回と同じ資源の固定戦略で再計算でき、失敗の有無は開始前の初期状態にある', () => {
    expect(compareSequenceFactorMoves(factors.seed)).toEqual(factors);
    expect(factors.resources).toMatchObject({
      focus: 6,
      parentWorkLeft: 4,
      parentValue: 12,
      horizons: [3, 9],
      reviewWindow: 2,
      reviewTicks: 1,
      assignees: 1,
      publishedFailure: true,
    });
    for (const entry of factors.moves as SequenceFactorRow[]) {
      const opened = createSequencePrototype(factors.seed, entry.horizon, entry.rules);
      if (!entry.integrationFails) opened.board.integrationFails = false;
      expect(opened.board.integrationFails).toBe(entry.integrationFails);
      expect(opened.board.failures).toBe(0);
      expect(opened.inputs).toEqual([]);
      expect(opened.board.focus).toBe(6);
      expect(opened.board.tasks[0]).toMatchObject({ id: 'parent', workLeft: 4, value: 12 });
      expect(opened.board.tick).toBeLessThan(opened.board.horizon);
    }
  });

  it('規則が無い状態は初回と同じ確認1tickで、動かしていない方針の入力は初回と一致する', () => {
    const withRules = createSequencePrototype(comparison.seed, 9, baselineSequenceRules);
    let plain = createSequencePrototype(comparison.seed, 9);
    let ruled = withRules;
    for (const input of legacyNet(9, 'split-review').inputs as SequenceInput[]) {
      plain = applySequenceInput(plain, input);
      ruled = applySequenceInput(ruled, input);
    }
    expect(summarizeSequence(ruled)).toEqual(summarizeSequence(plain));
    expect(summarizeSequence(plain)).toEqual(legacyNet(9, 'split-review').result);
    for (const step of ['2', '3']) {
      for (const horizon of [3, 9]) {
        expect(factorRow('reviewTicks', step, horizon, 'split-only').inputs).toEqual(
          legacyNet(horizon, 'split-only').inputs,
        );
        expect(factorRow('reviewTicks', step, horizon, 'split-only').result).toEqual(
          legacyNet(horizon, 'split-only').result,
        );
      }
    }
    expect(factorRow('leading', 'family', 9, 'split-review').inputs).toEqual(
      legacyNet(9, 'split-review').inputs,
    );
    expect(factorRow('leading', 'unavailable', 9, 'split-review').inputs).toEqual(
      legacyNet(9, 'split-only').inputs,
    );
  });

  it('確認2tickで期末9の優位が反転し、窓の内外は失敗フラグに残る', () => {
    expect(legacyNet(9, 'split-review').result.netValue).toBeGreaterThan(
      legacyNet(9, 'split-only').result.netValue,
    );
    const inside = factorRow('reviewTicks', '2', 9, 'split-review');
    const outside = factorRow('reviewTicks', '3', 9, 'split-review');
    expect(inside.result.integrationFails).toBe(false);
    expect(inside.result.netValue).toBeLessThan(
      factorRow('reviewTicks', '2', 9, 'split-only').result.netValue,
    );
    expect(outside.result.integrationFails).toBe(true);
    expect(outside.result.netValue).toBeLessThan(
      factorRow('reviewTicks', '3', 9, 'split-only').result.netValue,
    );
    const rules: SequenceRules = { ...baselineSequenceRules, reviewTicks: 2 };
    const reviewed = applySequenceInput(
      applySequenceInput(createSequencePrototype('RI-168', 9, rules), {
        type: 'split',
        id: 'parent',
      }),
      { type: 'pairReview', id: 'split-1' },
    );
    expect(reviewed.board.tick).toBe(2);
    expect(reviewed.board.integrationFails).toBe(false);
    const lateRules: SequenceRules = { ...baselineSequenceRules, reviewTicks: 3 };
    const late = applySequenceInput(
      applySequenceInput(createSequencePrototype('RI-168', 9, lateRules), {
        type: 'split',
        id: 'parent',
      }),
      { type: 'pairReview', id: 'split-1' },
    );
    expect(late.board.tick).toBe(3);
    expect(late.board.integrationFails).toBe(true);
  });

  it('分割不要な原因では期末9の順序が逆転し、期末3は分割だけが残る', () => {
    expect(factorRow('cause', 'no-split', 9, 'whole').result.netValue).toBe(12);
    expect(factorRow('cause', 'no-split', 9, 'review-whole').result.netValue).toBe(10);
    expect(factorRow('cause', 'no-split', 9, 'review-split').result.netValue).toBe(8);
    expect(factorRow('cause', 'no-split', 9, 'split-only').result.netValue).toBe(6);
    expect(factorRow('cause', 'no-split', 9, 'split-review').result.netValue).toBe(4);
    expect(factorRow('cause', 'no-split', 9, 'review-split').result.netValue).toBeGreaterThan(
      factorRow('cause', 'no-split', 9, 'split-review').result.netValue,
    );
    expect(factorRow('cause', 'no-split', 3, 'split-only').result.netValue).toBeGreaterThan(
      factorRow('cause', 'no-split', 3, 'whole').result.netValue,
    );
    const rules: SequenceRules = { ...baselineSequenceRules, cause: 'no-split' };
    let parent = createSequencePrototype('RI-168', 9, rules);
    const reviewed = applySequenceInput(parent, { type: 'pairReview', id: 'parent' });
    expect(reviewed.board.integrationFails).toBe(false);
    for (let index = 0; index < 4; index += 1) {
      parent = applySequenceInput(parent, { type: 'work', id: 'parent' });
    }
    expect(parent.board.failures).toBe(1);
    expect(parent.board.tasks.find((task) => task.id === 'parent')).toMatchObject({
      doneTick: null,
      workLeft: 2,
    });
    const split = applySequenceInput(createSequencePrototype('RI-168', 9, rules), {
      type: 'split',
      id: 'parent',
    });
    expect(
      applySequenceInput(split, { type: 'pairReview', id: 'split-1' }).board.integrationFails,
    ).toBe(true);
  });

  it('公開済みの失敗件数が4件中2件以下で期末9の優位が消え、予兆tick2では窓の外になる', () => {
    for (const rate of factors.failureRates) {
      if (rate.horizon !== 9) continue;
      const ordered = rate.netSum['split-review'];
      const immediate = rate.netSum['split-only'];
      if (rate.failed >= 3) expect(ordered).toBeGreaterThan(immediate);
      if (rate.failed === 2) expect(ordered).toBe(immediate);
      if (rate.failed <= 1) expect(ordered).toBeLessThan(immediate);
      expect(rate.netSum['sign-following']).toBeGreaterThanOrEqual(ordered);
      expect(rate.netSum['sign-following']).toBeGreaterThanOrEqual(immediate);
    }
    for (const rate of factors.failureRates) {
      if (rate.horizon !== 3 || rate.failed === 0) continue;
      expect(rate.netSum['sign-following']).toBeLessThan(rate.netSum['split-only']);
    }
    const orderedFail = legacyNet(9, 'split-review').result.netValue;
    const orderedClear = factorRow('failureSign', 'rate0', 9, 'split-review').result.netValue;
    const immediateFail = legacyNet(9, 'split-only').result.netValue;
    const immediateClear = factorRow('failureSign', 'rate0', 9, 'split-only').result.netValue;
    expect(
      factors.failureRates.find((rate) => rate.horizon === 9 && rate.failed === 3)?.netSum,
    ).toMatchObject({
      'split-review': 3 * orderedFail + orderedClear,
      'split-only': 3 * immediateFail + immediateClear,
      'sign-following': 3 * orderedFail + immediateClear,
    });
    expect(factorRow('failureSign', 'signTick1', 9, 'review-on-sign').result).toMatchObject({
      netValue: 8,
      integrationFails: false,
    });
    expect(factorRow('failureSign', 'signTick2', 9, 'review-on-sign').result.netValue).toBeLessThan(
      legacyNet(9, 'split-only').result.netValue,
    );
    expect(factorRow('failureSign', 'signTick2', 9, 'review-on-sign').result.integrationFails).toBe(
      true,
    );
  });

  it('担当2人以上では期末9の優位が反転し、同じタスクを1tickに二人で進めない', () => {
    for (const step of ['2', '3']) {
      expect(factorRow('assignees', step, 9, 'split-only').result.netValue).toBeGreaterThan(
        factorRow('assignees', step, 9, 'split-review').result.netValue,
      );
      expect(factorRow('assignees', step, 9, 'split-review').result.netValue).toBe(
        factorRow('assignees', step, 9, 'review-split').result.netValue,
      );
      expect(factorRow('assignees', step, 3, 'split-only').result.netValue).toBeGreaterThan(
        factorRow('assignees', step, 3, 'split-review').result.netValue,
      );
    }
    expect(factorRow('assignees', '2', 9, 'split-only').result.netValue).toBe(
      factorRow('assignees', '3', 9, 'split-only').result.netValue,
    );
    const rules: SequenceRules = { ...baselineSequenceRules, assignees: 2 };
    const split = applySequenceInput(createSequencePrototype('RI-168', 9, rules), {
      type: 'split',
      id: 'parent',
    });
    const parallel = applySequenceInput(split, {
      type: 'assign',
      actions: [
        { type: 'work', id: 'split-1' },
        { type: 'work', id: 'split-1' },
      ],
    });
    expect(parallel.board.tasks.find((task) => task.id === 'split-1')?.workLeft).toBe(2);
    expect(parallel.board.tick).toBe(1);
    const both = applySequenceInput(split, {
      type: 'assign',
      actions: [
        { type: 'work', id: 'split-1' },
        { type: 'work', id: 'split-2' },
      ],
    });
    expect(both.board.tasks.find((task) => task.id === 'split-1')?.workLeft).toBe(2);
    expect(both.board.tasks.find((task) => task.id === 'split-2')?.workLeft).toBe(2);
    expect(both.board.tick).toBe(1);
  });

  it('先頭が新しい子なら順序を選べ、別系統や選択不能では期末9の優位が消える', () => {
    expect(factorRow('leading', 'family', 9, 'split-review').result.netValue).toBeGreaterThan(
      factorRow('leading', 'family', 9, 'split-only').result.netValue,
    );
    expect(factorRow('leading', 'board', 9, 'split-review').inputs).toContainEqual({
      type: 'pairReview',
      id: 'other',
    });
    expect(factorRow('leading', 'board', 9, 'split-review').result.netValue).toBeLessThan(
      factorRow('leading', 'board', 9, 'split-only').result.netValue,
    );
    expect(factorRow('leading', 'unavailable', 9, 'split-review').result).toEqual(
      factorRow('leading', 'unavailable', 9, 'split-only').result,
    );
    const rules: SequenceRules = { ...baselineSequenceRules, reviewSelection: 'unavailable' };
    const split = applySequenceInput(createSequencePrototype('RI-168', 9, rules), {
      type: 'split',
      id: 'parent',
    });
    expect(applySequenceInput(split, { type: 'pairReview', id: 'split-1' })).toBe(split);
  });

  it('要因比較も毎入力のJSON保存再開と再生が一致し、期末を超えない', () => {
    for (const entry of factors.moves as SequenceFactorRow[]) {
      let live = createSequencePrototype(factors.seed, entry.horizon, entry.rules);
      if (!entry.integrationFails) live.board.integrationFails = false;
      let restored = structuredClone(live);
      for (const input of entry.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applySequenceInput(live, input);
        expect(previous).toEqual(before);
        restored = applySequenceInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
        expect(live.board.tick).toBeLessThanOrEqual(live.board.horizon);
      }
      expect(summarizeSequence(live)).toEqual(entry.result);
      expect(live.board.horizon).toBe(entry.horizon);
    }
  });
});
