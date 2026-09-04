import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const choiceState = vi.hoisted(() => ({ value: undefined as boolean | undefined }));

// Node では表示切り替えの state とブラウザのフォーカス管理だけを代行する。
// イベント、採用判定、カード定義と効果タグは実装を通す。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: boolean) {
    choiceState.value ??= initial;
    return [choiceState.value, (value: boolean) => (choiceState.value = value)];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { RECRUIT_COST, ROSTER_CAP } from '../../../src/sim/member';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { BeatScreen } from '../../../src/ui/BeatScreen';
import { RestScreen } from '../../../src/ui/RestScreen';

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

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'beat-rest-interactions', difficulty: 'easy' });
  engine.startRun();
  return { ...engine.snapshot(), ...overrides };
}

function mountScreen(render: () => ReactNode) {
  choiceState.value = undefined;
  let tree = render();
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
      tree = render();
    },
  };
}

afterEach(() => {
  choiceState.value = undefined;
});

describe('BeatScreen のイベント選択', () => {
  it.each([null, { eventId: 'missing-event', kind: 'decision' as const }])(
    '提示イベントが存在しなければ描画せず選択もしない',
    (beat) => {
      const onResolve = vi.fn();
      expect(BeatScreen({ state: makeState({ beat }), onResolve })).toBeNull();
      expect(onResolve).not.toHaveBeenCalled();
    },
  );

  it('判定イベントは結果を提示し、了解で選択番号を渡さず解決する', () => {
    const onResolve = vi.fn();
    const state = makeState({ beat: { eventId: 'debt-incident', kind: 'judgment' } });
    const screen = mountScreen(() => BeatScreen({ state, onResolve }));
    expect(screen.find('beat').props['data-kind']).toBe('judgment');
    const message = content(screen.find('beat'));
    expect(message).toContain('"動いているように見える" 障害');
    expect(message).toContain('潜在バグが顕在化し、品質と士気が揺らぐ');
    expect(message).toContain('品質 -8');
    expect(message).toContain('Tech Debt +6');
    expect(screen.has('beat-choice-0')).toBe(false);
    screen.click('beat-ack');
    expect(onResolve).toHaveBeenCalledExactlyOnceWith();
  });

  it('判断を保留して状況確認に戻り、再開後に選んだ番号だけを解決する', () => {
    const onResolve = vi.fn();
    const state = makeState({ beat: { eventId: 'urgent-demo', kind: 'decision' } });
    const screen = mountScreen(() => BeatScreen({ state, onResolve }));
    expect(screen.find('beat').props).toMatchObject({
      'data-kind': 'decision',
      'aria-modal': 'true',
      'aria-labelledby': 'decision-title',
    });
    expect(content(screen.find('beat-choice-0'))).toContain('残業して間に合わせる');
    expect(content(screen.find('beat-choice-0'))).toContain('出荷 +30');
    expect(content(screen.find('beat-choice-2'))).toContain('期待値マネジメント');
    screen.click('beat-dismiss');
    expect(screen.has('beat')).toBe(false);
    expect(content(screen.find('beat-pending'))).toContain('選択はまだ確定していません');
    expect(onResolve).not.toHaveBeenCalled();
    screen.click('beat-reopen');
    expect(screen.has('beat-pending')).toBe(false);
    expect(content(screen.find('beat-choice-1'))).toContain('スコープを削って出す');
    screen.click('beat-choice-1');
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('RestScreen の休息・採用・施策強化', () => {
  it.each(['heal', 'repay', 'recruit'] as const)('%s の選択をそのまま通知する', (option) => {
    const onChoose = vi.fn();
    const state = makeState({ budget: RECRUIT_COST });
    const screen = mountScreen(() => RestScreen({ state, onChoose }));
    expect(screen.find('rest-recruit').props.disabled).toBe(false);
    screen.click(`rest-${option}`);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(option);
  });

  it('回復レリックの加算を休息の効果タグに含める', () => {
    const state = makeState({ relics: ['flow-first'] });
    const screen = mountScreen(() => RestScreen({ state, onChoose: vi.fn() }));
    expect(content(screen.find('rest-tags-heal'))).toContain('シニアHP +50 (基本+40)');
    expect(content(screen.find('rest-tags-heal'))).toContain('スタミナ +');
    expect(content(screen.find('rest-tags-repay'))).toContain('次スプリント 手戻り率');
    expect(content(screen.find('rest-tags-recruit'))).toContain(`予算 -${RECRUIT_COST}`);
  });

  it.each(['budget', 'roster'] as const)('採用不可の理由（%s）を示して選択させない', (reason) => {
    const state = makeState({ budget: reason === 'budget' ? RECRUIT_COST - 1 : RECRUIT_COST });
    if (reason === 'roster') {
      const firstMember = state.roster.members[0];
      state.roster = {
        ...state.roster,
        members: Array.from({ length: ROSTER_CAP }, (_, index) => ({
          ...firstMember,
          id: `full-roster-${index}`,
        })),
      };
    }
    const onChoose = vi.fn();
    const screen = mountScreen(() => RestScreen({ state, onChoose }));
    expect(screen.find('rest-recruit').props.disabled).toBe(true);
    expect(content(screen.find('rest-recruit'))).toContain(
      reason === 'budget' ? `予算が足りません（💰${RECRUIT_COST} 必要）` : 'ロスターが満員です',
    );
    screen.click('rest-recruit');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('デッキが空なら施策強化を無効にする', () => {
    const onChoose = vi.fn();
    const state = makeState({ deck: [] });
    const screen = mountScreen(() => RestScreen({ state, onChoose }));
    expect(screen.find('rest-upgrade').props.disabled).toBe(true);
    expect(content(screen.find('rest-upgrade'))).toContain('デッキが空です');
    screen.click('rest-upgrade');
    expect(screen.has('rest-upgrade-cards')).toBe(false);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('強化選択のキャンセルでは消費せず、同名カードをデッキ位置で区別して確定する', () => {
    const onChoose = vi.fn();
    const state = makeState({
      deck: [
        { defId: 'docs', level: 1 },
        { defId: 'docs', level: 3 },
      ],
    });
    const screen = mountScreen(() => RestScreen({ state, onChoose }));
    screen.click('rest-upgrade');
    expect(content(screen.find('rest-upgrade-card-docs-0'))).toContain('次: Lv.2');
    expect(content(screen.find('rest-upgrade-card-docs-1'))).toContain('次: Lv.4');
    expect(content(screen.find('rest-upgrade-card-docs-1'))).toContain('発動 ⚡');
    expect(onChoose).not.toHaveBeenCalled();
    screen.click('rest-upgrade-cancel');
    expect(screen.has('rest-upgrade-cards')).toBe(false);
    expect(screen.has('rest-heal')).toBe(true);
    expect(onChoose).not.toHaveBeenCalled();
    screen.click('rest-upgrade');
    screen.click('rest-upgrade-card-docs-1');
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('upgrade', 1);
    expect(state.deck.map((card) => card.level)).toEqual([1, 3]);
  });
});
