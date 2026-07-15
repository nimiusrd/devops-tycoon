/**
 * ランのフェーズ遷移表（単一の真実源。SPEC 第3章 / 第22.1 / RI-39）。
 *
 * **固定トラック（スプリント列）＋スプリント間ビート**の正当な遷移を純TSデータで定義する。
 * 編成（setup）→ スプリント → リザルト → ドラフト → 進化 → ビート（判定/選択）→ 次スプリント …
 * → ボススプリント → 四半期レビュー → 勝敗/継続。ショップ/休息はビートの選択から到達する。
 *
 * この表を `RunEngine.setPhase()`（実ランタイムの遷移検証）と
 * `src/state/runMachine.ts`（XState マシン生成。契約テスト/可視化用）の両方が参照することで、
 * フェーズ遷移の二重管理を防ぐ。sim 層の純TS・XState 非依存は維持する（第22.3）。
 */
import type { RunPhase } from './types';

/** 遷移イベント名の一覧（表とマシンで共有する）。 */
export const RUN_EVENT_TYPES = [
  'START',
  'BEGIN',
  'ENTER_SPRINT',
  'ENTER_SHOP',
  'ENTER_REST',
  'SPRINT_DONE',
  'BOSS_REVIEW',
  'LOST',
  'ACK',
  'NEXT',
  'FINISH',
  'RESOLVE',
  'REVIEW_WON',
  'REVIEW_CONTINUE',
  'REVIEW_LOST',
] as const;

/** 遷移イベント名。 */
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** 全フェーズの一覧（`RunPhase` の網羅を型で強制する）。 */
export const RUN_PHASES: readonly RunPhase[] = [
  'title',
  'setup',
  'sprint',
  'result',
  'draft',
  'evolution',
  'beat',
  'shop',
  'rest',
  'quarterReview',
  'won',
  'lost',
] satisfies readonly RunPhase[];

/** 終端フェーズ（出エッジを持たない。XState では final state になる）。 */
export const FINAL_PHASES: ReadonlySet<RunPhase> = new Set<RunPhase>(['won', 'lost']);

/**
 * フェーズ遷移表: `from` フェーズで `event` が起きると `to` フェーズへ移る。
 * `Record<RunPhase, ...>` の網羅性により、フェーズ追加時はこの表への行追加が
 * コンパイルエラーで強制される。
 *
 * 進行中の全フェーズに `LOST` を張る（予算枯渇などの即時敗北はレバー発動等の
 * ガード無し経路からも起きるため。`applyImmediateLose` / `applyOrgLever` 参照）。
 */
export const RUN_PHASE_TRANSITIONS: Readonly<
  Record<RunPhase, Partial<Readonly<Record<RunEventType, RunPhase>>>>
> = {
  // ラン開始直後は編成（Setup）。いきなり盤面を走らせない。
  title: { START: 'setup' },
  // setup は第1スプリント前の編成、かつショップ/休息後・次四半期の編成入口（setup-pre）も兼ねる。
  setup: { BEGIN: 'sprint', LOST: 'lost' },
  sprint: { SPRINT_DONE: 'result', BOSS_REVIEW: 'quarterReview', LOST: 'lost' },
  result: { ACK: 'draft', LOST: 'lost' },
  draft: { NEXT: 'evolution', LOST: 'lost' },
  evolution: { FINISH: 'beat', LOST: 'lost' },
  beat: {
    ENTER_SPRINT: 'sprint',
    ENTER_SHOP: 'shop',
    ENTER_REST: 'rest',
    LOST: 'lost',
  },
  // 購入・採用で予算枯渇した場合は編成へ戻らず lost へ。
  shop: { RESOLVE: 'setup', LOST: 'lost' },
  rest: { RESOLVE: 'setup', LOST: 'lost' },
  quarterReview: { REVIEW_WON: 'won', REVIEW_CONTINUE: 'setup', REVIEW_LOST: 'lost', LOST: 'lost' },
  won: {},
  lost: {},
};

/** 表から導出した (from → to) エッジ集合（イベント名は問わない到達可否）。 */
const TRANSITION_EDGES: ReadonlySet<string> = new Set(
  RUN_PHASES.flatMap((from) =>
    Object.values(RUN_PHASE_TRANSITIONS[from]).map((to) => `${from}→${to}`),
  ),
);

/** `from` から `to` への遷移が遷移表で許可されているか。 */
export function canTransition(from: RunPhase, to: RunPhase): boolean {
  return TRANSITION_EDGES.has(`${from}→${to}`);
}

/** 遷移表に無いフェーズ遷移を検知したときのエラー（エンジン実装のバグを示す）。 */
export class RunPhaseError extends Error {
  constructor(
    readonly from: RunPhase,
    readonly to: RunPhase,
  ) {
    super(`不正なフェーズ遷移: ${from} → ${to}（RUN_PHASE_TRANSITIONS に無い遷移）`);
    this.name = 'RunPhaseError';
  }
}
