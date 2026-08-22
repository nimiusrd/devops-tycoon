/**
 * リプレイ保存（RI-61）のスキーマと正規化。
 *
 * ラン中のフェーズ境界キーフレームを終了時にまとめて保存し、閲覧時は
 * RunEngine.hydrateReplayFrame で read-only 表示する。純入力ログ再生は非スコープ。
 */
import { isReplayFramePhase, type RunReplayFrame, type ReplayFramePhase } from '../sim/run/persist';
import { canHydrateReplayFrame } from '../sim/run/persistValidation';
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { getCard } from '../data/cards';
import { getRelic, type RelicDef } from '../data/relics';
import { isDiagnosisType } from '../sim/diagnosis';
import type { CardDef } from '../sim/types';
import type {
  DiagnosisType,
  DifficultyId,
  LoseReason,
  RunPhase,
  RunStatus,
  WinType,
} from '../sim/run/types';

/** リプレイスキーマ版。v1 は読み込み時に v2 の形へ正規化する。 */
export const REPLAY_SCHEMA_VERSION = 2;
const LEGACY_REPLAY_SCHEMA_VERSION = 1;

/** 保持するリプレイ件数の上限（古いものから削除）。 */
export const REPLAY_MAX_COUNT = 10;

export interface ReplayOutcome {
  status: Extract<RunStatus, 'won' | 'lost'>;
  winType?: WinType;
  loseReason?: LoseReason;
  diagnosis: DiagnosisType;
  score: number;
}

export interface ReplayKeyframe {
  phase: ReplayFramePhase;
  label?: string;
  frame: RunReplayFrame;
}

/** リプレイ記録時に適用されていたルールセットの識別子。 */
export interface ReplayRulesetIdentity {
  readonly version: number;
  readonly fingerprint: string;
}

/** リプレイ表示で参照するカード／レリック定義の最小スナップショット。 */
export interface ReplayContentSnapshot {
  cards: CardDef[];
  relics: RelicDef[];
}

/** IndexedDB に保存するリプレイ本体。 */
export interface ReplayBlob {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  id: string;
  seed: string;
  difficulty: DifficultyId;
  trials: string[];
  finishedAt: number;
  outcome: ReplayOutcome;
  keyframes: ReplayKeyframe[];
  /** 旧 v1 リプレイでは null。 */
  ruleset: ReplayRulesetIdentity | null;
  /** 旧 v1 リプレイでは null。 */
  contentSnapshot: ReplayContentSnapshot | null;
}

export type ReplayFileImportReason =
  | 'invalid-json'
  | 'unsupported-schema'
  | 'invalid-data'
  | 'ruleset-mismatch'
  | 'duplicate'
  | 'evicted'
  | 'storage';

export interface ReplayFileCompatibilityIssue {
  readonly savedRuleset: ReplayRulesetIdentity;
  readonly currentRuleset: ReplayRulesetIdentity;
}

export interface ReplayFileImportSuccess {
  readonly ok: true;
  readonly replay: ReplayBlob;
  readonly message: string;
}

export interface ReplayFileImportFailure {
  readonly ok: false;
  readonly reason: ReplayFileImportReason;
  readonly message: string;
  readonly issue?: ReplayFileCompatibilityIssue;
}

export type ReplayFileImportResult = ReplayFileImportSuccess | ReplayFileImportFailure;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCardRarity(value: unknown): value is CardDef['rarity'] {
  return value === 'common' || value === 'rare' || value === 'legendary';
}

const CARD_EFFECT_KEYS = [
  'codingSpeedMul',
  'routineSpeedMul',
  'reviewEfficiencyMul',
  'reviewCapacityMul',
  'seniorHpCostMul',
  'reviewHpCostMul',
  'reworkRateAdd',
  'incidentRateMul',
  'aiLiteracyAdd',
  'aiDependencyAdd',
  'qualityAdd',
  'testCoverageAdd',
  'securityAdd',
  'infraCostMul',
] as const;

const RELIC_PASSIVE_KEYS = [
  'moraleDamageMul',
  'restHealBonus',
  'shopDiscount',
  'relicSlots',
] as const;

function hasFiniteNumericFields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => {
    const field = value[key];
    return field === undefined || (typeof field === 'number' && Number.isFinite(field));
  });
}

function isCardDef(value: unknown): value is CardDef {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isCardRarity(value.rarity) &&
    typeof value.cost === 'number' &&
    Number.isFinite(value.cost) &&
    typeof value.focusCost === 'number' &&
    Number.isFinite(value.focusCost) &&
    Array.isArray(value.description) &&
    value.description.every((line) => typeof line === 'string') &&
    isObject(value.base) &&
    hasFiniteNumericFields(value.base, CARD_EFFECT_KEYS)
  );
}

function isRelicDef(value: unknown): value is RelicDef {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    (value.effects === undefined ||
      (isObject(value.effects) && hasFiniteNumericFields(value.effects, CARD_EFFECT_KEYS))) &&
    (value.passives === undefined ||
      (isObject(value.passives) && hasFiniteNumericFields(value.passives, RELIC_PASSIVE_KEYS)))
  );
}

