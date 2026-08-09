/**
 * メタ進行とアンロック（SPEC 第17章）。
 *
 * ランをまたいで蓄積する進行。ボス撃破でメタ進行ポイント・難易度解放・実績を
 * 得る。ロジックは純関数に保ち、永続化は metaPersistence.ts に分離する。
 */
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

/**
 * 現行チュートリアル内容の版（RI-67）。
 * `src/ui/tutorial.ts` のガイド内容と同期させる。
 */
export const TUTORIAL_CONTENT_VERSION = 3;

/** 旧 RI-60（3ステップ）完了セーブの版。 */
export const LEGACY_TUTORIAL_VERSION = 1;

/** 旧 localStorage の移行と互換テストに使う最小インターフェース。 */
export interface LegacyMetaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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
  /** UTC 日付（YYYY-MM-DD）→ デイリーラン記録。 */
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

/** 研修方針で選べる優先施策の上限（RI-34⁗）。 */
export const MAX_PREFERRED_CARDS = 2;

/** 1 日分のデイリーラン記録（第23章）。 */
export interface DailyRunRecord {
  /** その日のベストスコア（出荷ポイント）。 */
  bestScore: number;
  /** その日のメタ進行 points 報酬を受け取り済みか。 */
  rewardClaimed: boolean;
}

/** 業界画面に表示する、順位付きデイリー記録。 */
export interface DailyLeaderboardEntry extends DailyRunRecord {
  dateStr: string;
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
    unlockedDifficulties: ['easy', 'normal'],
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
export function sanitizePreferredCardIds(ids: unknown, allowed?: ReadonlySet<string>): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== 'string' || !raw || seen.has(raw)) continue;
    if (allowed && !allowed.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= MAX_PREFERRED_CARDS) break;
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
    soundMuted: typeof rest.soundMuted === 'boolean' ? rest.soundMuted : true,
    seenTutorialVersion,
    seenTutorial: seenTutorialVersion >= TUTORIAL_CONTENT_VERSION || rest.seenTutorial === true,
  };
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

/** デイリーランの固定難易度・試練（全員同一条件）。 */
export const DAILY_RUN_DIFFICULTY: DifficultyId = 'normal';
export const DAILY_RUN_TRIALS: readonly string[] = [];

/** UTC 日付文字列（YYYY-MM-DD）。 */
export function utcDateStr(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 日付から決定論シードを導出する（同一日は全員同じ seed）。 */
export function dailySeed(dateStr: string): string {
  return `daily-${dateStr}`;
}

/** 指定日のデイリー記録を返す（未プレイは undefined）。 */
export function getDailyRecord(meta: MetaState, dateStr: string): DailyRunRecord | undefined {
  return meta.dailyRuns[dateStr];
}

/**
 * 自分のデイリー記録をベストスコア順の擬似リーダーボードにする。
 * 同点は新しい UTC 日付を上位とし、表示順を決定論的に保つ。
 */
export function dailyLeaderboardEntries(meta: MetaState): DailyLeaderboardEntry[] {
  return Object.entries(meta.dailyRuns)
    .map(([dateStr, record]) => ({ dateStr, ...record }))
    .sort((a, b) => b.bestScore - a.bestScore || b.dateStr.localeCompare(a.dateStr))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];

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
  const base = Math.round((input.won ? 20 : 5) * Math.max(1, input.scoreMul));
  const learningBonus =
    !input.won && reviews.some((r) => r === 'missed_adjustable')
      ? Math.min(5, 2 + reviews.filter((r) => r === 'missed_adjustable').length)
      : 0;
  let reviewBonus = 0;
  let reviewBonusKind: RunRewardBreakdown['reviewBonusKind'] = null;
  if (input.won && reviews.some((r) => r === 'exceeded')) {
    reviewBonus = 3;
    reviewBonusKind = 'exceeded';
  } else if (input.won && reviews.includes('met')) {
    reviewBonus = 1;
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

/** 実績の宣言的定義（コレクション表示・獲得条件ヒント。第17章）。 */
export interface AchievementDef {
  id: string;
  label: string;
  /** 未取得時に表示する獲得条件のヒント。 */
  hint: string;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  {
    id: 'first-clear',
    label: '初クリア',
    hint: 'いずれかの難易度で四半期（ボス）を突破する',
  },
  {
    id: 'no-damage',
    label: 'ノーダメージ突破',
    hint: '残業・アンドン未使用・延焼ゼロ・手戻り率15%未満に加え、品質・士気・シニア体力を高水準で保ち健全系診断でボスを突破する（ノーダメージ勝利）',
  },
  {
    id: 'combo-master',
    label: 'コンボ x20 達成',
    hint: '1 ラン中にコンボ x20 以上を達成してからボスを突破する',
  },
  {
    id: 'all-bosses',
    label: '全ボス撃破',
    hint: 'すべてのボスを少なくとも 1 回ずつ撃破する',
  },
  {
    id: 'nightmare-clear',
    label: 'Nightmare 制覇',
    hint: 'Nightmare 難易度で四半期を突破する',
  },
  {
    id: 'review-exceeded',
    label: '超過達成クリア',
    hint: '四半期レビューで超過達成（exceeded）を出してランを勝利する',
  },
  {
    id: 'review-survivor',
    label: '目標修正からの生還',
    hint: '四半期レビューで目標修正（missed_adjustable）を経験したうえでランを勝利する',
  },
];

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
  management: '予算に余裕を残してボスを突破する',
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
    const earned: string[] = ['first-clear'];
    if (input.winType)
      next.collectedWinTypes = uniq([...next.collectedWinTypes, input.winType]) as WinType[];
    if (input.winType === 'noDamage') earned.push('no-damage');
    if (input.maxCombo >= 20) earned.push('combo-master');
    if (input.difficulty === 'nightmare') earned.push('nightmare-clear');
    if (allBossesDefeated(next.defeatedBosses, ALL_BOSSES)) earned.push('all-bosses');
    const reviews = input.quarterReviews ?? [];
    if (reviews.includes('exceeded')) earned.push('review-exceeded');
    if (reviews.includes('missed_adjustable')) earned.push('review-survivor');
    next.achievements = uniq([...next.achievements, ...earned]);
  }

  return next;
}

