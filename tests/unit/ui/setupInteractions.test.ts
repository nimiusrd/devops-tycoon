import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  dirty: false,
  effects: [] as (() => void)[],
}));

// Node 上でstateの再描画を代行する。DOM上のfocus・Tab循環はE2Eとoverlay lockテストで確認する。
// OKR・編成・デッキ・確認dialogの子コンポーネントは実装を展開する。
vi.mock('react', async (importOriginal) => {
  let nextId = 0;
  return {
    ...(await importOriginal<typeof import('react')>()),
    useMemo: (factory: () => unknown) => factory(),
    useState(initial: unknown) {
      const index = hooks.cursor++;
      hooks.values[index] ??=
        typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        hooks.values[index],
        (update: unknown) => {
          const next =
            typeof update === 'function'
              ? (update as (previous: unknown) => unknown)(hooks.values[index])
              : update;
          hooks.dirty = !Object.is(next, hooks.values[index]);
          hooks.values[index] = next;
        },
      ];
    },
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (effect: () => void) => hooks.effects.push(effect),
    useLayoutEffect: () => {},
    useId: () => `setup-${nextId++}`,
  };
});
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { getBoss } from '../../../src/data/bosses';
import { MIN_ORG_LEVER_BUDGET } from '../../../src/render/orgLeverHintView';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { dismissOrgLeverHint, resetOrgLeverHintSession } from '../../../src/ui/orgLeverHintSession';
import { SetupScreen, type SetupScreenProps } from '../../../src/ui/SetupScreen';
import { useDialogOverlayLock } from '../../../src/ui/useDialogOverlayLock';
import { directRoster } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

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
  if (!isValidElement<Props>(node)) return '';
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
  let props: SetupScreenProps = {
    state: makeState(),
    onAssign: vi.fn(),
    onToggleAi: vi.fn(),
    onBegin: vi.fn(),
    ...overrides,
  };
  hooks.values = [];
  const targets = new Map<
    string,
    {
      dataset: { testid: string };
      focus: ReturnType<typeof vi.fn>;
      scrollIntoView: ReturnType<typeof vi.fn>;
    }
  >();
  let tree: ReactNode;
  const render = () => {
    let renders = 0;
    do {
      if (++renders > 5) throw new Error('SetupScreenの更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      hooks.effects = [];
      tree = expand(SetupScreen(props));
    } while (hooks.dirty);
    for (const node of elements(tree)) {
      const id = node.props['data-testid'];
      if (typeof id !== 'string') continue;
      if (!targets.has(id)) {
        targets.set(id, { dataset: { testid: id }, focus: vi.fn(), scrollIntoView: vi.fn() });
      }
      const ref = node.props.ref as { current: unknown } | undefined;
      if (ref) {
        ref.current = {
          ...targets.get(id),
          querySelectorAll: () => [...targets.values()],
        };
      }
    }
    for (const effect of hooks.effects.splice(0)) effect();
  };
  render();
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    get props() {
      return props;
    },
    targets,
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    text: () => content(tree),
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
      render();
    },
    update(next: Partial<SetupScreenProps>) {
      props = { ...props, ...next };
      render();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(useDialogOverlayLock).mockClear();
  resetOrgLeverHintSession();
});

