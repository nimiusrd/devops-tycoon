import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Node 上の memo とリプレイ Context だけを代行する。
// OKR・編成・デッキの子コンポーネントは展開し、引き渡された状態も検証する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { getBoss } from '../../../src/data/bosses';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { SetupScreen, type SetupScreenProps } from '../../../src/ui/SetupScreen';
import { directRoster } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  if (typeof node.type === 'function') {
    return elements((node.type as (props: Props) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<Props>(node)) return '';
  if (typeof node.type === 'function') {
    return content((node.type as (props: Props) => ReactNode)(node.props));
  }
  return Children.toArray(node.props.children).map(content).join('');
}

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'setup-interactions', difficulty: 'easy' });
  engine.startRun();
  return {
    ...engine.snapshot(),
    phase: 'setup',
    sprintIndexInQuarter: 0,
    sprintsPerQuarter: 3,
    pendingSprintKind: 'normal',
    roster: structuredClone(directRoster),
    ...overrides,
  };
}

function mountSetup(overrides: Partial<SetupScreenProps> = {}) {
  const props: SetupScreenProps = {
    state: makeState(),
    onAssign: vi.fn(),
    onToggleAi: vi.fn(),
    onBegin: vi.fn(),
    ...overrides,
  };
  const tree = SetupScreen(props);
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    props,
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    text: () => content(tree),
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('SetupScreen の次スプリント案内と編成', () => {
  it('通常案件では四半期・ボス・OKR を示し、編成変更と開始を通知する', () => {
    const screen = mountSetup();
    const boss = getBoss(screen.props.state.bossId)!;
    expect(content(screen.find('setup-next-sprint'))).toBe('次: スプリント 1 / 3');
    expect(screen.text()).toContain(`第${screen.props.state.quarterNumber}四半期`);
    expect(screen.text()).toContain(boss.name);
    expect(screen.text()).toContain(boss.description);
    expect(screen.text()).toContain('編成 — スプリント開始前に配置とAIを決める');
    expect(screen.text()).toContain('誰に配るかこのタイミングで見直そう');
    expect(content(screen.find('setup-okr'))).toContain('今四半期の OKR');
    expect(screen.has('setup-elite-pending')).toBe(false);
    expect(screen.has('setup-boss-pending')).toBe(false);
    expect(screen.has('deck')).toBe(false);
    screen.click('assign-m1-review');
    screen.click('ai-m1');
    screen.click('begin-sprint');
    expect(screen.props.onAssign).toHaveBeenCalledExactlyOnceWith('m1', 'review');
    expect(screen.props.onToggleAi).toHaveBeenCalledExactlyOnceWith('m1', false);
    expect(screen.props.onBegin).toHaveBeenCalledExactlyOnceWith();
    expect(screen.props.state.roster).toEqual(directRoster);
  });

  it('途中の高負荷案件では固有バナーとリスク説明を出す', () => {
    const screen = mountSetup({
      state: makeState({ sprintIndexInQuarter: 1, pendingSprintKind: 'elite' }),
    });
    expect(content(screen.find('setup-next-sprint'))).toBe('次: スプリント 2 / 3');
    expect(content(screen.find('setup-elite-pending'))).toBe('高負荷案件');
    expect(screen.has('setup-boss-pending')).toBe(false);
    expect(screen.text()).toContain('編成 — 高負荷スプリントの前に配置とAIを決める');
    expect(screen.text()).toContain('出荷は大きいが渋滞・炎上リスクも高い');
  });

  it.each([
    { sprintIndexInQuarter: 0, pendingSprintKind: 'boss' as const },
    { sprintIndexInQuarter: 2, pendingSprintKind: 'normal' as const },
    { sprintIndexInQuarter: 2, pendingSprintKind: 'elite' as const },
  ])('ボス指定または最終枠では高負荷表示よりボス案内を優先する: %j', (state) => {
    const screen = mountSetup({ state: makeState(state) });
    expect(content(screen.find('setup-boss-pending'))).toBe('ボススプリント');
    expect(screen.has('setup-elite-pending')).toBe(false);
    expect(screen.text()).toContain('編成 — ボススプリントの前に配置とAIを決める');
    expect(screen.text()).toContain('次はボス。四半期の締めくくり');
  });

  it('未知のボス ID でもフォールバック名で編成を表示する', () => {
    const screen = mountSetup({ state: makeState({ bossId: 'missing-boss' }) });
    expect(screen.text()).toContain('★ ボス');
    expect(screen.find('begin-sprint').props.disabled).toBe(false);
  });

  it('リプレイでは編成と開始を無効にし、デッキをコレクション表示する', () => {
    const screen = mountSetup({
      state: makeState({ deck: [{ defId: 'docs', level: 2 }] }),
      readOnly: true,
    });
    expect(screen.find('setup').props['data-readonly']).toBe('true');
    expect(screen.find('deck').props['data-mode']).toBe('collection');
    expect(content(screen.find('deck-card-docs'))).toContain('ドキュメント整備★');
    expect(screen.text()).toContain('リプレイ閲覧中は編成を変更できません');
    for (const id of [
      'begin-sprint',
      'assign-m1-coding',
      'assign-m1-review',
      'assign-m1-bench',
      'ai-m1',
    ]) {
      expect(screen.find(id).props.disabled).toBe(true);
      screen.click(id);
    }
    expect(screen.props.onBegin).not.toHaveBeenCalled();
    expect(screen.props.onAssign).not.toHaveBeenCalled();
    expect(screen.props.onToggleAi).not.toHaveBeenCalled();
  });
});
