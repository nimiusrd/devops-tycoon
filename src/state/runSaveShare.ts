/**
 * 途中セーブのローカルファイル共有（SPEC 第23章 / RI-133）。
 *
 * IndexedDB の `RunSave` を版付き JSON で受け渡す。開始レシピやリプレイは含めない。
 * 破損・未対応スキーマ・ルールセット不一致は理由付きで拒否し、自動削除しない。
 */
import { createRunEngine } from '../sim/run/engine';
import {
  getRunSaveCompatibilityIssue,
  parseRunSave,
  RUN_SAVE_SCHEMA_VERSION,
  type RunSave,
} from './runPersistence';

/** parseRunSave が受け付けるスキーマ（現行 + 移行対象の旧版）。 */
const ACCEPTED_RUN_SAVE_SCHEMA_VERSIONS = new Set([4, 5, 6, 7, RUN_SAVE_SCHEMA_VERSION]);

export type RunSaveShareReason =
  | 'corrupt'
  | 'unsupported_version'
  | 'ruleset_unknown'
  | 'ruleset_mismatch';

export const RUN_SAVE_SHARE_REASON_MESSAGE: Record<RunSaveShareReason, string> = {
  corrupt: '途中セーブが壊れているか、読み取れません。',
  unsupported_version: '未対応の途中セーブ版です。',
  ruleset_unknown: 'ルールセット情報がない旧セーブのため、読み込めません。',
  ruleset_mismatch: '保存時と現在のルールセットが一致しないため、このセーブは読み込めません。',
};

export interface RunSaveShareOk {
  ok: true;
  save: RunSave;
}

export interface RunSaveShareErr {
  ok: false;
  reason: RunSaveShareReason;
  message: string;
}

export type RunSaveShareResult = RunSaveShareOk | RunSaveShareErr;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(reason: RunSaveShareReason): RunSaveShareErr {
  return { ok: false, reason, message: RUN_SAVE_SHARE_REASON_MESSAGE[reason] };
}

/** 現行の途中セーブを JSON 文字列にする。 */
export function serializeRunSave(save: RunSave): string {
  return `${JSON.stringify(structuredClone(save), null, 2)}\n`;
}

/**
 * JSON を構造検査し、現行ルールセットで再開できる途中セーブだけを返す。
 * 既存の IndexedDB レコードはここでは触らない。
 */
export function parseRunSaveShare(raw: string): RunSaveShareResult {
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
  if (!ACCEPTED_RUN_SAVE_SCHEMA_VERSIONS.has(parsed.schemaVersion)) {
    return fail('unsupported_version');
  }

  const save = parseRunSave(parsed);
  if (!save) return fail('corrupt');

  const issue = getRunSaveCompatibilityIssue(save);
  if (issue?.kind === 'ruleset-unknown') return fail('ruleset_unknown');
  if (issue?.kind === 'ruleset-mismatch') return fail('ruleset_mismatch');
  if (!canHydrateRunSave(save)) return fail('corrupt');

  return { ok: true, save };
}

/** 再開時の hydrate が例外なく通る構造だけを受け入れる。 */
export function canHydrateRunSave(save: RunSave): boolean {
  try {
    const trials = Array.isArray(save.state.trials) ? save.state.trials : [];
    const engine = createRunEngine({
      seed: save.state.seed,
      difficulty: save.state.difficulty,
      trials,
    });
    engine.hydratePersistState(structuredClone(save.state));
    return true;
  } catch {
    return false;
  }
}
