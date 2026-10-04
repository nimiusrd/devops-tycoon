import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import { draftCompanyGuidance, setupObservation } from '../../../src/render/companyGuidanceView';
import { formatCardDefTags } from '../../../src/render/eventOutcomeView';
import { RunEngine } from '../../../src/sim/run/engine';
import { directRoster } from '../helpers/whatIfFixtures';

function state() {
  const engine = new RunEngine({ seed: 'company-guidance', difficulty: 'easy' });
  engine.startRun();
  const snapshot = engine.snapshot();
  return {
    ...snapshot,
    roster: structuredClone(directRoster),
    org: { ...snapshot.org, seniorHp: 80 },
  };
}

describe('現在の会社に対応したドラフト説明', () => {
  it.each([13, 14, 15])('コスト意識の割引後価格14と予算%sを比較する', (budget) => {
    const input = state();
    input.relics = ['budget-discipline'];
    input.budget = budget;
    const text = draftCompanyGuidance(getCard('auto-test')!, input)!;
    if (budget < 14) expect(text).toContain('ショップ価格14には予算不足');
    else expect(text).not.toContain('予算不足');
    expect(text).not.toContain('ショップ価格18');
    expect(text).toContain('取得は無料');
  });

  it('組織の現在値を丸め、内部の小数値は変更しない', () => {
    const input = state();
    input.org.aiDependency = 27.200000000000003;
    input.org.securityLevel = 69.80000000000001;
    input.org.quality = 70.60000000000001;
    const before = structuredClone(input);
    expect(draftCompanyGuidance(getCard('copilot')!, input)).toContain(
      'AI依存度27・セキュリティ70',
    );
    expect(draftCompanyGuidance(getCard('auto-test')!, input)).toContain('品質71・セキュリティ70');
    expect(input).toEqual(before);
  });

  it.each(['copilot', 'auto-test'])('代表カード %s の助けと代償は実定義のタグを使う', (id) => {
    const input = state();
    const before = structuredClone(input);
    const def = getCard(id)!;
    const text = draftCompanyGuidance(def, input)!;
    for (const tag of formatCardDefTags(def).filter((tag) => tag.tone === 'negative')) {
      expect(text).toContain(tag.label);
    }
    const benefit = id === 'copilot' ? 'Coding速度 x1.15' : '手戻り率 -15%';
    expect(text).toContain(benefit);
    expect(text).toContain(`集中力${def.focusCost}`);
    expect(text).toContain('Coding担当1人');
    expect(text).toContain('出荷の見込み');
    expect(text).toContain('取得は無料');
    expect(input).toEqual(before);
  });

  it('対象なし・ショップ予算不足でも無料ドラフトの取得を妨げない説明になる', () => {
    const input = state();
    input.budget = 0;
    input.roster.members[0].onLeave = true;
    const text = draftCompanyGuidance(getCard('copilot')!, input)!;
    expect(text).toContain('配置対象なし');
    expect(text).toContain('ショップ価格1には予算不足');
    expect(text).toContain('取得は無料');
  });

  it('代表以外には追加説明を作らず、定義変更もタグから追従する', () => {
    expect(draftCompanyGuidance(getCard('docs')!, state())).toBeNull();
    const def = {
      ...getCard('copilot')!,
      base: { codingSpeedMul: 0.8, qualityAdd: 7 },
      focusCost: 5,
    };
    const text = draftCompanyGuidance(def, state())!;
    expect(text).toContain('助け: 品質 +7');
    expect(text).toContain('代償: Coding速度 x0.80、集中力5');
    expect(text).not.toContain('AI依存度 +5');
  });
});

describe('準備画面の観察入口', () => {
  it('健全状態とCoding担当もいない状態では予兆を作らない', () => {
    const input = state();
    expect(setupObservation(input)).toBeNull();
    input.roster.members.forEach((m) => {
      m.assignment = 'bench';
    });
    expect(setupObservation(input)).toBeNull();
  });

  it('休職中のレビュアーは除き、人数と対象工程を明示する', () => {
    const input = state();
    input.roster.members[1].onLeave = true;
    expect(setupObservation(input)).toMatchObject({ id: 'review-staff' });
    expect(setupObservation(input)!.text).toContain('Review担当 0人 / Coding担当 1人');
  });

  it('複数予兆ではHUDと同じ体力警告を安定して優先する', () => {
    const input = state();
    input.roster.members[1].assignment = 'bench';
    input.org.seniorHp = 24;
    const before = structuredClone(input);
    expect(setupObservation(input)).toEqual(setupObservation(input));
    expect(setupObservation(input)).toMatchObject({ id: 'senior-hp' });
    expect(setupObservation(input)!.text).toContain('24%（燃え尽き危険）');
    expect(input).toEqual(before);
    input.org.seniorHp = 49;
    expect(setupObservation(input)!.text).toContain('体力注意');
    input.org.seniorHp = 50;
    expect(setupObservation(input)).toMatchObject({ id: 'review-staff' });
  });
});
