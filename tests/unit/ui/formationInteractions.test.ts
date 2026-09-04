import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { FormationScreen, type FormationScreenProps } from '../../../src/ui/FormationScreen';
import { directRoster } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

// 純表示の子コンポーネントまで展開し、編成カードと予測の表示を実装経由で検証する。
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
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'formation-interactions' });
  engine.startRun();
  return {
    ...engine.snapshot(),
    phase: 'draft',
    roster: structuredClone(directRoster),
    ...overrides,
  };
}

function mountFormation(overrides: Partial<FormationScreenProps> = {}) {
  let props: FormationScreenProps = {
    state: makeState(),
    onAssign: vi.fn(),
    onToggleAi: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  let tree = expand(FormationScreen(props));
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    get props() {
      return props;
    },
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    text: () => content(tree),
    update(next: Partial<FormationScreenProps>) {
      props = { ...props, ...next };
      tree = expand(FormationScreen(props));
    },
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('編成画面の配置と AI 配布', () => {
  it('選んだ配置と AI 配布の反転を通知し、入力のロスターを変更しない', () => {
    const screen = mountFormation();
    const originalRoster = structuredClone(screen.props.state.roster);
    expect(screen.find('assign-m1-coding').props.className).toContain('active');
    for (const lane of ['coding', 'review', 'bench']) screen.click(`assign-m1-${lane}`);
    expect(screen.props.onAssign).toHaveBeenCalledTimes(3);
    expect(screen.props.onAssign).toHaveBeenNthCalledWith(1, 'm1', 'coding');
    expect(screen.props.onAssign).toHaveBeenNthCalledWith(2, 'm1', 'review');
    expect(screen.props.onAssign).toHaveBeenNthCalledWith(3, 'm1', 'bench');
    expect(content(screen.find('ai-m1'))).toBe('🤖 AI配布中');
    screen.click('ai-m1');
    expect(screen.props.onToggleAi).toHaveBeenCalledExactlyOnceWith('m1', false);
    expect(screen.props.state.roster).toEqual(originalRoster);

    const roster = structuredClone(screen.props.state.roster);
    roster.members[0].aiAssigned = false;
    screen.update({ state: { ...screen.props.state, roster } });
    expect(content(screen.find('ai-m1'))).toBe('AIを配る');
    screen.click('ai-m1');
    expect(screen.props.onToggleAi).toHaveBeenLastCalledWith('m1', true);
  });

  it.each(['review', 'bench'] as const)(
    '%s 担当には AI を配れず、配置変更はできる',
    (assignment) => {
      const state = makeState();
      state.roster.members[0].assignment = assignment;
      const screen = mountFormation({ state });
      expect(screen.find('ai-m1').props.disabled).toBe(true);
      expect(screen.find('ai-m1').props.title).toBe('AIはコーディング担当にのみ配れます');
      screen.click('ai-m1');
      expect(screen.props.onToggleAi).not.toHaveBeenCalled();
      screen.click('assign-m1-coding');
      expect(screen.props.onAssign).toHaveBeenCalledExactlyOnceWith('m1', 'coding');
    },
  );

  it.each([
    { phase: 'sprint' as const, readOnly: false, reason: 'スプリント中は編成を変更できません。' },
    { phase: 'draft' as const, readOnly: true, reason: 'リプレイ閲覧中は編成を変更できません。' },
    { phase: 'sprint' as const, readOnly: true, reason: 'リプレイ閲覧中は編成を変更できません。' },
  ])(
    '$phase / 読み取り専用=$readOnly では操作を止め、閉じる操作を受け付ける',
    ({ phase, readOnly, reason }) => {
      const screen = mountFormation({ state: makeState({ phase }), readOnly });
      expect(screen.text()).toContain(reason);
      for (const id of ['assign-m1-coding', 'assign-m1-review', 'assign-m1-bench', 'ai-m1']) {
        expect(screen.find(id).props.disabled).toBe(true);
        screen.click(id);
      }
      expect(screen.props.onAssign).not.toHaveBeenCalled();
      expect(screen.props.onToggleAi).not.toHaveBeenCalled();
      screen.click('formation-close');
      expect(screen.props.onClose).toHaveBeenCalledExactlyOnceWith();
    },
  );

  it('休職者は配置と AI 操作を隠し、能力・トレイトと安全なスタミナ表示を保つ', () => {
    const state = makeState();
    Object.assign(state.roster.members[0], {
      onLeave: true,
      assignment: 'bench',
      stamina: 0,
      staminaMax: 0,
      traits: ['aiArtisan'],
      stats: { implementation: 60.5, review: 79.4, aiMastery: 40.6 },
    });
    const screen = mountFormation({ state });
    const member = screen.find('formation-member-m1');
    expect(member.props.className).toContain('on-leave');
    expect(content(member)).toContain('Direct Coder');
    expect(content(member)).toContain('シニア ・ Lv2');
    expect(content(member)).toContain('🛠 61🔍 79🤖 41');
    expect(content(member)).toContain('AI職人');
    expect(content(member)).toContain('休職中。スタミナが戻れば復帰します。');
    expect(screen.find('face-m1').props.title).toBe('休職中');
    expect(screen.has('assign-m1-bench')).toBe(false);
    expect(screen.has('ai-m1')).toBe(false);
    const bar = elements(member).find((node) => node.props.className === 'fm-bar-fill low');
    expect(bar?.props.style).toEqual({ width: '0%' });
  });

  it.each([
    { stamina: 2, label: 'お疲れ', width: '20%', low: true },
    { stamina: 2.5, label: '平常', width: '25%', low: false },
    { stamina: 10, label: '絶好調', width: '100%', low: false },
  ])('スタミナ $stamina では $label と残量を示す', ({ stamina, label, width, low }) => {
    const state = makeState();
    state.roster.members[0].stamina = stamina;
    const screen = mountFormation({ state });
    expect(screen.find('face-m1').props.title).toBe(label);
    const bar = elements(screen.find('formation-member-m1')).find((node) =>
      String(node.props.className).startsWith('fm-bar-fill'),
    );
    expect(bar?.props.style).toEqual({ width });
    expect(String(bar?.props.className).includes(' low')).toBe(low);
  });

  it('試算がなければ予測を隠し、計算中から完成した出荷・延焼予測へ切り替わる', () => {
    const screen = mountFormation({ state: makeState({ whatIf: null, whatIfStatus: 'idle' }) });
    expect(screen.has('what-if-formation')).toBe(false);
    screen.update({ state: { ...screen.props.state, whatIfStatus: 'computing' } });
    expect(content(screen.find('what-if-formation'))).toContain('試算中…');
    screen.update({
      state: {
        ...screen.props.state,
        whatIfStatus: 'ready',
        whatIf: {
          current: {
            trials: 5,
            delivered: { min: 3, max: 6, mean: 4.5 },
            spread: { min: 0, max: 1, mean: 0.2 },
          },
          draftCandidates: {},
        },
      },
    });
    expect(content(screen.find('what-if-formation'))).toContain('出荷 3〜6延焼 0〜15回試算');
    expect(content(screen.find('what-if-formation'))).not.toContain('試算中');
  });
});
