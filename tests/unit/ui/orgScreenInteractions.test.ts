import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  usePixi: false,
  field: null as { focusDepartment: (id: string) => Promise<void> } | null,
}));

// Node で表示ローカル state を保持し、WebGL の選択とカメラ完了だけを制御する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (update: unknown) => {
        hooks.values[index] =
          typeof update === 'function'
            ? (update as (previous: unknown) => unknown)(hooks.values[index])
            : update;
      },
    ];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useRef: () => ({ current: hooks.field }),
}));
vi.mock('../../../src/ui/usePixiRenderer', () => ({
  usePixiRenderer: () => ({ usePixi: hooks.usePixi, onWebglError: vi.fn() }),
}));

import { COMPANY_LEVERS } from '../../../src/data/levers';
import { PROCESS_BALANCE } from '../../../src/data/balance';
import { createOrgState } from '../../../src/sim/org';
import { generateOrgScale } from '../../../src/sim/orgscale';
import { AspectStage } from '../../../src/ui/AspectStage';
import { OrgScreen, type OrgScreenProps } from '../../../src/ui/OrgScreen';
import { emptyRunTotals } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

// 盤面の ref / ResizeObserver は OrgBoard の専用テストで扱う。
// 比較表・HUD・タグは実コンポーネントを一度展開し、走査時は再実行しない。
function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function' && node.type !== AspectStage) {
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
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function mountOrg(overrides: Partial<OrgScreenProps> = {}) {
  let props: OrgScreenProps = {
    org: generateOrgScale({
      seed: 'org-screen-interactions',
      org: createOrgState('default', true),
      totals: emptyRunTotals(),
      diagnosis: 'healthyAcceleration',
      budget: 100,
    }),
    budget: 100,
    zoom: { level: 'company', deptId: null, teamId: null },
    trendHistory: [],
    onFocusDept: vi.fn(),
    onFocusTeam: vi.fn(),
    onApplyLever: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    tree = expand(OrgScreen(props));
  };
  const find = (id: string) => {
    const node = elements(tree).find((node) => node.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  render();
  return {
    get props() {
      return props;
    },
    find,
    all: () => elements(tree),
    update(next: Partial<OrgScreenProps>) {
      props = { ...props, ...next };
      render();
    },
    click(id: string) {
      const button = find(id);
      if (!button.props.disabled) (button.props.onClick as () => void)();
      render();
    },
  };
}

afterEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.usePixi = false;
  hooks.field = null;
  vi.restoreAllMocks();
});

