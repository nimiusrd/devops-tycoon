/** RI-299: リプレイJSONだけを読む、通常ランから隔離した比較試作。 */
import { getCard } from '../data/cards';
import { getRelic } from '../data/relics';
import { getTrial } from '../data/difficulties';
import { SCENARIOS } from '../sim/scenarios';
import type { ReplayBlob } from '../state/replay';
import { parseReplayShare } from '../state/replayShare';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';
import { checkIdentity } from './pastRunCompare';

export const LOCAL_TOURNAMENT_LIMITS = {
  minFiles: 2,
  maxFiles: 4,
  jsonCharacters: 2_000_000,
  keyframes: 256,
  noteCharacters: 80,
  depth: 48,
  nodes: 250_000,
  arrayItems: 5_000,
  stringCharacters: 16_000,
} as const;

export interface TournamentInput {
  json: string;
  /** 任意のローカル注記。本人性を示さず、重複判定にも使用しない。 */
  participantNote?: string;
}

export interface ConditionIssue {
  field: string;
  reason: 'missing' | 'unknown' | 'inconsistent';
}

type ImportResult =
  | { index: number; status: 'accepted' }
  | { index: number; status: 'duplicate'; duplicateOf: number }
  | { index: number; status: 'rejected'; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** parser/hydrate と canonical 化の前に入力の仕事量を制限する。 */
function withinBounds(
  value: unknown,
  depth = 0,
  budget = { remaining: LOCAL_TOURNAMENT_LIMITS.nodes as number },
): boolean {
  if (depth > LOCAL_TOURNAMENT_LIMITS.depth || --budget.remaining < 0) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= LOCAL_TOURNAMENT_LIMITS.stringCharacters;
  if (Array.isArray(value)) {
    return (
      value.length <= LOCAL_TOURNAMENT_LIMITS.arrayItems &&
      value.every((item) => withinBounds(item, depth + 1, budget))
    );
  }
  if (isObject(value)) {
    return Object.entries(value).every(
      ([key, item]) =>
        key.length <= LOCAL_TOURNAMENT_LIMITS.stringCharacters &&
        withinBounds(item, depth + 1, budget),
    );
  }
  return true;
}

/** ハッシュを使わず、キー順だけを正規化して内容そのものを比較する。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const REPLAY_FIELDS = new Set([
  'schemaVersion',
  'id',
  'seed',
  'difficulty',
  'trials',
  'finishedAt',
  'outcome',
  'keyframes',
  'ruleset',
  'contentSnapshot',
  'exportedAt',
]);

function unknownReplayFields(raw: unknown): Record<string, unknown> {
  return isObject(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([key]) => !REPLAY_FIELDS.has(key)))
    : {};
}

function contentKey(replay: ReplayBlob, raw: unknown, issues: readonly ConditionIssue[]): string {
  return canonical({
    schemaVersion: replay.schemaVersion,
    seed: replay.seed,
    difficulty: replay.difficulty,
    trials: replay.trials,
    ruleset: replay.ruleset,
    outcome: replay.outcome,
    contentSnapshot: replay.contentSnapshot,
    unrecognizedFields: unknownReplayFields(raw),
    conditionIssues: issues,
    keyframes: replay.keyframes.map(({ phase, frame }) => ({ phase, frame })),
  });
}

function inspect(replay: ReplayBlob, raw: unknown) {
  const issues: ConditionIssue[] = [];
  const add = (field: string, reason: ConditionIssue['reason']) => issues.push({ field, reason });
  if (Object.keys(unknownReplayFields(raw)).length) add('unrecognizedFields', 'unknown');
  const starts = replay.keyframes.filter(
    ({ phase, frame }) => phase === 'setup' && frame.sprintsPlayed === 0,
  );
  const start = starts.length === 1 ? starts[0].frame : null;
  if (!start) add('recordedStart', starts.length ? 'inconsistent' : 'missing');
  if (!replay.seed.length) add('seed', 'missing');
  if (!replay.ruleset) add('ruleset', 'missing');
  else if (canonical(replay.ruleset) !== canonical(CURRENT_RUN_RULESET)) add('ruleset', 'unknown');
  if (new Set(replay.trials).size !== replay.trials.length) add('trials', 'inconsistent');
  if (replay.trials.some((id) => !getTrial(id))) add('trials', 'unknown');
  if (start) {
    if (typeof start.budget !== 'number' || !Number.isFinite(start.budget))
      add('budget', 'unknown');
    const startIndex = replay.keyframes.findIndex(({ frame }) => frame === start);
    const rawEntry: unknown =
      isObject(raw) && Array.isArray(raw.keyframes) ? raw.keyframes[startIndex] : null;
    const rawStart = isObject(rawEntry) && isObject(rawEntry.frame) ? rawEntry.frame : {};
    const rawExtras = isObject(rawStart.extras) ? rawStart.extras : {};
    for (const key of ['goalCarryoverQuarter', 'goalCarryoverId']) {
      if (!(key in rawStart) && !(key in rawExtras)) add(key, 'missing');
    }
    if (start.scenario === undefined) add('scenario', 'missing');
    else if (!Object.prototype.hasOwnProperty.call(SCENARIOS, start.scenario))
      add('scenario', 'unknown');
    if (start.extras.scenario === undefined) add('scenario', 'missing');
    else if (start.extras.scenario !== start.scenario) add('scenario', 'inconsistent');
    if (start.runKind === undefined) add('runKind', 'missing');
    if (start.runKind === 'daily' && !start.dailyDate) add('dailyDate', 'missing');
    for (const field of ['allowedCards', 'allowedRelics', 'preferredCardIds'] as const) {
      const value = start.extras[field];
      if (value === undefined) add(field, 'missing');
      else if (
        !Array.isArray(value) ||
        value.some((id) => typeof id !== 'string') ||
        new Set(value).size !== value.length
      )
        add(field, 'unknown');
      else if (value.some((id) => (field === 'allowedRelics' ? !getRelic(id) : !getCard(id))))
        add(field, 'unknown');
    }
  }
  const terminal = replay.keyframes[replay.keyframes.length - 1];
  const end =
    terminal && (terminal.phase === 'won' || terminal.phase === 'lost') ? terminal.frame : null;
  if (!end) add('terminal', 'missing');
  const delivered = end?.totals.delivered;
  if (delivered === undefined || !Number.isSafeInteger(delivered) || delivered < 0)
    add('delivered', 'unknown');
  else if (replay.outcome.score !== delivered) add('delivered', 'inconsistent');
  if (end) {
    if (end.diagnosis !== replay.outcome.diagnosis) add('diagnosis', 'inconsistent');
    if (end.winType !== replay.outcome.winType || end.loseReason !== replay.outcome.loseReason)
      add('outcome', 'inconsistent');
    if (end.status === 'won' && !end.winType) add('winType', 'missing');
    if (end.status === 'lost' && end.winType !== undefined) add('winType', 'inconsistent');
    if (end.status === 'lost' && !end.loseReason) add('loseReason', 'missing');
    if (end.status === 'won' && end.loseReason !== undefined) add('loseReason', 'inconsistent');
  }
  return { issues, start, delivered: delivered ?? null };
}

/**
 * 2〜4ファイルのバッチを毎回ゼロから比較する。追記・保存・集計・報酬APIは持たない。
 * 重複は最初の注記を保持。IDが同じで内容が異なる場合はバッチ全体を拒否する。
 * 過去の返り値や入力を変更しないため、失敗後も呼出元の既存比較を保持できる。
 */
export function compareLocalTournament(inputs: readonly TournamentInput[]) {
  if (
    inputs.length < LOCAL_TOURNAMENT_LIMITS.minFiles ||
    inputs.length > LOCAL_TOURNAMENT_LIMITS.maxFiles
  ) {
    return { ok: false as const, reason: 'file_count' as const };
  }
  const imports: ImportResult[] = [];
  const records: {
    index: number;
    note: string | null;
    replay: ReplayBlob;
    content: string;
    inspection: ReturnType<typeof inspect>;
  }[] = [];
  const identities = new Map<string, string>();
  for (const [index, input] of inputs.entries()) {
    if (
      typeof input.json !== 'string' ||
      input.json.length > LOCAL_TOURNAMENT_LIMITS.jsonCharacters ||
      (input.participantNote !== undefined &&
        (typeof input.participantNote !== 'string' ||
          input.participantNote.length > LOCAL_TOURNAMENT_LIMITS.noteCharacters))
    ) {
      imports.push({ index, status: 'rejected', reason: 'input_limit' });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(input.json);
    } catch {
      imports.push({ index, status: 'rejected', reason: 'corrupt' });
      continue;
    }
    if (
      !withinBounds(raw) ||
      (isObject(raw) &&
        Array.isArray(raw.keyframes) &&
        raw.keyframes.length > LOCAL_TOURNAMENT_LIMITS.keyframes)
    ) {
      imports.push({ index, status: 'rejected', reason: 'structure_limit' });
      continue;
    }
    const parsed = parseReplayShare(input.json);
    if (!parsed.ok) {
      imports.push({ index, status: 'rejected', reason: parsed.reason });
      continue;
    }
    const { replay } = parsed;
    if (
      replay.keyframes.some(({ frame }) =>
        ['allowedCards', 'allowedRelics', 'preferredCardIds'].some((field) => {
          const values: unknown = frame.extras[field as keyof typeof frame.extras];
          return (
            values !== undefined &&
            (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
          );
        }),
      )
    ) {
      imports.push({ index, status: 'rejected', reason: 'condition_shape' });
      continue;
    }
    const inspection = inspect(replay, raw);
    const content = contentKey(replay, raw, inspection.issues);
    const previous = identities.get(replay.id);
    if (previous !== undefined && previous !== content) {
      return { ok: false as const, reason: 'id_collision' as const, index, replayId: replay.id };
    }
    // 別IDで同内容でもIDを予約し、後続のID衝突検知から漏らさない。
    identities.set(replay.id, content);
    const duplicate = records.find((record) => record.content === content);
    if (duplicate) {
      imports.push({ index, status: 'duplicate', duplicateOf: duplicate.index });
      continue;
    }
    records.push({
      index,
      note: input.participantNote ?? null,
      replay,
      content,
      inspection,
    });
    imports.push({ index, status: 'accepted' });
  }
  const pairs = records.flatMap((a, i) =>
    records.slice(i + 1).map((b) => {
      const identity = checkIdentity(a.replay, b.replay);
      const startStatus =
        !a.inspection.start || !b.inspection.start
          ? 'missing'
          : canonical(a.inspection.start) === canonical(b.inspection.start)
            ? 'match'
            : 'mismatch';
      const fields = [...identity, { field: 'recordedStart', status: startStatus }];
      const status =
        a.inspection.issues.length || b.inspection.issues.length
          ? 'incomparable'
          : fields.every((item) => item.status === 'match')
            ? 'same-conditions'
            : 'different-conditions';
      return { a: a.index, b: b.index, status, identity: fields };
    }),
  );
  const groups: number[][] = [];
  for (const record of records) {
    if (record.inspection.issues.length) continue;
    const group = groups.find(([first]) =>
      pairs.some(
        (pair) => pair.a === first && pair.b === record.index && pair.status === 'same-conditions',
      ),
    );
    if (group) group.push(record.index);
    else groups.push([record.index]);
  }
  return {
    ok: true as const,
    source: 'recorded-replay-json' as const,
    authenticity: 'unverified-local-records' as const,
    ranking: 'none' as const,
    enoughParticipants: records.length >= 2,
    imports,
    entries: records.map(({ index, note, replay, inspection }) => ({
      index,
      participantNote: note,
      replayId: replay.id,
      seed: replay.seed,
      difficulty: replay.difficulty,
      trials: [...replay.trials],
      ruleset: replay.ruleset,
      delivered: inspection.delivered,
      recordedWinType: replay.outcome.winType ?? null,
      outcome: { ...replay.outcome },
      issues: inspection.issues,
    })),
    pairs,
    groups,
  };
}
