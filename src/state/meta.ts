/**
 * メタ進行とアンロック（SPEC 第17章）。
 *
 * ランをまたいで蓄積する進行。ボス撃破でメタ進行ポイント・難易度解放・実績を
 * 得る。ロジックは純関数に保ち、永続化は metaPersistence.ts に分離する。
 */
import { ACHIEVEMENT_DEFS, ACHIEVEMENT_IDS } from '../data/achievements';
import { INITIAL_UNLOCKED_DIFFICULTIES, META_BALANCE } from '../data/balance/meta';
import { DIFFICULTY_ORDER } from '../data/difficulties';
import type { BOSS_DEFS } from '../data/bosses';
import { BOSS_DEFS as ALL_BOSSES } from '../data/bosses';
import {
  defaultUnlockedCardIds,
  defaultUnlockedRelicIds,
  getUnlock,
  type UnlockDef,
} from '../data/unlocks';
import { isFailureDiagnosis } from '../sim/diagnosis';
import { winView } from '../sim/outcome';
import type { DiagnosisType, DifficultyId, QuarterOutcome, WinType } from '../sim/run/types';
import { CURRENT_RUN_RULESET, type RunRulesetIdentity } from './runPersistence';

/**
 * 現行チュートリアル内容の版（RI-67）。
 * `src/ui/tutorial.ts` のガイド内容と同期させる。
 */
export const TUTORIAL_CONTENT_VERSION = 5;

/** 旧 RI-60（3ステップ）完了セーブの版。 */
export const LEGACY_TUTORIAL_VERSION = 1;

export const LEGACY_META_STORAGE_KEY = 'devops-tycoon:meta:v1';

export interface MetaState {
  /** 累積メタ進行ポイント。 */
  points: number;
  /** 解放済み難易度。 */
  unlockedDifficulties: DifficultyId[];
  /** 撃破したボス ID（重複なし）。 */
  defeatedBosses: string[];
  /** 解除済み実績 ID。 */
  achievements: string[];
  /** 収集済みの勝利称号（WinType、重複なし）。 */
  collectedWinTypes: WinType[];
  /** 収集済みの AI 導入失敗診断（失敗 4 種のみ、重複なし）。 */
  collectedDiagnoses: DiagnosisType[];
  /** 自己ベストスコア。 */
  bestScore: number;
  /** メタショップで購入済みのカード定義 ID。 */
  unlockedCards: string[];
  /** メタショップで購入済みのレリック定義 ID。 */
  unlockedRelics: string[];
  /**
   * 研修方針として優先するカード定義 ID（最大 {@link MAX_PREFERRED_CARDS}）。
   * ドラフト／ショップの出やすさだけを偏らせ、初期所持にはしない（RI-34⁗）。
   */
  preferredCardIds: string[];
  /** 複合キー（daily:UTC日付:v版:指紋）→ デイリーラン記録。旧日付キーも保持する。 */
  dailyRuns: Record<string, DailyRunRecord>;
  /** サウンドミュート（RI-59）。UI 層のみ。 */
  soundMuted: boolean;
  /** 初見向け段階ガイドを表示済みか（RI-60。互換用。版は seenTutorialVersion）。 */
  seenTutorial: boolean;
  /**
   * 表示済みチュートリアル内容の版（RI-67）。
   * 現行 {@link TUTORIAL_CONTENT_VERSION} 未満なら再表示する。
   */
  seenTutorialVersion: number;
}

/** 研修方針で選べる優先施策の上限（RI-34⁗）。正本は `META_BALANCE`。 */
export const MAX_PREFERRED_CARDS = META_BALANCE.preferredMaxCards.value;

/** 1 日分のデイリーラン記録（第23章）。 */
export interface DailyRunRecord {
  /** その日のベストスコア（出荷ポイント）。 */
  bestScore: number;
  /** その日のメタ進行 points 報酬を受け取り済みか。 */
  rewardClaimed: boolean;
}

