/**
 * RI-291: 同じ開始条件の2リプレイを、記録済みスプリント境界だけで並べる。
 * 過去の会社をライブsimとして動かさず、キーフレームの記録値だけを読む。
 */
import type { ReplayBlob } from '../state/replay';
import type { ReplayFramePhase, RunPersistExtras, RunReplayFrame } from '../sim/run/persist';
import type { OrgState, SprintResult } from '../sim/types';

export interface ComparableFrame extends Pick<
  RunReplayFrame,
  'sprintsPlayed' | 'budget' | 'scenario' | 'runKind' | 'status'
> {
  org: Pick<OrgState, 'seniorHp' | 'morale' | 'techDebt'>;
  totals: Pick<RunReplayFrame['totals'], 'delivered'>;
  lastResult: Pick<SprintResult, 'delivered' | 'reviewQueueMax'> | null;
  /**
   * 照合では setup の値だけを読む。比較用の写しでは他の境界から省く。
   * 研修方針の欠落は空配列として写す（旧記録の復元と同じ）。
   */
  extras?: Pick<RunPersistExtras, 'allowedCards' | 'allowedRelics' | 'preferredCardIds'>;
}

export interface ComparableReplay extends Pick<
  ReplayBlob,
  'id' | 'seed' | 'difficulty' | 'trials' | 'ruleset' | 'outcome'
> {
  keyframes: { phase: ReplayFramePhase; frame: ComparableFrame }[];
}

export type IdentityField =
  | 'seed'
  | 'difficulty'
  | 'trials'
  | 'scenario'
  | 'runKind'
  | 'ruleset'
  | 'unlockPool'
  | 'preferredCards';
export type IdentityStatus = 'match' | 'mismatch' | 'missing';
export type Side = 'a' | 'b';
export type Lead = Side | 'tie';
export type Span = 'common' | 'only-a' | 'only-b';

export interface BoundaryMetrics {
  phase: ReplayFramePhase;
  deliveredTotal: number;
  deliveredSprint: number | null;
  reviewQueueMax: number | null;
}

type MetricKey = Exclude<keyof BoundaryMetrics, 'phase'>;

/** 指標ごとの向き。合算して総合点にはしない。 */
export const METRIC_DIRECTION: Record<MetricKey, 'higher' | 'lower'> = {
  deliveredTotal: 'higher',
  deliveredSprint: 'higher',
  reviewQueueMax: 'lower',
};

/** 時間帯の得手を見る2系統。出荷と滞留を別々に数える。 */
export const BAND_METRICS = {
  shipping: 'deliveredSprint',
  backlog: 'reviewQueueMax',
} as const satisfies Record<string, MetricKey>;

const BOUNDARY_PHASES: ReadonlySet<ReplayFramePhase> = new Set(['result', 'quarterReview']);

function isStartFrame(keyframe: ComparableReplay['keyframes'][number]): boolean {
  return keyframe.phase === 'setup' && keyframe.frame.sprintsPlayed === 0;
}

/** setup は各スプリント前にも記録される。開始条件はラン開始時の1枚だけで照合する。 */
function setupFrame(replay: ComparableReplay): ComparableFrame | null {
  return replay.keyframes.find(isStartFrame)?.frame ?? null;
}

function sortedKey(values: readonly string[]): string {
  return JSON.stringify([...values].sort());
}

/** 旧記録で欠ける研修方針は、復元時と同じく空配列にする。順序は照合で無視する。 */
function preferredCardIdsOf(frame: ComparableFrame): readonly string[] {
  const ids = frame.extras?.preferredCardIds;
  return Array.isArray(ids) ? ids : [];
}

function identityValue(replay: ComparableReplay, field: IdentityField): string | null {
  const setup = setupFrame(replay);
  switch (field) {
    case 'seed':
      return replay.seed;
    case 'difficulty':
      return replay.difficulty;
    case 'trials':
      return sortedKey(replay.trials);
    case 'scenario':
      return setup?.scenario ?? null;
    case 'runKind':
      return setup?.runKind ?? null;
    case 'ruleset':
      return replay.ruleset ? `${replay.ruleset.version}:${replay.ruleset.fingerprint}` : null;
    case 'unlockPool':
      return setup?.extras
        ? JSON.stringify([
            [...setup.extras.allowedCards].sort(),
            [...setup.extras.allowedRelics].sort(),
          ])
        : null;
    case 'preferredCards':
      return setup ? sortedKey(preferredCardIdsOf(setup)) : null;
  }
}

const IDENTITY_FIELDS: readonly IdentityField[] = [
  'seed',
  'difficulty',
  'trials',
  'scenario',
  'runKind',
  'ruleset',
  'unlockPool',
  'preferredCards',
];

export function checkIdentity(a: ComparableReplay, b: ComparableReplay) {
  return IDENTITY_FIELDS.map((field) => {
    const left = identityValue(a, field);
    const right = identityValue(b, field);
    const status: IdentityStatus =
      left === null || right === null ? 'missing' : left === right ? 'match' : 'mismatch';
    return { field, status };
  });
}

