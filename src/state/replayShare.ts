/**
 * 完走リプレイのローカルファイル共有（SPEC 第23章 / RI-133）。
 *
 * IndexedDB の `ReplayBlob` を版付き JSON で受け渡す。開始レシピや途中セーブは含めない。
 * 破損・未対応スキーマは理由付きで拒否する。ルールセット不一致の旧リプレイは
 * IndexedDB と同様に読み取り専用で取り込む。
 */
import { createRunEngine } from '../sim/run/engine';
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
  if (!replay || !canHydrateReplay(replay)) return fail('corrupt');

  return { ok: true, replay };
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
