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
import {
  parseStartRecipe,
  serializeStartRecipe,
  validateStartRecipe,
  type StartRecipeInput,
} from '../state/startRecipe';
import type { MetaState } from '../state/meta';

/**
 * current=記録時と現行が同じ、changed=定義が違う、retired=現行に無い。
 * unknown=記録時定義が無く、同じとも変更とも言えない。
 */
export type ContentStatus = 'current' | 'changed' | 'retired' | 'unknown';
/** 進化ノードは記録時の定義を持たないため、変更の有無は確かめられない。 */
export type EvolutionStatus = 'present' | 'retired';

export const BUILD_HISTORY_MAX = 20;
export const BUILD_NAME_MAX = 24;

/** カード定義のうち、現行定義との比較に使う記録時の値。 */
export interface RecordedCardDef {
  name: string;
  cost: number;
  focusCost: number;
  base: CardDef['base'];
  rarity: CardDef['rarity'];
  description: string[];
}

/** レリック定義のうち、現行定義との比較に使う記録時の値。 */
export interface RecordedRelicDef {
  name: string;
  effects: RelicDef['effects'] | null;
  passives: RelicDef['passives'] | null;
  description: string;
}

export interface BuildCard {
  defId: string;
  /** 一覧に出す名前。記録時の名前を優先し、無ければ要約時点の現行名、それも無ければ定義ID。 */
  name: string;
  count: number;
  maxLevel: number;
  /** スナップショットが無い、またはそのカードを含まないときは null。 */
  recorded: RecordedCardDef | null;
}

export interface BuildRelic {
  id: string;
  /** 一覧に出す名前。記録時の名前を優先し、無ければ要約時点の現行名、それも無ければID。 */
  name: string;
  /** スナップショットが無い、またはそのレリックを含まないときは null。 */
  recorded: RecordedRelicDef | null;
}

export interface BuildSummary {
  seed: string;
  difficulty: ReplayBlob['difficulty'];
  trials: string[];
  ruleset: RunRulesetIdentity | null;
  outcome: { status: 'won' | 'lost'; winType: WinType | null; diagnosis: DiagnosisType };
  sprintsPlayed: number;
  cards: BuildCard[];
  relics: BuildRelic[];
  evolution: { id: string; name: string }[];
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

/** 閲覧時に現行カタログと照合した要約。履歴へはこの判定を保存しない。 */
export interface ResolvedBuildSummary extends Omit<BuildSummary, 'cards' | 'relics' | 'evolution'> {
  cards: (BuildCard & { status: ContentStatus })[];
  relics: (BuildRelic & { status: ContentStatus })[];
  evolution: { id: string; name: string; status: EvolutionStatus }[];
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

function cardShape(def: RecordedCardDef | CardDef): string {
  return JSON.stringify([def.name, def.cost, def.focusCost, def.base, def.rarity, def.description]);
}

function relicShape(def: RecordedRelicDef | RelicDef): string {
  return JSON.stringify([def.name, def.effects ?? null, def.passives ?? null, def.description]);
}

function recordedCard(def: CardDef): RecordedCardDef {
  return {
    name: def.name,
    cost: def.cost,
    focusCost: def.focusCost,
    base: structuredClone(def.base),
    rarity: def.rarity,
    description: [...def.description],
  };
}

function recordedRelic(def: RelicDef): RecordedRelicDef {
  return {
    name: def.name,
    effects: structuredClone(def.effects ?? null),
    passives: structuredClone(def.passives ?? null),
    description: def.description,
  };
}

/** 現行に無ければ retired。記録時定義が無ければ unknown。それ以外は記録時と現行の比較。 */
function cardContentStatus(card: BuildCard): ContentStatus {
  const current = getCard(card.defId);
  if (!current) return 'retired';
  if (!card.recorded) return 'unknown';
  return cardShape(card.recorded) === cardShape(current) ? 'current' : 'changed';
}

function relicContentStatus(relic: BuildRelic): ContentStatus {
  const current = getRelic(relic.id);
  if (!current) return 'retired';
  if (!relic.recorded) return 'unknown';
  return relicShape(relic.recorded) === relicShape(current) ? 'current' : 'changed';
}

/**
 * 保存した記録時定義と現行カタログを照合する。
 * カード・レリックの current / changed / retired / unknown と、進化の present / retired はここで決める。
 */
export function resolveContentStatus(summary: BuildSummary): ResolvedBuildSummary {
  return {
    ...summary,
    cards: summary.cards.map((card) => ({ ...card, status: cardContentStatus(card) })),
    relics: summary.relics.map((relic) => ({ ...relic, status: relicContentStatus(relic) })),
    evolution: summary.evolution.map((node) => ({
      ...node,
      status: getEvolutionNode(node.id) ? 'present' : 'retired',
    })),
  };
}

function buildHistoryId(replayId: string): string {
  return `build:${replayId}`;
}

/** 末尾キーフレームが outcome と一致する勝敗フレームのときだけ要約する。 */
export function summarizeBuild(replay: ReplayBlob): BuildSummary | null {
  const end = replay.keyframes[replay.keyframes.length - 1];
  if (!end || (end.phase !== 'won' && end.phase !== 'lost')) return null;
  if (replay.outcome.status !== end.phase) return null;
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
        const recorded = snapshot ? recordedCard(snapshot) : null;
        return {
          defId,
          name: recorded?.name ?? getCard(defId)?.name ?? defId,
          ...entry,
          recorded,
        };
      }),
    relics: [...new Set(frame.relics)].sort().map((id) => {
      const snapshot = snapshotRelics.get(id);
      const recorded = snapshot ? recordedRelic(snapshot) : null;
      return {
        id,
        name: recorded?.name ?? getRelic(id)?.name ?? id,
        recorded,
      };
    }),
    evolution: Object.keys(frame.evolution.unlocked)
      .sort()
      .map((id) => ({ id, name: getEvolutionNode(id)?.name ?? id })),
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
  const existing = history.find(
    (entry) => entry.sourceReplayId === replay.id || entry.id === buildHistoryId(replay.id),
  );
  if (existing)
    return history.map((entry) =>
      entry === existing ? { ...structuredClone(entry), name } : entry,
    );
  const entry: BuildHistoryEntry = {
    id: buildHistoryId(replay.id),
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
      reason:
        | 'no-start-frame'
        | 'ruleset-mismatch'
        | 'ruleset-unknown'
        | 'invalid-start'
        | 'locked';
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
  const parsed = parseStartRecipe(serializeStartRecipe(summary.start));
  if (!parsed.ok) return { ok: false, reason: 'invalid-start', notCarried: NOT_CARRIED };
  const checked = validateStartRecipe(parsed.recipe, meta);
  if (!checked.ok) return { ok: false, reason: 'locked', notCarried: NOT_CARRIED };
  const recipe: StartRecipeInput = {
    seed: checked.recipe.seed,
    difficulty: checked.recipe.difficulty,
    trials: [...checked.recipe.trials],
    scenario: checked.recipe.scenario,
    preferredCardIds: [...checked.recipe.preferredCardIds],
  };
  return { ok: true, recipe, notCarried: NOT_CARRIED };
}
