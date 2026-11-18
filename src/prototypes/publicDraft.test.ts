import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/public-draft-comparison.json';
import { defaultUnlockedCardIds } from '../data/unlocks';
import { drawDraft } from '../sim/cards';
import { createRng } from '../sim/rng';
import {
  applyPublicDraft,
  comparePublicDraft,
  createPublicDraft,
  PUBLIC_DRAFT_BUDGET,
  PUBLIC_DRAFT_CONDITIONS,
  PUBLIC_DRAFT_OFFERS,
  PUBLIC_DRAFT_RULESET,
  restorePublicDraft,
  savePublicDraft,
  summarizePublicDraft,
  viewPublicDraft,
  type PublicDraftInput,
  type PublicDraftState,
} from './publicDraft';

function prepared() {
  return applyPublicDraft(createPublicDraft('RI-269'), { type: 'buy', id: 'hire-senior' });
}

describe('RI-269 公開ドラフトの隔離試作', () => {
  it('開始前から6候補・取得予算・発動focus・貸与・取消条件を公開し、閲覧は無消費', () => {
    const state = createPublicDraft('RI-269');
    const before = structuredClone(state);
    const view = viewPublicDraft(state);
    expect(view.offers).toHaveLength(6);
    expect(view.budget).toBe(PUBLIC_DRAFT_BUDGET);
    expect(view.budgetRemaining).toBe(6);
    expect(view.offers[0]).toMatchObject({
      id: 'hire-senior',
      acquisitionCost: 6,
      playFocusCost: 4,
    });
    expect(view).toMatchObject({
      changesAllowed: true,
      cancellationFee: 0,
      loanPolicy: 'all-offers-including-meta-locked',
    });
    expect(state).toEqual(before);
    expect(state.current).toBeNull();
  });

  it('購入・二重購入拒否・予算不足・全額取消・一括変更は原子的で、開始前は効果を付けない', () => {
    const state = prepared();
    expect(state.selected).toEqual(['hire-senior']);
    expect(viewPublicDraft(state).budgetRemaining).toBe(0);
    expect(state.current).toBeNull();
    expect(applyPublicDraft(state, { type: 'buy', id: 'hire-senior' })).toBe(state);
    expect(applyPublicDraft(state, { type: 'buy', id: 'copilot' })).toBe(state);
    expect(applyPublicDraft(state, { type: 'replace', ids: ['docs', 'docs'] })).toBe(state);
    expect(applyPublicDraft(state, { type: 'replace', ids: ['hire-senior', 'copilot'] })).toBe(
      state,
    );
    expect(applyPublicDraft(state, { type: 'cancel', id: 'docs' })).toBe(state);
    const cancel = applyPublicDraft(state, { type: 'cancel', id: 'hire-senior' });
    expect(viewPublicDraft(cancel).budgetRemaining).toBe(6);
    expect(applyPublicDraft(cancel, { type: 'cancel', id: 'hire-senior' })).toBe(cancel);
    const changed = applyPublicDraft(state, {
      type: 'replace',
      ids: ['copilot', 'docs', 'pr-size-limit'],
    });
    expect(changed.selected).toEqual(['docs', 'pr-size-limit', 'copilot']);
    expect(viewPublicDraft(changed).acquisitionSpent).toBe(6);
    expect(restorePublicDraft(savePublicDraft(changed))).toEqual(changed);
    expect(state.selected).toEqual(['hire-senior']);
  });

  it('候補順とseedで確定取得は揺れず、研修の抽選優先と違って未解放札もこの試作内で貸す', () => {
    const allowed = defaultUnlockedCardIds();
    expect(allowed.has('hire-senior')).toBe(false);
    for (const seed of ['RI-269', 'RI-269:1', 'RI-269:2']) {
      const state = applyPublicDraft(
        applyPublicDraft(createPublicDraft(seed), { type: 'buy', id: 'hire-senior' }),
        { type: 'start' },
      );
      expect(state.current!.deck).toEqual([{ defId: 'hire-senior', level: 1 }]);
      expect(state.current!.sprint.cardPiles.hand).toEqual([0]);
      expect(state.current!.sprint.focus).toBe(8);
      expect(state.current!.org.quality).toBe(45);
      expect(drawDraft(createRng(seed), 3, allowed, new Set(['hire-senior']))).not.toContain(
        'hire-senior',
      );
    }
    const build = ['docs', 'pr-size-limit', 'copilot'] as const;
    const select = (ids: (typeof build)[number][]) =>
      applyPublicDraft(applyPublicDraft(createPublicDraft('same'), { type: 'replace', ids }), {
        type: 'start',
      });
    expect(select([...build]).current).toEqual(select([...build].reverse()).current);
    expect(select([...build]).selected).toEqual(select([...build].reverse()).selected);
    expect(defaultUnlockedCardIds()).toEqual(allowed);
  });

  it('開始後の変更・再開始と発動二重適用を止め、取得費とfocusを別に払う', () => {
    let state = applyPublicDraft(prepared(), { type: 'start' });
    const before = structuredClone(state);
    for (const input of [
      { type: 'buy', id: 'copilot' },
      { type: 'cancel', id: 'hire-senior' },
      { type: 'replace', ids: [] },
      { type: 'start' },
      { type: 'play', id: 'docs' },
    ] satisfies PublicDraftInput[])
      expect(applyPublicDraft(state, input)).toBe(state);
    expect(viewPublicDraft(state).changesAllowed).toBe(false);
    const rng = state.current!.rngState;
    state = applyPublicDraft(state, { type: 'play', id: 'hire-senior' });
    expect(state.current!.org.quality).toBe(57);
    expect(state.current!.sprint.focus).toBe(4);
    expect(state.current!.rngState).toBe(rng);
    expect(state.current!.deck[0].baselineAppliedLevel).toBe(1);
    expect(viewPublicDraft(state).acquisitionSpent).toBe(6);
    expect(applyPublicDraft(state, { type: 'play', id: 'hire-senior' })).toBe(state);
    expect(before.current!.org.quality).toBe(45);
  });

  it('focus不足の札と不正選択は副作用なしで拒否する', () => {
    let state = applyPublicDraft(
      applyPublicDraft(createPublicDraft('RI-269'), {
        type: 'replace',
        ids: ['docs', 'pr-size-limit', 'copilot'],
      }),
      { type: 'start' },
    );
    state = structuredClone(state);
    state.current!.sprint.focus = 1;
    expect(applyPublicDraft(state, { type: 'play', id: 'docs' })).toBe(state);
    const invalid = { ...state, selected: ['docs', 'docs'] } as PublicDraftState;
    expect(applyPublicDraft(invalid, { type: 'tick', action: 'none' })).toBe(invalid);
    expect(summarizePublicDraft(state)).toBeNull();
  });

  it('準備中・発動後・進行中・完了後のJSON再開は同じsim状態と成果になり、完了後は無消費', () => {
    const row = comparePublicDraft('RI-269')[1];
    let direct = createPublicDraft('RI-269');
    let resumed = createPublicDraft('RI-269');
    for (const input of row.inputs) {
      direct = applyPublicDraft(direct, input);
      resumed = applyPublicDraft(restorePublicDraft(savePublicDraft(resumed))!, input);
      expect(resumed).toEqual(direct);
    }
    expect(restorePublicDraft(savePublicDraft(direct))).toEqual(direct);
    expect(summarizePublicDraft(direct)).toEqual(row.result);
    for (const input of [
      { type: 'tick', action: 'none' },
      { type: 'start' },
      { type: 'play', id: 'docs' },
    ] satisfies PublicDraftInput[])
      expect(applyPublicDraft(direct, input)).toBe(direct);
    expect(direct.ruleset).toBe(PUBLIC_DRAFT_RULESET);
  });

  it('未知version/ruleset・乱数破損・不正入力・重複購入/開始/発動を復元しない', () => {
    expect(restorePublicDraft('{')).toBeNull();
    expect(restorePublicDraft('null')).toBeNull();
    for (const mutation of [
      { version: 2 },
      { ruleset: 'normal' },
      { condition: '__proto__' },
      { rngState: 9 },
      { inputs: [{ type: 'buy', id: 'unknown' }] },
      { inputs: [{ type: 'replace', ids: ['docs', 'docs'] }] },
      { inputs: [{ type: 'tick', action: 'none' }] },
      {
        inputs: [
          { type: 'buy', id: 'hire-senior' },
          { type: 'buy', id: 'hire-senior' },
        ],
      },
      { inputs: [{ type: 'start' }, { type: 'start' }] },
      {
        inputs: [
          { type: 'buy', id: 'hire-senior' },
          { type: 'start' },
          { type: 'play', id: 'hire-senior' },
          { type: 'play', id: 'hire-senior' },
        ],
      },
    ])
      expect(
        restorePublicDraft(
          JSON.stringify({
            ...JSON.parse(savePublicDraft(createPublicDraft('RI-269'))),
            ...mutation,
          }),
        ),
      ).toBeNull();
  });

  it('全45件の記録を実simで再計算し、品質と期限の感度・未準備の完走を区別する', () => {
    expect(
      comparison.contract.offers.map((offer) => ({
        id: offer.id,
        acquisitionCost: offer.acquisitionCost,
      })),
    ).toEqual(PUBLIC_DRAFT_OFFERS);
    const rows = (
      Object.keys(PUBLIC_DRAFT_CONDITIONS) as (keyof typeof PUBLIC_DRAFT_CONDITIONS)[]
    ).flatMap((condition) =>
      ['RI-269', 'RI-269:1', 'RI-269:2'].flatMap((seed) => comparePublicDraft(seed, condition)),
    );
    expect(rows).toEqual(comparison.results);
    const at = (condition: keyof typeof PUBLIC_DRAFT_CONDITIONS, seed: string, build: string) =>
      rows.find((row) => row.condition === condition && row.seed === seed && row.build === build)!
        .result;
    expect(at('control', 'RI-269:1', 'concentrated').delivered).toBeGreaterThan(
      at('control', 'RI-269:1', 'diversified').delivered,
    );
    expect(at('control', 'RI-269:2', 'diversified').delivered).toBeGreaterThan(
      at('control', 'RI-269:2', 'concentrated').delivered,
    );
    expect(at('control', 'RI-269:1', 'diversified').bossCleared).toBe(true);
    expect(at('quality-pressure', 'RI-269:1', 'diversified').bossCleared).toBe(false);
    expect(at('short-deadline', 'RI-269:1', 'diversified').timedOut).toBe(true);
    expect(at('short-deadline', 'RI-269:1', 'concentrated').bossCleared).toBe(true);
    const control = rows.filter((row) => row.condition === 'control');
    expect(control.some((row) => row.build === 'unprepared' && !row.result.timedOut)).toBe(true);
    expect(
      control.filter((row) => row.build === 'throughput').every((row) => !row.result.bossCleared),
    ).toBe(true);
    expect(rows.some((row) => row.result.bossCleared)).toBe(true);
    expect(rows.some((row) => row.result.timedOut)).toBe(true);
    for (const row of rows) {
      expect(row.result.acquisitionSpent).toBeLessThanOrEqual(6);
      expect(row.result.focusRemaining).toBeGreaterThanOrEqual(0);
      if (row.result.timedOut) expect(row.result.bossCleared).toBe(false);
    }
  });
});