describe('OrgScreen の移動と全社レバー', () => {
  it('部署チップと比較表から部署へ移動し、チーム比較と盤面はチーム選択へ接続する', () => {
    const screen = mountOrg();
    const dept = screen.props.org.departments[0];
    const team = dept.teams[0];
    screen.click(`dept-chip-${dept.def.id}`);
    screen.click(`org-dept-focus-${dept.def.id}`);
    expect(screen.props.onFocusDept).toHaveBeenNthCalledWith(1, dept.def.id);
    expect(screen.props.onFocusDept).toHaveBeenNthCalledWith(2, dept.def.id);
    screen.click('org-compare-unit-team');
    expect(screen.find('org-compare-unit-team').props['aria-selected']).toBe(true);
    screen.click(`org-team-focus-${team.id}`);
    expect(screen.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith(team.id);
    screen.click(`team-${dept.teams[1].id}`);
    expect(screen.props.onFocusTeam).toHaveBeenLastCalledWith(dept.teams[1].id);
  });

  it.each(COMPANY_LEVERS)(
    '$name は予算の不足・一致を区別し、効果を示して全社へ適用する',
    (lever) => {
      const screen = mountOrg({ budget: lever.cost - 1 });
      const id = `lever-${lever.id}`;
      expect(screen.find(id).props.disabled).toBe(true);
      expect(content(screen.find(id))).toContain(lever.name);
      expect(content(screen.find(id))).toContain(`💰${lever.cost}`);
      expect(screen.find(id).props.title).toContain(lever.description);
      expect(content(screen.find(`lever-tags-${lever.id}`))).not.toBe('');
      screen.click(id);
      expect(screen.props.onApplyLever).not.toHaveBeenCalled();
      screen.update({ budget: lever.cost });
      expect(screen.find(id).props.disabled).toBe(false);
      screen.click(id);
      expect(screen.props.onApplyLever).toHaveBeenCalledExactlyOnceWith(lever.id);
    },
  );

  it('全社指標の警告境界と基盤の注意表示を更新する', () => {
    const screen = mountOrg();
    const stat = (label: string) =>
      screen.all().find(
        (node) =>
          String(node.props.className ?? '')
            .split(' ')
            .includes('org-stat') &&
          elements(node).some((child) => child.type === 'dt' && content(child) === label),
      )!;
    screen.update({
      org: {
        ...screen.props.org,
        aiDependency: 70,
        securityLevel: PROCESS_BALANCE.securityFragilityThreshold.value - 1,
        onFire: 2,
        infra: { ci: 0, docs: 42, aiGuideline: 55 },
      },
    });
    expect(stat('AI依存度').props.className).toContain('tone-warn');
    expect(stat('セキュリティ').props.className).toContain('tone-warn');
    expect(stat('炎上中チーム').props.className).toContain('tone-bad');
    expect(content(screen.find('org-onfire'))).toBe('2');
    expect(content(screen.find('org-infra-hub'))).toContain('注意');
    expect(content(screen.find('org-infra-hub'))).toContain('CI 0 / Docs 42 / AI 55');
    expect(content(screen.find('org-trend-history'))).toBe('記録なし');
    screen.update({
      org: {
        ...screen.props.org,
        aiDependency: 69,
        securityLevel: PROCESS_BALANCE.securityFragilityThreshold.value,
        onFire: 0,
        infra: { ...screen.props.org.infra, ci: 100 },
      },
    });
    expect(stat('AI依存度').props.className).not.toContain('tone-warn');
    expect(stat('セキュリティ').props.className).not.toContain('tone-warn');
    expect(stat('炎上中チーム').props.className).toContain('tone-good');
    expect(screen.find('org-infra-hub').props['data-tone']).toBe('ok');
    expect(content(screen.find('org-infra-hub'))).not.toContain('注意');
  });
});

describe('OrgScreen の Pixi 移動', () => {
  it('カメラ完了まで部署切替を待ち、部門色と不明部門の既定色を盤面へ渡す', async () => {
    let finish: () => void = () => {};
    const transition = new Promise<void>((resolve) => {
      finish = resolve;
    });
    hooks.usePixi = true;
    hooks.field = { focusDepartment: vi.fn(() => transition) };
    const screen = mountOrg();
    const dept = screen.props.org.departments[1];
    const pixi = screen.all().find((node) => 'teams' in node.props)!;
    expect(pixi.props.teams).toEqual(screen.props.org.departments.flatMap((d) => d.teams));
    const color = pixi.props.deptColor as (id: string) => string;
    expect(color(dept.def.id)).toBe(dept.def.color);
    expect(color('missing')).toBe('#6b4a9e');
    screen.click(`dept-chip-${dept.def.id}`);
    expect(hooks.field.focusDepartment).toHaveBeenCalledExactlyOnceWith(dept.def.id);
    expect(screen.props.onFocusDept).not.toHaveBeenCalled();
    finish();
    await transition;
    expect(screen.props.onFocusDept).toHaveBeenCalledExactlyOnceWith(dept.def.id);
  });

  it('Pixi 未ロード時は直ちに移動し、島が容量を超えてもPixi盤面とHTMLのチーム選択を維持する', () => {
    hooks.usePixi = true;
    const screen = mountOrg();
    const dept = screen.props.org.departments[0];
    screen.click(`dept-chip-${dept.def.id}`);
    expect(screen.props.onFocusDept).toHaveBeenCalledExactlyOnceWith(dept.def.id);

    hooks.field = { focusDepartment: vi.fn(() => Promise.resolve()) };
    screen.update({
      org: {
        ...screen.props.org,
        departments: screen.props.org.departments.map((item, index) =>
          index === 0
            ? {
                ...item,
                teams: Array.from({ length: 30 }, (_, i) => ({
                  ...item.teams[0],
                  id: `capacity-${i}`,
                })),
              }
            : item,
        ),
      },
    });
    expect(screen.all().some((node) => 'teams' in node.props)).toBe(true);
    screen.click('team-capacity-29');
    expect(screen.props.onFocusTeam).toHaveBeenCalledWith('capacity-29');
  });
});
