/**
 * 開始前の仮説メモ（RI-295）。
 *
 * タイトルで書いた下書きをラン開始時に「開始前の仮説」として固定し、決着画面で
 * 再表示する。終了後の振り返りは別欄に保存し、開始前の仮説として見せない。
 * 開始レシピ・メタ進行・ラン状態には混ぜず、seed・候補・判定へ影響させない。
 */
import type { RunState } from '../sim/run/types';

export const HYPOTHESIS_NOTE_SCHEMA_VERSION = 1 as const;
export const HYPOTHESIS_NOTE_SAVE_FAILED =
  'メモを端末に保存できませんでした。このタブを閉じるまでは表示されます。';
export const HYPOTHESIS_START_UNRECORDED = '仮説メモを保存できなかったので、今回は記録しません';
/** 開始時のメモ保存を待つ上限。古いタブの DB 更新待ちでも、この時間で仮説なしの開始へ進む。 */
export const HYPOTHESIS_START_SAVE_TIMEOUT_MS = 1500;
/** 短い仮説1件に収める上限（コードポイント数）。 */
export const HYPOTHESIS_NOTE_MAX_LENGTH = 120;

export interface HypothesisNoteEntry {
  text: string;
  /** 最後に書いた時刻（epoch ms）。 */
  writtenAt: number;
}

export interface BoundHypothesisNote {
  runKey: string;
  /** この開始だけを指す。同じ下書きから始めても開始ごとに違う。 */
  startId: string;
  /** 開始時点で固定した仮説。開始後は変更しない。 */
  beforeStart: HypothesisNoteEntry;
  /** 決着後に書いた振り返り。 */
  reflection: HypothesisNoteEntry | null;
}

export interface HypothesisNoteRecord {
  schemaVersion: typeof HYPOTHESIS_NOTE_SCHEMA_VERSION;
  /** 次に始めるランへ付ける下書き。 */
  draft: HypothesisNoteEntry | null;
  /** 最後に始めたランへ付けた仮説。 */
  bound: BoundHypothesisNote | null;
  /** 端末へ書いた回数。別タブの古い全体上書きを混ぜるときに使う。 */
  generation: number;
}

export const EMPTY_HYPOTHESIS_NOTE: HypothesisNoteRecord = {
  schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION,
  draft: null,
  bound: null,
  generation: 0,
};

const LINE_BREAKS = /[\r\n\t\u2028\u2029]+/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** 入力中の文字列を1行・上限内に整える。前後の空白は入力途中のため残す。 */
export function sanitizeHypothesisText(raw: string): string {
  const flattened = raw.replace(LINE_BREAKS, ' ').replace(CONTROL_CHARS, '');
  return Array.from(flattened).slice(0, HYPOTHESIS_NOTE_MAX_LENGTH).join('');
}

export function hypothesisTextLength(text: string): number {
  return Array.from(text).length;
}

function entryFrom(text: string, now: number): HypothesisNoteEntry | null {
  const clean = sanitizeHypothesisText(text);
  return clean.trim() ? { text: clean, writtenAt: now } : null;
}

/**
 * このタブで開始したランを指す鍵。シナリオまで含め、開始のたびに上書きする。
 * 途中セーブの取り込みは別ランなので、鍵では同一視せず関連を外す。
 */
export function hypothesisRunKey(
  state: Pick<RunState, 'runKind' | 'dailyDate' | 'seed' | 'difficulty' | 'trials' | 'scenario'>,
): string {
  return [
    state.runKind,
    state.dailyDate ?? '',
    state.seed,
    state.difficulty,
    state.scenario,
    [...state.trials].sort().join(','),
  ].join('|');
}

/** 取り込んだセーブには、この端末で開始した仮説を載せない。 */
export function detachHypothesisNote(record: HypothesisNoteRecord): HypothesisNoteRecord {
  return record.bound ? { ...record, bound: null } : record;
}

export function editHypothesisDraft(
  record: HypothesisNoteRecord,
  text: string,
  now: number,
): HypothesisNoteRecord {
  return { ...record, draft: entryFrom(text, now) };
}

/** 開始ごとの識別子。同じ下書きでもタブや開始のたびに別の値になる。 */
export function newHypothesisStartId(): string {
  return globalThis.crypto.randomUUID();
}

/** ラン開始時に下書きを開始前の仮説として固定する。空なら前回の仮説だけを外す。 */
export function bindHypothesisToRun(
  record: HypothesisNoteRecord,
  runKey: string,
  startId: string = newHypothesisStartId(),
): HypothesisNoteRecord {
  const draft = record.draft;
  return {
    ...record,
    draft: null,
    bound: draft
      ? {
          runKey,
          startId,
          beforeStart: { text: draft.text.trim(), writtenAt: draft.writtenAt },
          reflection: null,
        }
      : null,
  };
}

/** 決着後の振り返りを書く。対象ランの仮説が無いときは何もしない。 */
export function writeHypothesisReflection(
  record: HypothesisNoteRecord,
  runKey: string,
  text: string,
  now: number,
): HypothesisNoteRecord {
  const bound = record.bound;
  if (!bound || bound.runKey !== runKey) return record;
  return { ...record, bound: { ...bound, reflection: entryFrom(text, now) } };
}

export function hypothesisForRun(
  record: HypothesisNoteRecord,
  runKey: string,
): BoundHypothesisNote | null {
  return record.bound?.runKey === runKey ? record.bound : null;
}