export interface DailyRunRewardResult {
  meta: MetaState;
  /** 今回付与されたメタ進行 points（再走時は 0）。 */
  pointsGained: number;
  /** その日初回の報酬付与が行われたか。 */
  rewardGranted: boolean;
  /** その日のベストスコアが更新されたか。 */
  dailyBestUpdated: boolean;
  /** 今回のメタ進行ポイント内訳（再走時は total 0 / granted false）。 */
  breakdown: RunRewardBreakdown;
}

/**
 * デイリーラン結果をメタ進行へ反映する（不変）。
 * 同一 UTC 日付では points 付与は 1 回のみ。再走はベスト更新と勝利称号収集のみ。
 */
export function applyDailyRunReward(
  meta: MetaState,
  input: RunRewardInput & { dateStr: string },
): DailyRunRewardResult {
  const existing = meta.dailyRuns[input.dateStr] ?? { bestScore: 0, rewardClaimed: false };

  if (!existing.rewardClaimed) {
    const rewarded = applyRunReward(meta, input);
    const breakdown = computeRunRewardBreakdown(input);
    const dailyBest = Math.max(existing.bestScore, input.score);
    const next: MetaState = {
      ...rewarded,
      dailyRuns: {
        ...meta.dailyRuns,
        [input.dateStr]: { bestScore: dailyBest, rewardClaimed: true },
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
      [input.dateStr]: { bestScore: dailyBest, rewardClaimed: true },
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

/** メタ状態を読み込む（壊れていれば初期値）。SSR/未対応環境では初期値。 */
export function loadMeta(storage: LegacyMetaStorage | null = browserStorage()): MetaState {
  if (!storage) return defaultMeta();
  try {
    const raw = storage.getItem(LEGACY_META_STORAGE_KEY);
    if (!raw) return defaultMeta();
    return parseLegacyMeta(raw) ?? defaultMeta();
  } catch {
    return defaultMeta();
  }
}

/** メタ状態を保存する（未対応環境では黙って何もしない）。 */
export function saveMeta(
  meta: MetaState,
  storage: LegacyMetaStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LEGACY_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // 容量超過・プライベートモード等は無視（ゲーム進行を止めない）。
  }
}

/**
 * ブラウザの localStorage（非対応環境では null）。
 *
 * 戻り値は `LegacyMetaStorage` ではなく実体の `Storage` を返す。
 * 利用側で必要なメソッドが違う（meta は読み書きのみ、metaPersistence は
 * 移行後の削除も要る）ため、狭い型で返すと利用側ごとに同じ実装を
 * 複製することになる。
 */
export function browserStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // アクセス自体が例外になる環境がある。
  }
  return null;
}
