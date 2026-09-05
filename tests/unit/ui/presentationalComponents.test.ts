import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  playSfx: vi.fn(),
  reducedMotion: false,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => effect(),
  useMemo: <T>(factory: () => T) => factory(),
  useRef: <T>(initial: T) => ({ current: initial }),
}));
vi.mock('recharts', () => ({
  Bar: 'Bar',
  BarChart: 'BarChart',
  CartesianGrid: 'CartesianGrid',
  Legend: 'Legend',
  ResponsiveContainer: 'ResponsiveContainer',
  Tooltip: 'Tooltip',
  XAxis: 'XAxis',
  YAxis: 'YAxis',
}));
vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  useReducedMotion: () => mocks.reducedMotion,
}));
vi.mock('../../../src/audio/useAudio', () => ({
  useAudio: () => ({ playSfx: mocks.playSfx }),
}));
vi.mock('../../../src/ui/ResultOverlay', () => ({ ResultOverlay: 'section' }));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

import { getCard } from '../../../src/data/cards';
import { getRelic } from '../../../src/data/relics';
import type { SprintEvent, SprintResult, TimelineSample } from '../../../src/sim/types';
import { BaselineComparisonChart } from '../../../src/ui/BaselineComparisonChart';
import { Breadcrumb } from '../../../src/ui/Breadcrumb';
import { ComboBadge } from '../../../src/ui/ComboBadge';
import { HOW_TO_PLAY_SECTIONS } from '../../../src/ui/howToPlayContent';
import { HowToPlayScreen } from '../../../src/ui/HowToPlayScreen';
import { AttentionOverlay, RewardCeremony, SlowMotionOverlay } from '../../../src/ui/JuicyEffects';
import { ReplayContentContext } from '../../../src/ui/replayContentCore';
import { ReplayContentProvider } from '../../../src/ui/replayContentProvider';
import { SprintTimelineChart } from '../../../src/ui/SprintTimelineChart';
import { useDialogOverlayLock } from '../../../src/ui/useDialogOverlayLock';

type Props = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function') {
    return expand((node.type as (props: Props) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<Props>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

function find(node: ReactNode, testId: string): ReactElement<Props> {
  const found = elements(node).find((element) => element.props['data-testid'] === testId);
  if (!found) throw new Error(`要素がありません: ${testId}`);
  return found;
}

function byType(node: ReactNode, type: string): ReactElement<Props>[] {
  return elements(node).filter((element) => element.type === type);
}

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 50,
    maxCombo: 5,
    aiAssistedPct: 30,
    reviewQueueMax: 4,
    rework: 1,
    incidents: 2,
    contained: 2,
    spread: 0,
    seniorHpDelta: -10,
    actionCounts: {},
    grade: 'B',
    title: 'テスト称号',
    diagnosis: 'テスト診断',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 5,
    focusMax: 8,
    autoContainCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.playSfx.mockClear();
  mocks.reducedMotion = false;
  vi.mocked(useDialogOverlayLock).mockClear();
});

describe('BaselineComparisonChart', () => {
  it('ベースラインがない場合と介入がない場合は比較を表示しない', () => {
    expect(BaselineComparisonChart({ result: makeResult() })).toBeNull();
    expect(
      BaselineComparisonChart({
        result: makeResult({ baseline: { delivered: 45, spread: 2, maxCombo: 3 } }),
      }),
    ).toBeNull();
  });

  it('ベースラインと実績をグラフ props とアクセシブルな数値行へ反映する', () => {
    const tree = expand(
      BaselineComparisonChart({
        result: makeResult({
          actionCounts: { interruptReview: 1 },
          baseline: { delivered: 42, spread: 2, maxCombo: 3 },
        }),
      }),
    );

    expect(find(tree, 'result-baseline-comparison')).toBeDefined();
    expect(byType(tree, 'BarChart')[0].props).toMatchObject({
      data: [
        { name: '出荷', baseline: 42, actual: 50 },
        { name: '延焼', baseline: 2, actual: 0 },
        { name: 'Max Combo', baseline: 3, actual: 5 },
      ],
      margin: { top: 8, right: 8, left: 0, bottom: 0 },
    });
    const legend = byType(tree, 'Legend')[0];
    const formatter = legend.props.formatter as (value: string) => string;
    expect(formatter('baseline')).toBe('介入なし');
    expect(formatter('actual')).toBe('実績');
    expect(byType(tree, 'Bar').map((bar) => bar.props.dataKey)).toEqual(['baseline', 'actual']);

    expect(content(find(tree, 'result-baseline-row-delivered'))).toContain('42 pt → 50 pt+8 pt');
    expect(content(find(tree, 'result-baseline-row-spread'))).toContain('2 件 → 0 件-2 件');
    expect(content(find(tree, 'result-baseline-row-maxCombo'))).toContain('x3 → x5+2');
    expect(content(find(tree, 'result-baseline-disclaimer'))).toContain('厳密な同一世界線');
  });
});