function normalizeEntry(raw: unknown): HypothesisNoteEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const { text, writtenAt } = raw as Record<string, unknown>;
  if (typeof text !== 'string' || typeof writtenAt !== 'number') return null;
  if (!Number.isFinite(writtenAt) || writtenAt < 0) return null;
  const clean = sanitizeHypothesisText(text);
  return clean.trim() ? { text: clean, writtenAt } : null;
}

/** 保存値を検証する。読めない値は空のメモとして扱い、ゲームの進行は止めない。 */
export function normalizeHypothesisNote(raw: unknown): HypothesisNoteRecord {
  if (!raw || typeof raw !== 'object') return EMPTY_HYPOTHESIS_NOTE;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== HYPOTHESIS_NOTE_SCHEMA_VERSION) return EMPTY_HYPOTHESIS_NOTE;
  const draft = normalizeEntry(value.draft);
  let bound: BoundHypothesisNote | null = null;
  if (value.bound && typeof value.bound === 'object') {
    const b = value.bound as Record<string, unknown>;
    const beforeStart = normalizeEntry(b.beforeStart);
    if (typeof b.runKey === 'string' && b.runKey && beforeStart) {
      bound = {
        runKey: b.runKey,
        startId: typeof b.startId === 'string' ? b.startId : '',
        beforeStart: { ...beforeStart, text: beforeStart.text.trim() },
        reflection: normalizeEntry(b.reflection),
      };
    }
  }
  const generation =
    typeof value.generation === 'number' &&
    Number.isInteger(value.generation) &&
    value.generation >= 0
      ? value.generation
      : 0;
  return { schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION, draft, bound, generation };
}

function sameEntry(a: HypothesisNoteEntry | null, b: HypothesisNoteEntry | null): boolean {
  return !!a && !!b ? a.text === b.text && a.writtenAt === b.writtenAt : a === b;
}

function sameBound(a: BoundHypothesisNote | null, b: BoundHypothesisNote | null): boolean {
  return !!a && !!b
    ? a.runKey === b.runKey &&
        a.startId === b.startId &&
        sameEntry(a.beforeStart, b.beforeStart) &&
        sameEntry(a.reflection, b.reflection)
    : a === b;
}

/**
 * 読み込み時の世代と端末上の世代がずれていたら、このタブが変えた欄だけを採用する。
 * 変えていない欄は、別タブが先に書いた内容を残す。
 */
function reflectionOnly(
  base: BoundHypothesisNote | null,
  local: BoundHypothesisNote | null,
): local is BoundHypothesisNote {
  return (
    !!local &&
    !!base &&
    local.runKey === base.runKey &&
    local.startId === base.startId &&
    sameEntry(local.beforeStart, base.beforeStart)
  );
}

function mergeDraft(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
  currentIsBase: boolean,
): HypothesisNoteEntry | null {
  if (currentIsBase) return local.draft;
  if (sameEntry(base.draft, local.draft)) return current.draft;
  // 開始で消す下書きは、端末上の値がその下書きのままのときだけ消す。
  if (local.draft === null && base.draft && !sameEntry(base.draft, current.draft)) {
    return current.draft;
  }
  return local.draft;
}

/** 競合で自分の仮説を端末へ書けなかった。画面上の仮説は残す。 */
export function hypothesisCommitDroppedSessionBound(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  stored: HypothesisNoteRecord,
): boolean {
  const baseBound = base.bound;
  const localBound = local.bound;
  if (!baseBound || !reflectionOnly(baseBound, localBound)) return false;
  return (
    !sameEntry(baseBound.reflection, localBound.reflection) &&
    stored.bound?.startId !== localBound.startId
  );
}

/** 解除は競合する後発ランを端末に残し、このタブの表示は外したままにする。 */
export function hypothesisCommitKeptForeignBound(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  stored: HypothesisNoteRecord,
): boolean {
  return (
    local.bound === null &&
    !!base.bound &&
    !!stored.bound &&
    stored.bound.startId !== base.bound.startId
  );
}

function mergeBound(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
  currentIsBase: boolean,
): BoundHypothesisNote | null {
  if (currentIsBase) return local.bound;
  if (sameBound(base.bound, local.bound)) return current.bound;
  if (local.bound === null && base.bound) {
    if (!current.bound || current.bound.startId === base.bound.startId) return null;
    return current.bound;
  }
  if (reflectionOnly(base.bound, local.bound)) {
    if (
      !current.bound ||
      current.bound.runKey !== local.bound.runKey ||
      current.bound.startId !== local.bound.startId ||
      !sameEntry(current.bound.beforeStart, local.bound.beforeStart)
    ) {
      return current.bound;
    }
    return { ...current.bound, reflection: local.bound.reflection };
  }
  return local.bound;
}

export function commitHypothesisNote(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
): HypothesisNoteRecord {
  const currentIsBase = current.generation === base.generation;
  return {
    schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION,
    draft: mergeDraft(base, local, current, currentIsBase),
    bound: mergeBound(base, local, current, currentIsBase),
    generation: (currentIsBase ? base.generation : current.generation) + 1,
  };
}

export interface HypothesisNoteExport {
  beforeStart: { text: string; writtenAt: string };
  reflection: { text: string; writtenAt: string } | null;
}

function isoTime(at: number): string {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

/** 書き出し用。記入時点を区別できるよう、開始前と振り返りを別キーに分ける。 */
export function hypothesisNoteForExport(note: BoundHypothesisNote): HypothesisNoteExport {
  return {
    beforeStart: { text: note.beforeStart.text, writtenAt: isoTime(note.beforeStart.writtenAt) },
    reflection: note.reflection
      ? { text: note.reflection.text.trim(), writtenAt: isoTime(note.reflection.writtenAt) }
      : null,
  };
}