/** `dailyRuns` の複合キーを解析した結果。旧日付キーは ruleset=null になる。 */
export interface DailyRunKeyParts {
  dateStr: string;
  ruleset: RunRulesetIdentity | null;
}

/** 業界画面に表示する、順位付きデイリー記録。 */
export interface DailyLeaderboardEntry extends DailyRunRecord {
  /** `MetaState.dailyRuns` 内の一意なキー。 */
  entryKey: string;
  dateStr: string;
  /** 旧日付キーでは null（ルールセット不明）。 */
  ruleset: RunRulesetIdentity | null;
  rank: number;
}

export interface UnlockedContent {
  cards: ReadonlySet<string>;
  relics: ReadonlySet<string>;
}

export type PurchaseUnlockReason = 'unknown' | 'already_owned' | 'insufficient_points' | 'requires';

export interface PurchaseUnlockResult {
  meta: MetaState;
  ok: boolean;
  reason?: PurchaseUnlockReason;
}

/** 初期メタ状態（easy/normal は最初から解放）。 */
export function defaultMeta(): MetaState {
  return {
    points: 0,
    unlockedDifficulties: [...INITIAL_UNLOCKED_DIFFICULTIES],
    defeatedBosses: [],
    achievements: [],
    collectedWinTypes: [],
    collectedDiagnoses: [],
    bestScore: 0,
    unlockedCards: [],
    unlockedRelics: [],
    preferredCardIds: [],
    dailyRuns: {},
    soundMuted: true,
    seenTutorial: false,
    seenTutorialVersion: 0,
  };
}

/**
 * 優先施策 ID を正規化する（未知・未解放を落とし、重複除去、上限で切り詰め）。
 * `allowed` 未指定時は ID の形式だけ整える（解放チェックは呼び出し側）。
 */
export function sanitizePreferredCardIds(
  ids: unknown,
  allowed?: ReadonlySet<string>,
  maxCards: number = MAX_PREFERRED_CARDS,
): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== 'string' || !raw || seen.has(raw)) continue;
    if (allowed && !allowed.has(raw)) continue;
    if (out.length >= maxCards) break;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** 保存値へ現行スキーマの既定値を補完する。 */
export function normalizeMeta(value: unknown): MetaState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultMeta();
  // 旧セーブの unlockedPresets（RI-25 で削除した足場）は読み捨てる。
  const { unlockedPresets: _legacyPresets, ...rest } = value as Record<string, unknown>;
  const base = { ...defaultMeta(), ...(rest as Partial<MetaState>) };
  // 旧セーブや壊れた値は boolean に正規化する。
  // soundMuted 未設定は既定ミュート（true）。明示 false のセーブは維持する。
  const unlocked = unlockedContent(base);
  const seenTutorialVersion =
    typeof rest.seenTutorialVersion === 'number' && Number.isFinite(rest.seenTutorialVersion)
      ? Math.max(0, Math.floor(rest.seenTutorialVersion))
      : rest.seenTutorial === true
        ? LEGACY_TUTORIAL_VERSION
        : 0;
  return {
    ...base,
    preferredCardIds: sanitizePreferredCardIds(rest.preferredCardIds, unlocked.cards),
    dailyRuns: normalizeDailyRuns(rest.dailyRuns),
    soundMuted: typeof rest.soundMuted === 'boolean' ? rest.soundMuted : true,
    seenTutorialVersion,
    seenTutorial: seenTutorialVersion >= TUTORIAL_CONTENT_VERSION || rest.seenTutorial === true,
  };
}

function normalizeDailyRuns(value: unknown): Record<string, DailyRunRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, DailyRunRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (
      typeof record.bestScore !== 'number' ||
      !Number.isFinite(record.bestScore) ||
      typeof record.rewardClaimed !== 'boolean'
    ) {
      continue;
    }
    normalized[key] = {
      bestScore: record.bestScore,
      rewardClaimed: record.rewardClaimed,
    };
  }
  return normalized;
}

/** ミュート設定を更新した新しい MetaState を返す（RI-59）。 */
export function withSoundMuted(meta: MetaState, soundMuted: boolean): MetaState {
  if (meta.soundMuted === soundMuted) return meta;
  return { ...meta, soundMuted };
}

