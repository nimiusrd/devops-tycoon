/**
 * 全社マップの部門比較表（RI-125）。
 *
 * 出荷・炎上・耐性は既存チップの正。ここでは AI依存・負債・士気・健全度だけを固定する。
 */
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_DEFS } from '../../../src/data/departments';
import {
  normalizeOrgCompareMetric,
  ORG_DEPT_COMPARE_COLUMNS,
  planOrgDeptComparison,
} from '../../../src/render/orgDeptComparison';
import { HEALTH_LABEL } from '../../../src/render/orgView';
import { aggregateDepartment } from '../../../src/sim/orgscale/aggregate';
import type { DepartmentState, Team, TeamHealth } from '../../../src/sim/orgscale/types';

function dept(
  overrides: Partial<DepartmentState> & { def?: DepartmentState['def'] },
): DepartmentState {
  return {
    def: overrides.def ?? DEPARTMENT_DEFS[0],
    teams: [],
    shipping: 100,
    aiDependency: 50,
    reviewResilience: 80,
    techDebt: 20,
    morale: 70,
    onFire: 0,
    health: 'healthy',
    ...overrides,
  };
}

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 't',
    deptId: 'product',
    name: 'チームA',
    gridX: 0,
    gridY: 0,
    shipping: 100,
    aiDependency: 50,
    reviewQueue: 2,
    incidents: 0,
    morale: 70,
    techDebt: 10,
    engineers: 5,
    aiAssignedCount: 0,
    health: 'healthy',
    isPlayer: false,
    isActive: false,
    ...overrides,
  };
}

function cell(row: ReturnType<typeof planOrgDeptComparison>['rows'][number], key: string) {
  return row.cells.find((c) => c.key === key);
}