describe('SetupScreen の次スプリント案内と編成', () => {
  it('通常案件では四半期・ボス・OKR を示し、編成変更と開始を通知する', () => {
    const screen = mountSetup();
    const boss = getBoss(screen.props.state.bossId)!;
    expect(content(screen.find('setup-next-sprint'))).toBe('次: スプリント 1 / 3');
    expect(screen.text()).toContain(`第${screen.props.state.quarterNumber}四半期`);
    expect(screen.text()).toContain(boss.name);
    expect(screen.text()).toContain(boss.description);
    expect(screen.find('setup').props).toMatchObject({
      role: 'main',
      'aria-labelledby': 'setup-heading',
    });
    expect(screen.find('begin-sprint').props['aria-label']).toBe('スプリント開始');
    expect(
      elements(screen.find('setup')).find((node) => node.props.className === 'formation-grid')
        ?.props,
    ).toMatchObject({
      role: 'region',
      'aria-label': 'メンバー配置',
    });
    expect(screen.text()).toContain('編成 — スプリント開始前に配置とAIを決める');
    expect(screen.text()).toContain('誰に配るかこのタイミングで見直そう');
    expect(content(screen.find('setup-okr'))).toContain('今四半期の OKR');
    expect(content(screen.find('term-tip-pr'))).toContain('PR');
    expect(content(screen.find('term-tip-aiLiteracy'))).toContain('AIリテラシー');
    expect(content(screen.find('term-tip-rework'))).toContain('手戻り');
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
    expect(screen.find('setup-elite-pending').props).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
    });
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
    expect(screen.find('setup-boss-pending').props).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
    });
    expect(screen.has('setup-elite-pending')).toBe(false);
    expect(screen.text()).toContain('編成 — ボススプリントの前に配置とAIを決める');
    expect(screen.text()).toContain('次はボス。四半期の締めくくり');
  });

  it('未知のボス ID でもフォールバック名で編成を表示する', () => {
    const screen = mountSetup({ state: makeState({ bossId: 'missing-boss' }) });
    expect(screen.text()).toContain('ボス: ボス');
    expect(screen.text()).toContain('★ ');
    expect(screen.find('begin-sprint').props.disabled).toBe(false);
  });

  it('休職中を除くコーダーが0人なら開始前に結果と修正方法を案内し、開始操作にも関連付ける', () => {
    const state = makeState();
    state.roster.members[0].onLeave = true;
    const screen = mountSetup({ state });
    const warning = screen.find('setup-observation-coding-staff');
    expect(content(warning)).toBe('コーダー0人。出荷できません');
    expect(screen.find('begin-sprint').props['aria-describedby']).toBe(warning.props.id);
    expect(screen.has('setup-observation-dismiss')).toBe(false);
    screen.click('setup-assign-coder');
    expect(screen.targets.get('assign-m2-coding')!.scrollIntoView).toHaveBeenCalledOnce();
    expect(screen.targets.get('assign-m2-coding')!.focus).toHaveBeenCalledOnce();
    expect(screen.props.onAssign).not.toHaveBeenCalled();
    screen.click('begin-sprint');
    expect(screen.props.onBegin).not.toHaveBeenCalled();
    const dialog = screen.find('setup-no-coder-confirm');
    expect(dialog.props).toMatchObject({ role: 'dialog', 'aria-modal': 'true', tabIndex: -1 });
    expect(content(dialog)).toContain('コーダーが0人です');
    expect(content(screen.find('setup-no-coder-assign'))).toBe('コーダーを割り当てる');
    expect(content(screen.find('setup-no-coder-begin'))).toBe('このまま開始');
    expect(screen.targets.get('setup-no-coder-assign')!.focus).toHaveBeenCalledOnce();
    expect(useDialogOverlayLock).toHaveBeenLastCalledWith(expect.any(Object), {
      restoreFocus: true,
      onDismiss: expect.any(Function),
    });
    // 確認後の重複イベントでも開始を二重に通知しない。
    const confirm = screen.find('setup-no-coder-begin').props.onClick as () => void;
    confirm();
    confirm();
    screen.update({});
    expect(screen.props.onBegin).toHaveBeenCalledExactlyOnceWith();
    expect(screen.has('setup-no-coder-confirm')).toBe(false);
  });

  it('割り当てる導線はベンチの稼働メンバーを優先し、確認画面からも配置を変えずに誘導する', () => {
    vi.useFakeTimers();
    const state = makeState();
    state.roster.members[0].assignment = 'review';
    state.roster.members[1].assignment = 'bench';
    const screen = mountSetup({ state });
    screen.click('setup-assign-coder');
    expect(screen.targets.get('assign-m2-coding')!.focus).toHaveBeenCalledOnce();
    expect(screen.targets.get('assign-m1-coding')!.focus).not.toHaveBeenCalled();
    screen.click('begin-sprint');
    screen.click('setup-no-coder-assign');
    expect(screen.has('setup-no-coder-confirm')).toBe(false);
    vi.runAllTimers();
    expect(screen.targets.get('assign-m2-coding')!.focus).toHaveBeenCalledTimes(2);
    expect(screen.props.onAssign).not.toHaveBeenCalled();
    expect(screen.props.onBegin).not.toHaveBeenCalled();
  });

  it('確認をEscapeで取り消し、別チームやスプリントへ確認状態を持ち越さない', () => {
    const state = makeState();
    state.roster.members[0].assignment = 'review';
    const screen = mountSetup({ state });
    screen.click('begin-sprint');
    const options = vi.mocked(useDialogOverlayLock).mock.lastCall?.[1];
    options?.onDismiss?.();
    screen.update({});
    expect(screen.has('setup-no-coder-confirm')).toBe(false);
    expect(screen.props.onBegin).not.toHaveBeenCalled();
    for (const next of [
      { ...state, activeTeamId: `${state.activeTeamId}-other` },
      { ...state, sprintIndexInQuarter: state.sprintIndexInQuarter + 1 },
    ]) {
      screen.click('begin-sprint');
      expect(screen.has('setup-no-coder-confirm')).toBe(true);
      screen.update({ state: next });
      expect(screen.has('setup-no-coder-confirm')).toBe(false);
      screen.update({ state });
      expect(screen.has('setup-no-coder-confirm')).toBe(false);
    }
    expect(screen.props.onBegin).not.toHaveBeenCalled();
  });

  it('全員休職時も安全側の編成に戻るへフォーカスし、開始せず取り消せる', () => {
    const state = makeState();
    state.roster.members.forEach((member) => {
      member.onLeave = true;
    });
    const screen = mountSetup({ state });
    expect(screen.find('setup-assign-coder').props.disabled).toBe(true);
    screen.click('begin-sprint');
    expect(content(screen.find('setup-no-coder-confirm'))).toContain(
      '今は割り当てられるメンバーがいません',
    );
    expect(content(screen.find('setup-no-coder-assign'))).toBe('編成に戻る');
    expect(screen.find('setup-no-coder-assign').props.disabled).toBeUndefined();
    expect(screen.targets.get('setup-no-coder-assign')!.focus).toHaveBeenCalledOnce();
    expect(screen.targets.get('setup-no-coder-begin')!.focus).not.toHaveBeenCalled();
    screen.click('setup-no-coder-assign');
    expect(screen.has('setup-no-coder-confirm')).toBe(false);
    expect(screen.props.onBegin).not.toHaveBeenCalled();
  });

  it('通常案内は×で閉じられ、非表示でも常設slotを残す', () => {
    const screen = mountSetup();
    expect(screen.has('setup-observation-slot')).toBe(true);
    expect(screen.has('setup-observation')).toBe(false);
    const state = screen.props.state;
    const roster = structuredClone(state.roster);
    roster.members[1].assignment = 'bench';
    screen.update({ state: { ...state, roster } });
    const dismiss = screen.find('setup-observation-dismiss');
    expect(content(dismiss)).toBe('×');
    expect(dismiss.props['aria-label']).toBe('案内を閉じる');
    screen.click('setup-observation-dismiss');
    expect(screen.has('setup-observation')).toBe(false);
    expect(screen.has('setup-observation-slot')).toBe(true);
    expect(screen.targets.get('begin-sprint')!.focus).toHaveBeenCalledOnce();
  });

  it('読み取り専用ではコーダー不在でも開始確認も配置誘導も実行しない', () => {
    const state = makeState();
    state.roster.members[0].assignment = 'review';
    const screen = mountSetup({ state, readOnly: true });
    expect(screen.find('setup-assign-coder').props.disabled).toBe(true);
    screen.click('setup-assign-coder');
    screen.click('begin-sprint');
    expect(screen.has('setup-no-coder-confirm')).toBe(false);
    expect(screen.targets.get('assign-m1-coding')!.focus).not.toHaveBeenCalled();
    expect(screen.props.onBegin).not.toHaveBeenCalled();
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

  it('開いた時点で条件を満たすときだけ案内行を出し、途中では足さず開封で消す', () => {
    const hidden = mountSetup({
      runEpoch: 2,
      state: makeState({ budget: MIN_ORG_LEVER_BUDGET - 1, quarterNumber: 1 }),
    });
    expect(hidden.has('org-lever-hint')).toBe(false);
    hidden.update({
      state: makeState({ budget: MIN_ORG_LEVER_BUDGET, quarterNumber: 1 }),
    });
    expect(hidden.has('org-lever-hint')).toBe(false);

    const shown = mountSetup({
      runEpoch: 2,
      state: makeState({ budget: MIN_ORG_LEVER_BUDGET, quarterNumber: 1 }),
    });
    expect(content(shown.find('org-lever-hint'))).toBe('予算は組織レバーで使えます');
    expect(shown.find('org-lever-hint').props.role).toBe('status');
    shown.update({
      state: makeState({ budget: MIN_ORG_LEVER_BUDGET - 1, quarterNumber: 2 }),
    });
    expect(shown.has('org-lever-hint')).toBe(true);
    dismissOrgLeverHint(2);
    shown.update({});
    expect(shown.has('org-lever-hint')).toBe(false);
  });
});