/**
 * 研修方針（優先施策）を更新した新しい MetaState を返す（RI-34⁗）。
 * 解放済みカードのみ受け付け、最大 {@link MAX_PREFERRED_CARDS} 枚まで。
 */
export function withPreferredCardIds(
  meta: MetaState,
  preferredCardIds: readonly string[],
): MetaState {
  const allowed = unlockedContent(meta).cards;
  const next = sanitizePreferredCardIds(preferredCardIds, allowed);
  if (
    next.length === meta.preferredCardIds.length &&
    next.every((id, i) => id === meta.preferredCardIds[i])
  ) {
    return meta;
  }
  return { ...meta, preferredCardIds: next };
}

/** 旧 JSON セーブを現行スキーマへ復元する。壊れていれば null。 */
export function parseLegacyMeta(raw: string): MetaState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return normalizeMeta(parsed);
  } catch {
    return null;
  }
}

export { DAILY_RUN_DIFFICULTY, DAILY_RUN_TRIALS } from '../data/difficulties';

/** UTC 日付文字列（YYYY-MM-DD）。 */
export function utcDateStr(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 日付から決定論シードを導出する（同一日は全員同じ seed）。 */
export function dailySeed(dateStr: string): string {
  return `daily-${dateStr}`;
}

/** デイリー記録を保存する複合キーを組み立てる。 */
export function dailyRunKey(
  dateStr: string,
  ruleset: RunRulesetIdentity = CURRENT_RUN_RULESET,
): string {
  return `daily:${dateStr}:v${ruleset.version}:${ruleset.fingerprint}`;
}

/** デイリー記録キーを解析する。旧日付キーはルールセット不明として扱う。 */
export function parseDailyRunKey(key: string): DailyRunKeyParts | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return { dateStr: key, ruleset: null };
  }
  const match = /^daily:(\d{4}-\d{2}-\d{2}):v([1-9]\d*):([^:]+)$/.exec(key);
  if (!match) return null;
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version)) return null;
  return {
    dateStr: match[1],
    ruleset: { version, fingerprint: match[3] },
  };
}

/** 指定日の現行（または指定）ルールセットのデイリー記録を返す。 */
export function getDailyRecord(
  meta: MetaState,
  dateStr: string,
  ruleset: RunRulesetIdentity = CURRENT_RUN_RULESET,
): DailyRunRecord | undefined {
  return meta.dailyRuns[dailyRunKey(dateStr, ruleset)];
}

/**
 * 自分のデイリー記録をベストスコア順の擬似リーダーボードにする。
 * 同点は新しい UTC 日付を上位とし、表示順を決定論的に保つ。
 */
