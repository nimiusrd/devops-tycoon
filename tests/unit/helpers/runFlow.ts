/**
 * 新ランループ（固定トラック＋ビート）の共通オートプレイ・ヘルパ（テスト用）。
 *
 * 旧マップ駆動（enterNode）に代わり、setup→beginSetupSprint / beat→resolveBeat を
 * 既定の選択で消化する。各テストはここを使ってランを進める。
 */
import { getEvent } from '../../../src/data/events';
import type { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';

export interface PlayOptions {
  /** 進化ポイントがあれば review-1 を解放する。 */
  unlockEvolution?: boolean;
  /** スプリントを実プレイ風に小刻みに介入しながら進める。 */
  skilled?: boolean;
  /** ビートの選択 index（decision）。既定 0。 */
  beatChoice?: number;
  /** 休息の選択（既定 heal）。 */
  restOption?: 'heal' | 'repay' | 'upgrade' | 'recruit';
}

/**
 * オートプレイ用のビート選択肢 index。
 * 明示指定がなければ即時採用（`grantRecruit`）を避け、決定論シードの安定を保つ。
 */
export function autoplayBeatChoiceIndex(
  eventId: string,
  kind: 'judgment' | 'decision',
  explicit?: number,
): number | undefined {
  if (kind === 'judgment') return undefined;
  if (explicit !== undefined) return explicit;
  const def = getEvent(eventId);
  const choices = def?.choices ?? [];
  let choice = 0;
  if (choices[choice]?.outcome.grantRecruit) {
    const alt = choices.findIndex((c) => !c.outcome.grantRecruit);
    if (alt >= 0) choice = alt;
  }
  return choice;
}

/** 現在フェーズに応じて 1 ステップ進める（playing のときのみ）。停止すべきなら false。 */
export function advance(e: RunEngine, opts: PlayOptions = {}): boolean {
  const s = e.snapshot();
  switch (s.phase) {
    case 'title':
      e.startRun();
      return true;
    case 'setup':
      e.beginSetupSprint();
      return true;
    case 'sprint': {
      // RI-30: オートプレイは手札を可能な限り発動してから進める。
      // 先頭が高コストでも後続の安いカードを試す。
      let guard = 0;
      while (guard < 24) {
        guard += 1;
        const hand = e.snapshot().sprint?.cardPiles.hand ?? [];
        if (hand.length === 0) break;
        let playedAny = false;
        for (const deckIndex of [...hand]) {
          const outcome = e.playCard(deckIndex);
          if (outcome.ok) {
            playedAny = true;
            break;
          }
        }
        if (!playedAny) break;
      }
      if (opts.skilled) {
        const sp = e.snapshot().sprint;
        if (sp && !sp.complete) {
          if (sp.tasks.filter((t) => t.lane === 'review').length >= 6)
            e.dispatch('interruptReview');
          if (sp.tasks.some((t) => t.lane === 'rework' && t.incident)) e.dispatch('firefight');
        }
        e.step(300);
      } else {
        e.step(1_000_000);
      }
      return true;
    }
    case 'result':
      e.acknowledgeResult();
      return true;
    case 'draft':
      if (s.draft && s.draft.length > 0) e.chooseCard(s.draft[0]);
      else e.skipDraft();
      return true;
    case 'evolution':
      if (opts.unlockEvolution && s.evolution.points > 0) e.unlockEvolution('review-1');
      e.finishEvolution();
      return true;
    case 'beat': {
      if (!s.beat) return false;
      e.resolveBeat(autoplayBeatChoiceIndex(s.beat.eventId, s.beat.kind, opts.beatChoice));
      return true;
    }
    case 'shop':
      e.leaveShop();
      return true;
    case 'rest':
      e.restChoose(opts.restOption ?? 'heal');
      return true;
    case 'recruit':
      e.recruitChoose('skip');
      return true;
    case 'quarterReview':
      if (s.quarterReview?.outcome === 'missed_adjustable') {
        e.chooseGoalAdjustment(s.quarterReview.availableAdjustments[0] ?? 'cut_scope');
      } else {
        e.acknowledgeQuarterReview();
      }
      return true;
    default:
      return false;
  }
}

/** ランを決着（won/lost）まで自動プレイする。 */
export function playRun(e: RunEngine, opts: PlayOptions = {}, guardMax = 40_000): RunState {
  let s = e.snapshot();
  let guard = 0;
  while (s.status === 'playing' && guard < guardMax) {
    guard += 1;
    if (!advance(e, opts)) break;
    s = e.snapshot();
  }
  return s;
}

/** 指定フェーズに到達するまで自動プレイする（到達できなければ最後の状態）。 */
export function playUntil(
  e: RunEngine,
  phase: RunState['phase'],
  opts: PlayOptions = {},
  guardMax = 40_000,
): RunState {
  let s = e.snapshot();
  let guard = 0;
  while (s.status === 'playing' && s.phase !== phase && guard < guardMax) {
    guard += 1;
    if (!advance(e, opts)) break;
    s = e.snapshot();
  }
  return s;
}