describe('Breadcrumb', () => {
  it.each([
    ['industry', '俯瞰して采配'],
    ['company', '俯瞰して采配'],
    ['department', 'ボトルネックを診断'],
    ['team', '手を動かす'],
  ] as const)('%s の現在地と操作のヒントを示す', (level, hint) => {
    const onNavigate = vi.fn();
    const tree = expand(Breadcrumb({ level, onNavigate }));
    const nav = find(tree, 'breadcrumb');
    const current = find(tree, `crumb-${level}`);

    expect(nav.props['aria-label']).toBe('ズーム階層');
    expect(current.props).toMatchObject({ 'data-active': true, 'aria-current': 'page' });
    expect(content(nav)).toContain(hint);
    expect(byType(tree, 'button')).toHaveLength(4);
    (find(tree, 'crumb-industry').props.onClick as () => void)();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('industry');
  });

  it('入り込み拘束中は現場以外への移動を止めて理由を示す', () => {
    const tree = expand(Breadcrumb({ level: 'team', onNavigate: vi.fn(), enterLocked: true }));

    for (const level of ['industry', 'company', 'department']) {
      expect(find(tree, `crumb-${level}`).props).toMatchObject({
        disabled: true,
        title: '入り込み拘束中は他チームを俯瞰できません',
      });
    }
    expect(find(tree, 'crumb-team').props).toMatchObject({ disabled: false, title: '現場へ' });
    expect(content(find(tree, 'breadcrumb'))).toContain('入り込み拘束中');
  });
});

describe('SprintTimelineChart', () => {
  const timeline: TimelineSample[] = [
    { tick: 2, reviewQueue: 2, burningCount: 0, combo: 0, seniorHp: 80 },
    { tick: 7, reviewQueue: 6, burningCount: 1, combo: 2, seniorHp: 70 },
    { tick: 12, reviewQueue: 3, burningCount: 0, combo: 4, seniorHp: 65 },
  ];
  const events: SprintEvent[] = [
    {
      tick: 7,
      kind: 'intervention',
      combo: 2,
      effect: {
        actionId: 'interruptReview',
        focusCost: 3,
        gaugeGain: 0.34,
        reviewedCount: 4,
        hpCost: 3,
      },
    },
  ];

  it('記録がない場合は空表示にする', () => {
    const tree = expand(SprintTimelineChart({ timeline: [], events: [] }));
    expect(content(find(tree, 'sprint-timeline'))).toContain('記録なし');
    expect(elements(tree).some((node) => node.type === 'svg')).toBe(false);
  });

  it('4系列、介入マーカー、tick範囲を意味のある SVG 属性へ反映する', () => {
    const tree = expand(SprintTimelineChart({ timeline, events }));
    const svg = find(tree, 'sprint-timeline-svg');

    expect(svg.props).toMatchObject({
      role: 'img',
      'aria-label': 'スプリント時系列 tick 2〜12',
      viewBox: '0 0 320 120',
    });
    for (const key of ['reviewQueue', 'burningCount', 'combo', 'seniorHp']) {
      expect(find(tree, `timeline-series-${key}`).props.d).toMatch(/^M /);
    }
    const marker = find(tree, 'timeline-marker-interruptReview');
    expect(marker.props.transform).toBe('translate(160, 12)');
    expect(content(marker)).toContain('tick 7: 割り込みレビュー');
    expect(content(svg)).toContain('t2');
    expect(content(svg)).toContain('t12');
  });
});

