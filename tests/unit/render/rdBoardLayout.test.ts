import { describe, expect, it } from 'vitest';
import {
  isRdBoardPrototypeActive,
  replaceRdLayoutInSearch,
  resolveRdLayout,
  resolveRdScene,
} from '../../../src/render/rdBoardLayout';

describe('rdBoardLayout（R&D A/B クエリ）', () => {
  it('未指定と未知値は現行 iso のまま', () => {
    expect(resolveRdLayout('')).toBe('iso');
    expect(resolveRdLayout('?seed=abc')).toBe('iso');
    expect(resolveRdLayout('?rd=ortho')).toBe('iso');
  });

  it('?rd=lane だけレーン盤面にする', () => {
    expect(resolveRdLayout('?rd=lane')).toBe('lane');
    expect(resolveRdLayout('?rd=iso&rdScene=stress')).toBe('iso');
  });

  it('?rdScene=stress だけ固定場面にする', () => {
    expect(resolveRdScene('')).toBe('live');
    expect(resolveRdScene('?rdScene=stress')).toBe('stress');
    expect(resolveRdScene('?rdScene=other')).toBe('live');
  });

  it('rd または rdScene があるときだけプロトタイプ UI を出す', () => {
    expect(isRdBoardPrototypeActive('')).toBe(false);
    expect(isRdBoardPrototypeActive('?rd=iso')).toBe(true);
    expect(isRdBoardPrototypeActive('?rdScene=stress')).toBe(true);
  });

  it('rd 以外のクエリを残してレイアウトだけ差し替える', () => {
    expect(replaceRdLayoutInSearch('?rdScene=stress&tutorial=off', 'lane')).toBe(
      '?rdScene=stress&tutorial=off&rd=lane',
    );
  });

  it('location が無いテスト環境では iso / live に落とす', async () => {
    const { resolveRdLayoutFromLocation, resolveRdSceneFromLocation } =
      await import('../../../src/render/rdBoardLayout');
    expect(resolveRdLayoutFromLocation()).toBe('iso');
    expect(resolveRdSceneFromLocation()).toBe('live');
  });
});
