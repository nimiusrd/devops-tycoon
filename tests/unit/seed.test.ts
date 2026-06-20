import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, resolveSeed } from '../../src/sim/seed';

describe('resolveSeed', () => {
  it('?seed= の値を解決する', () => {
    expect(resolveSeed('?seed=abc')).toBe('abc');
  });

  it('seed が無ければ既定値を返す', () => {
    expect(resolveSeed('')).toBe(DEFAULT_SEED);
    expect(resolveSeed('?foo=bar')).toBe(DEFAULT_SEED);
  });

  it('空の seed は既定値へフォールバックする', () => {
    expect(resolveSeed('?seed=')).toBe(DEFAULT_SEED);
  });

  it('fallback を指定できる', () => {
    expect(resolveSeed('', 'custom')).toBe('custom');
  });
});