describe('JuicyEffects', () => {
  it('突破数と注目イベントの説明を演出 props とともに表示する', () => {
    const slow = expand(SlowMotionOverlay({ clearedIncidentCount: 3 }));
    const attention = expand(AttentionOverlay({ label: 'INCIDENT', title: '延焼警報' }));

    expect(find(slow, 'boss-slowmo').props).toMatchObject({
      initial: { opacity: 0 },
      animate: { opacity: [0, 0.9, 0.45, 0] },
    });
    expect(content(slow)).toContain('3件を鎮火');
    expect(find(attention, 'attention-pause').props.transition).toMatchObject({ duration: 0.85 });
    expect(content(attention)).toContain('INCIDENT延焼警報介入のチャンス');
  });

  it('報酬の種類・任意詳細を表示し、式典効果音を再生する', () => {
    const detailed = expand(RewardCeremony({ kind: 'relic', title: '文化を獲得', detail: '安心' }));
    const terse = expand(RewardCeremony({ kind: 'title', title: '新称号' }));

    expect(find(detailed, 'reward-ceremony-relic').props).toMatchObject({
      className: 'reward-ceremony reward-ceremony-relic',
      initial: { opacity: 0, scale: 0.78, y: 12 },
    });
    expect(content(detailed)).toContain('文化を獲得安心');
    expect(content(terse)).toContain('新称号');
    expect(byType(terse, 'small')).toHaveLength(0);
    expect(mocks.playSfx).toHaveBeenCalledTimes(2);
    expect(mocks.playSfx).toHaveBeenNthCalledWith(1, 'ceremony');
  });
});

describe('ComboBadge', () => {
  it('表示中のコンボと出荷倍率をバウンド演出つきで示す', () => {
    const tree = expand(ComboBadge({ combo: 4 }));
    const badge = find(tree, 'combo');
    const inner = elements(tree).find((node) => node.props.className === 'combo-inner');

    expect(badge.props).toMatchObject({ 'data-combo': 4, 'aria-label': '現在のコンボ ×4' });
    expect(inner?.props).toMatchObject({
      initial: { scale: 0.6, opacity: 0 },
      animate: { scale: 1, opacity: 1 },
      transition: { type: 'spring', stiffness: 320, damping: 18 },
    });
    expect(content(tree)).toContain('COMBO ×4');
    expect(content(tree)).toMatch(/出荷倍率 \d+\.\dx/);
  });

  it('動きを減らす設定と非表示コンボをそれぞれ反映する', () => {
    mocks.reducedMotion = true;
    const visible = expand(ComboBadge({ combo: 8, stabilized: true }));
    const inner = elements(visible).find((node) => node.props.className === 'combo-inner');
    const hidden = expand(ComboBadge({ combo: 0 }));

    expect(inner?.props).toMatchObject({ initial: false, transition: { duration: 0 } });
    expect(find(hidden, 'combo').props['aria-label']).toBe('現在のコンボなし');
    expect(elements(hidden).some((node) => node.props.className === 'combo-inner')).toBe(false);
  });
});

describe('HowToPlayScreen', () => {
  it('全ヘルプ節をダイアログとして示し、背景と閉じるボタンを同じ callback へ結ぶ', () => {
    const onClose = vi.fn();
    const tree = expand(HowToPlayScreen({ onClose }));
    const dialog = find(tree, 'how-to-play');

    expect(dialog.props).toMatchObject({
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '遊び方',
      tabIndex: -1,
    });
    expect(vi.mocked(useDialogOverlayLock)).toHaveBeenCalledWith(expect.any(Object), {
      restoreFocus: true,
    });
    for (const section of HOW_TO_PLAY_SECTIONS) {
      expect(content(find(tree, `how-to-play-${section.id}`))).toBe(section.title + section.body);
    }
    (find(tree, 'how-to-play-backdrop').props.onClick as () => void)();
    (find(tree, 'how-to-play-close').props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('ReplayContentProvider', () => {
  it('通常時と記録時の resolver を Context へ渡す', () => {
    const live = ReplayContentProvider({ contentSnapshot: null, children: '通常画面' });
    expect(live.type).toBe(ReplayContentContext.Provider);
    expect(live.props.children).toBe('通常画面');
    expect(live.props.value.isReplaySnapshot).toBe(false);

    const card = getCard('copilot');
    const relic = getRelic('psych-safety');
    if (!card || !relic) throw new Error('テスト用コンテンツがありません');
    const replay = ReplayContentProvider({
      contentSnapshot: {
        cards: [{ ...card, name: '記録時のカード' }],
        relics: [{ ...relic, name: '記録時のレリック' }],
      },
      children: 'リプレイ画面',
    });

    expect(replay.type).toBe(ReplayContentContext.Provider);
    expect(replay.props.children).toBe('リプレイ画面');
    expect(replay.props.value.isReplaySnapshot).toBe(true);
    expect(replay.props.value.resolveCard('copilot').name).toBe('記録時のカード');
    expect(replay.props.value.resolveRelic('psych-safety').name).toBe('記録時のレリック');
  });
});
