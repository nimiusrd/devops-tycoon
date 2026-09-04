import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const previewState = vi.hoisted(() => ({ value: null as string | null }));

// Node では親のプレビュー state と provider 接続だけを代行する。
// OKR・ロードマップ・履歴は実コンポーネントと導出を一度展開する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [previewState.value, (value: string | null) => (previewState.value = value)],
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { RunEngine } from '../../../src/sim/run/engine';
import type { GoalAdjustmentId, GoalKpiProgress, RunState } from '../../../src/sim/run/types';
import { RewardCeremony } from '../../../src/ui/JuicyEffects';
import { QuarterOkr } from '../../../src/ui/QuarterOkr';
import {
  QuarterReviewScreen,
  type QuarterReviewScreenProps,
} from '../../../src/ui/QuarterReviewScreen';
import { StakeholderNegotiationList } from '../../../src/ui/StakeholderNegotiationList';
import { adjustableReview } from '../helpers/runEngineFixtures';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<ElementProps>(node)) return node;
  // 交渉の入力イベントは専用テストが担当。ここでは親への公開 callback 接続を検証する。
  // 音声・アニメーションを持つ報酬演出も展開せず、渡される報酬内容を検証する。
  if (node.type === StakeholderNegotiationList || node.type === RewardCeremony) return node;
  if (typeof node.type === 'function') {
    return expand((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<ElementProps>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'quarter-review-interactions', difficulty: 'easy' });
  engine.startRun();
  const review = adjustableReview(['cut_scope', 'request_budget']);
  return {
    ...engine.snapshot(),
    phase: 'quarterReview',
    quarterNumber: 2,
    quarterReview: { ...review, goal: { ...review.goal, deliveryTarget: 3_000 } },
    reviewHistory: ['missed_adjustable', 'missed_adjustable'],
    ...overrides,
  };
}

