/**
 * 組織状態・ラン集計の共通フィクスチャ（テスト用）。
 *
 * `org` / `totals` は sim・state の複数テストで同一定義が重複していたため集約した。
 * どちらも既定値を上書きできる形なので、テスト固有の値は引数で渡すこと。
 */
import { createOrgState } from '../../../src/sim/org';
import type { RunTotals } from '../../../src/sim/run/types';
import type { OrgState } from '../../../src/sim/types';

/** default シナリオ・AI 有効の初期組織状態。 */
export const org = (o: Partial<OrgState> = {}): OrgState => ({
  ...createOrgState('default', true),
  ...o,
});

/** すべて 0 のラン集計（`consecutiveIncidentSprints` は既定のまま）。 */
export const totals = (t: Partial<RunTotals> = {}): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: 0,
  maxCombo: 0,
  ...t,
});
