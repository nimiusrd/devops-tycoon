import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  const onChoose = vi.fn();
  const tree = RecruitScreen({ state, onChoose });
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    find,
    onChoose,
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('RecruitScreen の採用条件と見送り', () => {
  it.each([RECRUIT_COST, RECRUIT_COST + 1])(
    '予算 %i では採用コストと効果を示して hire を通知する',
    (budget) => {
      const state = makeState(budget);
      const originalRoster = structuredClone(state.roster);
      const screen = mountRecruit(state);
      expect(screen.find('recruit').props).toMatchObject({
        role: 'dialog',
        'aria-label': 'Recruit',
      });
      expect(screen.find('recruit-hire').props.disabled).toBe(false);
      expect(content(screen.find('recruit-hire'))).toContain(
        '未来の主力候補を1人迎える（ベンチに加わる）',
      );
      expect(content(screen.find('recruit-tags-hire'))).toContain(`予算 -${RECRUIT_COST}`);
      screen.click('recruit-hire');
      expect(screen.onChoose).toHaveBeenCalledExactlyOnceWith('hire');
      expect(state.budget).toBe(budget);
      expect(state.roster).toEqual(originalRoster);
    },
  );

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
