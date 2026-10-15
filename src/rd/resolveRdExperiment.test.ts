import { describe, expect, it } from 'vitest';
import { rdExperimentPath, resolveRdExperiment } from './resolveRdExperiment';

describe('R&D クエリ入口', () => {
  it('未知の rd は無視する', () => {
    expect(resolveRdExperiment('?rd=999')).toBeNull();
    expect(resolveRdExperiment('')).toBeNull();
  });

  it('#735 の腕と seed を読む', () => {
    expect(resolveRdExperiment('?rd=735')).toEqual({ id: '735', arm: 'none', seed: 'RI-735' });
    expect(resolveRdExperiment('?rd=queue-moves&arm=reserve&seed=abc')).toEqual({
      id: '735',
      arm: 'reserve',
      seed: 'abc',
    });
    expect(rdExperimentPath('reserve')).toBe('/?rd=735&arm=reserve&seed=RI-735');
  });
});
