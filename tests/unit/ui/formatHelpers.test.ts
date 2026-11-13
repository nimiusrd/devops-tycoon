import { describe, expect, it } from 'vitest';
import { formatSigned, formatSignedHudFeedback } from '../../../src/ui/formatSigned';
import { pct } from '../../../src/ui/pct';
import { formatReplayRuleset } from '../../../src/ui/replayRuleset';

describe('UI 表示フォーマッタ', () => {
  it('増加だけ正符号を付け、0 と減少は数値表現を維持する', () => {
    expect(formatSigned(3)).toBe('+3');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(-2)).toBe('-2');
  });

  it('HUD 増減は 1000 未満をそのまま、以上は k 表記に縮める（#954）', () => {
    expect(formatSignedHudFeedback(120)).toBe('+120');
    expect(formatSignedHudFeedback(999)).toBe('+999');
    expect(formatSignedHudFeedback(1000)).toBe('+1k');
    expect(formatSignedHudFeedback(1200)).toBe('+1.2k');
    expect(formatSignedHudFeedback(-1000)).toBe('-1k');
    expect(formatSignedHudFeedback(-1050)).toBe('-1.1k');
    expect(formatSignedHudFeedback(0)).toBe('0');
  });

  it('設計座標を CSS の割合へ変換する', () => {
    expect(pct(702, 1404)).toBe('50%');
    expect(pct(0, 573)).toBe('0%');
  });

  it('記録済みルールセットを表示し、旧リプレイには不明表示を返す', () => {
    expect(formatReplayRuleset({ version: 3, fingerprint: 'sha256:abc' })).toBe('v3 / sha256:abc');
    expect(formatReplayRuleset(null)).toBe('ルールセット不明');
  });
});
