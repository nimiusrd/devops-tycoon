/**
 * 開始前の仮説メモ（RI-295）。
 *
 * 画面が一度に見せるのは、次のラン向けの下書き1件と、いまのランの仮説1件だけ。
 * 保存はそれと別で、下書きと開始 ID ごとの仮説を分ける。履歴画面は持たない。
 *
 * 保持と削除:
 * - 下書きは端末で1件。競合は draftRevision の比較で見る。
 * - 仮説は startId ごとに1件。beforeStart は作成後に変えない。振り返りはその ID だけを更新する。
 * - ノートは自動では消さない。別タブが決着画面で見ているメモを掃除で消さない。
 * - schemaVersion 1 の bound は、startId があるときだけ notes[startId] へ移す。
 *   startId が空の bound はどのランとも結び付けられないので移さない。
 *
 * 開始レシピ・メタ進行・ラン状態には混ぜず、seed・候補・判定へ影響させない。
 */
import type { RunState } from '../sim/run/types';

export const HYPOTHESIS_NOTE_SCHEMA_VERSION = 2 as const;
const HYPOTHESIS_NOTE_SCHEMA_VERSION_V1 = 1;
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

/** 開始 ID に結び付いた仮説。beforeStart は作成後に変えない。 */
export interface HypothesisNote {
  runKey: string;
  beforeStart: HypothesisNoteEntry;
  reflection: HypothesisNoteEntry | null;
}

/** 決着画面が読む形。startId はラン側の保存と突き合わせる。 */
export interface BoundHypothesisNote extends HypothesisNote {
  startId: string;
}

export interface HypothesisNoteRecord {
  schemaVersion: typeof HYPOTHESIS_NOTE_SCHEMA_VERSION;
  /** 次に始めるランへ付ける下書き。開始が採用されるまで消さない。 */
  draft: HypothesisNoteEntry | null;
  /** 下書きを書いた回数。別タブとの競合判定にだけ使う。 */
  draftRevision: number;
  /** 開始 ID ごとの仮説。キー以外のノートは更新しない。 */
  notes: Record<string, HypothesisNote>;
}

export const EMPTY_HYPOTHESIS_NOTE: HypothesisNoteRecord = {
  schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION,
  draft: null,
  draftRevision: 0,
  notes: {},
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

export function editHypothesisDraft(
  record: HypothesisNoteRecord,
  text: string,
  now: number,
): HypothesisNoteRecord {
  const draft = entryFrom(text, now);
  if (sameEntry(record.draft, draft)) return record;
  return { ...record, draft, draftRevision: record.draftRevision + 1 };
}

/** 開始ごとの識別子。同じ下書きでもタブや開始のたびに別の値になる。 */
export function newHypothesisStartId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * 開始の準備。下書きは消さない。同じ startId が既にあれば beforeStart は変えない。
 */
export function prepareHypothesis(
  record: HypothesisNoteRecord,
  runKey: string,
  startId: string,
  beforeStart: HypothesisNoteEntry,
): HypothesisNoteRecord {
  if (!startId || record.notes[startId]) return record;
  const text = beforeStart.text.trim();
  if (!text) return record;
  return {
    ...record,
    notes: {
      ...record.notes,
      [startId]: {
        runKey,
        beforeStart: { text, writtenAt: beforeStart.writtenAt },
        reflection: null,
      },
    },
  };
}

/** 開始を採用できたときだけ、準備時点の版の下書きを消す。 */
export function consumeDraftRevision(
  record: HypothesisNoteRecord,
  revision: number,
): HypothesisNoteRecord {
  if (record.draft == null || record.draftRevision !== revision) return record;
  return { ...record, draft: null, draftRevision: record.draftRevision + 1 };
}

/** 決着後の振り返りを書く。対象の startId だけを変え、beforeStart は残す。 */
export function writeHypothesisReflection(
  record: HypothesisNoteRecord,
  runKey: string,
  startId: string | null,
  text: string,
  now: number,
): HypothesisNoteRecord {
  if (!startId) return record;
  const note = record.notes[startId];
  if (!note || note.runKey !== runKey) return record;
  const reflection = entryFrom(text, now);
  if (sameEntry(note.reflection, reflection)) return record;
  return {
    ...record,
    notes: { ...record.notes, [startId]: { ...note, reflection } },
  };
}

export function hypothesisForRun(
  record: HypothesisNoteRecord,
  runKey: string,
  startId: string | null,
): BoundHypothesisNote | null {
  if (!startId) return null;
  const note = record.notes[startId];
  if (!note || note.runKey !== runKey) return null;
  return { ...note, startId };
}

function normalizeEntry(raw: unknown): HypothesisNoteEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const { text, writtenAt } = raw as Record<string, unknown>;
  if (typeof text !== 'string' || typeof writtenAt !== 'number') return null;
  if (!Number.isFinite(writtenAt) || writtenAt < 0) return null;
  const clean = sanitizeHypothesisText(text);
  return clean.trim() ? { text: clean, writtenAt } : null;
}

function normalizeNote(raw: unknown): HypothesisNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const beforeStart = normalizeEntry(value.beforeStart);
  if (typeof value.runKey !== 'string' || !value.runKey || !beforeStart) return null;
  return {
    runKey: value.runKey,
    beforeStart: { ...beforeStart, text: beforeStart.text.trim() },
    reflection: normalizeEntry(value.reflection),
  };
}

function revisionOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** 保存値を検証する。読めない値は空のメモとして扱い、ゲームの進行は止めない。 */
export function normalizeHypothesisNote(raw: unknown): HypothesisNoteRecord {
  if (!raw || typeof raw !== 'object') return EMPTY_HYPOTHESIS_NOTE;
  const value = raw as Record<string, unknown>;
  if (
    value.schemaVersion !== HYPOTHESIS_NOTE_SCHEMA_VERSION &&
    value.schemaVersion !== HYPOTHESIS_NOTE_SCHEMA_VERSION_V1
  ) {
    return EMPTY_HYPOTHESIS_NOTE;
  }
  const draft = normalizeEntry(value.draft);
  const notes: Record<string, HypothesisNote> = {};
  if (value.notes && typeof value.notes === 'object') {
    for (const [startId, note] of Object.entries(value.notes as Record<string, unknown>)) {
      if (!startId) continue;
      const normalized = normalizeNote(note);
      if (normalized) notes[startId] = normalized;
    }
  }
  if (value.schemaVersion === HYPOTHESIS_NOTE_SCHEMA_VERSION_V1) {
    const legacy = normalizeNote(value.bound);
    const legacyId =
      value.bound && typeof value.bound === 'object'
        ? (value.bound as Record<string, unknown>).startId
        : '';
    if (legacy && typeof legacyId === 'string' && legacyId && !notes[legacyId]) {
      notes[legacyId] = legacy;
    }
  }
  const draftRevision =
    value.schemaVersion === HYPOTHESIS_NOTE_SCHEMA_VERSION
      ? revisionOf(value.draftRevision)
      : revisionOf(value.generation);
  return {
    schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION,
    draft,
    draftRevision,
    notes,
  };
}

function sameEntry(a: HypothesisNoteEntry | null, b: HypothesisNoteEntry | null): boolean {
  return !!a && !!b ? a.text === b.text && a.writtenAt === b.writtenAt : a === b;
}

function sameNote(a: HypothesisNote | undefined, b: HypothesisNote | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.runKey === b.runKey &&
    sameEntry(a.beforeStart, b.beforeStart) &&
    sameEntry(a.reflection, b.reflection)
  );
}

/** このタブの下書き変更を、別タブが先に書いた下書きへ上書きできない。 */
export function hypothesisDraftConflict(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
): boolean {
  const localChanged = local.draftRevision !== base.draftRevision;
  const diskChanged = current.draftRevision !== base.draftRevision;
  return localChanged && diskChanged && !sameEntry(local.draft, current.draft);
}

function mergeDraft(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
) {
  if (hypothesisDraftConflict(base, local, current)) {
    return { draft: current.draft, draftRevision: current.draftRevision };
  }
  if (local.draftRevision === base.draftRevision) {
    return { draft: current.draft, draftRevision: current.draftRevision };
  }
  return {
    draft: local.draft,
    draftRevision: Math.max(local.draftRevision, current.draftRevision),
  };
}

function mergeNotes(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
): Record<string, HypothesisNote> {
  const ids = new Set([
    ...Object.keys(base.notes),
    ...Object.keys(local.notes),
    ...Object.keys(current.notes),
  ]);
  const notes: Record<string, HypothesisNote> = {};
  for (const id of ids) {
    const previous = base.notes[id];
    const ours = local.notes[id];
    const disk = current.notes[id];
    if (!ours || sameNote(previous, ours)) {
      // こちらが変えていないノートは、端末側の削除をそのまま残す。
      if (!disk) continue;
      if (!ours && previous && sameNote(previous, disk)) continue;
      notes[id] = disk;
      continue;
    }
    if (!disk || sameNote(previous, disk)) {
      notes[id] = ours;
      continue;
    }
    notes[id] = {
      runKey: disk.runKey,
      beforeStart: disk.beforeStart,
      reflection: sameEntry(previous?.reflection ?? null, disk.reflection)
        ? ours.reflection
        : disk.reflection,
    };
  }
  return notes;
}

/** 同じ開始 ID の振り返りを両方のタブが変えたとき、こちらの未保存本文。 */
export function conflictingReflections(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
): Record<string, HypothesisNoteEntry | null> {
  const held: Record<string, HypothesisNoteEntry | null> = {};
  for (const id of Object.keys(local.notes)) {
    const previous = base.notes[id];
    const ours = local.notes[id];
    const disk = current.notes[id];
    if (!previous || !ours || !disk) continue;
    if (sameEntry(previous.reflection, ours.reflection)) continue;
    if (sameEntry(previous.reflection, disk.reflection)) continue;
    if (sameEntry(ours.reflection, disk.reflection)) continue;
    held[id] = ours.reflection;
  }
  return held;
}

/** 採用しなかった開始だけを外す。別の本文や振り返りが付いていれば残す。 */
export function removeUnadoptedHypothesis(
  record: HypothesisNoteRecord,
  startId: string,
  beforeStart: HypothesisNoteEntry,
): HypothesisNoteRecord {
  const note = record.notes[startId];
  if (!note || note.reflection) return record;
  if (
    note.beforeStart.text !== beforeStart.text.trim() ||
    note.beforeStart.writtenAt !== beforeStart.writtenAt
  ) {
    return record;
  }
  const notes = { ...record.notes };
  delete notes[startId];
  return { ...record, notes };
}

/** 下書きは版番号、仮説は startId ごとにマージする。未変更のノートは端末の削除を戻さない。 */
export function commitHypothesisNote(
  base: HypothesisNoteRecord,
  local: HypothesisNoteRecord,
  current: HypothesisNoteRecord,
): HypothesisNoteRecord {
  const draft = mergeDraft(base, local, current);
  return {
    schemaVersion: HYPOTHESIS_NOTE_SCHEMA_VERSION,
    draft: draft.draft,
    draftRevision: draft.draftRevision,
    notes: mergeNotes(base, local, current),
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
