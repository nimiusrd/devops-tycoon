import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeptTrendMetricSelection } from '../../../src/render/trendHistoryView';
import type { QuarterTrendSnapshot } from '../../../src/sim/run/types';

const selection = vi.hoisted(() => ({ value: 'all' as DeptTrendMetricSelection }));

// Node ではローカルな選択 state だけを代行し、履歴の導出は実装をそのまま使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [selection.value, (value: DeptTrendMetricSelection) => (selection.value = value)],
  useMemo: (factory: () => unknown) => factory(),
}));

import { OrgTrendHistory, type OrgTrendHistoryProps } from '../../../src/ui/OrgTrendHistory';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

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

function snapshot(
  quarterNumber: number,
  overrides: Partial<QuarterTrendSnapshot> = {},
): QuarterTrendSnapshot {
  return {
    quarterNumber,
    diagnosis: 'healthyAcceleration',
    kpis: [
      {
        id: 'delivery',
        label: '出荷',
        target: 90,
        actual: 100 * quarterNumber,
        status: 'exceeded',
      },
      { id: 'quality', label: '品質', target: 70, actual: 70, status: 'met' },
      { id: 'morale', label: '士気', target: 50, actual: 30, status: 'missed' },
    ],
    company: {
      shipping: 9999,
      aiDependency: 90,
      techDebt: 80,
      morale: 90,
      onFire: 0,
      healthRank: 'A',
      selfRank: 1,
    },
    departments: [
      { deptId: 'product', aiDependency: 60, techDebt: 20, morale: 40, health: 'healthy' },
    ],
    ...overrides,
  };
}

function history(): QuarterTrendSnapshot[] {
  return [
    snapshot(1),
    snapshot(2, {
      departments: [
        { deptId: 'platform', aiDependency: 50, techDebt: 10, morale: 70, health: 'congested' },
      ],
    }),
    snapshot(3, {
      diagnosis: 'reviewHell',
      departments: [
        { deptId: 'product', aiDependency: 80, techDebt: 35, morale: 20, health: 'reviewHell' },
      ],
    }),
  ];
}

