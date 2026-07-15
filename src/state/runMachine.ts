/**
 * ランのフェーズ遷移マシン（XState / SPEC 第3章・第22.1 / RI-39）。
 *
 * 遷移の単一の真実源は純TSの遷移表 `src/sim/run/phases.ts`（`RUN_PHASE_TRANSITIONS`）で、
 * このマシンはその表から**生成**する（手書きの遷移定義を持たない）。
 * ゲームデータと実ランタイム遷移の真実は決定論エンジン `RunEngine`
 * （`src/sim/run/engine.ts`。`setPhase()` が同じ表で検証する）が持ち、
 * マシンは「正当なフェーズ遷移の契約」のテスト・可視化用として使う。
 * テスト（tests/unit/run-machine.test.ts）で全フェーズの到達可能性を保証する。
 */
import { createMachine } from 'xstate';
import {
  FINAL_PHASES,
  RUN_PHASES,
  RUN_PHASE_TRANSITIONS,
  type RunEventType,
} from '../sim/run/phases';
import type { RunPhase } from '../sim/run/types';

/** マシンへ送るイベント。 */
export type RunEvent = { type: RunEventType };

export const runMachine = createMachine({
  id: 'run',
  initial: 'title' satisfies RunPhase,
  types: {} as { events: RunEvent },
  states: Object.fromEntries(
    RUN_PHASES.map((phase) => [
      phase,
      FINAL_PHASES.has(phase)
        ? { type: 'final' as const }
        : { on: { ...RUN_PHASE_TRANSITIONS[phase] } },
    ]),
  ),
});

/** マシンの状態値（= フェーズ）の集合。`RunPhase` と一致することを型で保証する。 */
export type RunMachinePhase = RunPhase;
