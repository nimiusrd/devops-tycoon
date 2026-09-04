import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// 動画再生はブラウザ境界に残し、実コンポーネントが渡す座標・時間・キーを検証する。
vi.mock('framer-motion', () => ({ AnimatePresence: 'div', motion: { div: 'div', span: 'span' } }));

import type { BoardEffectPayload, TimedBoardEffect } from '../../../src/render/boardEffects';
import { BOARD_VIEW } from '../../../src/render/boardScene';
import type { PositionedInterventionReaction } from '../../../src/render/interventionEffects';
import { FireEffects } from '../../../src/ui/FireEffects';
import { InterventionEffects } from '../../../src/ui/InterventionEffects';

type Props = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function')
    return expand((node.type as (props: Props) => ReactNode)(node.props));
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function find(node: ReactNode, id: string): ReactElement<Props> {
  const found = elements(node).find((element) => element.props['data-testid'] === id);
  if (!found) throw new Error(`要素がありません: ${id}`);
  return found;
}
function byClass(node: ReactNode, className: string) {
  return elements(node).filter((element) =>
    String(element.props.className).split(' ').includes(className),
  );
}
function timed(
  payload: BoardEffectPayload,
  sequence = 1,
  durationMs = 800,
  delayMs = 0,
): TimedBoardEffect {
  return {
    ...payload,
    sequence,
    startedAtMs: 1000,
    durationMs,
    delayMs,
    endsAtMs: 1000 + delayMs + durationMs + 120,
  };
}

const route = {
  fromX: BOARD_VIEW.w / 4,
  fromY: BOARD_VIEW.h / 2,
  toX: (BOARD_VIEW.w * 3) / 4,
  toY: BOARD_VIEW.h / 4,
};
const point = { x: BOARD_VIEW.w / 2, y: (BOARD_VIEW.h * 3) / 4 };
const success: BoardEffectPayload = { source: 'intervention', effect: { kind: 'successPulse' } };

describe('FireEffects の DOM フォールバック', () => {
  it('延焼・自動鎮火・緊急鎮火・点火を区別し、plan の座標と秒換算時間を描画へ渡す', () => {
    const effects: TimedBoardEffect[] = [
      timed(
        { source: 'fire', effect: { kind: 'spread', fromTaskId: 1, toTaskId: 2, ...route } },
        10,
        1250,
      ),
      timed(
        { source: 'fire', effect: { kind: 'extinguish', taskId: 3, source: 'auto', ...point } },
        11,
        600,
      ),
      timed(
        {
          source: 'fire',
          effect: { kind: 'extinguish', taskId: 4, source: 'firefight', ...point },
        },
        12,
        900,
      ),
      timed({ source: 'fire', effect: { kind: 'ignite', taskId: 5, ...point } }, 13, 700),
      timed(success, 14),
    ];
    const before = structuredClone(effects);
    const tree = expand(FireEffects({ effects, gpuActive: false }));
    expect(elements(tree)[0].props).toMatchObject({
      className: 'fire-effects',
      'data-effect-count': 4,
      'aria-hidden': 'true',
    });
    expect(find(tree, 'fire-effect-spread').props).toMatchObject({
      style: { left: '25%', top: '50%' },
      animate: { left: '75%', top: '25%' },
      transition: { duration: 1.25, ease: 'easeInOut' },
    });
    const bursts = byClass(tree, 'fire-extinguish-burst');
    expect(bursts.map((node) => node.props.className)).toEqual([
      'fire-extinguish-burst',
      'fire-extinguish-burst firefight',
    ]);
    expect(bursts[0].props).toMatchObject({
      style: { left: '50%', top: '75%' },
      animate: { scale: [0.3, 1.5, 1.1, 0.2] },
      transition: { duration: 0.6 },
    });
    expect(bursts[1].props).toMatchObject({
      animate: { scale: [0.3, 2.2, 1.6, 0.2] },
      transition: { duration: 0.9 },
    });
    expect(find(tree, 'fire-effect-ignite').props).toMatchObject({
      style: { left: '50%', top: '75%' },
      animate: { scale: [0.4, 1.8, 1.2, 0.5] },
      transition: { duration: 0.7 },
    });
    expect(elements(tree).filter((node) => node.type === 'span')).toHaveLength(4);
    expect(effects).toEqual(before);
  });

  it('GPU 有効時も同じ演出を保持して不可視化し、対象がなければ空にする', () => {
    const effects = [
      timed({ source: 'fire', effect: { kind: 'ignite', taskId: 1, ...point } }, 42),
    ];
    const visible = FireEffects({ effects, gpuActive: false });
    const hidden = FireEffects({ effects, gpuActive: true });
    expect(hidden.props.className).toBe('fire-effects dom-fallback-hidden');
    expect(hidden.props.children).toEqual(visible.props.children);
    expect(find(expand(hidden), 'fire-effect-ignite').props).toEqual(
      find(expand(visible), 'fire-effect-ignite').props,
    );
    for (const payloads of [[], [timed(success)]]) {
      const empty = expand(FireEffects({ effects: payloads, gpuActive: false }));
      expect(elements(empty)[0].props['data-effect-count']).toBe(0);
      expect(elements(empty).filter((node) => node.type === 'span')).toHaveLength(0);
    }
  });
});

