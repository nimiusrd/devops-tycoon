import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Node では ref とブラウザのフォーカスロックだけを代行する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

import type { GrowthOutcome } from '../../../src/sim/run/types';
import { summarizeSprint } from '../../../src/sim/sprint';
import type { SprintResult } from '../../../src/sim/types';
import {
  SprintResultScreen,
  type SprintResultScreenProps,
} from '../../../src/ui/SprintResultScreen';
import { completeSprint, makeOrg } from '../helpers/runEngineFixtures';

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

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  const org = makeOrg();
  const sprint = completeSprint('sprint-result-interactions', org);
  return { ...summarizeSprint(sprint, org), ...overrides };
}

function mountResult(overrides: Partial<SprintResultScreenProps> = {}) {
  const onContinue = vi.fn();
  const props: SprintResultScreenProps = { result: makeResult(), onContinue, ...overrides };
  const nodes = elements(SprintResultScreen(props));
  const find = (id: string) => {
    const node = nodes.find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    find,
    onContinue,
    has: (id: string) => nodes.some((item) => item.props['data-testid'] === id),
    row(label: string) {
      const row = nodes.find(
        (item) =>
          item.props.className === 'result-row' &&
          elements(item).some((child) => child.type === 'dt' && content(child) === label),
      );
      if (!row) throw new Error(`結果行がありません: ${label}`);
      return content(elements(row).find((item) => item.type === 'dd'));
    },
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

const emptyGrowth: GrowthOutcome = {
  promotions: [],
  leveledUp: [],
  wentOnLeave: [],
  docGain: 0,
};

describe('SprintResultScreen の結果表示と進行', () => {
  it('集計値と正の介入回数を表示し、カードドラフトへ進む', () => {
    const screen = mountResult({
      result: makeResult({
        done: 12,
        delivered: 84,
        maxCombo: 4,
        aiAssistedPct: 75,
        reviewQueueMax: 9,
        rework: 3,
        incidents: 2,
        contained: 1,
        spread: 1,
        actionCounts: { interruptReview: 3, firefight: 1, andon: 0 },
        title: '小さく出すチーム',
        diagnosis: 'レビュー介入が出荷を支えた。',
      }),
    });
    expect(screen.row('Done')).toBe('12 tasks');
    expect(screen.row('Delivered')).toBe('84 pt');
    expect(screen.row('Max Combo')).toBe('x4');
    expect(screen.row('AI Assisted')).toBe('75%');
    expect(screen.row('Review Queue Max')).toBe('9 PR');
    expect(screen.row('Rework')).toBe('3 tasks');
    expect(screen.row('Incidents')).toBe('2 (鎮火 1 / 延焼 1)');
    expect(screen.row('介入')).toBe('割り込みレビュー×3 / 緊急対応×1');
    expect(content(screen.find('result-diagnosis-text'))).toBe('レビュー介入が出荷を支えた。');
    expect(content(screen.find('result-title'))).toBe('「小さく出すチーム」');
    expect(content(screen.find('result-intervention-tip'))).toContain('延焼 1 件');
    expect(content(screen.find('result-continue'))).toBe('カードドラフトへ →');
    expect(screen.has('result-restart')).toBe(false);
    screen.click('result-continue');
    expect(screen.onContinue).toHaveBeenCalledOnce();
  });

  it('介入も成長ニュースもなければ分析を省略し、残量不明のシニア HP を捏造しない', () => {
    const screen = mountResult({ result: makeResult({ timeline: [] }), growth: emptyGrowth });
    expect(screen.row('介入')).toBe('なし');
    expect(screen.row('Senior HP')).toBe('—');
    expect(screen.has('result-intervention-analysis')).toBe(false);
    expect(screen.has('result-burn-cause')).toBe(false);
    expect(screen.has('result-growth')).toBe(false);
    expect(screen.has('result-review-hell-summary')).toBe(false);
  });

  it('記録された S 評価・HP 残量と鎮火の因果を表示する', () => {
    const screen = mountResult({
      result: makeResult({
        grade: 'S',
        gradeRatio: 1,
        seniorHpDelta: -40,
        incidents: 1,
        contained: 1,
        timeline: [{ tick: 20, reviewQueue: 0, burningCount: 0, combo: 3, seniorHp: 58 }],
        fireEvents: [
          { tick: 10, kind: 'ignite', taskId: 7, source: 'review' },
          { tick: 12, kind: 'contain', taskId: 7, combo: 3 },
        ],
      }),
    });
    expect(content(screen.find('result-grade'))).toBe('S');
    expect(content(screen.find('result-grade-caption'))).toContain('100%');
    expect(screen.row('Senior HP')).toBe('58');
    expect(content(screen.find('result-burn-cause-entry'))).toContain(
      't10: PR#7 が Review 落ちで点火 → t12 緊急対応で鎮火',
    );
    expect(content(screen.find('result-burn-cause-tip'))).toContain(
      '点火した火をすべて緊急対応で鎮火',
    );
  });

  it('次の移動先がないリプレイは継続を無効にし、理由とレビュー地獄の要約を表示する', () => {
    const onAbandon = vi.fn();
    const screen = mountResult({
      result: makeResult({ reviewQueueMax: 18 }),
      replayMode: true,
      diagnosis: 'reviewHell',
      continueLabel: '次の記録へ',
      continueDisabled: true,
      continueDisabledReason: 'これが最後の記録です',
      onAbandon,
    });
    expect(content(screen.find('result-review-hell-peak'))).toBe('Review Queue Max 18 PR');
    expect(content(screen.find('result-review-hell-lesson')).length).toBeGreaterThan(0);
    expect(screen.find('result-continue').props).toMatchObject({
      disabled: true,
      title: 'これが最後の記録です',
    });
    expect(content(screen.find('result-continue'))).toBe('次の記録へ');
    expect(content(screen.find('result-continue-hint'))).toBe('これが最後の記録です');
    screen.click('result-continue');
    expect(screen.onContinue).not.toHaveBeenCalled();
    expect(content(screen.find('result-restart'))).toBe('タイトルへ戻る');
    expect(screen.find('result-restart').props.title).toBeUndefined();
    screen.click('result-restart');
    expect(onAbandon).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'ランを終了する'])(
    '通常ランの中断（表示指定=%s）は保存条件を伝えて中断する',
    (label) => {
      const onAbandon = vi.fn();
      const screen = mountResult({ onAbandon, abandonLabel: label });
      expect(content(screen.find('result-restart'))).toBe(label ?? 'リプレイに残さずタイトルへ');
      expect(screen.find('result-restart').props.title).toContain('リプレイに保存されません');
      screen.click('result-restart');
      expect(onAbandon).toHaveBeenCalledOnce();
      expect(screen.onContinue).not.toHaveBeenCalled();
    },
  );
});

describe('SprintResultScreen の成長ニュース', () => {
  it('昇格者と休職者を名前付きで表示し、昇格とレベルアップの二重報告を避ける', () => {
    const screen = mountResult({
      growth: {
        ...emptyGrowth,
        promotions: [{ id: 'member-1', name: '青木', to: 'senior' }],
        wentOnLeave: [{ id: 'member-2', name: '佐藤' }],
        leveledUp: ['member-1'],
      },
    });
    const news = content(screen.find('result-growth'));
    expect(news).toContain('青木 がシニアに昇格');
    expect(news).toContain('佐藤 が休職に入った');
    expect(news).not.toContain('人がレベルアップ');
  });

  it('昇格がなければレベルアップ人数を表示する', () => {
    const screen = mountResult({
      growth: { ...emptyGrowth, leveledUp: ['member-1', 'member-2'] },
    });
    expect(content(screen.find('result-growth'))).toContain('2人がレベルアップ');
  });
});
