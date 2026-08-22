/**
 * 完走リプレイのローカルファイル共有（SPEC 第23章 / RI-133）。
 *
 * IndexedDB の `ReplayBlob` を版付き JSON で受け渡す。開始レシピや途中セーブは含めない。
 * 破損・未対応スキーマ・ルールセット不一致は理由付きで拒否し、自動削除しない。
 */
import { CURRENT_RUN_RULESET } from './runPersistence';
import { normalizeReplay, REPLAY_SCHEMA_VERSION, type ReplayBlob } from './replay';

const ACCEPTED_REPLAY_SCHEMA_VERSIONS = new Set([1, REPLAY_SCHEMA_VERSION]);

export type ReplayShareReason =
  | 'corrupt'
  | 'unsupported_version'
  | 'ruleset_unknown'
  | 'ruleset_mismatch';

export const REPLAY_SHARE_REASON_MESSAGE: Record<ReplayShareReason, string> = {
  corrupt: 'リプレイが壊れているか、読み取れません。',
  unsupported_version: '未対応のリプレイ版です。',
  ruleset_unknown: 'ルールセット情報がない旧リプレイのため、読み込めません。',
  ruleset_mismatch: '記録時と現在のルールセットが一致しないため、このリプレイは読み込めません。',
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
 * JSON を構造検査し、現行ルールセットのリプレイだけを返す。
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
  if (!replay) return fail('corrupt');
  if (replay.ruleset === null) return fail('ruleset_unknown');
  if (
    replay.ruleset.version !== CURRENT_RUN_RULESET.version ||
    replay.ruleset.fingerprint !== CURRENT_RUN_RULESET.fingerprint
  ) {
    return fail('ruleset_mismatch');
  }

  return { ok: true, replay };
}
