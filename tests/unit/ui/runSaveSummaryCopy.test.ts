import { describe, expect, it } from 'vitest';
import type { RunSaveSummary } from '../../../src/state/runPersistence';
import {
  resumableRunDetail,
  resumableRunHeadline,
  startDailyConfirmRiskText,
  startDailyConfirmTitle,
} from '../../../src/ui/runSaveSummaryCopy';

function summary(overrides: Partial<RunSaveSummary> = {}): RunSaveSummary {
  return {
    seed: 'ri367',
    difficulty: 'easy',
    trials: [],
    runKind: 'normal',
    phase: 'evolution',
    quarterNumber: 1,
    sprintIndexInQuarter: 2,
    sprintsPlayed: 2,
    status: 'playing',
    ...overrides,
  };
}

describe('runSaveSummaryCopy', () => {
  it('中断ランの見出しに難易度・四半期・フェーズを並べる', () => {
    expect(resumableRunHeadline(summary())).toBe('Easy / Q1 進化');
  });

  it('詳細はスプリント完了数を示し、デイリーなら日付を添える', () => {
    expect(resumableRunDetail(summary())).toBe('スプリント 2 完了');
    expect(
      resumableRunDetail(
        summary({ runKind: 'daily', dailyDate: '2026-08-27', seed: 'daily-2026-08-27' }),
        { includeSeed: true },
      ),
    ).toBe('seed: daily-2026-08-27 · スプリント 2 完了 · デイリー 2026-08-27');
  });
});

describe('startDailyConfirmCopy', () => {
  it('再開できるときは再開を先に選ばせる', () => {
    expect(startDailyConfirmTitle(true)).toBe('中断中のランがあります');
    expect(startDailyConfirmRiskText(true)).toContain('先に再開するか');
    expect(startDailyConfirmRiskText(true)).toContain('続きから再開できなくなります');
  });

  it('再開できないときは再開を案内しない', () => {
    expect(startDailyConfirmTitle(false)).toBe('再開できないセーブがあります');
    expect(startDailyConfirmRiskText(false)).not.toContain('先に再開するか');
    expect(startDailyConfirmRiskText(false)).toContain(
      '戻るか、中断ランを捨ててデイリーを始めるか',
    );
  });
});
