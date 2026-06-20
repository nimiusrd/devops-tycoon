/**
 * 決定論フック `window.game`（SPEC 第22.5）。
 *
 * Phase 3 ではラン（1四半期）全体を露出する。E2E / デバッグから、タイトル →
 * マップ → スプリント → リザルト → ドラフト → 進化 → ボス の各フェーズを
 * 一時停止つきで駆動でき、seed で再現できる（第22.3 / 22.5）。
 * ラン決着時にはメタ進行（localStorage）へ報酬を記録する（第17章）。
 */
import { getTrial } from './data/difficulties';
import { createRunEngine, type RunEngine } from './sim/run/engine';
import { resolveSeedFromLocation } from './sim/seed';
import type { ActionId, InterventionOutcome } from './sim/types';
import type { DifficultyId, RunState } from './sim/run/types';
import { applyRunReward, loadMeta, saveMeta, type MetaState } from './state/meta';

export interface GameHandle {
  /** 自動進行を止める。 */
  pause(): void;
  /** 自動進行を再開する。 */
  resume(): void;
  /** 一時停止中か。 */
  isPaused(): boolean;
  /** 現在のラン状態のスナップショット。 */
  getState(): RunState;
  /** タイトルで選んだ難易度・試練でランを開始する。 */
  startRun(difficulty?: DifficultyId, trials?: string[], seed?: string): RunState;
  /** マップ上のノードへ進入する。 */
  enterNode(id: string): RunState;
  /** 指定 ms ぶんスプリントを手動で前進させる。 */
  step(ms: number): RunState;
  /** 介入アクションを発動する（第6章）。 */
  dispatch(id: ActionId): InterventionOutcome;
  /** リザルトを確認してドラフトへ進む。 */
  acknowledgeResult(): RunState;
  /** ドラフトでカードを選ぶ。 */
  chooseCard(defId: string): RunState;
  /** ドラフトをスキップする。 */
  skipDraft(): RunState;
  /** 進化ノードを解放する。 */
  unlockEvolution(id: string): RunState;
  /** 進化フェーズを終えてマップへ戻る。 */
  finishEvolution(): RunState;
  /** イベントの選択肢を選ぶ。 */
  chooseEvent(index: number): RunState;
  /** ショップでカードを買う。 */
  buyShopCard(defId: string): RunState;
  /** ショップでレリックを買う。 */
  buyShopRelic(): RunState;
  /** ショップを出る。 */
  leaveShop(): RunState;
  /** 休息の選択（heal / repay / upgrade）。 */
  restChoose(option: 'heal' | 'repay' | 'upgrade'): RunState;
  /** 新しいランをタイトルから始める（seed を差し替え可能）。 */
  newRun(seed?: string): RunState;
  /** 現在のメタ進行（解放状況・実績）。 */
  getMeta(): MetaState;
  /** 内部エンジン（高度なデバッグ用）。 */
  readonly engine: RunEngine;
}

export interface CreateGameOptions {
  seed?: string;
  difficulty?: DifficultyId;
  trials?: string[];
}

export function createGame(options: CreateGameOptions = {}): GameHandle {
  const seed = options.seed ?? resolveSeedFromLocation();
  const engine = createRunEngine({ seed, difficulty: options.difficulty, trials: options.trials });
  let paused = false;
  let meta = loadMeta();
  let recorded = false;

  /** ラン決着を検知したら一度だけメタ進行へ報酬を記録する（第17章）。 */
  const recordIfFinished = (): void => {
    const s = engine.snapshot();
    if (recorded || (s.status !== 'won' && s.status !== 'lost')) return;
    recorded = true;
    const scoreMul = s.trials.reduce((m, id) => m * (getTrial(id)?.scoreMul ?? 1), 1);
    meta = applyRunReward(meta, {
      won: s.status === 'won',
      difficulty: s.difficulty,
      winType: s.winType,
      bossId: s.bossId,
      score: s.org.deliveryScore,
      scoreMul,
      maxCombo: s.totals.maxCombo,
    });
    saveMeta(meta);
  };

  const after = (): RunState => {
    recordIfFinished();
    return engine.snapshot();
  };

  return {
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
    getState() {
      return engine.snapshot();
    },
    startRun(difficulty, trials, runSeed) {
      recorded = false;
      engine.startRun(difficulty, trials, runSeed);
      return engine.snapshot();
    },
    enterNode(id) {
      engine.enterNode(id);
      return engine.snapshot();
    },
    step(ms) {
      engine.step(ms);
      return after();
    },
    dispatch(id) {
      return engine.dispatch(id);
    },
    acknowledgeResult() {
      engine.acknowledgeResult();
      return engine.snapshot();
    },
    chooseCard(defId) {
      engine.chooseCard(defId);
      return engine.snapshot();
    },
    skipDraft() {
      engine.skipDraft();
      return engine.snapshot();
    },
    unlockEvolution(id) {
      engine.unlockEvolution(id);
      return engine.snapshot();
    },
    finishEvolution() {
      engine.finishEvolution();
      return engine.snapshot();
    },
    chooseEvent(index) {
      engine.chooseEvent(index);
      return after();
    },
    buyShopCard(defId) {
      engine.buyShopCard(defId);
      return engine.snapshot();
    },
    buyShopRelic() {
      engine.buyShopRelic();
      return engine.snapshot();
    },
    leaveShop() {
      engine.leaveShop();
      return engine.snapshot();
    },
    restChoose(option) {
      engine.restChoose(option);
      return engine.snapshot();
    },
    newRun(runSeed) {
      recorded = false;
      engine.toTitle(runSeed);
      return engine.snapshot();
    },
    getMeta() {
      return meta;
    },
    engine,
  };
}

declare global {
  interface Window {
    game?: GameHandle;
  }
}

/**
 * `window.game` を生成して公開する。アプリ起動時に一度だけ呼ぶ。
 */
export function installGame(options?: CreateGameOptions): GameHandle {
  const handle = createGame(options);
  if (typeof window !== 'undefined') {
    window.game = handle;
  }
  return handle;
}
