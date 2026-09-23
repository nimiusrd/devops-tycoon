import { describe, expect, it } from 'vitest';
import { resolveRdFlag, resolveRdScenario } from '../../../../src/rd/intervene/query';

describe('resolveRdFlag', () => {
  it('?rd=intervene だけを試作入口にする', () => {
    expect(resolveRdFlag('?rd=intervene')).toBe('intervene');
    expect(resolveRdFlag('?rd=intervene&scenario=stable')).toBe('intervene');
  });

  it('未知値・空では本番経路のままにする', () => {
    expect(resolveRdFlag('')).toBeNull();
    expect(resolveRdFlag('?seed=abc')).toBeNull();
    expect(resolveRdFlag('?rd=538')).toBeNull();
    expect(resolveRdFlag('?rd=')).toBeNull();
  });
});

describe('resolveRdScenario', () => {
  it('安定シードだけを stable と読む', () => {
    expect(resolveRdScenario('?rd=intervene&scenario=stable')).toBe('stable');
    expect(resolveRdScenario('?rd=intervene')).toBe('crisis');
    expect(resolveRdScenario('?scenario=crisis')).toBe('crisis');
    expect(resolveRdScenario('')).toBe('crisis');
  });
});
