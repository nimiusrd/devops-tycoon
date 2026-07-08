/**
 * 介入アクション成功時の盤面リアクション演出（SPEC 第6 / 第18.2 / RI-50）。
 *
 * RI-49 の `InterventionEffect` ペイロードから plan を導出し、Framer Motion で再生する。
 * シミュレーションには影響しない描画専用レイヤ（第22.2）。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  interventionPct,
  planPositionedInterventionReactions,
  type PositionedInterventionReaction,
} from '../render/interventionEffects';
import type { InterventionEffect, Task } from '../sim/types';

type ActiveEffect = PositionedInterventionReaction & { key: number };

const MAX_EFFECTS = 12;
const SWEEP_MS = 480;
const SWEEP_STAGGER_MS = 90;
const SPLIT_MS = 520;
const FIREFIGHT_MS = 550;
const DASH_MS = 420;
const AURA_PULSE_MS = 600;

export interface InterventionTrigger {
  effect: InterventionEffect;
  prevTasks: readonly Task[];
  currentTick: number;
  key: number;
}

export interface InterventionEffectsProps {
  trigger: InterventionTrigger | null;
  tasks: readonly Task[];
  onFirefightTaskId?: (taskId: number) => void;
}

export function InterventionEffects({
  trigger,
  tasks,
  onFirefightTaskId,
}: InterventionEffectsProps) {
  const nextKey = useRef(0);
  const removalTimers = useRef<Map<number, number>>(new Map());
  const lastTriggerKey = useRef<number | null>(null);
  const [active, setActive] = useState<ActiveEffect[]>([]);

  useEffect(() => {
    const timers = removalTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!trigger || trigger.key === lastTriggerKey.current) return;
    lastTriggerKey.current = trigger.key;

    const positioned = planPositionedInterventionReactions(
      trigger.effect,
      tasks,
      trigger.prevTasks,
      trigger.currentTick,
    );
    if (positioned.length === 0) return;

    const firefight = positioned.find((p) => p.kind === 'firefight');
    if (firefight?.kind === 'firefight') {
      onFirefightTaskId?.(firefight.taskId);
    }

    const batch = positioned.map((effect) => ({
      ...effect,
      key: nextKey.current++,
    }));
    setActive((cur) => [...cur, ...batch].slice(-MAX_EFFECTS));

    for (const effect of batch) {
      const duration =
        effect.kind === 'reviewSweep'
          ? SWEEP_MS + effect.staggerIndex * SWEEP_STAGGER_MS
          : effect.kind === 'split'
            ? SPLIT_MS
            : effect.kind === 'firefight'
              ? FIREFIGHT_MS
              : effect.kind === 'assignDash'
                ? DASH_MS
                : effect.kind === 'boardAura'
                  ? AURA_PULSE_MS
                  : 400;
      const timer = window.setTimeout(() => {
        setActive((cur) => cur.filter((e) => e.key !== effect.key));
        removalTimers.current.delete(effect.key);
      }, duration + 80);
      removalTimers.current.set(effect.key, timer);
    }
  }, [trigger, tasks, onFirefightTaskId]);

  return (
    <div className="intervention-effects" aria-hidden="true">
      <AnimatePresence>
        {active.map((effect) => {
          switch (effect.kind) {
            case 'reviewSweep':
              return (
                <ReviewSweepParticle
                  key={effect.key}
                  effect={effect}
                  duration={SWEEP_MS / 1000}
                  delay={(effect.staggerIndex * SWEEP_STAGGER_MS) / 1000}
                />
              );
            case 'split':
              return <SplitBurst key={effect.key} effect={effect} duration={SPLIT_MS / 1000} />;
            case 'firefight':
              return (
                <FirefightBurst key={effect.key} effect={effect} duration={FIREFIGHT_MS / 1000} />
              );
            case 'assignDash':
              return <AssignDash key={effect.key} effect={effect} duration={DASH_MS / 1000} />;
            case 'boardAura':
              return (
                <BoardAuraPulse key={effect.key} effect={effect} duration={AURA_PULSE_MS / 1000} />
              );
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
      className="intervention-sweep-particle"
      data-testid="intervention-effect-sweep"
      style={{
        left: interventionPct(effect.fromX, 1404),
        top: interventionPct(effect.fromY, 573),
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{
        opacity: [0, 1, 1, 0.7],
        scale: [0.6, 1.1, 1, 0.5],
        left: interventionPct(effect.toX, 1404),
        top: interventionPct(effect.toY, 573),
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
          left: interventionPct(effect.x, 1404),
          top: interventionPct(effect.y, 573),
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
            left: interventionPct(effect.x, 1404),
            top: interventionPct(effect.y, 573),
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
          left: interventionPct(effect.x, 1404),
          top: interventionPct(effect.y, 573),
        }}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: [0, 0.95, 0.5, 0], scale: [0.4, 1.4, 1.8, 2.2] }}
        exit={{ opacity: 0 }}
        transition={{ duration: duration * 0.55, ease: 'easeOut' }}
      />
      <motion.span
        className="intervention-firefight-burst"
        style={{
          left: interventionPct(effect.x, 1404),
          top: interventionPct(effect.y, 573),
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
  const rad = (effect.angleDeg * Math.PI) / 180;
  return (
    <motion.span
      className="intervention-assign-dash"
      data-testid="intervention-effect-dash"
      style={
        {
          left: interventionPct(effect.fromX, 1404),
          top: interventionPct(effect.fromY, 573),
          '--dash-angle': `${effect.angleDeg}deg`,
          '--dash-dx': `${Math.cos(rad) * 28}px`,
          '--dash-dy': `${Math.sin(rad) * 28}px`,
        } as CSSProperties
      }
      initial={{ opacity: 0, scaleX: 0.2 }}
      animate={{
        opacity: [0, 1, 0.8, 0],
        scaleX: [0.2, 1.2, 1, 0.4],
        left: interventionPct(effect.toX, 1404),
        top: interventionPct(effect.toY, 573),
      }}
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
