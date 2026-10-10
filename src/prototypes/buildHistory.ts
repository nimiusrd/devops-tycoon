/**
 * RI-293: 完走リプレイの終端フレームから会社の構成要約を作り、名前を付けて残す。
 * 現行メタの所持へ置換せず、開始は既存の開始レシピへ変換できる範囲だけを引き継ぐ。
 */
import { getCard } from '../data/cards';
import { getEvolutionNode } from '../data/evolution';
import { getRelic, type RelicDef } from '../data/relics';
import type { DiagnosisType, WinType } from '../sim/run/types';
import type { CardDef } from '../sim/types';
import type { ReplayBlob } from '../state/replay';
import { CURRENT_RUN_RULESET, type RunRulesetIdentity } from '../state/runPersistence';
import { validateStartRecipe, type StartRecipeInput } from '../state/startRecipe';
import type { MetaState } from '../state/meta';

/** current=現行定義と同じ、changed=記録時と現行で定義が違う、retired=現行に無い。 */
export type ContentStatus = 'current' | 'changed' | 'retired';
/** 進化ノードは記録時の定義を持たないため、変更の有無は確かめられない。 */
export type EvolutionStatus = 'present' | 'retired';

export const BUILD_HISTORY_MAX = 20;
export const BUILD_NAME_MAX = 24;

export interface BuildSummary {
  seed: string;
  difficulty: ReplayBlob['difficulty'];
  trials: string[];
  ruleset: RunRulesetIdentity | null;
  outcome: { status: 'won' | 'lost'; winType: WinType | null; diagnosis: DiagnosisType };
  sprintsPlayed: number;
  cards: { defId: string; name: string; count: number; maxLevel: number; status: ContentStatus }[];
  relics: { id: string; name: string; status: ContentStatus }[];
  evolution: { id: string; name: string; status: EvolutionStatus }[];
  roster: {
    name: string;
    rank: string;
    level: number;
    traits: string[];
    assignment: string;
    aiAssigned: boolean;
  }[];
  start: StartRecipeInput | null;
}

export interface BuildHistoryEntry {
  id: string;
  name: string;
  /** 元のリプレイ。上限で消えたら null にし、要約だけを残す。 */
  sourceReplayId: string | null;
  finishedAt: number;
  summary: BuildSummary;
}

/** 開始レシピへ引き継がない構成。貸与にしないため、すべて新しいランで作り直す。 */
export const NOT_CARRIED = [
  'deck',
  'cardLevels',
  'relics',
  'evolution',
  'roster',
  'budget',
] as const;

function cardStatus(snapshot: CardDef | undefined, id: string): ContentStatus {
  const current = getCard(id);
  if (!current) return 'retired';
  if (!snapshot) return 'current';
  const shape = (def: CardDef) =>
    JSON.stringify([def.cost, def.focusCost, def.base, def.rarity, def.description]);
  return shape(snapshot) === shape(current) ? 'current' : 'changed';
}

function relicStatus(snapshot: RelicDef | undefined, id: string): ContentStatus {
  const current = getRelic(id);
  if (!current) return 'retired';
  if (!snapshot) return 'current';
  const shape = (def: RelicDef) =>
    JSON.stringify([def.effects ?? null, def.passives ?? null, def.description]);
  return shape(snapshot) === shape(current) ? 'current' : 'changed';
}