export function dailyLeaderboardEntries(meta: MetaState): DailyLeaderboardEntry[] {
  return Object.entries(meta.dailyRuns)
    .flatMap(([entryKey, record]) => {
      const parts = parseDailyRunKey(entryKey);
      if (!parts) return [];
      return [{ entryKey, dateStr: parts.dateStr, ruleset: parts.ruleset, ...record }];
    })
    .sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        b.dateStr.localeCompare(a.dateStr) ||
        b.entryKey.localeCompare(a.entryKey),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** 指定難易度の「次」を解放する（最後尾なら変化なし）。 */
function nextDifficulty(id: DifficultyId): DifficultyId | null {
  const i = DIFFICULTY_ORDER.indexOf(id);
  return i >= 0 && i < DIFFICULTY_ORDER.length - 1 ? DIFFICULTY_ORDER[i + 1] : null;
}

export interface RunRewardInput {
  won: boolean;
  difficulty: DifficultyId;
  winType?: WinType;
  bossId?: string;
  /** ランの最終スコア（出荷ポイント）。 */
  score: number;
  /** 試練のスコア倍率の積。 */
  scoreMul: number;
  /** ランで達成した最大コンボ。 */
  maxCombo: number;
  /** 四半期レビュー履歴（メタ進行ボーナス用）。 */
  quarterReviews?: QuarterOutcome[];
  /** ラン終了時の組織タイプ診断（失敗図鑑収集用）。 */
  diagnosis?: DiagnosisType;
}

/** 失敗診断を図鑑へ追記する（健全系は無視、重複なし）。 */
function mergeCollectedDiagnoses(
  current: readonly DiagnosisType[],
  diagnosis: DiagnosisType | undefined,
): DiagnosisType[] {
  if (!diagnosis || !isFailureDiagnosis(diagnosis)) return [...current];
  return uniq([...current, diagnosis]) as DiagnosisType[];
}

/** 1 ラン分のメタ進行ポイント内訳（RI-28′ 可視化用）。 */
export interface RunRewardBreakdown {
  /** 勝敗ベース報酬（試練倍率込み）。 */
  base: number;
  /** 敗北時の四半期修正経験ボーナス。 */
  learningBonus: number;
  /** 勝利時のレビュー評価ボーナス（exceeded / met）。 */
  reviewBonus: number;
  /** reviewBonus の種別。ボーナス無しなら null。 */
  reviewBonusKind: 'exceeded' | 'met' | null;
  /** base + learningBonus + reviewBonus。 */
  total: number;
  /** 今回ポイントが実際に付与されたか（デイリー再走は false）。 */
  granted: boolean;
}

/**
 * ラン結果からメタ進行ポイントの内訳を計算する（付与はしない）。
 * `granted` は呼び出し側が上書きできるよう既定 true。
 */
export function computeRunRewardBreakdown(input: RunRewardInput): RunRewardBreakdown {
  const reviews = input.quarterReviews ?? [];
  const base = Math.round(
    (input.won ? META_BALANCE.rewardWinBase.value : META_BALANCE.rewardLossBase.value) *
      Math.max(META_BALANCE.rewardScoreMulFloor.value, input.scoreMul),
  );
  const learningBonus =
    !input.won && reviews.some((r) => r === 'missed_adjustable')
      ? Math.min(
          META_BALANCE.rewardLearningCap.value,
          META_BALANCE.rewardLearningBase.value +
            META_BALANCE.rewardLearningPerReview.value *
              reviews.filter((r) => r === 'missed_adjustable').length,
        )
      : 0;
  let reviewBonus = 0;
  let reviewBonusKind: RunRewardBreakdown['reviewBonusKind'] = null;
  if (input.won && reviews.some((r) => r === 'exceeded')) {
    reviewBonus = META_BALANCE.rewardReviewExceeded.value;
    reviewBonusKind = 'exceeded';
  } else if (input.won && reviews.includes('met')) {
    reviewBonus = META_BALANCE.rewardReviewMet.value;
    reviewBonusKind = 'met';
  }
  return {
    base,
    learningBonus,
    reviewBonus,
    reviewBonusKind,
    total: base + learningBonus + reviewBonus,
    granted: true,
  };
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs));

export type { AchievementDef } from '../data/achievements';
export { ACHIEVEMENT_DEFS } from '../data/achievements';

/** 勝利称号の宣言的定義（コレクション表示・獲得条件ヒント）。 */
export interface WinTitleDef {
  id: WinType;
  label: string;
  description: string;
  hint: string;
}

const WIN_TITLE_HINTS: Record<WinType, string> = {
  normal: 'ボスを突破して四半期を完遂する',
  healthy: '出荷・品質・士気をすべて高く保ってボスを突破する',
  aiSuccess:
    'AI 利用率を高め、AI リテラシー 40 以上を維持しつつ、手戻りとレビュー渋滞を抑えてボスを突破する',
  management: '予算を十分に残し、他の勝利種別の条件を満たさずにボスを突破する',
  happiness: 'Morale とシニア体力を高く保ってボスを突破する',
  chaos: '障害を乗り越えて高い出荷を達成し、ボスを突破する',
  noDamage:
    '残業・アンドン未使用・延焼ゼロ・手戻り率15%未満に加え、品質・士気・シニア体力を高水準で保ち健全系診断でボスを突破する',
};