const INVALID_REPLAY_VALUE = Symbol('invalid-replay-value');

function parseReplayRuleset(
  value: unknown,
): ReplayRulesetIdentity | null | typeof INVALID_REPLAY_VALUE {
  if (!isObject(value)) return INVALID_REPLAY_VALUE;
  if (
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.fingerprint !== 'string' ||
    value.fingerprint.length === 0
  ) {
    return INVALID_REPLAY_VALUE;
  }
  return {
    version: value.version,
    fingerprint: value.fingerprint,
  };
}

function parseReplayContentSnapshot(
  value: unknown,
): ReplayContentSnapshot | typeof INVALID_REPLAY_VALUE {
  if (!isObject(value) || !Array.isArray(value.cards) || !Array.isArray(value.relics)) {
    return INVALID_REPLAY_VALUE;
  }
  if (
    !value.cards.every(isCardDef) ||
    !value.relics.every(isRelicDef) ||
    new Set(value.cards.map((card) => card.id)).size !== value.cards.length ||
    new Set(value.relics.map((relic) => relic.id)).size !== value.relics.length
  ) {
    return INVALID_REPLAY_VALUE;
  }
  return {
    cards: structuredClone(value.cards),
    relics: structuredClone(value.relics),
  };
}

function isReplayFrame(value: unknown): value is RunReplayFrame {
  if (!isObject(value)) return false;
  if (typeof value.phase !== 'string' || !isReplayFramePhase(value.phase as RunPhase)) {
    return false;
  }
  if (typeof value.seed !== 'string' || !isObject(value.extras)) return false;
  if (!isDiagnosisType(value.diagnosis)) return false;
  if (!Array.isArray(value.extras.allowedCards) || !Array.isArray(value.extras.allowedRelics)) {
    return false;
  }
  return true;
}

function addCardId(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string') ids.add(value);
}

function addRelicId(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string') ids.add(value);
}

/**
 * キーフレームの表示に実際に登場するカード／レリックだけを収集する。
 * allowedCards / allowedRelics はラン開始時のプールであり、表示参照では
 * ないためスナップショットへは含めない。
 */
export function snapshotReplayContent(keyframes: readonly ReplayKeyframe[]): ReplayContentSnapshot {
  const cardIds = new Set<string>();
  const relicIds = new Set<string>();

  for (const keyframe of keyframes) {
    const frame = keyframe.frame;
    if (Array.isArray(frame.deck)) {
      for (const card of frame.deck) {
        if (isObject(card)) addCardId(cardIds, card.defId);
      }
    }
    if (Array.isArray(frame.draft)) {
      for (const cardId of frame.draft) addCardId(cardIds, cardId);
    }
    if (frame.shop && isObject(frame.shop)) {
      if (Array.isArray(frame.shop.cards)) {
        for (const offer of frame.shop.cards) {
          if (isObject(offer)) addCardId(cardIds, offer.defId);
        }
      }
      if (isObject(frame.shop.relic)) addRelicId(relicIds, frame.shop.relic.id);
    }

    if (Array.isArray(frame.relics)) {
      for (const relicId of frame.relics) addRelicId(relicIds, relicId);
    }
    addRelicId(relicIds, frame.bossRelicReward);
  }

  return {
    cards: [...cardIds]
      .map((id) => getCard(id))
      .filter((card): card is CardDef => card !== undefined)
      .map((card) => structuredClone(card)),
    relics: [...relicIds]
      .map((id) => getRelic(id))
      .filter((relic): relic is RelicDef => relic !== undefined)
      .map((relic) => structuredClone(relic)),
  };
}

/**
 * キーフレーム配列を正規化する。
 * 壊れた要素は捨てる（途中セーブの互換補完用。完全な ReplayBlob では別途空配列を拒否）。
 */
export function normalizeReplayKeyframes(value: unknown): ReplayKeyframe[] {
  if (!Array.isArray(value)) return [];
  const keyframes: ReplayKeyframe[] = [];
  for (const raw of value) {
    if (!isObject(raw) || typeof raw.phase !== 'string') continue;
    if (!isReplayFramePhase(raw.phase as RunPhase)) continue;
    if (!isReplayFrame(raw.frame)) continue;
    if (raw.phase !== raw.frame.phase) continue;
    keyframes.push({
      phase: raw.phase as ReplayFramePhase,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      frame: structuredClone(raw.frame),
    });
  }
  return keyframes;
}

