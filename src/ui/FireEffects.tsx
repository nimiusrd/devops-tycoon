/**
 * 延焼・鎮火・点火の盤面演出（SPEC 第18.2 / RI-06）。
 *
 * `useBoardEffects` が一度だけ作った時刻付き plan を DOM fallback として描く。
 * Pixi 使用中も不可視のまま同じ animation を進め、初期化失敗時に再発火させない。
 */
import { AnimatePresence, motion } from 'framer-motion';
import type { TimedBoardEffect } from '../render/boardEffects';
import { firePct, type PositionedFireEffect } from '../render/fireEffects';
import { BOARD_VIEW } from '../render/boardScene';

export interface FireEffectsProps {
  effects: readonly TimedBoardEffect[];
  /** Pixi 描画中は DOM fallback を不可視にする（アンマウントはしない）。 */
  gpuActive: boolean;
}

export function FireEffects({ effects, gpuActive }: FireEffectsProps) {
  const active = effects.filter(
    (effect): effect is TimedBoardEffect & { source: 'fire' } => effect.source === 'fire',
  );
  return (
    <div
      className={`fire-effects${gpuActive ? ' dom-fallback-hidden' : ''}`}
      data-effect-count={active.length}
      aria-hidden="true"
    >
      <AnimatePresence>
        {active.map((timed) => {
          const effect = timed.effect;
          switch (effect.kind) {
            case 'spread':
              return (
                <SpreadParticle
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            case 'extinguish':
              return (
                <ExtinguishBurst
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            case 'ignite':
              return (
                <IgniteFlash
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            default:
              return null;
          }
        })}
      </AnimatePresence>
    </div>
  );
}

function SpreadParticle({
  effect,
  duration,
}: {
  effect: Extract<PositionedFireEffect, { kind: 'spread' }>;
  duration: number;
}) {
  return (
    <motion.span
      className="fire-spread-particle"
      data-testid="fire-effect-spread"
      style={{
        left: firePct(effect.fromX, BOARD_VIEW.w),
        top: firePct(effect.fromY, BOARD_VIEW.h),
      }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{
        opacity: [0, 1, 1, 0.8],
        scale: [0.5, 1.2, 1, 0.6],
        left: firePct(effect.toX, BOARD_VIEW.w),
        top: firePct(effect.toY, BOARD_VIEW.h),
      }}
      exit={{ opacity: 0, scale: 0 }}
      transition={{ duration, ease: 'easeInOut' }}
    />
  );
}

function ExtinguishBurst({
  effect,
  duration,
}: {
  effect: Extract<PositionedFireEffect, { kind: 'extinguish' }>;
  duration: number;
}) {
  const big = effect.source === 'firefight';
  return (
    <motion.span
      className={`fire-extinguish-burst${big ? ' firefight' : ''}`}
      data-testid="fire-effect-extinguish"
      style={{
        left: firePct(effect.x, BOARD_VIEW.w),
        top: firePct(effect.y, BOARD_VIEW.h),
      }}
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{
        opacity: [0, 1, 0.6, 0],
        scale: big ? [0.3, 2.2, 1.6, 0.2] : [0.3, 1.5, 1.1, 0.2],
      }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  );
}

function IgniteFlash({
  effect,
  duration,
}: {
  effect: Extract<PositionedFireEffect, { kind: 'ignite' }>;
  duration: number;
}) {
  return (
    <motion.span
      className="fire-ignite-flash"
      data-testid="fire-effect-ignite"
      style={{
        left: firePct(effect.x, BOARD_VIEW.w),
        top: firePct(effect.y, BOARD_VIEW.h),
      }}
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: [0, 1, 0.7, 0], scale: [0.4, 1.8, 1.2, 0.5] }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  );
}