/** 終端（won/lost）フレームの実状態から要約する。終端がない記録は null。 */
export function summarizeBuild(replay: ReplayBlob): BuildSummary | null {
  const end = [...replay.keyframes]
    .reverse()
    .find((keyframe) => keyframe.phase === 'won' || keyframe.phase === 'lost');
  if (!end || replay.outcome.status !== end.phase) return null;
  const frame = end.frame;
  const snapshotCards = new Map((replay.contentSnapshot?.cards ?? []).map((def) => [def.id, def]));
  const snapshotRelics = new Map(
    (replay.contentSnapshot?.relics ?? []).map((def) => [def.id, def]),
  );
  const cards = new Map<string, { count: number; maxLevel: number }>();
  for (const card of frame.deck) {
    const entry = cards.get(card.defId) ?? { count: 0, maxLevel: 0 };
    cards.set(card.defId, {
      count: entry.count + 1,
      maxLevel: Math.max(entry.maxLevel, card.level),
    });
  }
  const setup = replay.keyframes.find(
    (keyframe) => keyframe.phase === 'setup' && keyframe.frame.sprintsPlayed === 0,
  )?.frame;
  return {
    seed: replay.seed,
    difficulty: replay.difficulty,
    trials: [...replay.trials],
    ruleset: replay.ruleset ? { ...replay.ruleset } : null,
    outcome: {
      status: replay.outcome.status,
      winType: replay.outcome.winType ?? null,
      diagnosis: replay.outcome.diagnosis,
    },
    sprintsPlayed: frame.sprintsPlayed,
    cards: [...cards.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([defId, entry]) => {
        const snapshot = snapshotCards.get(defId);
        return {
          defId,
          name: snapshot?.name ?? getCard(defId)?.name ?? defId,
          ...entry,
          status: cardStatus(snapshot, defId),
        };
      }),
    relics: [...new Set(frame.relics)].sort().map((id) => {
      const snapshot = snapshotRelics.get(id);
      return {
        id,
        name: snapshot?.name ?? getRelic(id)?.name ?? id,
        status: relicStatus(snapshot, id),
      };
    }),
    evolution: Object.keys(frame.evolution.unlocked)
      .sort()
      .map((id) => {
        const node = getEvolutionNode(id);
        return { id, name: node?.name ?? id, status: node ? 'present' : 'retired' };
      }),
    roster: frame.roster.members.map((member) => ({
      name: member.name,
      rank: member.rank,
      level: member.level,
      traits: [...member.traits],
      assignment: member.assignment,
      aiAssigned: member.aiAssigned,
    })),
    start: setup
      ? {
          seed: replay.seed,
          difficulty: replay.difficulty,
          trials: [...replay.trials],
          scenario: setup.scenario,
          preferredCardIds: [...(setup.extras.preferredCardIds ?? [])],
        }
      : null,
  };
}

export function sanitizeBuildName(raw: string, summary: BuildSummary): string {
  const name = [...raw.replace(/\s+/g, ' ').trim()].slice(0, BUILD_NAME_MAX).join('');
  if (name) return name;
  return `${summary.seed} / ${summary.outcome.winType ?? summary.outcome.status}`;
}

/** 同じリプレイは1件にまとめ、名前だけを更新する。上限を超えたら古いものから外す。 */
export function addBuildHistory(
  history: readonly BuildHistoryEntry[],
  replay: ReplayBlob,
  rawName: string,
): BuildHistoryEntry[] | null {
  const summary = summarizeBuild(replay);
  if (!summary) return null;
  const name = sanitizeBuildName(rawName, summary);
  const existing = history.find((entry) => entry.sourceReplayId === replay.id);
  if (existing)
    return history.map((entry) =>
      entry === existing ? { ...structuredClone(entry), name } : entry,
    );
  const entry: BuildHistoryEntry = {
    id: `build:${replay.id}`,
    name,
    sourceReplayId: replay.id,
    finishedAt: replay.finishedAt,
    summary,
  };
  return [entry, ...history]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, BUILD_HISTORY_MAX)
    .map((item) => structuredClone(item));
}

/** リプレイ上限で消えた元記録への参照を外す。要約は残す。 */
export function detachRemovedReplays(
  history: readonly BuildHistoryEntry[],
  replayIds: ReadonlySet<string>,
): BuildHistoryEntry[] {
  return history.map((entry) =>
    entry.sourceReplayId && !replayIds.has(entry.sourceReplayId)
      ? { ...structuredClone(entry), sourceReplayId: null }
      : structuredClone(entry),
  );
}

export type StartFromBuild =
  | { ok: true; recipe: StartRecipeInput; notCarried: typeof NOT_CARRIED }
  | {
      ok: false;
      reason: 'no-start-frame' | 'ruleset-mismatch' | 'ruleset-unknown' | 'locked';
      notCarried: typeof NOT_CARRIED;
    };

/** 開始レシピへ変換できる範囲だけを返す。ruleset が違う記録からは開始しない。 */
export function startFromBuild(
  entry: BuildHistoryEntry,
  meta: MetaState,
  current: RunRulesetIdentity = CURRENT_RUN_RULESET,
): StartFromBuild {
  const { summary } = entry;
  if (!summary.start) return { ok: false, reason: 'no-start-frame', notCarried: NOT_CARRIED };
  if (!summary.ruleset) return { ok: false, reason: 'ruleset-unknown', notCarried: NOT_CARRIED };
  if (
    summary.ruleset.version !== current.version ||
    summary.ruleset.fingerprint !== current.fingerprint
  )
    return { ok: false, reason: 'ruleset-mismatch', notCarried: NOT_CARRIED };
  const checked = validateStartRecipe({ schemaVersion: 1, ...summary.start }, meta);
  if (!checked.ok) return { ok: false, reason: 'locked', notCarried: NOT_CARRIED };
  return { ok: true, recipe: structuredClone(summary.start), notCarried: NOT_CARRIED };
}