describe('planOrgDeptComparison (RI-125)', () => {
  it('部門順を保ち、チップ指標を複製せず欠けている4指標だけを出す', () => {
    const view = planOrgDeptComparison([
      dept({
        def: DEPARTMENT_DEFS[1],
        shipping: 999,
        onFire: 3,
        reviewResilience: 11,
        aiDependency: 42,
        techDebt: 88,
        morale: 61,
        health: 'congested',
      }),
      dept({
        def: DEPARTMENT_DEFS[0],
        aiDependency: 10,
        techDebt: 5,
        morale: 90,
        health: 'healthy',
      }),
    ]);

    expect(view.columns.map((c) => c.key)).toEqual([
      'aiDependency',
      'techDebt',
      'morale',
      'health',
    ]);
    expect(view.columns.map((c) => c.label)).toEqual(['AI依存度', '技術的負債', '士気', '健全度']);
    expect(view.rows.map((r) => r.deptId)).toEqual(['platform', 'product']);
    expect(view.rows.flatMap((r) => r.cells.map((c) => c.key))).not.toContain('shipping');
    expect(view.rows.flatMap((r) => r.cells.map((c) => c.key))).not.toContain('onFire');
    expect(view.rows.flatMap((r) => r.cells.map((c) => c.key))).not.toContain('reviewResilience');

    const platform = view.rows[0];
    expect(platform.name).toBe('基盤・プラットフォーム部');
    expect(platform.color).toBe('#2f6f7a');
    expect(cell(platform, 'aiDependency')).toEqual({
      key: 'aiDependency',
      value: '42',
    });
    expect(cell(platform, 'techDebt')).toEqual({ key: 'techDebt', value: '88' });
    expect(cell(platform, 'morale')).toEqual({ key: 'morale', value: '61' });
    expect(cell(platform, 'health')).toEqual({
      key: 'health',
      value: HEALTH_LABEL.congested,
      tone: 'warn',
      health: 'congested',
    });
  });

  it('AI依存度 70 以上だけ warn にし、数値は丸め直さない', () => {
    const view = planOrgDeptComparison([
      dept({ def: { ...DEPARTMENT_DEFS[0], id: 'low' }, aiDependency: 69 }),
      dept({ def: { ...DEPARTMENT_DEFS[0], id: 'high' }, aiDependency: 70 }),
    ]);
    expect(cell(view.rows[0], 'aiDependency')).toEqual({
      key: 'aiDependency',
      value: '69',
    });
    expect(cell(view.rows[1], 'aiDependency')).toEqual({
      key: 'aiDependency',
      value: '70',
      tone: 'warn',
    });
  });

  it.each([
    ['healthy', 'good'],
    ['congested', 'warn'],
    ['reviewHell', 'bad'],
  ] as const)('健全度 %s を HEALTH_LABEL と tone に写す', (health: TeamHealth, tone) => {
    const view = planOrgDeptComparison([dept({ health })]);
    expect(cell(view.rows[0], 'health')).toEqual({
      key: 'health',
      value: HEALTH_LABEL[health],
      tone,
      health,
    });
  });

  it('aggregateDepartment のスナップショットをそのまま表示用に写す', () => {
    const healthy = aggregateDepartment(DEPARTMENT_DEFS[0], [
      team({ id: 'a', health: 'healthy', aiDependency: 20, morale: 80, techDebt: 10 }),
      team({ id: 'b', health: 'healthy', aiDependency: 30, morale: 70, techDebt: 20 }),
    ]);
    const hell = aggregateDepartment(DEPARTMENT_DEFS[2], [
      team({
        id: 'c',
        deptId: 'newbiz',
        health: 'reviewHell',
        incidents: 2,
        reviewQueue: 12,
        aiDependency: 80,
        morale: 20,
        techDebt: 40,
      }),
      team({
        id: 'd',
        deptId: 'newbiz',
        health: 'congested',
        aiDependency: 70,
        morale: 40,
        techDebt: 15,
      }),
    ]);

    const view = planOrgDeptComparison([healthy, hell]);
    expect(cell(view.rows[0], 'aiDependency')?.value).toBe(String(healthy.aiDependency));
    expect(cell(view.rows[0], 'techDebt')?.value).toBe(String(healthy.techDebt));
    expect(cell(view.rows[0], 'morale')?.value).toBe(String(healthy.morale));
    expect(cell(view.rows[0], 'health')?.value).toBe(HEALTH_LABEL[healthy.health]);
    expect(cell(view.rows[1], 'aiDependency')?.value).toBe(String(hell.aiDependency));
    expect(cell(view.rows[1], 'health')).toMatchObject({
      value: HEALTH_LABEL[hell.health],
      health: hell.health,
    });
  });

  it('RI-135: チーム比較は部門順と部門内順を保ち、診断用7指標を出す', () => {
    const view = planOrgDeptComparison(
      [
        dept({
          def: DEPARTMENT_DEFS[1],
          teams: [
            team({
              id: 'platform-b',
              deptId: 'platform',
              name: '基盤B',
              shipping: 12,
              reviewQueue: 7,
              incidents: 1,
              aiDependency: 72,
              techDebt: 30,
              morale: 45,
              health: 'congested',
            }),
            team({ id: 'platform-a', deptId: 'platform', name: '基盤A' }),
          ],
        }),
        dept({
          def: DEPARTMENT_DEFS[0],
          teams: [team({ id: 'product-a', name: '製品A' })],
        }),
      ],
      { unit: 'team' },
    );

    expect(view.unit).toBe('team');
    expect(view.metric).toBe('all');
    expect(view.columns.map((column) => column.key)).toEqual([
      'shipping',
      'reviewQueue',
      'incidents',
      'aiDependency',
      'techDebt',
      'morale',
      'health',
    ]);
    expect(view.rows.map((row) => row.teamId)).toEqual(['platform-b', 'platform-a', 'product-a']);
    expect(view.rows[0]).toMatchObject({
      deptId: 'platform',
      teamId: 'platform-b',
      name: '基盤B',
      groupLabel: DEPARTMENT_DEFS[1].name,
    });
    expect(cell(view.rows[0], 'shipping')?.value).toBe('12');
    expect(cell(view.rows[0], 'reviewQueue')?.value).toBe('7');
    expect(cell(view.rows[0], 'incidents')).toMatchObject({ value: '1', tone: 'bad' });
    expect(cell(view.rows[0], 'aiDependency')).toMatchObject({ value: '72', tone: 'warn' });
  });

  it('RI-135: 個別指標だけに絞り、単位に無い指標はすべてへ戻す', () => {
    const departments = [dept({ teams: [team({ id: 'product-a', reviewQueue: 8 })] })];
    const filtered = planOrgDeptComparison(departments, {
      unit: 'team',
      metric: 'reviewQueue',
    });
    expect(filtered.metric).toBe('reviewQueue');
    expect(filtered.columns.map((column) => column.key)).toEqual(['reviewQueue']);
    expect(filtered.rows[0].cells).toEqual([{ key: 'reviewQueue', value: '8' }]);

    const fallback = planOrgDeptComparison(departments, {
      unit: 'department',
      metric: 'shipping',
    });
    expect(normalizeOrgCompareMetric('department', 'shipping')).toBe('all');
    expect(fallback.metric).toBe('all');
    expect(fallback.columns).toEqual([...ORG_DEPT_COMPARE_COLUMNS]);
  });
});
