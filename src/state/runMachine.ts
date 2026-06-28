/**
 * ランのフェーズ遷移マシン（XState / SPEC 第3章・architecture §1）。
 *
 * **固定トラック（スプリント列）＋スプリント間ビート**の入れ子を宣言的に定義する。
 * 編成（setup）→ スプリント → リザルト → ドラフト → 進化 → ビート（判定/選択）→ 次スプリント …
 * → ボススプリント → 四半期レビュー → 勝敗/継続。ショップ/休息はビートの選択から到達する。
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
  | { type: 'BEGIN' }
  | { type: 'ENTER_SPRINT' }
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
    // ラン開始直後は編成（Setup）。いきなり盤面を走らせない。
    title: { on: { START: 'setup' } },
    // setup は第1スプリント前の編成、かつショップ/休息後・次四半期の編成入口（setup-pre）も兼ねる。
    setup: { on: { BEGIN: 'sprint' } },
    sprint: {
      on: { SPRINT_DONE: 'result', BOSS_REVIEW: 'quarterReview', LOST: 'lost' },
    },
    result: { on: { ACK: 'draft' } },
    draft: { on: { NEXT: 'evolution' } },
    evolution: { on: { FINISH: 'beat' } },
    beat: {
      on: {
        ENTER_SPRINT: 'sprint',
        ENTER_SHOP: 'shop',
        ENTER_REST: 'rest',
        LOST: 'lost',
      },
    },
    shop: { on: { RESOLVE: 'setup' } },
    rest: { on: { RESOLVE: 'setup' } },
    quarterReview: {
      on: { REVIEW_WON: 'won', REVIEW_CONTINUE: 'setup', REVIEW_LOST: 'lost' },
    },
    won: { type: 'final' },
    lost: { type: 'final' },
  },
});

/** マシンの状態値（= フェーズ）の集合。`RunPhase` と一致することを型で保証する。 */
export type RunMachinePhase = RunPhase;
