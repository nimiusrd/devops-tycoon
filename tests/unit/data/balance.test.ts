import { describe, expect, it } from 'vitest';
import {
  BALANCE_REGISTRY,
  PROCESS_BALANCE,
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
  validateBalanceRegistry,
} from '../../../src/data/balance';
import { AI_ADOPTION, AI_CODING_SPEEDUP, CODING_BASE_TICKS } from '../../../src/sim/model/process';

describe('型付きバランスレジストリ', () => {
  it('集約済みの代表値が検証を通り、既存 export と同じ値を返す', () => {
    expect(validateBalanceRegistry(BALANCE_REGISTRY)).toEqual([]);
    expect(CODING_BASE_TICKS).toBe(PROCESS_BALANCE.codingBaseTicks.value);
    expect(AI_CODING_SPEEDUP).toBe(PROCESS_BALANCE.aiCodingSpeedup.value);
    expect(AI_ADOPTION).toBe(PROCESS_BALANCE.aiAdoption.value);
  });

  it('重複した安定IDを検出する', () => {
    const duplicate = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      value: 8,
    });

    expect(validateBalanceRegistry([...BALANCE_REGISTRY, duplicate])).toContainEqual(
      expect.objectContaining({ code: 'duplicate-id', id: 'process.coding.baseTicks' }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('非有限値 %p を検出する', (value) => {
    const invalid = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: `test.non-finite.${String(value)}`,
      value,
    });

    expect(validateBalanceRegistry([invalid])).toContainEqual(
      expect.objectContaining({ code: 'non-finite-value', id: invalid.id }),
    );
  });

  it('非有限な許容範囲、範囲の逆転、許容範囲外の値を検出する', () => {
    const invalidRange = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: 'test.non-finite-range',
      allowedRange: { min: 1, max: Number.POSITIVE_INFINITY },
    });
    const invertedRange = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: 'test.inverted-range',
      allowedRange: { min: 8, max: 7 },
    });
    const outOfRange = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: 'test.value-out-of-range',
      value: 31,
    });

    const codes = validateBalanceRegistry([invalidRange, invertedRange, outOfRange]).map(
      (error) => error.code,
    );
    expect(codes).toContain('non-finite-range');
    expect(codes).toContain('range-inverted');
    expect(codes).toContain('value-out-of-range');
  });

  it('確率の単位範囲を検出する', () => {
    const invalidProbability = defineBalanceEntry({
      ...PROCESS_BALANCE.aiAdoption,
      id: 'test.probability-out-of-range',
      value: 1.1,
      allowedRange: { min: 0, max: 2 },
    });

    expect(validateBalanceRegistry([invalidProbability])).toContainEqual(
      expect.objectContaining({ code: 'probability-out-of-range', id: invalidProbability.id }),
    );
  });

  it('確率分布の非正重みと合計不一致を検出する', () => {
    const invalidDistribution = defineProbabilityDistribution({
      id: 'test.invalid-distribution',
      unit: 'probability',
      allowedRange: { min: 0, max: 1 },
      label: '不正な確率分布',
      description: '検証テスト用。',
      tags: ['test'],
      derived: false,
      entries: [
        defineBalanceEntry({
          id: 'test.invalid-distribution.none',
          value: 0,
          unit: 'probability',
          allowedRange: { min: 0, max: 1 },
          label: 'ゼロ重み',
          description: '検証テスト用。',
          tags: ['test'],
          derived: false,
        }),
        defineBalanceEntry({
          id: 'test.invalid-distribution.partial',
          value: 0.6,
          unit: 'probability',
          allowedRange: { min: 0, max: 1 },
          label: '合計不足',
          description: '検証テスト用。',
          tags: ['test'],
          derived: false,
        }),
      ],
    });

    const errors = validateBalanceRegistry([invalidDistribution]);
    expect(flattenBalanceEntries([invalidDistribution]).map((entry) => entry.id)).toEqual([
      'test.invalid-distribution.none',
      'test.invalid-distribution.partial',
    ]);
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'distribution-weight-not-positive',
        id: 'test.invalid-distribution.none',
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'distribution-total-invalid',
        id: 'test.invalid-distribution',
      }),
    );
  });
});
