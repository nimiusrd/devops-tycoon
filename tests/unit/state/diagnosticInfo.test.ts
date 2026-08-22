import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { CURRENT_RUN_RULESET } from '../../../src/state/runPersistence';
import {
  createRunDiagnosticInfo,
  formatRunRuleset,
  serializeRunDiagnosticInfo,
} from '../../../src/state/diagnosticInfo';

describe('RI-121 ラン診断情報', () => {
  it('デイリーのseed・日付・ルールセット・開始条件を公開する', () => {
    const game = createGame({ seed: 'diagnostic-title' });
    game.startDailyRun('2026-08-22');

    const info = game.getDiagnosticInfo();

    expect(info).toMatchObject({
      schemaVersion: 1,
      seed: 'daily-2026-08-22',
      ruleset: CURRENT_RUN_RULESET,
      runKind: 'daily',
      dailyDate: '2026-08-22',
      difficulty: 'normal',
      trials: [],
      phase: 'setup',
      status: 'playing',
    });
    expect(info.diagnosis).toBe(game.getState().diagnosis);
  });

  it('診断JSONはキー順と完全な指紋を固定する', () => {
    const game = createGame({ seed: 'diagnostic-json' });
    game.startDailyRun('2026-08-22');
    const info = game.getDiagnosticInfo();

    const raw = serializeRunDiagnosticInfo(info);
    expect(raw).toBe(serializeRunDiagnosticInfo(info));
    expect(JSON.parse(raw)).toEqual(info);
    expect(raw).toContain(CURRENT_RUN_RULESET.fingerprint);
  });

  it('旧リプレイ相当のルールセット不明をJSONへ保持する', () => {
    const game = createGame({ seed: 'diagnostic-legacy' });
    const info = createRunDiagnosticInfo(game.getState(), null);

    expect(info.ruleset).toBeNull();
    expect(formatRunRuleset(info.ruleset)).toBe('ルールセット不明');
    expect(JSON.parse(serializeRunDiagnosticInfo(info)).ruleset).toBeNull();
  });

  it('公開診断情報の配列を変更してもGameHandleの状態を汚染しない', () => {
    const game = createGame({ seed: 'diagnostic-clone' });
    const info = game.getDiagnosticInfo();
    info.trials.push('mutated');

    expect(game.getDiagnosticInfo().trials).toEqual([]);
    expect(game.getDiagnosticInfo().ruleset).toEqual(CURRENT_RUN_RULESET);
  });
});