describe('InterventionEffects の DOM フォールバック', () => {
  it('reviewSweep は結果別ルート・stagger を維持し、2 件以上で全体バーストを重ねる', () => {
    const sweeps = (['done', 'rework', 'incident'] as const).map((outcome, index) =>
      timed(
        {
          source: 'intervention',
          effect: {
            kind: 'reviewSweep',
            outcome,
            taskId: index + 1,
            staggerIndex: index,
            ...route,
          },
        },
        index + 20,
        850,
        index * 120,
      ),
    );
    const fire = timed({ source: 'fire', effect: { kind: 'ignite', taskId: 9, ...point } });
    const one = expand(InterventionEffects({ effects: [sweeps[0], fire], gpuActive: false }));
    expect(elements(one)[0].props['data-effect-count']).toBe(1);
    expect(byClass(one, 'intervention-sweep-burst')).toHaveLength(0);
    const two = expand(InterventionEffects({ effects: sweeps.slice(0, 2), gpuActive: false }));
    expect(find(two, 'intervention-effect-sweep-burst').props.transition).toEqual({
      duration: 0.7,
      ease: 'easeOut',
    });
    const tree = expand(InterventionEffects({ effects: [...sweeps, fire], gpuActive: false }));
    expect(elements(tree)[0].props).toMatchObject({
      'data-effect-count': 3,
      'aria-hidden': 'true',
    });
    for (const [index, outcome] of ['done', 'rework', 'incident'].entries()) {
      expect(find(tree, `intervention-effect-sweep-${outcome}`).props).toMatchObject({
        className: `intervention-sweep-particle sweep-${outcome}`,
        style: { left: '25%', top: '50%' },
        animate: { left: '75%', top: '25%' },
        transition: { duration: 0.85, delay: index * 0.12, ease: 'easeInOut' },
      });
    }
    expect(byClass(tree, 'intervention-sweep-burst')).toHaveLength(1);
    expect(elements(tree).some((node) => node.props['data-testid'] === 'fire-effect-ignite')).toBe(
      false,
    );
  });

  it('split は両側へ破片を飛ばし、緊急対応は輪と遅延バーストを順に描く', () => {
    const effects = [
      timed({ source: 'intervention', effect: { kind: 'split', taskId: 1, ...point } }, 30, 800),
      timed(
        { source: 'intervention', effect: { kind: 'firefight', taskId: 2, ...point } },
        31,
        1000,
      ),
    ];
    const before = structuredClone(effects);
    const tree = expand(InterventionEffects({ effects, gpuActive: false }));
    expect(find(tree, 'intervention-effect-split').props).toMatchObject({
      children: 'split',
      style: { left: '50%', top: '75%' },
      transition: { duration: 0.8 },
    });
    const shards = byClass(tree, 'intervention-split-shard');
    expect(shards).toHaveLength(2);
    expect(shards.map((node) => (node.props.animate as { x: number }).x)).toEqual([-18, 18]);
    for (const shard of shards) {
      expect(shard.props).toMatchObject({
        style: { left: '50%', top: '75%' },
        animate: { y: -12 },
        transition: { duration: 0.8 },
      });
    }
    expect(find(tree, 'intervention-effect-firefight').props).toMatchObject({
      style: { left: '50%', top: '75%' },
      transition: { duration: 0.55, ease: 'easeOut' },
    });
    expect(byClass(tree, 'intervention-firefight-burst')[0].props).toMatchObject({
      style: { left: '50%', top: '75%' },
      transition: { duration: 1, delay: 0.35, ease: 'easeOut' },
    });
    expect(effects).toEqual(before);
  });

  it('担当割当は角度と移動先を使い、対象タスクのない成功は全体パルスで知らせる', () => {
    const tree = expand(
      InterventionEffects({
        effects: [
          timed(
            {
              source: 'intervention',
              effect: { kind: 'assignDash', taskId: 1, angleDeg: -32, ...route },
            },
            40,
            1200,
          ),
          timed(success, 41, 650),
        ],
        gpuActive: false,
      }),
    );
    expect(find(tree, 'intervention-effect-dash').props).toMatchObject({
      style: { left: '25%', top: '50%', transformOrigin: 'left center' },
      initial: { rotate: -32 },
      animate: { rotate: -32, left: '75%', top: '25%' },
      transition: { duration: 1.2 },
    });
    expect(find(tree, 'intervention-effect-success-pulse').props).toMatchObject({
      animate: { opacity: [0, 0.5, 0.2, 0] },
      transition: { duration: 0.65, ease: 'easeOut' },
    });
    expect(byClass(tree, 'intervention-sweep-burst')).toHaveLength(0);
  });

  it.each(['andon', 'overtime', 'stability', 'throttle'] as const)(
    '%s は対応する常駐効果色のパルスを描く',
    (modifierKind) => {
      const effect: PositionedInterventionReaction = {
        kind: 'boardAura',
        modifierKind,
        durationTicks: 30,
      };
      const tree = expand(
        InterventionEffects({
          effects: [timed({ source: 'intervention', effect }, 50, 950)],
          gpuActive: false,
        }),
      );
      expect(find(tree, `intervention-effect-aura-${modifierKind}`).props).toMatchObject({
        className: `intervention-aura-pulse aura-${modifierKind}`,
        animate: { opacity: [0, 0.55, 0.25, 0] },
        transition: { duration: 0.95, ease: 'easeOut' },
      });
    },
  );

  it('GPU 切替で演出キー・時間を変えず、消去後はパルスも残さない', () => {
    const effects = [timed(success, 61)];
    const visible = InterventionEffects({ effects, gpuActive: false });
    const hidden = InterventionEffects({ effects, gpuActive: true });
    expect(hidden.props.className).toBe('intervention-effects dom-fallback-hidden');
    expect(hidden.props.children).toEqual(visible.props.children);
    const empty = expand(InterventionEffects({ effects: [], gpuActive: true }));
    expect(elements(empty)[0].props['data-effect-count']).toBe(0);
    expect(elements(empty).filter((node) => node.props['data-testid'])).toHaveLength(0);
  });
});
