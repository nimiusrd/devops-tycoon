import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const copyState = vi.hoisted(() => ({ value: 'idle' }));

// Node ではコピー通知の state と provider の接続だけを代行する。
// 判定・報酬・診断 JSON・クリップボード処理は実装を通す。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [copyState.value, (value: string) => (copyState.value = value)],
}));
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { createRunDiagnosticInfo } from '../../../src/state/diagnosticInfo';
import { computeRunRewardBreakdown, dailyRunKey, defaultMeta } from '../../../src/state/meta';
import { RunResultScreen, type RunResultScreenProps } from '../../../src/ui/RunResultScreen';
import { adjustableReview } from '../helpers/runEngineFixtures';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'run-result-interactions', difficulty: 'easy' });
  engine.startRun();
  return { ...engine.snapshot(), status: 'won', phase: 'won', winType: 'normal', ...overrides };
}

const ruleset = { version: 2, fingerprint: 'recorded-ruleset-fingerprint' };

function mountResult(overrides: Partial<RunResultScreenProps> = {}) {
  const state = overrides.state ?? makeState();
  const onNewRun = vi.fn();
  const props: RunResultScreenProps = {
    state,
    meta: defaultMeta(),
    diagnosticInfo: createRunDiagnosticInfo(state, ruleset),
    onNewRun,
    ...overrides,
  };
  let tree = RunResultScreen(props);
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    find,
    onNewRun,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    details: () => elements(tree).find((item) => item.type === 'details')!,
    click(id: string) {
      (find(id).props.onClick as () => void)();
    },
    async settleCopy(status: 'copied' | 'error') {
      await vi.waitFor(() => expect(copyState.value).toBe(status));
      tree = RunResultScreen(props);
    },
  };
}

beforeEach(() => {
  copyState.value = 'idle';
});
afterEach(() => vi.unstubAllGlobals());

