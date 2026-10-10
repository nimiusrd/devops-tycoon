/**
 * RI-292: 出荷以外の自己ベストを、勝利・条件・ruleset 付きで1指標ずつ記録する。
 * 既存の bestScore・メタ進行ポイント・デイリー記録には触れない。
 */
import type { DifficultyId, RunKind, RunStatus, WinType } from '../sim/run/types';
import type { ScenarioId } from '../sim/types';
import type { RunRulesetIdentity } from '../state/runPersistence';

export type AltBestMetric = 'moraleAtClear' | 'seniorHpAtClear' | 'minSeniorHp' | 'budgetAtClear';
export const ALT_BEST_METRICS: readonly AltBestMetric[] = [
  'moraleAtClear',
  'seniorHpAtClear',
  'minSeniorHp',
  'budgetAtClear',
];

/** 0..100 に丸められる指標の上限。予算は上限を持たない。 */
export const METRIC_CEILING: Record<AltBestMetric, number | null> = {
  moraleAtClear: 100,
  seniorHpAtClear: 100,
  minSeniorHp: 100,
  budgetAtClear: null,
};

/** ラン決着時に記録へ渡す値。旧保存から再開したランは境界の列を欠きうる。 */
export interface AltBestInput {
  status: RunStatus;
  runKind: RunKind;
  difficulty: DifficultyId;
  /** ラン開始時のシナリオ。デイリーは default。異なるシナリオは別の記録枠。 */
  scenario: ScenarioId;
  trials: string[];
  ruleset: RunRulesetIdentity | null;
  sprintsPlayed: number;
  winType?: WinType;
  finalOrg?: { morale: number; seniorHp: number };
  budget?: number;
  /** 各スプリント完了境界のシニア余力。1スプリント目から順に完了数と同じ長さ。 */
  boundarySeniorHp?: number[];
}

export interface AltBestRecord {
  value: number;
  sprintsPlayed: number;
  winType: WinType | null;
}

export type AltBestBook = Record<string, AltBestRecord>;
export type AltBestUpdate = 'new' | 'improved' | 'tie' | 'lower' | 'missing' | 'not-eligible';

/** 指標・ラン種別・難易度・シナリオ・試練・ruleset を分けたキー。異なる条件は同じ枠に入らない。 */
export function altBestKey(
  metric: AltBestMetric,
  input: Pick<AltBestInput, 'runKind' | 'difficulty' | 'scenario' | 'trials'>,
  ruleset: RunRulesetIdentity,
): string {
  const trials = [...input.trials].sort().join('+') || '-';
  return `${metric}:${input.runKind}:${input.difficulty}:${input.scenario}:${trials}:v${ruleset.version}:${ruleset.fingerprint}`;
}

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 勝利ランの決着時点の値。開始時点は測らない。
 * 最低シニア余力は全スプリントの完了境界が揃うときだけ測る。
 */
export function measureAltBest(input: AltBestInput, metric: AltBestMetric): number | null {
  switch (metric) {
    case 'moraleAtClear':
      return finite(input.finalOrg?.morale);
    case 'seniorHpAtClear':
      return finite(input.finalOrg?.seniorHp);
    case 'budgetAtClear':
      return finite(input.budget);
    case 'minSeniorHp': {
      const list = input.boundarySeniorHp;
      if (!list || list.length !== input.sprintsPlayed || list.length === 0) return null;
      if (!list.every((value) => finite(value) !== null)) return null;
      return Math.min(...list);
    }
  }
}

export function recordAltBest(
  book: AltBestBook,
  input: AltBestInput,
  metric: AltBestMetric,
): { book: AltBestBook; update: AltBestUpdate } {
  if (input.status !== 'won' || input.sprintsPlayed < 1 || !input.ruleset)
    return { book, update: 'not-eligible' };
  const value = measureAltBest(input, metric);
  if (value === null) return { book, update: 'missing' };
  const key = altBestKey(metric, input, input.ruleset);
  const existing = book[key];
  if (existing && value === existing.value) return { book, update: 'tie' };
  if (existing && value < existing.value) return { book, update: 'lower' };
  return {
    book: {
      ...book,
      [key]: { value, sprintsPlayed: input.sprintsPlayed, winType: input.winType ?? null },
    },
    update: existing ? 'improved' : 'new',
  };
}

/** 勝利ランを順に記録したとき、指標ごとに記録が動いた回数と上限への張り付きを数える。記録対象外は標本に入れない。 */
export function evaluateAltBests(inputs: readonly AltBestInput[]) {
  return ALT_BEST_METRICS.map((metric) => {
    let book: AltBestBook = {};
    const tally: Record<AltBestUpdate, number> = {
      new: 0,
      improved: 0,
      tie: 0,
      lower: 0,
      missing: 0,
      'not-eligible': 0,
    };
    const values: number[] = [];
    const groups = new Map<number, number[]>();
    for (const input of inputs) {
      const result = recordAltBest(book, input, metric);
      book = result.book;
      tally[result.update] += 1;
      const value = measureAltBest(input, metric);
      // 勝利でも ruleset 不明・開始直後は記録しない。測定できても標本に混ぜない。
      if (result.update === 'not-eligible' || value === null) continue;
      values.push(value);
      groups.set(input.sprintsPlayed, [...(groups.get(input.sprintsPlayed) ?? []), value]);
    }
    const ceiling = METRIC_CEILING[metric];
    const records = Object.values(book);
    const meanBySprints = Object.fromEntries(
      [...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([sprints, list]) => [
          sprints,
          Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10,
        ]),
    );
    return {
      metric,
      samples: values.length,
      distinct: new Set(values).size,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      ceilingHits: ceiling === null ? null : values.filter((value) => value >= ceiling).length,
      updates: tally,
      meanBySprints,
      bestSprintsPlayed: records.map((record) => record.sprintsPlayed),
    };
  });
}
