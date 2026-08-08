/**
 * スプリント盤面の共通フィクスチャ（テスト用）。
 *
 * `makeTask` / `burningTask` / `makeSprint` は sim・render のスプリント系テストで
 * 同一定義が重複していたため、ここへ集約した。既定値を変えると広範囲のテストに
 * 影響するため、変更時は利用側の期待値もあわせて確認すること。
 */
import { BURN_TICKS } from '../../../src/sim/model';
import { createSprint, resolveSprintConfig } from '../../../src/sim/sprint';
import type { OrgState, SprintState, Task } from '../../../src/sim/types';

/** 既定は Review 待ち・進捗 0 の通常タスク。 */
export const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'review',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

/** 炎上中（Rework レーンでタイマー進行中）のタスク。 */
export const burningTask = (id: number, burnTicksLeft = BURN_TICKS): Task =>
  makeTask(id, { lane: 'rework', incident: true, burnTicksLeft, reworkAttempts: 1 });

/**
 * 既定シナリオのスプリントを作り、タスク列を差し替える。
 * `rng` 省略時は 0.5 固定（判定を中央に寄せて決定論にする）。
 */
export function makeSprint(
  org: OrgState,
  tasks: Task[],
  rng: () => number = () => 0.5,
): SprintState {
  const sprint = createSprint(resolveSprintConfig('default'), org, rng);
  sprint.tasks = tasks;
  return sprint;
}
