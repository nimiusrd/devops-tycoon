import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clamp } from '../../../src/sim/clamp';
import { propertyParameters } from '../helpers/property';

const intervalArbitrary = fc
  .record({
    min: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    width: fc.integer({ min: 0, max: 1_000_000 }),
  })
  .map(({ min, width }) => ({ min, max: min + width }));

const finiteNumberArbitrary = fc.oneof(
  fc.constantFrom(-0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  fc.double({ min: -1_000_000_000, max: 1_000_000_000, noNaN: true }),
);

describe('clamp property', () => {
  // 要件: min <= max なら出力は閉区間内。検出例: Math.min/Math.max の順序を逆にする。
  it('任意の有限値を常に指定した閉区間へ収める', () => {
    fc.assert(
      fc.property(finiteNumberArbitrary, intervalArbitrary, (value, { min, max }) => {
        const actual = clamp(value, min, max);
        expect(actual).toBeGreaterThanOrEqual(min);
        expect(actual).toBeLessThanOrEqual(max);
      }),
      propertyParameters(),
    );
  });

  // 要件: 区間内の値は情報を失わない。検出例: 常に境界へ寄せる、または整数へ丸める。
  it('区間内の値と両境界を変更しない', () => {
    fc.assert(
      fc.property(
        intervalArbitrary.chain(({ min, max }) =>
          fc.integer({ min, max }).map((value) => ({ min, max, value })),
        ),
        ({ min, max, value }) => {
          expect(clamp(value, min, max)).toBe(value);
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: 区間外では近い側の境界へ飽和する。検出例: 下限超過時に max を返す。
  it('下限未満と上限超過をそれぞれ正しい境界へ飽和させる', () => {
    fc.assert(
      fc.property(
        intervalArbitrary,
        fc.integer({ min: 1, max: 1_000_000 }),
        ({ min, max }, delta) => {
          expect(clamp(min - delta, min, max)).toBe(min);
          expect(clamp(max + delta, min, max)).toBe(max);
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: clamp 済みの値は正規形。検出例: 呼び出すたびに境界から1ずつずらす。
  it('同じ区間への再適用で結果が変わらない', () => {
    fc.assert(
      fc.property(finiteNumberArbitrary, intervalArbitrary, (value, { min, max }) => {
        const once = clamp(value, min, max);
        expect(clamp(once, min, max)).toBe(once);
      }),
      propertyParameters(),
    );
  });

  // 要件: 入力順序を保つ。検出例: 上限・下限の分岐条件を反転する。
  it('入力が増加しても出力は減少しない', () => {
    fc.assert(
      fc.property(
        intervalArbitrary,
        fc.integer({ min: -2_000_000, max: 2_000_000 }),
        fc.integer({ min: -2_000_000, max: 2_000_000 }),
        ({ min, max }, left, right) => {
          const lower = Math.min(left, right);
          const upper = Math.max(left, right);
          expect(clamp(lower, min, max)).toBeLessThanOrEqual(clamp(upper, min, max));
        },
      ),
      propertyParameters(),
    );
  });
});