function mountHistory(props: OrgTrendHistoryProps) {
  let tree = OrgTrendHistory(props);
  const render = () => {
    tree = OrgTrendHistory(props);
  };
  const find = (id: string) => {
    const node = elements(tree).find((element) => element.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    props,
    render,
    find,
    nodes: () => elements(tree),
    has: (id: string) => elements(tree).some((node) => node.props['data-testid'] === id),
    click(metric: DeptTrendMetricSelection) {
      (find(`org-trend-metric-${metric}`).props.onClick as () => void)();
      render();
    },
  };
}

afterEach(() => {
  selection.value = 'all';
});

describe('OrgTrendHistory', () => {
  it('履歴がなければ記録なしを表示し、診断やタブを出さない', () => {
    const screen = mountHistory({ history: [] });
    expect(content(screen.find('org-trend-history'))).toBe('記録なし');
    expect(screen.has('org-trend-diagnosis')).toBe(false);
    expect(screen.has('org-trend-metric-tabs')).toBe(false);
    expect(screen.nodes().some((node) => node.type === 'svg')).toBe(false);
    expect(screen.nodes().find((node) => node.type === 'section')?.props).toMatchObject({
      'aria-labelledby': 'org-trend-heading',
    });
  });

  it('保存済みの診断・KPI実績と判定を表示し、部門の欠測四半期に健全度を足さない', () => {
    const screen = mountHistory({
      history: history(),
      departmentNames: { product: 'プロダクト開発' },
    });
    expect(content(screen.find('org-trend-q1'))).toBe('Q1Healthy Acceleration 型');
    expect(content(screen.find('org-trend-q3'))).toBe('Q3Review Hell 型');
    expect(screen.find('org-trend-q3').props['data-diagnosis']).toBe('reviewHell');
    expect(content(screen.find('org-trend-company'))).toBe('出荷300超過品質70達成士気30未達');
    expect(screen.find('org-trend-series-delivery').props).toMatchObject({
      role: 'img',
      'aria-label': '出荷 300',
      viewBox: '0 0 220 36',
    });
    expect(
      elements(screen.find('org-trend-series-delivery')).find((node) => node.type === 'path')?.props
        .d,
    ).toBe('M 4.00,32.00 L 110.00,18.00 L 216.00,4.00');
    expect(screen.find('org-trend-dept-product-aiDependency').props['aria-label']).toBe(
      'プロダクト開発 AI依存 80',
    );
    const badges = elements(screen.find('org-trend-dept-product-health')).filter(
      (node) => node.props['data-health'],
    );
    expect(badges.map((node) => node.props.title)).toEqual(['Q1 健全', 'Q3 Review Hell']);
    expect(badges.map(content)).toEqual(['Q1 健全', 'Q3 Review Hell']);
    expect(content(screen.find('org-trend-dept-platform-health'))).toBe('Q2 渋滞');
    expect(screen.find('org-trend-metric-all').props['aria-selected']).toBe(true);
    expect(screen.find('org-trend-metric-tabs').props).toMatchObject({
      role: 'tablist',
      'aria-label': '部門トレンド指標',
    });
  });

  it.each([
    ['aiDependency', 'AI依存', 80],
    ['techDebt', '負債', 35],
    ['morale', '士気', 20],
  ] as const)('%s タブは部門系列だけを絞り、すべてで健全度も復元する', (metric, label, last) => {
    const savedHistory = history();
    const original = structuredClone(savedHistory);
    const screen = mountHistory({ history: savedHistory });
    const companyBefore = screen.find('org-trend-company');
    screen.click(metric);
    const tabs = screen.nodes().filter((node) => node.props.role === 'tab');
    expect(tabs.filter((node) => node.props['aria-selected']).map(content)).toEqual([label]);
    expect(screen.find(`org-trend-metric-${metric}`).props.className).toBe('active');
    expect(screen.find('org-trend-metric-all').props.className).toBeUndefined();
    expect(screen.find('org-trend-company')).toEqual(companyBefore);
    expect(
      elements(screen.find('org-trend-dept-product'))
        .filter((node) => node.type === 'svg')
        .map((node) => node.props['aria-label']),
    ).toEqual([`プロダクト事業部 ${label} ${last}`]);
    expect(screen.has('org-trend-dept-product-health')).toBe(false);

    screen.click('all');
    expect(screen.find('org-trend-metric-all').props['aria-selected']).toBe(true);
    expect(
      elements(screen.find('org-trend-dept-product')).filter((node) => node.type === 'svg'),
    ).toHaveLength(3);
    expect(screen.has('org-trend-dept-product-health')).toBe(true);
    expect(savedHistory).toEqual(original);
  });

  it('健全度タブでは部門チャートを隠し、全社チャートと四半期バッジを維持する', () => {
    const screen = mountHistory({ history: history() });
    const companyBefore = screen.find('org-trend-company');
    screen.click('health');
    expect(screen.find('org-trend-metric-health').props['aria-selected']).toBe(true);
    expect(screen.find('org-trend-company')).toEqual(companyBefore);
    expect(
      elements(screen.find('org-trend-depts')).filter((node) => node.type === 'svg'),
    ).toHaveLength(0);
    expect(content(screen.find('org-trend-dept-product-health'))).toBe('Q1 健全Q3 Review Hell');
    expect(content(screen.find('org-trend-dept-platform-health'))).toBe('Q2 渋滞');
  });

  it('履歴と部門名が更新されても選択中の指標を保ち、最新の表示へ更新する', () => {
    const screen = mountHistory({ history: [snapshot(1)] });
    screen.click('morale');
    screen.props.history = [snapshot(4)];
    screen.props.departmentNames = { product: '新事業部' };
    screen.render();
    expect(screen.find('org-trend-metric-morale').props['aria-selected']).toBe(true);
    expect(screen.has('org-trend-q1')).toBe(false);
    expect(screen.has('org-trend-q4')).toBe(true);
    expect(screen.find('org-trend-series-delivery').props['aria-label']).toBe('出荷 400');
    expect(screen.find('org-trend-dept-product-morale').props['aria-label']).toBe(
      '新事業部 士気 40',
    );
    expect(screen.has('org-trend-dept-product-health')).toBe(false);
  });
});