function mountReview(overrides: Partial<QuarterReviewScreenProps> = {}) {
  const props: QuarterReviewScreenProps = {
    state: makeState(),
    onAcknowledge: vi.fn(),
    onChooseAdjustment: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const render = () => {
    tree = expand(QuarterReviewScreen(props));
  };
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  const negotiation = () => {
    const node = elements(tree).find((item) => item.type === StakeholderNegotiationList);
    if (!node) throw new Error('交渉一覧がありません');
    return node;
  };
  render();
  return {
    props,
    find,
    negotiation,
    get tree() {
      return tree;
    },
    nodes: () => elements(tree),
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    click(id: string) {
      (find(id).props.onClick as () => void)();
      render();
    },
    preview(id: GoalAdjustmentId | null) {
      (negotiation().props.onPreviewAdjustment as (id: GoalAdjustmentId | null) => void)(id);
      render();
    },
    choose(id: GoalAdjustmentId) {
      (negotiation().props.onChooseAdjustment as (id: GoalAdjustmentId) => void)(id);
      render();
    },
    roadmapRows: () =>
      elements(tree).filter((node) => node.props['data-testid'] === 'quarter-roadmap-row'),
  };
}

afterEach(() => {
  previewState.value = null;
});

describe('QuarterReviewScreen のレビュー結果', () => {
  it('レビューがない状態では画面もアクションも表示しない', () => {
    const screen = mountReview({ state: makeState({ quarterReview: null }) });
    expect(screen.tree).toBeNull();
    expect(screen.props.onAcknowledge).not.toHaveBeenCalled();
  });

  it.each([
    ['exceeded', '超過達成', 'quarter-acknowledge', '四半期を完遂'],
    ['met', '目標達成', 'quarter-acknowledge', '四半期を完遂'],
    ['missed_crisis', '深刻な未達', 'quarter-shutdown', 'プロジェクト終了'],
    ['reorg_required', '組織再編が必要', 'quarter-shutdown', 'プロジェクト終了'],
    ['shutdown', '継続不能', 'quarter-shutdown', 'プロジェクト終了'],
  ] as const)('%s の結果と対応する終了操作だけを表示する', (outcome, label, action, text) => {
    const screen = mountReview({
      state: makeState({
        quarterReview: { ...adjustableReview([]), outcome },
        reviewHistory: ['missed_adjustable', outcome],
      }),
    });
    expect(screen.find('quarter-review').props).toMatchObject({
      role: 'dialog',
      'aria-label': 'Quarter Review',
      'data-outcome': outcome,
    });
    expect(content(screen.tree)).toContain(`Q2 四半期レビュー — ${label}`);
    const buttons = screen.nodes().filter((node) => node.type === 'button');
    expect(buttons).toHaveLength(1);
    expect(content(screen.find(action))).toBe(text);
    expect(screen.has('quarter-roadmap')).toBe(false);
    expect(screen.nodes().some((node) => node.type === StakeholderNegotiationList)).toBe(false);
    expect(screen.has('quarter-reasons')).toBe(false);
    expect(screen.has('boss-relic-reward')).toBe(false);
    const history = screen
      .nodes()
      .filter((node) => node.props['data-testid'] === 'review-history-row');
    expect(history).toHaveLength(2);
    expect(history[1].props).toMatchObject({ 'data-outcome': outcome, 'data-current': 'true' });
    screen.click(action);
    expect(screen.props.onAcknowledge).toHaveBeenCalledOnce();
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
  });

  it('信頼の数値・未達理由・実際のボス報酬を表示する', () => {
    const screen = mountReview({
      state: makeState({
        bossRelicReward: 'flow-first',
        quarterReview: {
          ...adjustableReview(['cut_scope']),
          trust: { management: 70, customers: 45, team: 20 },
          missedReasons: ['Delivery が目標に届かない', '品質を維持できない'],
        },
      }),
    });
    const trustRows = elements(screen.find('quarter-trust')).filter(
      (node) => node.props.className === 'quarter-trust-row',
    );
    expect(trustRows.map(content)).toEqual(['経営70', '顧客45', 'チーム20']);
    const fills = elements(screen.find('quarter-trust')).filter(
      (node) => node.props.className === 'quarter-trust-fill',
    );
    expect(fills.map((node) => node.props.style)).toEqual([
      { width: '70%' },
      { width: '45%' },
      { width: '20%' },
    ]);
    expect(
      elements(screen.find('quarter-reasons'))
        .filter((node) => node.type === 'li')
        .map(content),
    ).toEqual(['Delivery が目標に届かない', '品質を維持できない']);
    expect(content(screen.find('boss-relic-reward'))).toContain('◆ フロー重視');
    expect(content(screen.find('boss-relic-reward'))).toContain(
      'レビュー待ちを減らし、休息での回復も厚くする',
    );
    expect(screen.nodes().find((node) => node.type === RewardCeremony)?.props).toMatchObject({
      kind: 'relic',
      title: 'フロー重視 を獲得',
      detail: '組織に新しい文化が宿った',
    });
  });

  it('修正案のプレビューを次期目標へ反映し、解除と確定を親へ接続する', () => {
    const state = makeState();
    const initialState = structuredClone(state);
    const screen = mountReview({ state });
    expect(screen.has('quarter-acknowledge')).toBe(false);
    expect(screen.has('quarter-shutdown')).toBe(false);
    expect(screen.negotiation().props).toMatchObject({
      availableAdjustments: ['cut_scope', 'request_budget'],
      trust: state.quarterReview!.trust,
      currentDeliveryTarget: 3_000,
      hasAiAdoptionTarget: true,
      previewedAdjustmentId: null,
    });
    const initialDelivery = screen
      .roadmapRows()
      .map((node) => node.props['data-delivery'] as number);
    expect(screen.roadmapRows().map((node) => node.props['data-quarter'])).toEqual([3, 4]);
    expect(screen.find('quarter-roadmap').props['data-preview']).toBeUndefined();
    screen.preview('cut_scope');
    expect(screen.negotiation().props.previewedAdjustmentId).toBe('cut_scope');
    expect(screen.find('quarter-roadmap').props['data-preview']).toBe('cut_scope');
    expect(content(screen.find('quarter-roadmap-preview'))).toBe('プレビュー: スコープ削減');
    screen.roadmapRows().forEach((node, i) => {
      expect(node.props['data-delivery']).toBeLessThan(initialDelivery[i]);
    });
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
    expect(state).toEqual(initialState);

    screen.preview('request_budget');
    expect(content(screen.find('quarter-roadmap-preview'))).toBe('プレビュー: 追加予算申請');
    expect(content(screen.roadmapRows()[0])).toContain('次期予算上限 -15');
    expect(screen.roadmapRows()[0].props['data-delivery']).toBeGreaterThan(initialDelivery[0]);
    screen.preview(null);
    expect(screen.negotiation().props.previewedAdjustmentId).toBeNull();
    expect(screen.has('quarter-roadmap-preview')).toBe(false);
    expect(screen.roadmapRows().map((node) => node.props['data-delivery'])).toEqual(
      initialDelivery,
    );
    screen.choose('cut_scope');
    expect(screen.props.onChooseAdjustment).toHaveBeenCalledExactlyOnceWith('cut_scope');
    expect(screen.props.onAcknowledge).not.toHaveBeenCalled();
    expect(state).toEqual(initialState);
  });
});

describe('QuarterOkr の表示', () => {
  it('レビューでは目標・実績・三段階の判定を保持し、ゼロを欠測に置き換えない', () => {
    const progress: GoalKpiProgress[] = [
      { id: 'delivery', label: '出荷数', target: 80, actual: 100, status: 'exceeded' },
      { id: 'quality', label: '品質', target: 50, actual: 50, status: 'met' },
      { id: 'incident', label: '障害数', target: 0, actual: 0, status: 'met' },
      { id: 'morale', label: '士気', target: 45, actual: 30, status: 'missed' },
    ];
    const screen = mountReview({
      state: makeState({ quarterReview: { ...adjustableReview([]), progress } }),
    });
    const kpiRows = elements(screen.find('quarter-kpi')).filter((node) => node.props['data-kpi']);
    const values = (id: string) =>
      Children.toArray(kpiRows.find((node) => node.props['data-kpi'] === id)!.props.children).map(
        content,
      );
    expect(values('delivery')).toEqual(['出荷数', '80', '100', '超過']);
    expect(values('quality')).toEqual(['品質', '50', '50', '達成']);
    expect(values('incident')).toEqual(['障害数', '0', '0', '達成']);
    expect(values('morale')).toEqual(['士気', '45', '30', '未達']);
    expect(values('techDebt')).toEqual(['Tech Debt', '—', '—', '—']);
    const badges = kpiRows
      .flatMap(elements)
      .filter((node) => String(node.props.className).startsWith('kpi-badge'));
    expect(badges.map((node) => node.props.className)).toEqual(
      expect.arrayContaining([
        'kpi-badge kpi-exceeded',
        'kpi-badge kpi-met',
        'kpi-badge kpi-missed',
        'kpi-badge',
      ]),
    );
  });

  it.each([false, true])(
    '編成ではボスの Objective と KPI 名を示し、AI 目標の有無=%s を反映する',
    (hasAiTarget) => {
      const goal = { ...adjustableReview([]).goal, aiAdoptionTarget: hasAiTarget ? 40 : undefined };
      const tree = expand(QuarterOkr({ bossId: 'exec-review', goal, variant: 'setup' }));
      const nodes = elements(tree);
      expect(nodes.find((node) => node.props['data-testid'] === 'setup-okr')?.props).toMatchObject({
        'data-template': 'ai-with-health',
        'aria-label': '今四半期の OKR',
      });
      expect(content(tree)).toContain('健全性を崩さず AI 導入の成果を示す');
      expect(content(tree)).toContain('組織の持続可能性を守る');
      const chips = nodes.filter((node) => node.props['data-okr-kr']);
      expect(chips).toHaveLength(hasAiTarget ? 6 : 5);
      expect(chips.some((node) => node.props['data-okr-kr'] === 'aiAdoption')).toBe(hasAiTarget);
      expect(nodes.some((node) => node.props['data-testid'] === 'quarter-kpi')).toBe(false);
      expect(chips.map(content)).toEqual(
        expect.arrayContaining(['Delivery', 'Quality', 'Tech Debt', 'Morale', 'Incident']),
      );
    },
  );
});
