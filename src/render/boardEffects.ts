/**
 * スプリント盤面の一時演出タイムライン（RI-142）。
 *
 * 炎上・鎮火・介入の座標付き plan に、安定した発火順と壁時計上の寿命を付ける。
 * React、DOM、Pixi のどれにも依存しないため、両レンダラが同じ演出キー・位置・
 * 終了時刻を読み、途中で DOM フォールバックしても再発火しない。
 */
import type { SfxId } from '../audio/sounds';
import type { PositionedFireEffect } from './fireEffects';
import type { BoardAuraPlan, PositionedInterventionReaction } from './interventionEffects';
import { VISUAL_TOKENS } from './visualTokens';

export type BoardEffectPayload =
  | { source: 'fire'; effect: PositionedFireEffect }
  | { source: 'intervention'; effect: PositionedInterventionReaction };

export type TimedBoardEffect = BoardEffectPayload & {
  /** 盤面のマウント中に単調増加する描画順・再生キー。 */
  sequence: number;
  /** 同じ batch が検出された時刻。performance.now() と同じ時間軸。 */
  startedAtMs: number;
  /** Review sweep の stagger。その他は 0。 */
  delayMs: number;
  /** 個々の演出本体の長さ。 */
  durationMs: number;
  /** linger を含め、DOM/Pixi が plan を保持する最終時刻。 */
  endsAtMs: number;
};

export interface BoardEffectTimeline {
  effects: TimedBoardEffect[];
  nextSequence: number;
}

export const BOARD_EFFECT_BUDGET = VISUAL_TOKENS.dimensions.sprint.boardEffects.budget;

function timingFor(payload: BoardEffectPayload): { delayMs: number; durationMs: number } {
  const tokens = VISUAL_TOKENS.dimensions.sprint.boardEffects;
  if (payload.source === 'fire') {
    switch (payload.effect.kind) {
      case 'spread':
        return { delayMs: 0, durationMs: tokens.spread.durationMs };
      case 'extinguish':
        return { delayMs: 0, durationMs: tokens.extinguish.durationMs };
      case 'ignite':
        return { delayMs: 0, durationMs: tokens.ignite.durationMs };
    }
  }

  switch (payload.effect.kind) {
    case 'reviewSweep':
      return {
        delayMs: payload.effect.staggerIndex * tokens.sweep.staggerMs,
        durationMs: tokens.sweep.durationMs,
      };
    case 'split':
      return { delayMs: 0, durationMs: tokens.split.durationMs };
    case 'firefight':
      return { delayMs: 0, durationMs: tokens.firefight.durationMs };
    case 'assignDash':
      return { delayMs: 0, durationMs: tokens.assignDash.durationMs };
    case 'boardAura':
    case 'successPulse':
      return { delayMs: 0, durationMs: tokens.fullPulse.durationMs };
  }
}

/** 同一 batch に安定した sequence と終了時刻を付ける。 */
export function createTimedBoardEffects(
  payloads: readonly BoardEffectPayload[],
  startSequence: number,
  startedAtMs: number,
): BoardEffectTimeline {
  let nextSequence = startSequence;
  const lingerMs = VISUAL_TOKENS.dimensions.sprint.boardEffects.lingerMs;
  const effects = payloads.map((payload): TimedBoardEffect => {
    const timing = timingFor(payload);
    const effect: TimedBoardEffect = {
      ...payload,
      sequence: nextSequence,
      startedAtMs,
      delayMs: timing.delayMs,
      durationMs: timing.durationMs,
      endsAtMs: startedAtMs + timing.delayMs + timing.durationMs + lingerMs,
    };
    nextSequence += 1;
    return effect;
  });
  return { effects, nextSequence };
}

/** 期限切れを除外して新規 batch を加え、古い順に上限へ丸める。 */
export function mergeTimedBoardEffects(
  current: readonly TimedBoardEffect[],
  incoming: readonly TimedBoardEffect[],
  nowMs: number,
  budget = BOARD_EFFECT_BUDGET,
): TimedBoardEffect[] {
  if (budget <= 0) return [];
  return [...current.filter((effect) => effect.endsAtMs > nowMs), ...incoming]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-budget);
}

/** 描画本体の進捗。delay 前は 0、終了後は 1 へ固定する。 */
export function boardEffectProgress(effect: TimedBoardEffect, nowMs: number): number {
  const elapsed = nowMs - effect.startedAtMs - effect.delayMs;
  if (elapsed <= 0) return 0;
  if (effect.durationMs <= 0) return 1;
  return Math.max(0, Math.min(1, elapsed / effect.durationMs));
}

/**
 * レンダラと独立して一度だけ鳴らす SFX を batch から導く。
 * 同一 batch に複数の spread / sweep 粒があっても音は種類ごとに一回。
 */
export function boardEffectSfx(payloads: readonly BoardEffectPayload[]): SfxId[] {
  const sounds: SfxId[] = [];
  if (payloads.some((payload) => payload.source === 'fire' && payload.effect.kind === 'spread')) {
    sounds.push('fireSpread');
  }
  if (payloads.some((payload) => payload.source === 'intervention')) {
    sounds.push('interventionHit');
  }
  return sounds;
}

export type { BoardAuraPlan };
