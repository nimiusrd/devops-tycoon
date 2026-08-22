import { describe, expect, it } from 'vitest';
import { resolveSelectedReplayId } from '../../../src/ui/replayListSelection';

describe('リプレイ一覧の選択同期', () => {
  it('残っている ID はそのまま使う', () => {
    expect(resolveSelectedReplayId([{ id: 'a' }, { id: 'b' }], 'b')).toBe('b');
  });

  it('消えた ID は先頭へ戻す', () => {
    expect(resolveSelectedReplayId([{ id: 'new' }, { id: 'mid' }], 'old')).toBe('new');
  });

  it('一覧が空なら選択なし', () => {
    expect(resolveSelectedReplayId([], 'old')).toBeNull();
  });
});
