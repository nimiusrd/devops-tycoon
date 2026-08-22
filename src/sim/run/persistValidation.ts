/**
 * 永続スナップショットを実際の hydrate 経路へ通して検証する。
 *
 * JSON の構造を型アサーションだけで受け入れると、必須配列が null でも
 * parser を通過してしまう。保存済みデータを変更せず、専用エンジンで
 * hydrate できるかだけを確認する。
 */
import { createRunEngine } from './engine';
import type { RunPersistState, RunReplayFrame } from './persist';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasFiniteNumberFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  if (!isObject(value)) return false;
  if (
    !required.every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key] as number),
    )
  ) {
    return false;
  }
  return optional.every(
    (key) =>
      value[key] === undefined ||
      (typeof value[key] === 'number' && Number.isFinite(value[key] as number)),
  );
}

/** エンジンが計算に使う永続数値を、hydrate 前に文字列や非有限値から守る。 */
function hasValidPersistNumbers(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    !hasFiniteNumberFields(value, [
      'sprintsPerQuarter',
      'sprintIndexInQuarter',
      'sprintsPlayed',
      'quarterNumber',
      'budget',
    ])
  ) {
    return false;
  }
  if (
    !hasFiniteNumberFields(
      value.org,
      [
        'aiDependency',
        'aiLiteracy',
        'testCoverage',
        'documentation',
        'quality',
        'morale',
        'seniorHp',
        'techDebt',
        'deliveryScore',
      ],
      ['securityLevel'],
    )
  ) {
    return false;
  }
  if (!hasFiniteNumberFields(value.evolution, ['points'])) return false;
  if (
    !hasFiniteNumberFields(
      value.totals,
      [
        'delivered',
        'done',
        'rework',
        'incidents',
        'contained',
        'spread',
        'aiAssisted',
        'completed',
        'reviewQueuePeak',
        'maxCombo',
      ],
      ['consecutiveIncidentSprints'],
    )
  ) {
    return false;
  }
  if (
    !hasFiniteNumberFields(
      value.quarterTotals,
      [
        'delivered',
        'done',
        'rework',
        'incidents',
        'contained',
        'spread',
        'aiAssisted',
        'completed',
        'reviewQueuePeak',
        'maxCombo',
      ],
      ['consecutiveIncidentSprints'],
    )
  ) {
    return false;
  }
  if (
    !hasFiniteNumberFields(
      value.quarterGoal,
      ['deliveryTarget', 'qualityTarget', 'techDebtLimit', 'moraleTarget', 'incidentLimit'],
      ['aiAdoptionTarget'],
    )
  ) {
    return false;
  }
  return hasFiniteNumberFields(value.stakeholderTrust, ['management', 'customers', 'team']);
}

function hasRequiredPersistResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    !hasFiniteNumberFields(value, [
      'done',
      'delivered',
      'maxCombo',
      'aiAssistedPct',
      'reviewQueueMax',
      'rework',
      'incidents',
      'contained',
      'spread',
      'seniorHpDelta',
      'focusRemaining',
      'focusMax',
      'autoContainCount',
    ])
  ) {
    return false;
  }
  if (
    typeof value.grade !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.diagnosis !== 'string' ||
    !isObject(value.actionCounts) ||
    !Object.values(value.actionCounts).every(
      (count) => typeof count === 'number' && Number.isFinite(count),
    ) ||
    !Array.isArray(value.timeline) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.fireEvents)
  ) {
    return false;
  }
  if (value.timedOut !== undefined && typeof value.timedOut !== 'boolean') return false;
  if (
    value.baseline !== undefined &&
    !hasFiniteNumberFields(value.baseline, ['delivered', 'spread', 'maxCombo'])
  ) {
    return false;
  }
  return true;
}

/** フェーズ画面が要求する保存済みデータの存在を検証する。 */
export function hasRequiredPersistPhaseState(
  state: Pick<
    RunPersistState | RunReplayFrame,
    'phase' | 'lastResult' | 'draft' | 'beat' | 'shop' | 'quarterReview'
  >,
): boolean {
  switch (state.phase) {
    case 'result':
      return hasRequiredPersistResult(state.lastResult);
    case 'draft':
      return Array.isArray(state.draft);
    case 'beat':
      return isObject(state.beat);
    case 'shop':
      return isObject(state.shop);
    case 'quarterReview':
      return isObject(state.quarterReview);
    default:
      return true;
  }
}

export function canHydratePersistState(state: RunPersistState): boolean {
  try {
    if (!hasRequiredPersistPhaseState(state)) return false;
    if (!hasValidPersistNumbers(state)) return false;
    const engine = createRunEngine({
      seed: state.seed,
      difficulty: state.difficulty,
      trials: state.trials,
    });
    engine.hydratePersistState(state);
    engine.snapshot();
    return true;
  } catch {
    return false;
  }
}

export function canHydrateReplayFrame(frame: RunReplayFrame): boolean {
  try {
    if (!hasRequiredPersistPhaseState(frame)) return false;
    if (!hasValidPersistNumbers(frame)) return false;
    const engine = createRunEngine({
      seed: frame.seed,
      difficulty: frame.difficulty,
      trials: frame.trials,
    });
    engine.hydrateReplayFrame(frame);
    engine.snapshot();
    return true;
  } catch {
    return false;
  }
}
