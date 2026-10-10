/**
 * 開始前の仮説メモ（RI-295）。
 *
 * タイトルで書いた下書きをラン開始時に「開始前の仮説」として固定し、決着画面で
 * 再表示する。終了後の振り返りは別欄に保存し、開始前の仮説として見せない。
 * 開始レシピ・メタ進行・ラン状態には混ぜず、seed・候補・判定へ影響させない。
 */
import type { RunState } from '../sim/run/types';

export const HYPOTHESIS_NOTE_SCHEMA_VERSION = 1 as const;
/** 短い仮説1件に収める上限（コードポイント数）。 */
export const HYPOTHESIS_NOTE_MAX_LENGTH = 120;

export interface HypothesisNoteEntry {
  text: string;
  /** 最後に書いた時刻（epoch ms）。 */
  writtenAt: number;
}

export interface BoundHypothesisNote {
  runKey: string;
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
}

export const EMPTY_HYPOTHESIS_NOTE: HypothesisNoteRecord = {
  schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION,
  draft: null,
  bound: null,
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

/** 同じ開始条件のランを指す鍵。開始のたびに上書きするため、再走で前回のメモは残らない。 */
export function hypothesisRunKey(
  state: Pick<RunState, 'runKind' | 'dailyDate' | 'seed' | 'difficulty' | 'trials'>,
): string {
  return [
    state.runKind,
    state.dailyDate ?? '',
    state.seed,
    state.difficulty,
    [...state.trials].sort().join(','),
  ].join('|');
}

export function editHypothesisDraft(
  record: HypothesisNoteRecord,
  text: string,
  now: number,
): HypothesisNoteRecord {
  return { ...record, draft: entryFrom(text, now) };
}

/** ラン開始時に下書きを開始前の仮説として固定する。空なら前回の仮説だけを外す。 */
export function bindHypothesisToRun(
  record: HypothesisNoteRecord,
  runKey: string,
): HypothesisNoteRecord {
  const draft = record.draft;
  return {
    ...record,
    draft: null,
    bound: draft
      ? {
          runKey,
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
        beforeStart: { ...beforeStart, text: beforeStart.text.trim() },
        reflection: normalizeEntry(b.reflection),
      };
    }
  }
  return { schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION, draft, bound };
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
