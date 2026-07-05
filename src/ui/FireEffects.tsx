/**
 * 延焼・鎮火・点火の盤面演出（SPEC 第18.2 / RI-06）。
 *
 * スプリント状態の差分から演出 plan を導出し、Framer Motion で再生する。
 * シミュレーションには影響しない描画専用レイヤ（第22.2）。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  createFireSnapshot,
  detectFireEvents,
  firePct,
  positionFireEffects,
  type PositionedFireEffect,
} from '../render/fireEffects';
import type { SprintMetrics, Task } from '../sim/types';

interface ActiveEffect extends PositionedFireEffect {
  key: number;
}

const MAX_EFFECTS = 8;
const SPREAD_MS = 550;
const EXTINGUISH_MS = 500;
const IGNITE_MS = 450;

export interface FireEffectsProps {
  tasks: readonly Task[];
  metrics: SprintMetrics;
}

export function FireEffects({ tasks, metrics }: FireEffectsProps) {
  const prev = useRef(createFireSnapshot(tasks, metrics));
  const nextKey = useRef(0);
  const [active, setActive] = useState<ActiveEffect[]>([]);

  useEffect(() => {
    const nextSnap = createFireSnapshot(tasks, metrics);
    const raw = detectFireEvents(prev.current, nextSnap);
    prev.current = nextSnap;
    if (raw.length === 0) return;

    const positioned = positionFireEffects(raw, tasks);
    if (positioned.length === 0) return;

    const batch = positioned.map((effect) => ({
      ...effect,
      key: nextKey.current++,
    }));
    setActive((cur) => [...cur, ...batch].slice(-MAX_EFFECTS));

    const timers = batch.map((effect) => {
      const duration =
        effect.kind === 'spread'
          ? SPREAD_MS
          : effect.kind === 'extinguish'
            ? EXTINGUISH_MS
            : IGNITE_MS;
      return window.setTimeout(() => {
        setActive((cur) => cur.filter((e) => e.key !== effect.key));
      }, duration + 80);
    });

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [tasks, metrics]);

  return (
    <div className="fire-effects" aria-hidden="true">
      <AnimatePresence>
        {active.map((effect) => {
          switch (effect.kind) {
            case 'spread':
              return (
                <SpreadParticle key={effect.key} effect={effect} duration={SPREAD_MS / 1000} />
              );
            case 'extinguish':
              return (
                <ExtinguishBurst key={effect.key} effect={effect} duration={EXTINGUISH_MS / 1000} />
              );
            case 'ignite':
              return <IgniteFlash key={effect.key} effect={effect} duration={IGNITE_MS / 1000} />;
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
        left: firePct(effect.fromX, 1404),
        top: firePct(effect.fromY, 573),
      }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{
        opacity: [0, 1, 1, 0.8],
        scale: [0.5, 1.2, 1, 0.6],
        left: firePct(effect.toX, 1404),
        top: firePct(effect.toY, 573),
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
        left: firePct(effect.x, 1404),
        top: firePct(effect.y, 573),
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
        left: firePct(effect.x, 1404),
        top: firePct(effect.y, 573),
      }}
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: [0, 1, 0.7, 0], scale: [0.4, 1.8, 1.2, 0.5] }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  );
}
