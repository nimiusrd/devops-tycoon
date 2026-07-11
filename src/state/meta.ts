/**
 * メタ進行とアンロック（SPEC 第17章）。
 *
 * ランをまたいで蓄積する進行。ボス撃破でメタ進行ポイント・難易度解放・実績を
 * 得る。永続化は localStorage（architecture §1）。ロジックは純関数に保ち、
 * ストレージは差し替え可能なインターフェースで受けてテスト可能にする。
 */
import type { BOSS_DEFS } from '../data/bosses';
import { BOSS_DEFS as ALL_BOSSES } from '../data/bosses';
import {
  defaultUnlockedCardIds,
  defaultUnlockedRelicIds,
  getUnlock,
  type UnlockDef,
} from '../data/unlocks';
import type { DifficultyId, QuarterOutcome, WinType } from '../sim/run/types';

/** localStorage 等の最小インターフェース（テストでモック可能）。 */
export interface MetaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'devops-tycoon:meta:v1';

export interface MetaState {
  /** 累積メタ進行ポイント。 */
  points: number;
  /** 解放済み難易度。 */
  unlockedDifficulties: DifficultyId[];
  /** 撃破したボス ID（重複なし）。 */
  defeatedBosses: string[];
  /** 解除済み実績 ID。 */
  achievements: string[];
  /** 自己ベストスコア。 */
  bestScore: number;
  /** メタショップで購入済みのカード定義 ID。 */
  unlockedCards: string[];
  /** メタショップで購入済みのレリック定義 ID。 */
  unlockedRelics: string[];
  /** メタショップで購入済みの開始プリセット ID（将来用）。 */
  unlockedPresets: string[];
  /** UTC 日付（YYYY-MM-DD）→ デイリーラン記録。 */
  dailyRuns: Record<string, DailyRunRecord>;
}

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
  presets: ReadonlySet<string>;
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
    bestScore: 0,
    unlockedCards: [],
    unlockedRelics: [],
    unlockedPresets: [],
    dailyRuns: {},
  };
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
    hint: '残業・アンドンを使わず延焼ゼロでボスを突破する（ノーダメージ勝利）',
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
];

/** 実績 ID の表示名（後方互換。コレクション要素。第17章）。 */
export const ACHIEVEMENT_LABEL: Record<string, string> = Object.fromEntries(
  ACHIEVEMENT_DEFS.map((a) => [a.id, a.label]),
);

/**
 * 1 ラン分の結果をメタ進行へ反映した新しい `MetaState` を返す（不変）。
 * 勝利時のみ難易度解放・ボス撃破記録・実績解除が進む。
 */
export function applyRunReward(meta: MetaState, input: RunRewardInput): MetaState {
  const reviews = input.quarterReviews ?? [];
  const learningBonus =
    !input.won && reviews.some((r) => r === 'missed_adjustable')
      ? Math.min(5, 2 + reviews.filter((r) => r === 'missed_adjustable').length)
      : 0;
  const exceededBonus =
    input.won && reviews.some((r) => r === 'exceeded')
      ? 3
      : input.won && reviews.includes('met')
        ? 1
        : 0;
  const gained =
    Math.round((input.won ? 20 : 5) * Math.max(1, input.scoreMul)) + learningBonus + exceededBonus;
  const next: MetaState = {
    points: meta.points + gained,
    unlockedDifficulties: [...meta.unlockedDifficulties],
    defeatedBosses: [...meta.defeatedBosses],
    achievements: [...meta.achievements],
    bestScore: Math.max(meta.bestScore, input.score),
    unlockedCards: [...meta.unlockedCards],
    unlockedRelics: [...meta.unlockedRelics],
    unlockedPresets: [...meta.unlockedPresets],
    dailyRuns: { ...meta.dailyRuns },
  };

  if (input.won) {
    if (input.bossId) next.defeatedBosses = uniq([...next.defeatedBosses, input.bossId]);
    const unlock = nextDifficulty(input.difficulty);
    if (unlock && !next.unlockedDifficulties.includes(unlock)) {
      next.unlockedDifficulties.push(unlock);
    }
    const earned: string[] = ['first-clear'];
    if (input.winType === 'noDamage') earned.push('no-damage');
    if (input.maxCombo >= 20) earned.push('combo-master');
    if (input.difficulty === 'nightmare') earned.push('nightmare-clear');
    if (allBossesDefeated(next.defeatedBosses, ALL_BOSSES)) earned.push('all-bosses');
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
}

/**
 * デイリーラン結果をメタ進行へ反映する（不変）。
 * 同一 UTC 日付では points 付与は 1 回のみ。再走はベスト更新のみ。
 */
export function applyDailyRunReward(
  meta: MetaState,
  input: RunRewardInput & { dateStr: string },
): DailyRunRewardResult {
  const existing = meta.dailyRuns[input.dateStr] ?? { bestScore: 0, rewardClaimed: false };

  if (!existing.rewardClaimed) {
    const rewarded = applyRunReward(meta, input);
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
    };
  }

  const dailyBest = Math.max(existing.bestScore, input.score);
  const dailyBestUpdated = dailyBest > existing.bestScore;
  const next: MetaState = {
    ...meta,
    bestScore: Math.max(meta.bestScore, input.score),
    dailyRuns: {
      ...meta.dailyRuns,
      [input.dateStr]: { bestScore: dailyBest, rewardClaimed: true },
    },
  };
  return { meta: next, pointsGained: 0, rewardGranted: false, dailyBestUpdated };
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
  const presets = new Set(meta.unlockedPresets);
  return { cards, relics, presets };
}

function isUnlockOwned(meta: MetaState, unlock: UnlockDef): boolean {
  if (unlock.kind === 'card') return meta.unlockedCards.includes(unlock.contentId);
  if (unlock.kind === 'relic') return meta.unlockedRelics.includes(unlock.contentId);
  return meta.unlockedPresets.includes(unlock.contentId);
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
    unlockedPresets: [...meta.unlockedPresets],
  };

  if (unlock.kind === 'card') next.unlockedCards = uniq([...next.unlockedCards, unlock.contentId]);
  else if (unlock.kind === 'relic')
    next.unlockedRelics = uniq([...next.unlockedRelics, unlock.contentId]);
  else next.unlockedPresets = uniq([...next.unlockedPresets, unlock.contentId]);

  return { meta: next, ok: true };
}

/** メタ状態を読み込む（壊れていれば初期値）。SSR/未対応環境では初期値。 */
export function loadMeta(storage: MetaStorage | null = browserStorage()): MetaState {
  if (!storage) return defaultMeta();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaultMeta();
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    return { ...defaultMeta(), ...parsed };
  } catch {
    return defaultMeta();
  }
}

/** メタ状態を保存する（未対応環境では黙って何もしない）。 */
export function saveMeta(meta: MetaState, storage: MetaStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // 容量超過・プライベートモード等は無視（ゲーム進行を止めない）。
  }
}

/** ブラウザの localStorage（非対応環境では null）。 */
export function browserStorage(): MetaStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // アクセス自体が例外になる環境がある。
  }
  return null;
}