const WIN_TYPE_ORDER: readonly WinType[] = [
  'normal',
  'healthy',
  'aiSuccess',
  'management',
  'happiness',
  'chaos',
  'noDamage',
];

export const WIN_TITLE_DEFS: readonly WinTitleDef[] = WIN_TYPE_ORDER.map((id) => ({
  id,
  ...winView(id),
  hint: WIN_TITLE_HINTS[id],
}));

/** 実績 ID の表示名（後方互換。コレクション要素。第17章）。 */
export const ACHIEVEMENT_LABEL: Record<string, string> = Object.fromEntries(
  ACHIEVEMENT_DEFS.map((a) => [a.id, a.label]),
);

/**
 * 1 ラン分の結果をメタ進行へ反映した新しい `MetaState` を返す（不変）。
 * 勝利時のみ難易度解放・ボス撃破記録・実績解除が進む。
 */
export function applyRunReward(meta: MetaState, input: RunRewardInput): MetaState {
  const gained = computeRunRewardBreakdown(input).total;
  const next: MetaState = {
    points: meta.points + gained,
    unlockedDifficulties: [...meta.unlockedDifficulties],
    defeatedBosses: [...meta.defeatedBosses],
    achievements: [...meta.achievements],
    collectedWinTypes: [...meta.collectedWinTypes],
    collectedDiagnoses: mergeCollectedDiagnoses(meta.collectedDiagnoses, input.diagnosis),
    bestScore: Math.max(meta.bestScore, input.score),
    unlockedCards: [...meta.unlockedCards],
    unlockedRelics: [...meta.unlockedRelics],
    preferredCardIds: [...meta.preferredCardIds],
    dailyRuns: { ...meta.dailyRuns },
    soundMuted: meta.soundMuted,
    seenTutorial: meta.seenTutorial,
    seenTutorialVersion: meta.seenTutorialVersion,
  };

  if (input.won) {
    if (input.bossId) next.defeatedBosses = uniq([...next.defeatedBosses, input.bossId]);
    const unlock = nextDifficulty(input.difficulty);
    if (unlock && !next.unlockedDifficulties.includes(unlock)) {
      next.unlockedDifficulties.push(unlock);
    }
    const earned: string[] = [ACHIEVEMENT_IDS.firstClear];
    if (input.winType)
      next.collectedWinTypes = uniq([...next.collectedWinTypes, input.winType]) as WinType[];
    if (input.winType === 'noDamage') earned.push(ACHIEVEMENT_IDS.noDamage);
    if (input.maxCombo >= META_BALANCE.achievementComboMasterMinCombo.value)
      earned.push(ACHIEVEMENT_IDS.comboMaster);
    if (input.difficulty === 'nightmare') earned.push(ACHIEVEMENT_IDS.nightmareClear);
    if (allBossesDefeated(next.defeatedBosses, ALL_BOSSES)) earned.push(ACHIEVEMENT_IDS.allBosses);
    const reviews = input.quarterReviews ?? [];
    if (reviews.includes('exceeded')) earned.push(ACHIEVEMENT_IDS.reviewExceeded);
    if (reviews.includes('missed_adjustable')) earned.push(ACHIEVEMENT_IDS.reviewSurvivor);
    next.achievements = uniq([...next.achievements, ...earned]);
  }

  return next;
}

export interface DailyRunRewardResult {
  meta: MetaState;
  /** 今回付与されたメタ進行 points（再走時は 0）。 */
  pointsGained: number;
  /** 同日・同一ルールセットで初回の報酬付与が行われたか。 */
  rewardGranted: boolean;
  /** その日のベストスコアが更新されたか。 */
  dailyBestUpdated: boolean;
  /** 今回のメタ進行ポイント内訳（再走時は total 0 / granted false）。 */
  breakdown: RunRewardBreakdown;
}

/**
 * デイリーラン結果をメタ進行へ反映する（不変）。
 * 同一 UTC 日付・同一ルールセットでは points 付与は 1 回のみ。
 * 再走はベスト更新と勝利称号収集のみ。
 */
