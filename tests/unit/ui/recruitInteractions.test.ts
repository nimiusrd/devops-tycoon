import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hookState.cursor++;
    if (hookState.values.length <= index) hookState.values[index] = initial;
    return [
      hookState.values[index],
      (value: unknown) => {
        hookState.values[index] =
          typeof value === 'function'
            ? (value as (prev: unknown) => unknown)(hookState.values[index])
            : value;
      },
    ];
  },
}));

import { RECRUIT_SKIP_MORALE } from '../../../src/data/events';
import { RECRUIT_COST, ROSTER_CAP } from '../../../src/sim/member';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { RecruitScreen } from '../../../src/ui/RecruitScreen';

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

function makeState(budget: number, fullRoster = false): RunState {
  const engine = new RunEngine({ seed: 'recruit-interactions', difficulty: 'easy' });
  engine.startRun();
  const state = { ...engine.snapshot(), budget };
  if (fullRoster) {
    state.roster = {
      ...state.roster,
      members: Array.from({ length: ROSTER_CAP }, (_, index) => ({
        ...state.roster.members[0],
        id: `full-${index}`,
      })),
    };
  }
  return state;
}

function mountRecruit(state: RunState) {
  hookState.values = [];
  hookState.cursor = 0;
  const onChoose = vi.fn();
  let tree = RecruitScreen({ state, onChoose });
  const render = () => {
    hookState.cursor = 0;
    tree = RecruitScreen({ state, onChoose });
  };
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    onChoose,
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
      render();
    },
  };
}

describe('RecruitScreen の採用条件と見送り', () => {
  it('予算が残るときは支払後残高を示し、1回で hire を通知する', () => {
    const budget = RECRUIT_COST + 1;
    const state = makeState(budget);
    const originalRoster = structuredClone(state.roster);
    const screen = mountRecruit(state);
    expect(screen.find('recruit').props).toMatchObject({
      role: 'dialog',
      'aria-label': 'Recruit',
    });
    expect(screen.find('recruit-hire').props.disabled).toBe(false);
    expect(content(screen.find('recruit-hire'))).toContain(`支払後の残高 💰1`);
    expect(content(screen.find('recruit-hire'))).toContain(
      '未来の主力候補を1人迎える（ベンチに加わる）',
    );
    expect(content(screen.find('recruit-tags-hire'))).toContain(`予算 -${RECRUIT_COST}`);
    screen.click('recruit-hire');
    expect(screen.has('spend-confirm')).toBe(false);
    expect(screen.onChoose).toHaveBeenCalledExactlyOnceWith('hire');
    expect(state.budget).toBe(budget);
    expect(state.roster).toEqual(originalRoster);
  });

  it('予算ちょうどでの採用は確定まで hire せず、取消で予算とロスターを保つ', () => {
    const state = makeState(RECRUIT_COST);
    const originalRoster = structuredClone(state.roster);
    const screen = mountRecruit(state);
    expect(content(screen.find('recruit-hire'))).toContain('支払後の残高 💰0');
    expect(content(screen.find('recruit-hire'))).toContain('予算枯渇でランが終了する');
    screen.click('recruit-hire');
    expect(screen.onChoose).not.toHaveBeenCalled();
    expect(screen.find('recruit-skip').props.disabled).toBe(true);
    screen.click('recruit-skip');
    expect(screen.onChoose).not.toHaveBeenCalled();
    screen.click('spend-confirm-cancel');
    expect(screen.has('spend-confirm')).toBe(false);
    expect(state.budget).toBe(RECRUIT_COST);
    expect(state.roster).toEqual(originalRoster);
    screen.click('recruit-hire');
    screen.click('spend-confirm-accept');
    expect(screen.onChoose).toHaveBeenCalledExactlyOnceWith('hire');
    expect(state.budget).toBe(RECRUIT_COST);
    expect(state.roster).toEqual(originalRoster);
  });

  it.each([
    { budget: RECRUIT_COST - 1, full: false, reason: `予算が足りません（💰${RECRUIT_COST} 必要）` },
    { budget: RECRUIT_COST, full: true, reason: 'ロスターが満員です' },
    { budget: RECRUIT_COST - 1, full: true, reason: 'ロスターが満員です' },
  ])(
    '予算 $budget / 満員 $full で採用できない理由を示し、見送りは受け付ける',
    ({ budget, full, reason }) => {
      const screen = mountRecruit(makeState(budget, full));
      expect(screen.find('recruit-hire').props.disabled).toBe(true);
      expect(content(screen.find('recruit-hire'))).toContain(reason);
      screen.click('recruit-hire');
      expect(screen.onChoose).not.toHaveBeenCalled();
      expect(content(screen.find('recruit-tags-skip'))).toBe(`士気 ${RECRUIT_SKIP_MORALE}`);
      expect(content(screen.find('recruit-skip'))).toContain('採用せず編成へ戻る');
      screen.click('recruit-skip');
      expect(screen.onChoose).toHaveBeenCalledExactlyOnceWith('skip');
    },
  );
});
