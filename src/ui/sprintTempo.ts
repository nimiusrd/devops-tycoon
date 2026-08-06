/**
 * スプリント実時間テンポ（RI-62 / RI-66 / SPEC §3.1）。
 *
 * sim の tick（FIXED_STEP_MS=100）は変更せず、UI 層の壁時計→tick 換算だけを担う。
 * 1x 基準でスプリント 60〜120 秒帯（最短 30 秒以上）を狙う。
 * 四半期・ラン・介入回数の帯定数もここに置き、統計テストと共有する。
 */

/** 自動進行のポーリング間隔（ms）。UI 同期とアキュムレータ更新に使う。 */
export const FRAME_MS = 50;

/** 1 tick に対応するシミュレーション時間（ms）。`FIXED_STEP_MS` と一致させる。 */
export const SIM_STEP_MS = 100;

/**
 * 1x 再生時の実時間/tick（ms）。
 * RI-75: 難易度別タスク量と組み合わせ、F-4 代表方針の p50 を §3.1 帯へ寄せる。
 */
export const MS_PER_TICK_1X = 780;

/** プレイヤー向け再生速度。0=一時停止、1=1x、2=2x。 */
export type PlaybackSpeed = 0 | 1 | 2;

/** 1 ポーリングで追いつく最大 tick 数（タブ復帰時の飛び過ぎ防止）。 */
export const MAX_TICKS_PER_FRAME = 4;

/**
 * アキュムレータへ積める実時間の上限（ms）。
 * タブ復帰などで `deltaMs` が膨らんでも、1 フレーム分以上は捨てる。
 */
export function maxAccumulatorMs(speed: PlaybackSpeed): number {
  if (speed <= 0) return 0;
  return MAX_TICKS_PER_FRAME * msPerTick(speed);
}

/**
 * 壁時計差分をアキュムレータへ足す。上限を超えた分は破棄する（タブ復帰対策）。
 */
export function accumulateWallTime(
  accumulatedMs: number,
  deltaMs: number,
  speed: PlaybackSpeed,
): number {
  if (speed <= 0 || deltaMs <= 0) return 0;
  return Math.min(accumulatedMs + deltaMs, maxAccumulatorMs(speed));
}

/** §3.1: 通常スプリントの 1x 実時間レンジ（秒）。 */
export const SPRINT_WALL_SEC = { minTypical: 60, maxTypical: 120, absoluteMin: 30 } as const;

/** §3.1: ボススプリントの 1x 実時間レンジ（秒）。 */
export const BOSS_WALL_SEC = { min: 90, max: 180 } as const;

/**
 * §3.1: スプリント間（リザルト→ドラフト→進化→ビート）の標準操作秒。
 * プレイヤー任意（目安 30〜60）のため、回帰検知では帯内の標準操作 35 秒を固定加算する。
 */
export const BETWEEN_SPRINT_WALL_SEC = 35;

/**
 * §3.1: 四半期レビューの標準操作秒（意思決定の目安。回帰検知用モデル）。
 */
export const QUARTER_REVIEW_WALL_SEC = 45;

/** §3.1: 1 四半期（スプリント 6 本＋レビュー）の 1x 実時間レンジ（分）。 */
export const QUARTER_WALL_MIN = { minMin: 10, maxMin: 15 } as const;

/** §3.1: 1 ラン（1〜複数四半期）の 1x 実時間レンジ（分）。 */
export const RUN_WALL_MIN = { minMin: 15, maxMin: 45 } as const;

/** §3.1: 1 スプリントあたり介入回数の期待レンジ。 */
export const INTERVENTION_PER_SPRINT = { min: 3, max: 8 } as const;

/**
 * 指定再生速度での実時間/tick（ms）。
 * pause（0）は Infinity（進めない）。
 */
export function msPerTick(speed: PlaybackSpeed): number {
  if (speed <= 0) return Number.POSITIVE_INFINITY;
  return MS_PER_TICK_1X / speed;
}

/**
 * 壁時計アキュムレータから進める tick 数を計算する。
 * 戻り値の `consumedMs` をアキュムレータから差し引く。
 */
export function ticksDueFromAccumulator(
  accumulatedMs: number,
  speed: PlaybackSpeed,
  maxTicks: number = MAX_TICKS_PER_FRAME,
): { ticks: number; consumedMs: number } {
  if (speed <= 0 || accumulatedMs <= 0) return { ticks: 0, consumedMs: 0 };
  const perTick = msPerTick(speed);
  const raw = Math.floor(accumulatedMs / perTick);
  const ticks = Math.min(maxTicks, Math.max(0, raw));
  return { ticks, consumedMs: ticks * perTick };
}

/** tick 数 × 1x テンポから壁時計秒を求める（DoD 検証用）。 */
export function wallSecondsAt1x(ticks: number): number {
  return (ticks * MS_PER_TICK_1X) / 1000;
}

/**
 * 通常スプリントの tick 数が §3.1 のハード下限（最短 30 秒以上）を満たすか。
 * 上限 120 秒は典型帯の目安で、稀な渋滞外れ値は統計（p90）側で見る。
 */
export function meetsSprintAbsoluteMin(ticks: number): boolean {
  return wallSecondsAt1x(ticks) >= SPRINT_WALL_SEC.absoluteMin;
}

/**
 * 通常スプリントの tick 数が §3.1 帯（最短 30 秒以上・120 秒以内）に入るか。
 */
export function isSprintTickCountInSpecBand(ticks: number): boolean {
  const sec = wallSecondsAt1x(ticks);
  return sec >= SPRINT_WALL_SEC.absoluteMin && sec <= SPRINT_WALL_SEC.maxTypical;
}

/** ボススプリントの tick 数が §3.1 帯に入るか。 */
export function isBossTickCountInSpecBand(ticks: number): boolean {
  const sec = wallSecondsAt1x(ticks);
  return sec >= BOSS_WALL_SEC.min && sec <= BOSS_WALL_SEC.max;
}
