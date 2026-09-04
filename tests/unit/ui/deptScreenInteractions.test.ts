import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], usePixi: false }));

// Node 上で JSX と画像ロード後の再描画を検証する。選択・入り込み・描画計画は実装を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => (state.values[index] = value)];
  },
}));
vi.mock('../../../src/ui/usePixiRenderer', () => ({
  usePixiRenderer: () => ({ usePixi: state.usePixi, onWebglError: vi.fn() }),
}));

import { DEPARTMENT_LEVERS, TEAM_LEVERS } from '../../../src/data/levers';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';
import { createOrgState } from '../../../src/sim/org';
import { generateOrgScale } from '../../../src/sim/orgscale';
import type { RunPhase } from '../../../src/sim/run/types';
import { AspectStage } from '../../../src/ui/AspectStage';
import { DeptScreen, type DeptScreenProps } from '../../../src/ui/DeptScreen';
import { emptyRunTotals } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

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

function mountDept(overrides: Partial<DeptScreenProps> = {}) {
  const org = generateOrgScale({
    seed: 'dept-screen-interactions',
    org: createOrgState('default', true),
    totals: emptyRunTotals(),
    diagnosis: 'healthyAcceleration',
    budget: 100,
  });
  const dept = org.departments[0];
  let props: DeptScreenProps = {
    dept,
    budget: 100,
    selectedTeamId: null,
    activeTeamId: dept.teams[0].id,
    teamLockUntilSprint: 3,
    sprintsPlayed: 3,
    phase: 'draft',
    onFocusTeam: vi.fn(),
    onEnterTeam: vi.fn(),
    onApplyLever: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const render = () => {
    state.cursor = 0;
    tree = expand(DeptScreen(props));
  };
  const query = (id: string) => elements(tree).find((node) => node.props['data-testid'] === id);
  const find = (id: string) => {
    const node = query(id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  render();
  return {
    get props() {
      return props;
    },
    query,
    find,
    all: () => elements(tree),
    update(next: Partial<DeptScreenProps>) {
      props = { ...props, ...next };
      render();
    },
    click(id: string) {
      const button = find(id);
      if (!button.props.disabled) (button.props.onClick as () => void)();
      render();
    },
    imageEvent(image: ReactElement<Props>, event: 'onLoad' | 'onError') {
      (image.props[event] as () => void)();
      render();
    },
  };
}

afterEach(() => {
  state.values = [];
  state.cursor = 0;
  state.usePixi = false;
  vi.restoreAllMocks();
});

describe('DeptScreen のチーム選択と入り込み', () => {
  it('未選択・部署外の選択はアクティブチームへ戻し、島クリックは状態確認だけを依頼する', () => {
    const screen = mountDept();
    const [active, other] = screen.props.dept.teams;
    expect(content(screen.find('dept-team-panel'))).toContain(active.name);
    expect(content(screen.find('team-active-badge'))).toBe('選択中');
    screen.click(`team-${other.id}`);
    expect(screen.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith(other.id);
    expect(screen.props.onEnterTeam).not.toHaveBeenCalled();

    screen.update({ selectedTeamId: other.id });
    expect(content(screen.find('dept-team-panel'))).toContain(other.name);
    expect(screen.query('team-active-badge')).toBeUndefined();
    expect(content(screen.find('dept-board'))).toContain(`（選択: ${other.id}）`);
    screen.click('enter-team');
    expect(screen.props.onEnterTeam).toHaveBeenCalledExactlyOnceWith(other.id);

    screen.update({ selectedTeamId: 'other-department-team' });
    expect(content(screen.find('dept-team-panel'))).toContain(active.name);
    screen.update({ activeTeamId: 'other-department-active' });
    expect(screen.query('dept-team-panel')).toBeUndefined();
    expect(screen.query('team-levers')).toBeUndefined();
    expect(screen.query('dept-levers')).toBeDefined();
  });

  it.each([
    ['sprint', false, 'スプリント中はチームを切り替えられません'],
    ['quarterReview', false, '四半期レビュー中はチームを切り替えられません'],
    ['beat', false, 'イベント解決中はチームを切り替えられません'],
    ['draft', true, '入り込む（次スプリント集中力'],
  ] satisfies [RunPhase, boolean, string][])(
    '他チームへの入り込みは %s の可否と理由を表示する',
    (phase, enabled, reason) => {
      const screen = mountDept({ phase });
      const other = screen.props.dept.teams[1];
      screen.update({ selectedTeamId: other.id });
      expect(screen.find('enter-team').props.disabled).toBe(!enabled);
      expect(screen.find('enter-team').props.title).toContain(reason);
      expect(content(screen.find('enter-team'))).toBe('入り込む');
      screen.click('enter-team');
      expect(screen.props.onEnterTeam).toHaveBeenCalledTimes(enabled ? 1 : 0);
    },
  );

  it('拘束中は残り期間を示し、期限で解禁する。自チームへの復帰は拘束・イベント中でも許可する', () => {
    const screen = mountDept({ sprintsPlayed: 2 });
    screen.update({ selectedTeamId: screen.props.dept.teams[1].id });
    expect(screen.find('enter-team').props).toMatchObject({
      disabled: true,
      title: '入り込み拘束中（あと1スプリント）',
    });
    screen.click('enter-team');
    expect(screen.props.onEnterTeam).not.toHaveBeenCalled();
    screen.update({ sprintsPlayed: 3 });
    expect(screen.find('enter-team').props.disabled).toBe(false);

    for (const phase of ['quarterReview', 'beat', 'draft'] as const) {
      screen.update({ selectedTeamId: null, sprintsPlayed: 2, phase });
      expect(screen.find('enter-team').props).toMatchObject({
        disabled: false,
        title: '選択中チームの現場へ戻る',
      });
      expect(content(screen.find('enter-team'))).toBe('現場へ戻る');
      screen.click('enter-team');
      expect(screen.props.onEnterTeam).toHaveBeenLastCalledWith(screen.props.activeTeamId);
    }
    screen.update({ phase: 'sprint' });
    expect(screen.find('enter-team').props).toMatchObject({
      disabled: true,
      title: 'スプリント中は現場へ戻れません',
    });
    screen.click('enter-team');
    expect(screen.props.onEnterTeam).toHaveBeenCalledTimes(3);
  });
});

describe('DeptScreen のレバーとチーム描画', () => {
  it.each([...TEAM_LEVERS, ...DEPARTMENT_LEVERS])(
    '$name は予算がコストに達すると有効になり、正しい対象へ適用する',
    (lever) => {
      const screen = mountDept({ budget: lever.cost - 1 });
      const id = `lever-${lever.id}`;
      expect(screen.find(id).props.disabled).toBe(true);
      expect(screen.find(id).props.title).toContain(lever.description);
      expect(content(screen.find(id))).toContain(`💰${lever.cost}`);
      expect(content(screen.find(`lever-tags-${lever.id}`))).not.toBe('');
      screen.click(id);
      expect(screen.props.onApplyLever).not.toHaveBeenCalled();
      screen.update({ budget: lever.cost });
      expect(screen.find(id).props.disabled).toBe(false);
      screen.click(id);
      expect(screen.props.onApplyLever).toHaveBeenCalledExactlyOnceWith(
        ...(lever.scope === 'team'
          ? [lever.id, undefined, screen.props.activeTeamId]
          : [lever.id, screen.props.dept.def.id]),
      );
    },
  );

  it('炎上・レビュー渋滞・選択チームの情報を描き、画像の読込失敗時も人物を残す', () => {
    const screen = mountDept();
    const dept = {
      ...screen.props.dept,
      health: 'reviewHell' as const,
      onFire: 1,
      teams: screen.props.dept.teams.map((team, index) => ({
        ...team,
        health: index === 0 ? ('reviewHell' as const) : ('healthy' as const),
        incidents: index === 0 ? 2 : 0,
        reviewQueue: index === 0 ? 40 : 0,
        shipping: index === 0 ? 100 : 0,
      })),
    };
    screen.update({ dept });
    expect(screen.find('dept-board').props.className).toContain('dept-hell');
    expect(content(screen.find('dept-onfire'))).toBe('1');
    expect(content(screen.find(`team-${dept.teams[0].id}`))).toContain('🔥');
    expect(content(screen.find('dept-team-panel'))).toContain('炎上');
    const images = () =>
      elements(screen.find(`team-${dept.teams[0].id}`)).filter((n) => n.type === 'image');
    expect(images().map((n) => n.props['data-asset-id'])).toEqual([
      'platform-architect',
      'qa-alchemist',
    ]);
    expect(images().every((n) => n.props.opacity === 0)).toBe(true);
    const skinCount = () =>
      elements(screen.find(`team-${dept.teams[0].id}`)).filter(
        (n) => n.type === 'circle' && n.props.fill === VISUAL_TOKENS.colors.actor.skin,
      ).length;
    expect(skinCount()).toBe(2);
    screen.imageEvent(images()[0], 'onLoad');
    expect(images()[0].props.opacity).toBeGreaterThan(0);
    expect(skinCount()).toBe(1);
    screen.imageEvent(images()[1], 'onError');
    expect(images()[1].props.opacity).toBe(0);
    expect(skinCount()).toBe(1);
  });

  it('Pixi 選択時も状態パネルを保ち、盤面へチーム選択 callback を渡す', () => {
    state.usePixi = true;
    const screen = mountDept();
    expect(screen.query('dept-board')).toBeUndefined();
    expect(screen.query('dept-team-panel')).toBeDefined();
    const pixi = screen.all().find((node) => node.props.dept === screen.props.dept)!;
    (pixi.props.onFocusTeam as (id: string) => void)(screen.props.dept.teams[1].id);
    expect(screen.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith(screen.props.dept.teams[1].id);
  });
});