describe('RunResultScreen の勝敗・報酬表示', () => {
  it.each([false, true])(
    '勝利称号の登録済み=%s とボス報酬を表示して次のランへ進む',
    (collected) => {
      const screen = mountResult({
        state: makeState({ bossRelicReward: 'flow-first' }),
        meta: { ...defaultMeta(), collectedWinTypes: collected ? ['normal'] : [] },
        lastRunReward: computeRunRewardBreakdown({
          won: true,
          difficulty: 'easy',
          score: 120,
          maxCombo: 3,
          scoreMul: 1,
          quarterReviews: ['exceeded'],
        }),
      });
      expect(screen.find('run-result').props['data-status']).toBe('won');
      expect(content(screen.find('run-end-status'))).toBe('🏆 通常勝利');
      expect(screen.find('run-win-title').props['data-collected']).toBe(String(collected));
      expect(content(screen.find('run-win-title')).includes('コレクションに登録済み')).toBe(
        collected,
      );
      expect(content(screen.find('boss-relic-reward'))).toContain('フロー重視');
      expect(content(screen.find('meta-reward-total'))).toMatch(/^今回 \+\d+ pt$/);
      expect(content(screen.find('meta-reward-review'))).toContain('超過達成');
      expect(screen.has('meta-reward-learning')).toBe(false);
      expect(screen.has('lose-next-action')).toBe(false);
      screen.click('new-run');
      expect(screen.onNewRun).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    '敗因ラベルと継続不能の助言を表示し、失敗図鑑の登録済み=%s と学習報酬を示す',
    (collected) => {
      const screen = mountResult({
        state: makeState({
          status: 'lost',
          phase: 'lost',
          winType: undefined,
          loseReason: 'reviewFreeze',
          diagnosis: 'reviewHell',
          quarterReview: { ...adjustableReview([]), outcome: 'shutdown' },
        }),
        meta: { ...defaultMeta(), collectedDiagnoses: collected ? ['reviewHell'] : [] },
        lastRunReward: computeRunRewardBreakdown({
          won: false,
          difficulty: 'easy',
          score: 25,
          maxCombo: 1,
          scoreMul: 1,
          quarterReviews: ['missed_adjustable'],
        }),
      });
      expect(screen.find('run-result').props['data-quarter-outcome']).toBe('shutdown');
      expect(content(screen.find('run-end-status'))).toBe('⏹️ PR 凍結');
      // ラベルは敗因優先。shutdown の助言は四半期の継続条件を優先する。
      expect(content(screen.find('lose-next-action'))).toContain(
        '信頼・予算・士気・シニアHPのどの下限が先に危ないか',
      );
      expect(content(screen.find('lose-insight'))).toBe(
        '継続不能の条件は複数あり、原因と違う手を打つと悪化することがある。',
      );
      const entry = screen.find('failure-encyclopedia-registered');
      expect(entry.props['data-collected']).toBe(String(collected));
      expect(content(entry)).toContain(
        collected ? 'AI導入失敗図鑑に登録済み' : 'AI導入失敗図鑑の候補',
      );
      expect(content(screen.find('meta-reward-learning'))).toContain('敗北学習');
      expect(screen.has('meta-reward-review')).toBe(false);
      expect(screen.has('run-win-title')).toBe(false);
    },
  );

  it('同日の別ルールセットの記録を混ぜず、デイリー再走の報酬受領済みを表示する', () => {
    const state = makeState({ runKind: 'daily', dailyDate: '2026-09-04' });
    state.totals.delivered = 120;
    const screen = mountResult({
      state,
      meta: {
        ...defaultMeta(),
        dailyRuns: {
          [dailyRunKey('2026-09-04', ruleset)]: { bestScore: 180, rewardClaimed: true },
          [dailyRunKey('2026-09-04', { version: 1, fingerprint: 'older' })]: {
            bestScore: 999,
            rewardClaimed: false,
          },
        },
      },
      lastRunReward: {
        ...computeRunRewardBreakdown({
          won: true,
          difficulty: 'easy',
          score: 120,
          maxCombo: 3,
          scoreMul: 1,
        }),
        granted: false,
      },
    });
    expect(content(screen.find('run-delivered'))).toBe('120 pt');
    expect(content(screen.find('run-daily-summary'))).toBe(
      'デイリー 2026-09-04 — 今回 120 pt / 今日のベスト 180 pt（本日の報酬は受領済み）',
    );
    expect(content(screen.find('meta-reward-total'))).toBe('今回 +0 pt（本日の報酬は受領済み）');
    expect(screen.has('meta-reward-breakdown')).toBe(false);
  });

  it('ルールセット不明なら日付一致だけで記録を結びつけない', () => {
    const state = makeState({ runKind: 'daily', dailyDate: '2026-09-04' });
    const screen = mountResult({
      state,
      diagnosticInfo: createRunDiagnosticInfo(state, null),
      meta: {
        ...defaultMeta(),
        dailyRuns: { [dailyRunKey('2026-09-04')]: { bestScore: 999, rewardClaimed: true } },
      },
    });
    expect(content(screen.find('diagnostic-ruleset'))).toBe('ルールセット不明');
    expect(screen.find('diagnostic-ruleset').props['data-ruleset-known']).toBe('false');
    expect(content(screen.find('run-daily-summary'))).not.toContain('今日のベスト');
    expect(screen.has('meta-reward-total')).toBe(false);
  });
});

describe('RunResultScreen の診断コピー', () => {
  it('完全なルールセットとラン条件をコピーし、完了を通知する', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const screen = mountResult();
    expect(content(screen.find('diagnostic-copy-status'))).toBe('');
    expect(content(screen.find('diagnostic-ruleset'))).toBe('v2 / recorded-ruleset-fingerprint');
    expect(screen.details().props.open).toBe(false);
    screen.click('copy-diagnostic-info');
    await screen.settleCopy('copied');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(screen.find('diagnostic-json').props.value);
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toMatchObject({
      seed: 'run-result-interactions',
      ruleset,
      difficulty: 'easy',
      phase: 'won',
      status: 'won',
    });
    expect(content(screen.find('diagnostic-copy-status'))).toBe('再現情報をコピーしました。');
    expect(screen.details().props.open).toBe(false);
  });

  it('コピーが拒否されたら手動選択用 JSON を開き、再試行成功後にエラーを解除する', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('permission denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', undefined);
    const screen = mountResult();
    screen.click('copy-diagnostic-info');
    await screen.settleCopy('error');
    expect(content(screen.find('diagnostic-copy-status'))).toContain('下のJSONを選択してコピー');
    expect(screen.details().props.open).toBe(true);
    expect(screen.find('diagnostic-json').props.readOnly).toBe(true);
    writeText.mockResolvedValueOnce(undefined);
    screen.click('copy-diagnostic-info');
    await screen.settleCopy('copied');
    expect(content(screen.find('diagnostic-copy-status'))).toBe('再現情報をコピーしました。');
    expect(screen.details().props.open).toBe(false);
  });
});
