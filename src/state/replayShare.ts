/**
 * 完走リプレイのローカルファイル共有（SPEC 第23章 / RI-133）。
 *
 * IndexedDB の `ReplayBlob` を版付き JSON で受け渡す。開始レシピや途中セーブは含めない。
 * 破損・未対応スキーマは理由付きで拒否する。ルールセット不一致の旧リプレイは
 * IndexedDB と同様に読み取り専用で取り込む。
 */
import { isDiagnosisType } from '../sim/diagnosis';
import { createRunEngine } from '../sim/run/engine';
import type { DifficultyId, LoseReason, RunKind, RunStatus, WinType } from '../sim/run/types';
import { isPersistFrameShape } from './persistFrameShape';
import { normalizeReplay, REPLAY_SCHEMA_VERSION, type ReplayBlob } from './replay';

const ACCEPTED_REPLAY_SCHEMA_VERSIONS = new Set([1, REPLAY_SCHEMA_VERSION]);

export type ReplayShareReason = 'corrupt' | 'unsupported_version';

export const REPLAY_SHARE_REASON_MESSAGE: Record<ReplayShareReason, string> = {
  corrupt: 'リプレイが壊れているか、読み取れません。',
  unsupported_version: '未対応のリプレイ版です。',
};

export interface ReplayShareOk {
  ok: true;
  replay: ReplayBlob;
}

export interface ReplayShareErr {
  ok: false;
  reason: ReplayShareReason;
  message: string;
}

export type ReplayShareResult = ReplayShareOk | ReplayShareErr;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(reason: ReplayShareReason): ReplayShareErr {
  return { ok: false, reason, message: REPLAY_SHARE_REASON_MESSAGE[reason] };
}

/** 選択中リプレイを JSON 文字列にする。 */
export function serializeReplay(replay: ReplayBlob): string {
  return `${JSON.stringify(structuredClone(replay), null, 2)}\n`;
}

/**
 * JSON を構造検査し、閲覧復元できるリプレイを返す。
 * 既存の IndexedDB レコードはここでは触らない。上限適用は保存側の責務。
 */
export function parseReplayShare(raw: string): ReplayShareResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('corrupt');
  }
  if (!isObject(parsed)) return fail('corrupt');
  if (typeof parsed.schemaVersion !== 'number' || !Number.isInteger(parsed.schemaVersion)) {
    return fail('corrupt');
  }
  if (!ACCEPTED_REPLAY_SCHEMA_VERSIONS.has(parsed.schemaVersion)) {
    return fail('unsupported_version');
  }

  const replay = normalizeReplay(parsed);
  if (
    !replay ||
    !hasValidReplayDomainEnums(replay) ||
    !replayTerminalsConsistent(replay) ||
    !replay.keyframes.every((keyframe) => isPersistFrameShape(keyframe.frame)) ||
    !canHydrateReplay(replay)
  ) {
    return fail('corrupt');
  }

  return { ok: true, replay };
}

const RUN_STATUSES = new Set<RunStatus>(['playing', 'won', 'lost']);
const WIN_TYPES = new Set<WinType>([
  'normal',
  'healthy',
  'aiSuccess',
  'management',
  'happiness',
  'chaos',
  'noDamage',
]);
const LOSE_REASONS = new Set<LoseReason>([
  'seniorBurnout',
  'techDebt',
  'moraleCollapse',
  'reviewFreeze',
  'incidentCascade',
  'aiDependency',
  'budgetExhausted',
  'bossFailed',
  'trustExhausted',
  'reorgRequired',
  'kpiMissed',
]);
const RUN_KINDS = new Set<RunKind>(['normal', 'daily']);
const DIFFICULTIES = new Set<DifficultyId>(['easy', 'normal', 'hard', 'nightmare']);

/** キーフレームの phase / frame.status / 終端 outcome が食い違っていないか。 */
export function replayTerminalsConsistent(replay: ReplayBlob): boolean {
  for (const keyframe of replay.keyframes) {
    if (keyframe.frame.phase !== keyframe.phase) return false;
    if (
      (keyframe.phase === 'won' || keyframe.phase === 'lost') &&
      keyframe.frame.status !== keyframe.phase
    ) {
      return false;
    }
  }
  const last = replay.keyframes[replay.keyframes.length - 1];
  if (!last || (last.phase !== 'won' && last.phase !== 'lost')) return true;
  return replay.outcome.status === last.phase;
}

/** hydrate では落ちない未知の列挙値を、画面参照前に拒否する。 */
export function hasValidReplayDomainEnums(replay: ReplayBlob): boolean {
  if (!isDiagnosisType(replay.outcome.diagnosis)) return false;
  if (!DIFFICULTIES.has(replay.difficulty)) return false;
  for (const keyframe of replay.keyframes) {
    const frame = keyframe.frame;
    if (!isDiagnosisType(frame.diagnosis)) return false;
    if (frame.status !== undefined && !RUN_STATUSES.has(frame.status)) return false;
    if (frame.winType !== undefined && !WIN_TYPES.has(frame.winType)) return false;
    if (frame.loseReason !== undefined && !LOSE_REASONS.has(frame.loseReason)) return false;
    if (frame.runKind !== undefined && !RUN_KINDS.has(frame.runKind)) return false;
    if (frame.difficulty !== undefined && !DIFFICULTIES.has(frame.difficulty)) return false;
  }
  return true;
}

/** 全キーフレームを hydrate できて初めて受け入れる。 */
export function canHydrateReplay(replay: ReplayBlob): boolean {
  try {
    const engine = createRunEngine({ seed: replay.seed, difficulty: replay.difficulty });
    for (const keyframe of replay.keyframes) {
      engine.hydrateReplayFrame(structuredClone(keyframe.frame));
    }
    return true;
  } catch {
    return false;
  }
}