export function applyDailyRunReward(
  meta: MetaState,
  input: RunRewardInput & { dateStr: string; ruleset?: RunRulesetIdentity },
): DailyRunRewardResult {
  const ruleset = input.ruleset ?? CURRENT_RUN_RULESET;
  const entryKey = dailyRunKey(input.dateStr, ruleset);
  const existing = meta.dailyRuns[entryKey] ?? { bestScore: 0, rewardClaimed: false };

  if (!existing.rewardClaimed) {
    const rewarded = applyRunReward(meta, input);
    const breakdown = computeRunRewardBreakdown(input);
    const dailyBest = Math.max(existing.bestScore, input.score);
    const next: MetaState = {
      ...rewarded,
      dailyRuns: {
        ...meta.dailyRuns,
        [entryKey]: { bestScore: dailyBest, rewardClaimed: true },
      },
    };
    return {
      meta: next,
      pointsGained: rewarded.points - meta.points,
      rewardGranted: true,
      dailyBestUpdated: dailyBest > existing.bestScore,
      breakdown,
    };
  }

  const dailyBest = Math.max(existing.bestScore, input.score);
  const dailyBestUpdated = dailyBest > existing.bestScore;
  const collectedWinTypes =
    input.won && input.winType
      ? (uniq([...meta.collectedWinTypes, input.winType]) as WinType[])
      : [...meta.collectedWinTypes];
  const next: MetaState = {
    ...meta,
    bestScore: Math.max(meta.bestScore, input.score),
    collectedWinTypes,
    collectedDiagnoses: mergeCollectedDiagnoses(meta.collectedDiagnoses, input.diagnosis),
    dailyRuns: {
      ...meta.dailyRuns,
      [entryKey]: { bestScore: dailyBest, rewardClaimed: true },
    },
  };
  return {
    meta: next,
    pointsGained: 0,
    rewardGranted: false,
    dailyBestUpdated,
    breakdown: {
      base: 0,
      learningBonus: 0,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 0,
      granted: false,
    },
  };
}

function allBossesDefeated(defeated: string[], bosses: typeof BOSS_DEFS): boolean {
  return bosses.every((b) => defeated.includes(b.id));
}

/** 既定解放 ∪ メタ購入済みのコンテンツ集合。 */
export function unlockedContent(meta: MetaState): UnlockedContent {
  const cards = new Set(defaultUnlockedCardIds());
  for (const id of meta.unlockedCards) cards.add(id);
  const relics = new Set(defaultUnlockedRelicIds());
  for (const id of meta.unlockedRelics) relics.add(id);
  return { cards, relics };
}

function isUnlockOwned(meta: MetaState, unlock: UnlockDef): boolean {
  if (unlock.kind === 'card') return meta.unlockedCards.includes(unlock.contentId);
  return meta.unlockedRelics.includes(unlock.contentId);
}

/** points を消費してコンテンツを永続解放する（不変更新）。 */
export function purchaseUnlock(meta: MetaState, unlockId: string): PurchaseUnlockResult {
  const unlock = getUnlock(unlockId);
  if (!unlock) return { meta, ok: false, reason: 'unknown' };
  if (isUnlockOwned(meta, unlock)) return { meta, ok: false, reason: 'already_owned' };
  if (unlock.requires && !meta.achievements.includes(unlock.requires)) {
    return { meta, ok: false, reason: 'requires' };
  }
  if (meta.points < unlock.cost) return { meta, ok: false, reason: 'insufficient_points' };

  const next: MetaState = {
    ...meta,
    points: meta.points - unlock.cost,
    unlockedCards: [...meta.unlockedCards],
    unlockedRelics: [...meta.unlockedRelics],
  };

  if (unlock.kind === 'card') next.unlockedCards = uniq([...next.unlockedCards, unlock.contentId]);
  else next.unlockedRelics = uniq([...next.unlockedRelics, unlock.contentId]);

  return { meta: next, ok: true };
}
