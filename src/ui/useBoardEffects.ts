/** 炎上・介入の検出、寿命、SFX をレンダラから分離する React 境界（RI-142）。 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAudio } from '../audio/useAudio';
import type { SfxId } from '../audio/sounds';
import {
  boardEffectSfx,
  createTimedBoardEffects,
  mergeTimedBoardEffects,
  type BoardEffectPayload,
  type TimedBoardEffect,
} from '../render/boardEffects';
import {
  createFireSnapshot,
  detectFireEvents,
  fireSnapshotsEqual,
  positionFireEffects,
  type FireSnapshot,
} from '../render/fireEffects';
import { planPositionedInterventionReactions } from '../render/interventionEffects';
import type { SprintMetrics, Task } from '../sim/types';
import type { InterventionTrigger } from './InterventionEffects';

export interface UseBoardEffectsInput {
  tasks: readonly Task[];
  metrics?: SprintMetrics;
  reviewAccumulator: number;
  interventionTrigger: InterventionTrigger | null;
  suppressExtinguishTaskIds?: ReadonlySet<number>;
}

export interface BoardEffectAudioState {
  count: number;
  last: SfxId | null;
}

export interface BoardEffectsState {
  effects: readonly TimedBoardEffect[];
  /** 期限切れ後も維持する発火 high-water mark（フォールバック再発火の検証用）。 */
  lastSequence: number;
  reducedMotion: boolean;
  audio: BoardEffectAudioState;
}

function effectNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/**
 * 同じタイムラインを DOM/Pixi の両方へ渡す。レンダラ切替は依存に含めないため、
 * WebGL 初期化失敗でも sequence・終了時刻・SFX 回数を維持する。
 */
export function useBoardEffects({
  tasks,
  metrics,
  reviewAccumulator,
  interventionTrigger,
  suppressExtinguishTaskIds,
}: UseBoardEffectsInput): BoardEffectsState {
  const reducedMotion = useReducedMotion() ?? false;
  const { playSfx } = useAudio();
  const prevSnapshotRef = useRef<FireSnapshot | null>(
    metrics ? createFireSnapshot(tasks, metrics, reviewAccumulator) : null,
  );
  const prevTasksRef = useRef<readonly Task[]>(tasks);
  const seenTriggerKeysRef = useRef(new Set<number>());
  const nextSequenceRef = useRef(0);
  const [effects, setEffects] = useState<TimedBoardEffect[]>([]);
  const [audio, setAudio] = useState<BoardEffectAudioState>({ count: 0, last: null });

  useEffect(() => {
    const payloads: BoardEffectPayload[] = [];
    const priorTasks = prevTasksRef.current;

    if (metrics) {
      const nextSnapshot = createFireSnapshot(tasks, metrics, reviewAccumulator);
      const previous = prevSnapshotRef.current;
      if (previous && !fireSnapshotsEqual(previous, nextSnapshot)) {
        const raw = detectFireEvents(previous, nextSnapshot);
        const filtered = suppressExtinguishTaskIds?.size
          ? raw.filter(
              (effect) =>
                effect.kind !== 'extinguish' ||
                effect.source !== 'firefight' ||
                !suppressExtinguishTaskIds.has(effect.taskId),
            )
          : raw;
        for (const effect of positionFireEffects(filtered, tasks, priorTasks)) {
          payloads.push({ source: 'fire', effect });
        }
      }
      prevSnapshotRef.current = nextSnapshot;
    } else {
      prevSnapshotRef.current = null;
    }
    prevTasksRef.current = tasks;

    if (interventionTrigger && !seenTriggerKeysRef.current.has(interventionTrigger.key)) {
      seenTriggerKeysRef.current.add(interventionTrigger.key);
      const positioned = planPositionedInterventionReactions(
        interventionTrigger.effect,
        interventionTrigger.nextTasks,
        interventionTrigger.prevTasks,
        interventionTrigger.currentTick,
      );
      for (const effect of positioned) payloads.push({ source: 'intervention', effect });
    }

    if (payloads.length === 0) return;
    const nowMs = effectNow();
    const batch = createTimedBoardEffects(payloads, nextSequenceRef.current, nowMs);
    nextSequenceRef.current = batch.nextSequence;
    setEffects((current) => mergeTimedBoardEffects(current, batch.effects, nowMs));

    const sounds = boardEffectSfx(payloads);
    for (const sound of sounds) playSfx(sound);
    if (sounds.length > 0) {
      setAudio((current) => ({
        count: current.count + sounds.length,
        last: sounds[sounds.length - 1],
      }));
    }
  }, [interventionTrigger, metrics, playSfx, reviewAccumulator, suppressExtinguishTaskIds, tasks]);

  // StrictMode の setup→cleanup→setup でも、現在の最短終了時刻から必ずタイマーを張り直す。
  useEffect(() => {
    if (effects.length === 0) return;
    const nextEnd = Math.min(...effects.map((effect) => effect.endsAtMs));
    const timer = window.setTimeout(
      () => setEffects((current) => mergeTimedBoardEffects(current, [], effectNow())),
      Math.max(0, nextEnd - effectNow()) + 16,
    );
    return () => window.clearTimeout(timer);
  }, [effects]);

  return { effects, lastSequence: nextSequenceRef.current - 1, reducedMotion, audio };
}
