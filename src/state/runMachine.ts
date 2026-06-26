/**
 * ランのフェーズ遷移マシン（XState / SPEC 第3章・architecture §1）。
 *
 * マップ → スプリント → リザルト → ドラフト → 進化 の入れ子と、
 * イベント/ショップ/休息/ボス/四半期レビュー/勝敗のフェーズ遷移を宣言的に定義する。
 *
 * ゲームデータの真実は決定論エンジン `RunEngine`（`src/sim/run/engine.ts`）が持ち、
 * このマシンは「正当なフェーズ遷移の契約」を表す（`RunState.phase` はこの図に従う）。
 * テスト（tests/unit/run-machine.test.ts）で全フェーズの到達可能性を保証する。
 */
import { createMachine } from 'xstate';
import type { RunPhase } from '../sim/run/types';

/** マシンへ送るイベント。 */
export type RunEvent =
  | { type: 'START' }
  | { type: 'ENTER_SPRINT' }
  | { type: 'ENTER_EVENT' }
  | { type: 'ENTER_SHOP' }
  | { type: 'ENTER_REST' }
  | { type: 'SPRINT_DONE' }
  | { type: 'BOSS_REVIEW' }
  | { type: 'LOST' }
  | { type: 'ACK' }
  | { type: 'NEXT' }
  | { type: 'FINISH' }
  | { type: 'RESOLVE' }
  | { type: 'REVIEW_WON' }
  | { type: 'REVIEW_CONTINUE' }
  | { type: 'REVIEW_LOST' };

export const runMachine = createMachine({
  id: 'run',
  initial: 'title',
  types: {} as { events: RunEvent },
  states: {
    title: { on: { START: 'map' } },
    map: {
      on: {
        ENTER_SPRINT: 'sprint',
        ENTER_EVENT: 'event',
        ENTER_SHOP: 'shop',
        ENTER_REST: 'rest',
      },
    },
    sprint: {
      on: { SPRINT_DONE: 'result', BOSS_REVIEW: 'quarterReview', LOST: 'lost' },
    },
    result: { on: { ACK: 'draft' } },
    draft: { on: { NEXT: 'evolution' } },
    evolution: { on: { FINISH: 'map' } },
    event: { on: { RESOLVE: 'map', LOST: 'lost' } },
    shop: { on: { RESOLVE: 'map' } },
    rest: { on: { RESOLVE: 'map' } },
    quarterReview: {
      on: { REVIEW_WON: 'won', REVIEW_CONTINUE: 'map', REVIEW_LOST: 'lost' },
    },
    won: { type: 'final' },
    lost: { type: 'final' },
  },
});

/** マシンの状態値（= フェーズ）の集合。`RunPhase` と一致することを型で保証する。 */
export type RunMachinePhase = RunPhase;