/**
 * スプリント結果に残り、同じ画面の後続操作では置き換わらない値だけを境界にする。
 * 結果画面や四半期レビューでの組織レバー・チーム入り込みは、同じ phase の
 * キーフレームを操作後の org と budget で置き換える。それらは最初の境界ではない。
 */
export function boundaryMetrics(replay: ComparableReplay): Map<number, BoundaryMetrics> {
  const rows = new Map<number, BoundaryMetrics>();
  for (const { phase, frame } of replay.keyframes) {
    if (!BOUNDARY_PHASES.has(phase) || frame.sprintsPlayed < 1 || rows.has(frame.sprintsPlayed))
      continue;
    rows.set(frame.sprintsPlayed, {
      phase,
      deliveredTotal: frame.totals.delivered,
      deliveredSprint: frame.lastResult?.delivered ?? null,
      reviewQueueMax: frame.lastResult?.reviewQueueMax ?? null,
    });
  }
  return rows;
}

function lead(key: MetricKey, a: number | null, b: number | null): Lead | null {
  if (a === null || b === null) return null;
  if (a === b) return 'tie';
  const higherWins = METRIC_DIRECTION[key] === 'higher';
  return a > b === higherWins ? 'a' : 'b';
}

function terminal(replay: ComparableReplay) {
  const end = [...replay.keyframes]
    .reverse()
    .find((keyframe) => keyframe.phase === 'won' || keyframe.phase === 'lost');
  return {
    status: replay.outcome.status,
    winType: replay.outcome.winType ?? null,
    loseReason: replay.outcome.loseReason ?? null,
    endedAfterSprint: end ? end.frame.sprintsPlayed : null,
  };
}

export function comparePastRuns(a: ComparableReplay, b: ComparableReplay) {
  const identity = checkIdentity(a, b);
  const comparable = identity.every((item) => item.status === 'match');
  const base = {
    source: 'recorded-boundaries' as const,
    liveSimulation: false as const,
    ids: { a: a.id, b: b.id },
    comparable,
    identity,
  };
  if (!comparable) return { ...base, rows: [], spans: null, bands: null, ends: null };
  const left = boundaryMetrics(a);
  const right = boundaryMetrics(b);
  const sprints = [...new Set([...left.keys(), ...right.keys()])].sort((x, y) => x - y);
  const rows = sprints.map((sprint) => {
    const ma = left.get(sprint) ?? null;
    const mb = right.get(sprint) ?? null;
    const span: Span = ma && mb ? 'common' : ma ? 'only-a' : 'only-b';
    const leads =
      ma && mb
        ? (Object.fromEntries(
            (Object.keys(METRIC_DIRECTION) as MetricKey[]).map((key) => [
              key,
              lead(key, ma[key], mb[key]),
            ]),
          ) as Record<MetricKey, Lead | null>)
        : null;
    return { sprint, span, a: ma, b: mb, leads };
  });
  const bySpan = (span: Span) => rows.filter((row) => row.span === span).map((row) => row.sprint);
  const bands = Object.fromEntries(
    Object.entries(BAND_METRICS).map(([band, key]) => {
      const tally: Record<Lead, number[]> = { a: [], b: [], tie: [] };
      for (const row of rows) {
        const value = row.leads?.[key];
        if (value) tally[value].push(row.sprint);
      }
      return [band, tally];
    }),
  ) as Record<keyof typeof BAND_METRICS, Record<Lead, number[]>>;
  return {
    ...base,
    rows,
    spans: { common: bySpan('common'), onlyA: bySpan('only-a'), onlyB: bySpan('only-b') },
    bands,
    ends: { a: terminal(a), b: terminal(b) },
  };
}

const KEPT_PHASES: ReadonlySet<ReplayFramePhase> = new Set([...BOUNDARY_PHASES, 'won', 'lost']);

/** 比較に使う境界と項目だけを残す。記録値は丸めず、そのまま写す。 */
export function toComparableReplay(replay: ComparableReplay): ComparableReplay {
  return {
    id: replay.id,
    seed: replay.seed,
    difficulty: replay.difficulty,
    trials: [...replay.trials],
    ruleset: replay.ruleset ? { ...replay.ruleset } : null,
    outcome: { ...replay.outcome },
    keyframes: replay.keyframes
      .filter((keyframe) => isStartFrame(keyframe) || KEPT_PHASES.has(keyframe.phase))
      .map(({ phase, frame }) => ({
        phase,
        frame: {
          sprintsPlayed: frame.sprintsPlayed,
          budget: frame.budget,
          scenario: frame.scenario,
          runKind: frame.runKind,
          status: frame.status,
          org: {
            seniorHp: frame.org.seniorHp,
            morale: frame.org.morale,
            techDebt: frame.org.techDebt,
          },
          totals: { delivered: frame.totals.delivered },
          lastResult: frame.lastResult
            ? {
                delivered: frame.lastResult.delivered,
                reviewQueueMax: frame.lastResult.reviewQueueMax,
              }
            : null,
          ...(phase === 'setup' && frame.sprintsPlayed === 0 && frame.extras
            ? {
                extras: {
                  allowedCards: [...frame.extras.allowedCards],
                  allowedRelics: [...frame.extras.allowedRelics],
                  preferredCardIds: [...preferredCardIdsOf(frame)],
                },
              }
            : {}),
        },
      })),
  };
}
