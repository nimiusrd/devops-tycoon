/**
 * 介入アクション成功時の盤面リアクション演出（SPEC 第6 / 第18.2 / RI-50）。
 *
 * `useBoardEffects` が一度だけ作った時刻付き plan を DOM fallback として描く。
 * Pixi 使用中も不可視のまま同じ animation を進め、初期化失敗時に再発火させない。
 */
import { AnimatePresence, motion } from 'framer-motion';
import type { TimedBoardEffect } from '../render/boardEffects';
import {
  interventionPct,
  type PositionedInterventionReaction,
} from '../render/interventionEffects';
import { BOARD_VIEW } from '../render/boardScene';
import type { InterventionEffect, Task } from '../sim/types';

export interface InterventionTrigger {
  effect: InterventionEffect;
  prevTasks: readonly Task[];
  /** dispatch 直後のタスク快照（React state 更新前に outcome ルートを決める）。 */
  nextTasks: readonly Task[];
  currentTick: number;
  key: number;
}

export interface InterventionEffectsProps {
  effects: readonly TimedBoardEffect[];
  /** Pixi 描画中は DOM fallback を不可視にする（アンマウントはしない）。 */
  gpuActive: boolean;
}

export function InterventionEffects({ effects, gpuActive }: InterventionEffectsProps) {
  const active = effects.filter(
    (effect): effect is TimedBoardEffect & { source: 'intervention' } =>
      effect.source === 'intervention',
  );
  return (
    <div
      className={`intervention-effects${gpuActive ? ' dom-fallback-hidden' : ''}`}
      data-effect-count={active.length}
      aria-hidden="true"
    >
      <AnimatePresence>
        {active.filter((effect) => effect.effect.kind === 'reviewSweep').length >= 2 && (
          <motion.div
            key="sweep-burst"
            className="intervention-sweep-burst"
            data-testid="intervention-effect-sweep-burst"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: [0, 0.9, 0], scale: [0.7, 1.05, 1.2] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {active.map((timed) => {
          const effect = timed.effect;
          switch (effect.kind) {
            case 'reviewSweep':
              return (
                <ReviewSweepParticle
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                  delay={timed.delayMs / 1000}
                />
              );
            case 'split':
              return (
                <SplitBurst
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            case 'firefight':
              return (
                <FirefightBurst
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            case 'assignDash':
              return (
                <AssignDash
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            case 'boardAura':
              return (
                <BoardAuraPulse
                  key={timed.sequence}
                  effect={effect}
                  duration={timed.durationMs / 1000}
                />
              );
            case 'successPulse':
              return <SuccessPulse key={timed.sequence} duration={timed.durationMs / 1000} />;
            default:
              return null;
          }
        })}
      </AnimatePresence>
    </div>
  );
}

function ReviewSweepParticle({
  effect,
  duration,
  delay,
}: {
  effect: Extract<PositionedInterventionReaction, { kind: 'reviewSweep' }>;
  duration: number;
  delay: number;
}) {
  return (
    <motion.span
      className={`intervention-sweep-particle sweep-${effect.outcome}`}
      data-testid={`intervention-effect-sweep-${effect.outcome}`}
      style={{
        left: interventionPct(effect.fromX, BOARD_VIEW.w),
        top: interventionPct(effect.fromY, BOARD_VIEW.h),
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{
        opacity: [0, 1, 1, 0.7],
        scale: [0.6, 1.1, 1, 0.5],
        left: interventionPct(effect.toX, BOARD_VIEW.w),
        top: interventionPct(effect.toY, BOARD_VIEW.h),
      }}
      exit={{ opacity: 0, scale: 0 }}
      transition={{ duration, delay, ease: 'easeInOut' }}
    />
  );
}

function SplitBurst({
  effect,
  duration,
}: {
  effect: Extract<PositionedInterventionReaction, { kind: 'split' }>;
  duration: number;
}) {
  return (
    <>
      <motion.span
        className="intervention-split-badge"
        data-testid="intervention-effect-split"
        style={{
          left: interventionPct(effect.x, BOARD_VIEW.w),
          top: interventionPct(effect.y, BOARD_VIEW.h),
        }}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.3, 1.1, 0.8] }}
        exit={{ opacity: 0 }}
        transition={{ duration, ease: 'easeOut' }}
      >
        split
      </motion.span>
      {[-18, 18].map((offset) => (
        <motion.span
          key={offset}
          className="intervention-split-shard"
          style={{
            left: interventionPct(effect.x, BOARD_VIEW.w),
            top: interventionPct(effect.y, BOARD_VIEW.h),
          }}
          initial={{ opacity: 0, x: 0, y: 0, scale: 0.5 }}
          animate={{
            opacity: [0, 1, 0.6, 0],
            x: offset,
            y: -12,
            scale: [0.5, 0.9, 0.7, 0.3],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease: 'easeOut' }}
        />
      ))}
    </>
  );
}

function FirefightBurst({
  effect,
  duration,
}: {
  effect: Extract<PositionedInterventionReaction, { kind: 'firefight' }>;
  duration: number;
}) {
  return (
    <>
      <motion.span
        className="intervention-firefight-ring"
        data-testid="intervention-effect-firefight"
        style={{
          left: interventionPct(effect.x, BOARD_VIEW.w),
          top: interventionPct(effect.y, BOARD_VIEW.h),
        }}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: [0, 0.95, 0.5, 0], scale: [0.4, 1.4, 1.8, 2.2] }}
        exit={{ opacity: 0 }}
        transition={{ duration: duration * 0.55, ease: 'easeOut' }}
      />
      <motion.span
        className="intervention-firefight-burst"
        style={{
          left: interventionPct(effect.x, BOARD_VIEW.w),
          top: interventionPct(effect.y, BOARD_VIEW.h),
        }}
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{
          opacity: [0, 0, 1, 0.6, 0],
          scale: [0.3, 0.3, 2.2, 1.6, 0.2],
        }}
        exit={{ opacity: 0 }}
        transition={{ duration, ease: 'easeOut', delay: duration * 0.35 }}
      />
    </>
  );
}

function AssignDash({
  effect,
  duration,
}: {
  effect: Extract<PositionedInterventionReaction, { kind: 'assignDash' }>;
  duration: number;
}) {
  return (
    <motion.span
      className="intervention-assign-dash"
      data-testid="intervention-effect-dash"
      style={{
        left: interventionPct(effect.fromX, BOARD_VIEW.w),
        top: interventionPct(effect.fromY, BOARD_VIEW.h),
        transformOrigin: 'left center',
      }}
      initial={{ opacity: 0, scaleX: 0.2, rotate: effect.angleDeg }}
      animate={{
        opacity: [0, 1, 0.8, 0],
        scaleX: [0.2, 1.2, 1, 0.4],
        rotate: effect.angleDeg,
        left: interventionPct(effect.toX, BOARD_VIEW.w),
        top: interventionPct(effect.toY, BOARD_VIEW.h),
      }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  );
}

function SuccessPulse({ duration }: { duration: number }) {
  return (
    <motion.div
      className="intervention-success-pulse"
      data-testid="intervention-effect-success-pulse"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.5, 0.2, 0] }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  );
}

function BoardAuraPulse({
  effect,
  duration,
}: {
  effect: Extract<PositionedInterventionReaction, { kind: 'boardAura' }>;
  duration: number;
}) {
  return (
    <motion.div
      className={`intervention-aura-pulse aura-${effect.modifierKind}`}
      data-testid={`intervention-effect-aura-${effect.modifierKind}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.55, 0.25, 0] }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  );
}
