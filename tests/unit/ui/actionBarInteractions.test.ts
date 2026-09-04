import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
  sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return (
      previous?.length === next.length && next.every((value, i) => Object.is(value, previous[i]))
    );
  },
}));

// Node で state/ref/effect の再描画を代行する。利用可否・ドラッグ計画・JSX は実装を使う。
// 純粋な子コンポーネントも展開し、公開 props と表示・callback の対応を検証する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= {
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: unknown) => {
        const next =
          typeof update === 'function'
            ? (update as (value: unknown) => unknown)(slot.value)
            : update;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          hooks.dirty = true;
        }
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useMemo(factory: () => unknown, dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.sameDependencies(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { value: factory(), dependencies };
    }
    return hooks.slots[index].value;
  },
  useCallback(callback: unknown, dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.sameDependencies(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { value: callback, dependencies };
    }
    return hooks.slots[index].value;
  },
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (hooks.sameDependencies(previous?.dependencies, dependencies)) return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: 'div',
  motion: { div: 'div', span: 'span' },
}));
vi.mock('../../../src/ui/responsiveMode', () => ({
  useResponsiveMode: () => ({ width: 'narrow', height: 'short' }),
}));

import { OVERTIME_TICKS, STABILITY_TICKS } from '../../../src/sim/actions';
import { createOrgState } from '../../../src/sim/org';
import type { InterventionOutcome, SprintState } from '../../../src/sim/types';
import { ActionBar, type ActionBarProps } from '../../../src/ui/ActionBar';
import { burningTask, makeSprint, makeTask } from '../helpers/sprintFixtures';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  if (typeof node.type === 'function') {
    return elements((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  if (typeof node.type === 'function') {
    return content((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return Children.toArray(node.props.children).map(content).join('');
}

function actionSprint(overrides: Partial<SprintState> = {}): SprintState {
  const sprint = makeSprint(createOrgState('default', true), [
    makeTask(0),
    makeTask(1, { lane: 'coding' }),
    makeTask(2, { lane: 'backlog' }),
    burningTask(3),
  ]);
  return { ...sprint, focus: 6, config: { ...sprint.config, focusMax: 8 }, ...overrides };
}

function mountActionBar(overrides: Partial<ActionBarProps> = {}) {
  let props: ActionBarProps = {
    sprint: actionSprint(),
    sprintTick: 0,
    disabled: false,
    paused: false,
    armedId: null,
    onArm: vi.fn(),
    onAction: vi.fn(() => ({ ok: true })),
    ...overrides,
  };
  let tree: ReactNode;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 25) throw new Error('ActionBar の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = ActionBar(props);
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const query = (id: string) => elements(tree).find((node) => node.props['data-testid'] === id);
  const find = (id: string) => {
    const node = query(id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  flush();
  return {
    get props() {
      return props;
    },
    query,
    find,
    byClass(name: string) {
      return elements(tree).filter((node) =>
        String(node.props.className ?? '')
          .split(' ')
          .includes(name),
      );
    },
    update(next: Partial<ActionBarProps>) {
      props = { ...props, ...next };
      flush();
    },
    click(id: string) {
      const button = find(id);
      if (button.props.disabled) return;
      (button.props.onClick as () => void)();
      flush();
    },
    advance(ms: number) {
      vi.advanceTimersByTime(ms);
      flush();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout });
});

afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ActionBar の状態表示', () => {
  it('集中力・連携ゲージ・対象数を表示し、コストと対象を読み上げラベルへ載せる', () => {
    const bar = mountActionBar({ sprint: actionSprint({ comboGauge: 0.37 }) });

    expect(bar.find('action-bar').props).toMatchObject({
      'data-paused': 'false',
      'data-responsive-width': 'narrow',
      'data-responsive-height': 'short',
    });
    expect(content(bar.find('focus'))).toBe('⚡6/8');
    const pips = elements(bar.byClass('pips')[0]).filter((node) => node.type === 'i');
    expect(pips.map((node) => node.props.className)).toEqual([
      'on',
      'on',
      'on',
      'on',
      'on',
      'on',
      '',
      '',
    ]);
    expect(bar.find('combo-gauge').props['data-gauge']).toBe(0.37);
    expect(elements(bar.find('combo-gauge'))[1].props.style).toEqual({ width: '37%' });
    expect(content(bar.find('action-badge-interruptReview'))).toBe('PR 1');
    expect(content(bar.find('action-badge-firefight'))).toBe('🔥1');
    expect(content(bar.find('action-badge-assignTask'))).toBe('2');
    expect(bar.find('action-interruptReview').props['aria-label']).toContain(
      '割り込みレビュー。コスト⚡3。対象 PR 1。',
    );
    expect(bar.find('action-assignTask').props.title).toContain('クリックで武装');
    expect(bar.byClass('action').every((node) => node.props.disabled === false)).toBe(true);
    expect(bar.query('assign-assignee')).toBeUndefined();
  });

  it.each([
    ['一時停止', { paused: true }, {}, 'paused', '一時停止中', ''],
    ['完了指定', { disabled: true, paused: true }, {}, 'complete', 'スプリント終了', ''],
    ['CD中', {}, { cooldowns: { splitPr: 25 } }, 'cooldown', 'クールダウン中', 'oncooldown'],
    ['集中力不足', {}, { focus: 0 }, 'no-focus', '集中力不足', 'nofocus'],
    ['対象なし', {}, { tasks: [] }, 'no-target', '分割対象なし', 'notarget'],
  ] satisfies [string, Partial<ActionBarProps>, Partial<SprintState>, string, string, string][])(
    '%s は理由を表示して発動を止め、条件を満たした更新で再び武装できる',
    (_label, props, sprint, reason, message, className) => {
      const bar = mountActionBar({ ...props, sprint: actionSprint(sprint) });
      const button = bar.find('action-splitPr');
      expect(button.props.disabled).toBe(true);
      expect(button.props['data-block-reason']).toBe(reason);
      expect(button.props['aria-label']).toContain(`利用不可: ${message}。`);
      expect(content(bar.find('action-reason-splitPr'))).toBe(message);
      if (className) expect(bar.byClass(className)).toContainEqual(button);
      if (reason === 'cooldown') {
        const cooldown = elements(button).find((node) => node.props.className === 'cd')!;
        expect(elements(cooldown)[1].props.style).toEqual({ width: '50%' });
      }
      bar.click('action-splitPr');
      expect(bar.props.onArm).not.toHaveBeenCalled();
      expect(bar.props.onAction).not.toHaveBeenCalled();

      bar.update({ disabled: false, paused: false, sprint: actionSprint() });
      expect(bar.find('action-splitPr').props.disabled).toBe(false);
      expect(bar.query('action-reason-splitPr')).toBeUndefined();
      bar.click('action-splitPr');
      expect(bar.props.onArm).toHaveBeenCalledExactlyOnceWith('splitPr');
    },
  );

  it('運用安定とアクション効果の残り時間を表示し、期限到達または完了で消す', () => {
    const sprint = actionSprint();
    sprint.modifiers.stabilityUntilTick = 10 + STABILITY_TICKS / 2;
    sprint.modifiers.overtimeUntilTick = 10 + OVERTIME_TICKS / 2;
    const bar = mountActionBar({ sprint, sprintTick: 10 });

    expect(content(bar.find('stability-status'))).toBe(
      `🛡 運用安定残り ${STABILITY_TICKS / 2} tick`,
    );
    expect(elements(bar.byClass('stability-status-meter')[0])[1].props.style).toEqual({
      width: '50%',
    });
    expect(bar.find('action-mod-ring-overtime').props.title).toBe(
      `効果残り ${OVERTIME_TICKS / 2} tick`,
    );
    expect(elements(bar.find('action-mod-ring-overtime'))[1].props.style).toEqual({
      width: '50%',
    });
    expect(bar.find('action-overtime').props['aria-label']).toContain(
      `効果残り ${OVERTIME_TICKS / 2} tick。`,
    );

    bar.update({ sprintTick: 10 + Math.max(STABILITY_TICKS, OVERTIME_TICKS) });
    expect(bar.query('stability-status')).toBeUndefined();
    expect(bar.query('action-mod-ring-overtime')).toBeUndefined();
    bar.update({ sprintTick: 10, sprint: { ...sprint, complete: true } });
    expect(bar.query('stability-status')).toBeUndefined();
    expect(bar.query('action-mod-ring-overtime')).toBeUndefined();
  });
});

describe('ActionBar の武装と担当選択', () => {
  it.each(['assignTask', 'splitPr'] as const)(
    '%s は可視対象があれば武装し、集中力を失っても同じボタンで解除できる',
    (id) => {
      const bar = mountActionBar();
      bar.click(`action-${id}`);
      expect(bar.props.onArm).toHaveBeenCalledExactlyOnceWith(id);
      expect(bar.props.onAction).not.toHaveBeenCalled();

      bar.update({ armedId: id, sprint: actionSprint({ focus: 0 }) });
      expect(bar.find(`action-${id}`).props.disabled).toBe(false);
      expect(bar.find(`action-${id}`).props['data-armed']).toBe('true');
      expect(bar.find(`action-${id}`).props['aria-label']).toContain('武装中。');
      expect(bar.find(`action-${id}`).props.title).toContain('盤面で対象へドラッグ');
      expect(content(bar.find(`action-armed-${id}`))).toBe('武装中');
      bar.click(`action-${id}`);
      expect(bar.props.onArm).toHaveBeenLastCalledWith(null);
      expect(bar.props.onArm).toHaveBeenCalledTimes(2);
      expect(bar.props.onAction).not.toHaveBeenCalled();
    },
  );

  it('分割できるタスクが overflow にだけある場合は自動対象で即発動する', () => {
    const tasks = Array.from({ length: 13 }, (_, index) =>
      makeTask(index, { lane: 'coding', split: index < 12 }),
    );
    const onAction = vi.fn(
      (): InterventionOutcome => ({
        ok: true,
        effect: { actionId: 'splitPr', focusCost: 2, gaugeGain: 0 },
      }),
    );
    const bar = mountActionBar({ sprint: actionSprint({ tasks }), onAction });

    expect(content(bar.find('action-badge-splitPr'))).toBe('1');
    bar.click('action-splitPr');
    expect(onAction).toHaveBeenCalledExactlyOnceWith('splitPr');
    expect(bar.props.onArm).not.toHaveBeenCalled();
    expect(bar.byClass('focus-feedback-cost').map(content)).toEqual(['-⚡2']);
  });

  it('通常アクションは武装を解除してから対象を省略して発動する', () => {
    const bar = mountActionBar({ armedId: 'assignTask' });
    bar.click('action-pairReview');

    expect(bar.props.onArm).toHaveBeenCalledExactlyOnceWith(null);
    expect(bar.props.onAction).toHaveBeenCalledExactlyOnceWith('pairReview');
    expect(vi.mocked(bar.props.onArm).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(bar.props.onAction).mock.invocationCallOrder[0],
    );
  });

  it('差配の担当を変更でき、一時停止中は武装表示と担当操作を止める', () => {
    const onAssignAssigneeChange = vi.fn();
    const bar = mountActionBar({ armedId: 'assignTask', onAssignAssigneeChange });
    expect(bar.find('assign-assignee-ideal').props.className).toContain(' on');

    bar.click('assign-assignee-ai');
    expect(onAssignAssigneeChange).toHaveBeenLastCalledWith('ai');
    bar.update({ assignAssignee: 'ai' });
    expect(bar.find('assign-assignee-ai').props.className).toContain(' on');
    expect(bar.find('assign-assignee-ideal').props.className).not.toContain(' on');
    bar.click('assign-assignee-senior');
    expect(onAssignAssigneeChange).toHaveBeenLastCalledWith('senior');
    bar.update({ assignAssignee: 'senior' });
    expect(bar.find('assign-assignee-senior').props.className).toContain(' on');
    bar.click('assign-assignee-ideal');
    expect(onAssignAssigneeChange).toHaveBeenLastCalledWith(undefined);

    bar.update({ paused: true });
    expect(bar.find('action-bar').props['data-paused']).toBe('true');
    expect(bar.find('action-assignTask').props['data-armed']).toBeUndefined();
    expect(bar.query('action-armed-assignTask')).toBeUndefined();
    expect(bar.byClass('action').every((node) => node.props.disabled === true)).toBe(true);
    for (const choice of ['ideal', 'ai', 'senior']) {
      expect(bar.find(`assign-assignee-${choice}`).props.disabled).toBe(true);
      bar.click(`assign-assignee-${choice}`);
    }
    expect(onAssignAssigneeChange).toHaveBeenCalledTimes(3);
    bar.update({ paused: false, armedId: 'splitPr' });
    expect(bar.query('assign-assignee')).toBeUndefined();
    bar.update({ armedId: 'assignTask', onAssignAssigneeChange: undefined });
    expect(bar.query('assign-assignee')).toBeUndefined();
  });
});

describe('ActionBar の発動結果 feedback', () => {
  it('消費・還元を表示し、連携 flash と各表示をそれぞれの期限で消す', () => {
    const onAction = vi
      .fn<ActionBarProps['onAction']>()
      .mockReturnValueOnce({
        ok: true,
        effect: { actionId: 'pairReview', focusCost: 2, focusRefund: 1, gaugeGain: 0.3 },
      })
      .mockReturnValueOnce({
        ok: true,
        effect: { actionId: 'overtime', focusCost: 4, focusRefund: 0, gaugeGain: 0 },
      });
    const bar = mountActionBar({ onAction });
    bar.click('action-pairReview');
    expect(bar.byClass('focus-feedback-pop').map(content)).toEqual(['-⚡2', '+⚡1']);
    expect(bar.find('combo-gauge').props.className).toContain(' flash');
    expect(bar.query('action-toast')).toBeUndefined();

    bar.advance(499);
    expect(bar.find('combo-gauge').props.className).toContain(' flash');
    bar.advance(1);
    expect(bar.find('combo-gauge').props.className).not.toContain(' flash');
    bar.click('action-overtime');
    expect(bar.byClass('focus-feedback-pop').map(content)).toEqual(['-⚡2', '+⚡1', '-⚡4']);
    expect(bar.find('combo-gauge').props.className).not.toContain(' flash');
    bar.advance(500);
    expect(bar.byClass('focus-feedback-pop').map(content)).toEqual(['-⚡4']);
    bar.advance(500);
    expect(bar.byClass('focus-feedback-pop')).toHaveLength(0);
    expect(onAction).toHaveBeenNthCalledWith(1, 'pairReview');
    expect(onAction).toHaveBeenNthCalledWith(2, 'overtime');
    expect(bar.props.onArm).not.toHaveBeenCalled();
  });

  it('発動時に対象が消えたら短い失敗理由を通知し、揺れと通知を期限で消す', () => {
    const bar = mountActionBar({
      onAction: vi.fn((): InterventionOutcome => ({ ok: false, reason: 'no-target' })),
    });
    bar.click('action-firefight');

    expect(content(bar.find('action-toast'))).toBe('炎上なし');
    expect(bar.find('action-toast').props.role).toBe('status');
    expect(bar.find('action-firefight').props.className).toContain(' shake');
    expect(bar.find('action-pairReview').props.className).not.toContain(' shake');
    expect(bar.byClass('focus-feedback-pop')).toHaveLength(0);
    bar.advance(399);
    expect(bar.find('action-firefight').props.className).toContain(' shake');
    bar.advance(1);
    expect(bar.find('action-firefight').props.className).not.toContain(' shake');
    expect(content(bar.find('action-toast'))).toBe('炎上なし');
    bar.advance(600);
    expect(bar.query('action-toast')).toBeUndefined();
  });

  it.each([true, false])('詳細のない結果 ok=%s は追加の feedback を表示しない', (ok) => {
    const bar = mountActionBar({ onAction: vi.fn(() => ({ ok })) });
    bar.click('action-pairReview');

    expect(bar.props.onAction).toHaveBeenCalledExactlyOnceWith('pairReview');
    expect(bar.byClass('focus-feedback-pop')).toHaveLength(0);
    expect(bar.byClass('shake')).toHaveLength(0);
    expect(bar.query('action-toast')).toBeUndefined();
  });

  it('外部発動結果は nonce ごとに一度だけ表示し、新しい失敗・成功を受け取れる', () => {
    const feedback: NonNullable<ActionBarProps['outcomeFeedback']> = {
      id: 'assignTask',
      nonce: 0,
      outcome: {
        ok: true,
        effect: { actionId: 'assignTask', focusCost: 1, gaugeGain: 0.2 },
      },
    };
    const bar = mountActionBar({ outcomeFeedback: feedback });
    expect(bar.byClass('focus-feedback-pop').map(content)).toEqual(['-⚡1']);
    bar.advance(1000);
    expect(bar.byClass('focus-feedback-pop')).toHaveLength(0);
    bar.update({ outcomeFeedback: { ...feedback } });
    expect(bar.byClass('focus-feedback-pop')).toHaveLength(0);

    bar.update({
      outcomeFeedback: {
        id: 'assignTask',
        nonce: 1,
        outcome: { ok: false, reason: 'no-focus' },
      },
    });
    expect(content(bar.find('action-toast'))).toBe('集中力不足');
    expect(bar.find('action-assignTask').props.className).toContain(' shake');
    bar.update({ outcomeFeedback: null });
    bar.advance(1000);
    expect(bar.query('action-toast')).toBeUndefined();
    bar.update({ outcomeFeedback: { ...feedback, nonce: 2 } });
    expect(bar.byClass('focus-feedback-pop').map(content)).toEqual(['-⚡1']);
    expect(bar.props.onAction).not.toHaveBeenCalled();
    expect(bar.props.onArm).not.toHaveBeenCalled();
  });
});
