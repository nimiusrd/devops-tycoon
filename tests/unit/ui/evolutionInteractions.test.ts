import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ceremonyState = vi.hoisted(() => ({ value: null as string | null }));

// Node では進化通知用の state だけを代行する。解放判定と効果タグは実装を通す。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [ceremonyState.value, (value: string | null) => (ceremonyState.value = value)],
}));

import { BRANCH_LABEL, EVOLUTION_NODES } from '../../../src/data/evolution';
import { RunEngine } from '../../../src/sim/run/engine';
import { unlockNode } from '../../../src/sim/run/evolution';
import type { RunState } from '../../../src/sim/run/types';
import { EvolutionScreen } from '../../../src/ui/EvolutionScreen';
import { RewardCeremony } from '../../../src/ui/JuicyEffects';

type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  // ブラウザ上の音声・motion はこのテストの境界。通知コンポーネントへの公開 props を検証する。
  if (node.type === RewardCeremony) return [node];
  if (typeof node.type === 'function') {
    return elements((node.type as (props: Props) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<Props>(node) || node.type === RewardCeremony) return '';
  if (typeof node.type === 'function') {
    return content((node.type as (props: Props) => ReactNode)(node.props));
  }
  return Children.toArray(node.props.children).map(content).join('');
}

function makeState(evolution: RunState['evolution']): RunState {
  const engine = new RunEngine({ seed: 'evolution-interactions', difficulty: 'easy' });
  engine.startRun();
  return { ...engine.snapshot(), evolution };
}

function mountEvolution(initial: RunState['evolution']) {
  let state = makeState(initial);
  const onUnlock = vi.fn();
  const onFinish = vi.fn();
  const render = () => EvolutionScreen({ state, onUnlock, onFinish });
  let tree = render();
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    find,
    onUnlock,
    onFinish,
    text: () => content(tree),
    ceremony: () => elements(tree).find((node) => node.type === RewardCeremony),
    update(evolution: RunState['evolution']) {
      state = { ...state, evolution };
      tree = render();
    },
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
      tree = render();
    },
  };
}

afterEach(() => {
  ceremonyState.value = null;
});

describe('EvolutionScreen の解放と前提条件', () => {
  it('全 5 ブランチと各ノードの効果・費用を示し、ポイントゼロでも終了できる', () => {
    const screen = mountEvolution({ points: 0, unlocked: {} });
    expect(screen.find('evolution').props).toMatchObject({
      role: 'dialog',
      'aria-label': 'Evolution Tree',
    });
    expect(content(screen.find('evo-points'))).toBe('0');
    for (const label of Object.values(BRANCH_LABEL)) expect(screen.text()).toContain(label);
    for (const node of EVOLUTION_NODES) {
      expect(content(screen.find(`evo-${node.id}`))).toContain(node.name);
      expect(content(screen.find(`evo-${node.id}`))).toContain(node.description);
      expect(content(screen.find(`evo-${node.id}`))).toContain(`⭐${node.cost}`);
      expect(content(screen.find(`evo-effect-tags-${node.id}`))).not.toBe('');
      expect(screen.find(`evo-${node.id}`).props.disabled).toBe(true);
      screen.click(`evo-${node.id}`);
    }
    expect(screen.onUnlock).not.toHaveBeenCalled();
    expect(screen.ceremony()).toBeUndefined();
    screen.click('evolution-done');
    expect(screen.onFinish).toHaveBeenCalledExactlyOnceWith();
  });

  it('必要ポイントだけあっても前提未解放の次段ノードは選択できない', () => {
    const screen = mountEvolution({ points: 3, unlocked: {} });
    expect(screen.find('evo-dev-1').props.disabled).toBe(false);
    expect(screen.find('evo-dev-1').props.className).toContain(' can');
    expect(screen.find('evo-dev-2').props.disabled).toBe(true);
    expect(screen.find('evo-culture-1').props.disabled).toBe(true);
    screen.click('evo-dev-2');
    expect(screen.onUnlock).not.toHaveBeenCalled();
  });

  it.each([
    { points: 2, disabled: true },
    { points: 3, disabled: false },
    { points: 4, disabled: false },
  ])('前提解放済みの次段ノードはポイント $points で可否を切り替える', ({ points, disabled }) => {
    const screen = mountEvolution({ points, unlocked: { 'dev-1': true } });
    expect(screen.find('evo-dev-1').props.disabled).toBe(true);
    expect(screen.find('evo-dev-1').props.className).toContain(' unlocked');
    expect(content(screen.find('evo-dev-1'))).toContain('解放済み');
    expect(screen.find('evo-dev-2').props.disabled).toBe(disabled);
    screen.click('evo-dev-2');
    expect(screen.onUnlock).toHaveBeenCalledTimes(disabled ? 0 : 1);
    if (!disabled) expect(screen.onUnlock).toHaveBeenCalledWith('dev-2');
  });

  it('解放を通知して祝福の内容を更新し、親からの状態更新で重複解放を止める', () => {
    const evolution = { points: 5, unlocked: {} };
    const screen = mountEvolution(evolution);
    screen.click('evo-dev-1');
    expect(screen.onUnlock).toHaveBeenCalledExactlyOnceWith('dev-1');
    expect(screen.ceremony()?.props).toMatchObject({
      kind: 'evolution',
      title: 'Coding 速度向上 を解放',
      detail: '組織の新しい枝が伸びた',
    });
    expect(evolution).toEqual({ points: 5, unlocked: {} });
    const afterFirst = unlockNode(evolution, 'dev-1');
    screen.update(afterFirst);
    expect(content(screen.find('evo-points'))).toBe('4');
    expect(screen.find('evo-dev-1').props.disabled).toBe(true);
    expect(screen.find('evo-dev-2').props.disabled).toBe(false);
    screen.click('evo-dev-1');
    expect(screen.onUnlock).toHaveBeenCalledTimes(1);
    screen.click('evo-dev-2');
    expect(screen.onUnlock).toHaveBeenLastCalledWith('dev-2');
    expect(screen.ceremony()?.props.title).toBe('並列実装枠 +1 を解放');
    screen.update(unlockNode(afterFirst, 'dev-2'));
    expect(content(screen.find('evo-points'))).toBe('1');
    expect(screen.find('evo-dev-2').props.disabled).toBe(true);
    expect(screen.find('evo-dev-3').props.disabled).toBe(true);
  });
});