/** 壊れた／非互換リプレイは null。 */
export function normalizeReplay(value: unknown): ReplayBlob | null {
  if (!isObject(value)) return null;
  const isLegacy = value.schemaVersion === LEGACY_REPLAY_SCHEMA_VERSION;
  const isNormalizedLegacy =
    value.schemaVersion === REPLAY_SCHEMA_VERSION &&
    value.ruleset === null &&
    value.contentSnapshot === null;
  if (!isLegacy && !isNormalizedLegacy && value.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    return null;
  }
  if (typeof value.id !== 'string' || typeof value.seed !== 'string') return null;
  if (typeof value.difficulty !== 'string') return null;
  if (!Array.isArray(value.trials) || !value.trials.every((t) => typeof t === 'string')) {
    return null;
  }
  if (typeof value.finishedAt !== 'number' || !Number.isFinite(value.finishedAt)) return null;
  if (!isObject(value.outcome)) return null;
  if (value.outcome.status !== 'won' && value.outcome.status !== 'lost') return null;
  if (!isDiagnosisType(value.outcome.diagnosis)) return null;
  if (typeof value.outcome.score !== 'number' || !Number.isFinite(value.outcome.score)) {
    return null;
  }
  if (!Array.isArray(value.keyframes) || value.keyframes.length === 0) return null;

  const keyframes = normalizeReplayKeyframes(value.keyframes);
  if (keyframes.length !== value.keyframes.length || keyframes.length === 0) return null;

  const isLegacyShape = isLegacy || isNormalizedLegacy;
  const parsedRuleset = isLegacyShape ? null : parseReplayRuleset(value.ruleset);
  if (!isLegacyShape && parsedRuleset === INVALID_REPLAY_VALUE) return null;
  const ruleset = parsedRuleset === INVALID_REPLAY_VALUE ? null : parsedRuleset;

  const parsedContentSnapshot = isLegacyShape
    ? null
    : parseReplayContentSnapshot(value.contentSnapshot);
  if (!isLegacyShape && parsedContentSnapshot === INVALID_REPLAY_VALUE) return null;
  const contentSnapshot =
    parsedContentSnapshot === INVALID_REPLAY_VALUE ? null : parsedContentSnapshot;

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: value.id,
    seed: value.seed,
    difficulty: value.difficulty as DifficultyId,
    trials: [...value.trials],
    finishedAt: value.finishedAt,
    outcome: {
      status: value.outcome.status,
      winType: value.outcome.winType as WinType | undefined,
      loseReason: value.outcome.loseReason as LoseReason | undefined,
      diagnosis: value.outcome.diagnosis as DiagnosisType,
      score: value.outcome.score,
    },
    keyframes,
    ruleset,
    contentSnapshot,
  };
}

function isSupportedReplaySchema(value: unknown): value is 1 | 2 {
  return value === LEGACY_REPLAY_SCHEMA_VERSION || value === REPLAY_SCHEMA_VERSION;
}

function formatReplayRuleset(ruleset: ReplayRulesetIdentity): string {
  return `v${ruleset.version} / ${ruleset.fingerprint}`;
}

/** リプレイをファイル共有用のJSONへ変換する。 */
export function serializeReplay(blob: ReplayBlob): string {
  return `${JSON.stringify(blob, null, 2)}\n`;
}

/** リプレイファイルをJSON解析・正規化し、ファイル取込時の互換性を検証する。 */
export function parseReplayFile(
  raw: string,
  currentRuleset: ReplayRulesetIdentity = {
    version: BALANCE_RULESET_VERSION,
    fingerprint: BALANCE_RULESET_FINGERPRINT,
  },
): ReplayFileImportResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: 'invalid-json',
      message: 'JSONを解析できないため、リプレイを読み込めません。',
    };
  }

  if (!isObject(value)) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: 'リプレイのJSON構造が正しくありません。',
    };
  }
  if (!isSupportedReplaySchema(value.schemaVersion)) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      message: `未対応のリプレイスキーマです（schemaVersion: ${String(value.schemaVersion)}）。`,
    };
  }

  const replay = normalizeReplay(value);
  if (!replay) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: 'リプレイの必須データが欠落しているか、壊れています。',
    };
  }
  if (!replay.keyframes.every(({ frame }) => canHydrateReplayFrame(frame))) {
    return {
      ok: false,
      reason: 'invalid-data',
      message: 'リプレイのキーフレーム全体を復元できないため、読み込めません。',
    };
  }

  if (
    replay.ruleset &&
    (replay.ruleset.version !== currentRuleset.version ||
      replay.ruleset.fingerprint !== currentRuleset.fingerprint)
  ) {
    const issue = {
      savedRuleset: structuredClone(replay.ruleset),
      currentRuleset: structuredClone(currentRuleset),
    };
    return {
      ok: false,
      reason: 'ruleset-mismatch',
      message: `記録時と現在のルールセットが一致しないため、このリプレイはファイルから取り込めません（記録時: ${formatReplayRuleset(issue.savedRuleset)} / 現在: ${formatReplayRuleset(issue.currentRuleset)}）。`,
      issue,
    };
  }

  return {
    ok: true,
    replay,
    message: 'リプレイを読み込みました。',
  };
}

/** リプレイ ID を組み立てる。 */
export function buildReplayId(seed: string, finishedAt: number): string {
  return `${seed}:${finishedAt}`;
}
