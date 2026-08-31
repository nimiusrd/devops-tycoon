import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cloneRng,
  createRng,
  createRngFromState,
  getRngState,
  hashSeed,
  mulberry32,
  randInt,
  randRange,
} from '../../../src/sim/rng';
import { propertyParameters } from '../helpers/property';

const uint32Arbitrary = fc.integer({ min: 0, max: 0xffff_ffff });
const sequenceLengthArbitrary = fc.integer({ min: 1, max: 64 });
const consumptionArbitrary = fc.integer({ min: 0, max: 64 });
const unitArbitrary = uint32Arbitrary.map((value) => value / 4_294_967_296);

function take(rng: () => number, length: number): number[] {
  return Array.from({ length }, () => rng());
}

describe('seed付きRNG property', () => {
  // 要件: 同一seedは同一系列を返し、出力は [0, 1)。検出例: seedを無視してMath.randomを使う。
  it('同じ32bit seedから同じ範囲内の系列を生成する', () => {
    fc.assert(
      fc.property(uint32Arbitrary, sequenceLengthArbitrary, (seed, length) => {
        const first = take(mulberry32(seed), length);
        const second = take(mulberry32(seed), length);
        expect(first).toEqual(second);
        for (const value of first) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
      propertyParameters(),
    );
  });

  // 要件: 数値seedは符号なし32bitへ丸める。検出例: >>> 0 を省いて高位bitを系列へ混ぜる。
  it('2^32の整数倍だけ離れた数値seedを同じ系列へ写す', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -0x7fff_ffff, max: 0x7fff_ffff }),
        fc.integer({ min: -1_024, max: 1_024 }),
        sequenceLengthArbitrary,
        (seed, turns, length) => {
          const equivalent = seed + turns * 4_294_967_296;
          expect(hashSeed(equivalent)).toBe(hashSeed(seed));
          expect(take(createRng(equivalent), length)).toEqual(take(createRng(seed), length));
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: 保存状態から次の値以降を再現する。検出例: 状態更新前の値を保存する。
  it('任意回数消費した状態から元の続きを復元する', () => {
    fc.assert(
      fc.property(
        uint32Arbitrary,
        consumptionArbitrary,
        sequenceLengthArbitrary,
        (seed, consumed, length) => {
          const source = mulberry32(seed);
          take(source, consumed);
          const restored = createRngFromState(getRngState(source));
          expect(take(restored, length)).toEqual(take(source, length));
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: cloneは同じ位置から独立して進む。検出例: 元とcloneで同じ可変stateを共有する。
  it('cloneを元RNGの追加消費から分離する', () => {
    fc.assert(
      fc.property(
        uint32Arbitrary,
        consumptionArbitrary,
        sequenceLengthArbitrary,
        sequenceLengthArbitrary,
        (seed, consumed, sourceAdvance, length) => {
          const source = mulberry32(seed);
          take(source, consumed);
          const cloned = cloneRng(source);
          const control = createRngFromState(getRngState(source));
          take(source, sourceAdvance);
          expect(take(cloned, length)).toEqual(take(control, length));
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: randRangeは半開区間を守る。検出例: 幅へ+1して上端を含める。
  it('任意の単位乱数をrandRangeの半開区間へ写す', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        unitArbitrary,
        (min, width, unit) => {
          const max = min + width;
          const actual = randRange(() => unit, min, max);
          expect(actual).toBeGreaterThanOrEqual(min);
          expect(actual).toBeLessThan(max);
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: randIntは整数の閉区間で両端と単一点を扱う。検出例: max+1を省いて上端を除外する。
  it('randIntの結果を閉区間へ収め、単位乱数の両端を整数境界へ対応させる', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        unitArbitrary,
        (min, width, unit) => {
          const max = min + width;
          const actual = randInt(() => unit, min, max);
          expect(Number.isInteger(actual)).toBe(true);
          expect(actual).toBeGreaterThanOrEqual(min);
          expect(actual).toBeLessThanOrEqual(max);
          expect(randInt(() => 0, min, max)).toBe(min);
          expect(randInt(() => 1 - 1 / 4_294_967_296, min, max)).toBe(max);
          expect(randInt(() => unit, min, min)).toBe(min);
        },
      ),
      propertyParameters(),
    );
  });
});
