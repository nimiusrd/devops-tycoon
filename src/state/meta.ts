/**
 * メタ進行とアンロック（SPEC 第17章）。
 *
 * ランをまたいで蓄積する進行。ボス撃破でメタ進行ポイント・難易度解放・実績を
 * 得る。永続化は localStorage（architecture §1）。ロジックは純関数に保ち、
 * ストレージは差し替え可能なインターフェースで受けてテスト可能にする。
 */
import type { BOSS_DEFS } from '../data/bosses';
import { BOSS_DEFS as ALL_BOSSES } from '../data/bosses';
import type { DifficultyId, WinType } from '../sim/run/types';

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
}

/** 初期メタ状態（easy/normal は最初から解放）。 */
export function defaultMeta(): MetaState {
  return {
    points: 0,
    unlockedDifficulties: ['easy', 'normal'],
    defeatedBosses: [],
    achievements: [],
    bestScore: 0,
  };
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
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs));

/** 実績 ID の表示名（コレクション要素。第17章）。 */
export const ACHIEVEMENT_LABEL: Record<string, string> = {
  'first-clear': '初クリア',
  'no-damage': 'ノーダメージ突破',
  'combo-master': 'コンボ x20 達成',
  'all-bosses': '全ボス撃破',
  'nightmare-clear': 'Nightmare 制覇',
};

/**
 * 1 ラン分の結果をメタ進行へ反映した新しい `MetaState` を返す（不変）。
 * 勝利時のみ難易度解放・ボス撃破記録・実績解除が進む。
 */
export function applyRunReward(meta: MetaState, input: RunRewardInput): MetaState {
  const gained = Math.round((input.won ? 20 : 5) * Math.max(1, input.scoreMul));
  const next: MetaState = {
    points: meta.points + gained,
    unlockedDifficulties: [...meta.unlockedDifficulties],
    defeatedBosses: [...meta.defeatedBosses],
    achievements: [...meta.achievements],
    bestScore: Math.max(meta.bestScore, input.score),
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

function allBossesDefeated(defeated: string[], bosses: typeof BOSS_DEFS): boolean {
  return bosses.every((b) => defeated.includes(b.id));
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
