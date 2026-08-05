/**
 * プレイテスト用オートプレイ・ハーネス（SPEC 第19.1 の判定基準を計測する）。
 *
 * `RunEngine` の公開 API だけでランを自動プレイし、ラン結果・スプリント結果・
 * 介入の発動可能性・四半期レビューの発火要因を記録する。seed 固定の決定論により、
 * 同じ方針・同じ seed は常に同じ結果を返す（SPEC 第22.3）。
 *
 * `npm test` の対象外。`npm run playtest` から実行し、結果を JSON へ書き出す。
 * バランス変更の前後で同じコマンドを流せば差分を再計測できる。
 */
import { getEvent } from '../../src/data/events';
import { EVOLUTION_NODES } from '../../src/data/evolution';
import { CARD_DEFS } from '../../src/data/cards';
import { RELIC_DEFS } from '../../src/data/relics';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../src/data/unlocks';
import { ALL_ACTION_IDS, canApplyAction } from '../../src/sim/actions';
import { assignableTasks } from '../../src/sim/assignTask';
import { FIXED_STEP_MS } from '../../src/sim/engine';
import { CONSECUTIVE_INCIDENT_SPRINT_CAP, REVIEW_FREEZE_PEAK } from '../../src/sim/outcome';
import { RECRUIT_COST, REST_STAMINA_RECOVER, ROSTER_CAP } from '../../src/sim/member/roster';
import { RunEngine, REST_HEAL, REST_MORALE_HEAL, REST_REPAY } from '../../src/sim/run/engine';
import { foldPassives } from '../../src/sim/run/effects';
import { measureGoalProgress } from '../../src/sim/run/quarterReview';
import { ELITE_TASK_MUL } from '../../src/sim/run/sprintBaselineBuild';
import type {
  GoalAdjustmentId,
  LoseReason,
  RunState,
  StakeholderTrust,
} from '../../src/sim/run/types';
import type { ActionId } from '../../src/sim/types';
import { MS_PER_TICK_1X } from '../../src/ui/sprintTempo';

/** 介入の発動可否を判定するための盤面サマリー。 */
export interface BoardCtx {
  /** Review レーンの件数。 */
  reviewLen: number;
  /** 炎上中（Rework かつ incident）の件数。 */
  burning: number;
  /** Coding レーンの件数。 */
  codingLen: number;
  /** Rework レーンの件数。 */
  reworkLen: number;
  /** 現在 tick。 */
  tick: number;
}

export interface PolicySpec {
  /** 毎ステップ順に試す介入（条件つき）。条件省略は毎回試行。 */
  actions: { id: ActionId; when?: (ctx: BoardCtx) => boolean }[];
  /**
   * 1回の介入判断で進めるシミュレーション時間（ms）。大きいほど反応が鈍い＝初見寄り。
   *
   * **壁時計の間隔ではない。** `RunEngine.step(dtMs)` は `FIXED_STEP_MS`（=100ms）ごとに
   * 1 tick 進めるので、この値は `stepMs / 100` tick に相当する。実 UI の 1x では
   * 1 tick が壁時計 `MS_PER_TICK_1X`（=680ms）なので、換算は
   * `壁時計 = stepMs / 100 * 680`。つまり `300` は3 tick＝約2.0秒、`600` は6 tick＝約4.1秒。
   *
   * 所見へ書くときは必ず `wallClockIntervalSec()` で換算した値を使うこと。
   * 「300ms 刻み」と書くと実際の約7分の1の反応間隔として読まれる。
   */
  stepMs: number;
  /**
   * 手札の使い方。
   * - `none`: 使わない
   * - `always`: 手札を集中力が尽きるまで無差別に発動する
   * - `selective`: 集中力に余裕があり、盤面が切迫していないときだけ発動する
   */
  cards: 'none' | 'always' | 'selective';
  /**
   * 進化ポイントの使い方（解放するブランチの優先順）。
   * - `none`: 使わない
   * - `asListed`: ツリーの定義順（UI 表示順）に上から取る。初見相当
   * - `reviewFirst`: レビュー容量 → 品質 → AI → 文化 → 開発速度
   * - `aiFirst`: AI → 開発速度 → 品質 → レビュー → 文化。AI ビルド
   * - `qualityFirst`: 品質 → レビュー → 文化 → 開発速度 → AI。品質ビルド
   */
  evolve: 'none' | 'asListed' | 'reviewFirst' | 'aiFirst' | 'qualityFirst';
  /**
   * ドラフトの選び方。`first` は提示順の先頭。
   * それ以外は該当キーワードを含むカードを優先し、無ければ先頭を取る。
   */
  draft?: 'first' | 'ai' | 'quality';
  /** 編成フェーズで全員に AI を配る / 誰にも配らない。未指定は既定のまま。 */
  ai?: 'all' | 'none';
  /** 編成フェーズでレビューへ寄せる。 */
  formation?: 'reviewHeavy';
  /**
   * 採用の方針。採用後はいずれもベンチのメンバーを実働レーンへ配置する。
   * - `hire`: 枠と予算がある限り無差別に採る
   * - `skip`: 一切採らない
   * - `selective`: 欠員（休職者あり／実働2名以下）があり、かつ採用後も予算に
   *   余裕（`RECRUIT_COST` 1回分以上）が残るときだけ採る
   *
   * `hire` と `skip` の比較で分かるのは「無差別採用の是非」までで、実プレイヤーの
   * 「必要なときだけ採る」判断は測れない。`selective` はその第3の条件。
   */
  recruit: 'hire' | 'skip' | 'selective';
  /**
   * ショップでのカード・レリック購入。採用枠は `recruit` 側で扱う。
   * - `skipBuy`: 買わない（既定。既存の統制条件を変えないため）
   * - `buy`: 予算に余裕がある範囲でレリック → カードの順に買う
   *
   * F-2 のスプリント間投資にはショップも含まれるが、`skipBuy` だけでは
   * 「投資しない」条件しか測れない。
   */
  shop?: 'skipBuy' | 'buy';
  /**
   * 休息フェーズで採用しないときの選択。`RestScreen` には heal / repay / upgrade がある。
   * - `heal`: 常に回復（既定。既存の統制条件を変えないため）
   * - `stateAware`: 負債が危険域なら `repay`、そうでなければ `heal`
   * - `upgrade`: 常にカード強化
   *
   * 既定が `heal` 固定だと、負債返済とカード強化が一度も選ばれないまま
   * F-2 の「スプリント間投資が結果を変えない」の根拠に使われてしまう。
   */
  rest?: 'heal' | 'stateAware' | 'upgrade';
  /**
   * ビート（スプリント間イベント）の選択肢の選び方。
   * - `firstChoice`: 提示順の先頭。初見相当
   * - `stateAware`: 現在の組織状態を見て、削られたくない資源を減らす選択肢を避ける
   */
  beat?: 'firstChoice' | 'stateAware';
  /** 目標修正の選択（固定）。未指定は提示順の先頭。 */
  goalAdjustment?: GoalAdjustmentId;
  /** 試行順を tick ごとに回転させる（probe の順序バイアス平準化用）。 */
  rotateActions?: boolean;
}

/** `RunEngine.step` の 1 tick 相当（ms）。最小刻みで試行するにはこの値を渡す。 */
export const MS_PER_TICK = FIXED_STEP_MS;

/** `stepMs` を tick 数へ換算する。 */
export const stepTicks = (stepMs: number): number => stepMs / MS_PER_TICK;

/**
 * `stepMs` を実 UI（1x）の壁時計秒へ換算する。
 *
 * 所見に「何秒ごとに判断しているか」を書くときはこれを使う。`stepMs` をそのまま
 * ミリ秒として書くと、実際の約7分の1の反応間隔として読まれる（`MS_PER_TICK_1X` は
 * `MS_PER_TICK` の 6.8 倍のため）。
 */
export const wallClockIntervalSec = (stepMs: number): number =>
  (stepTicks(stepMs) * MS_PER_TICK_1X) / 1000;

/** メタ進行の解放状態。`fresh` は初見（既定解放のみ）、`full` はやり込み後（全解放）。 */
export type MetaProfile = 'fresh' | 'full';

/**
 * 解放コンテンツを実プレイに合わせる（`game.startRun` の `setUnlockedContent` 相当）。
 * 指定しないと `RunEngine` は全コンテンツを候補にしてしまい、初見プレイと条件がずれる。
 */
function unlockedFor(profile: MetaProfile): { cards: Set<string>; relics: Set<string> } {
  if (profile === 'full') {
    return {
      cards: new Set(CARD_DEFS.map((c) => c.id)),
      relics: new Set(RELIC_DEFS.map((r) => r.id)),
    };
  }
  return { cards: new Set(defaultUnlockedCardIds()), relics: new Set(defaultUnlockedRelicIds()) };
}

const SKILLED_ACTIONS: PolicySpec['actions'] = [
  { id: 'firefight', when: (c) => c.burning >= 1 },
  { id: 'interruptReview', when: (c) => c.reviewLen >= 6 },
  { id: 'andon', when: (c) => c.reviewLen >= 10 },
  { id: 'assignTask' },
];

/**
 * 攻略を知っている前提の解放順（レビュー容量 → 品質 → AI → 文化 → 開発速度）。
 * 前提ノードのある上位も含め、解放できるものを順に取る。
 */
const EVOLUTION_ORDER_REVIEW_FIRST = [
  'review-1',
  'review-2',
  'review-3',
  'quality-1',
  'quality-2',
  'quality-3',
  'ai-1',
  'ai-2',
  'ai-3',
  'culture-1',
  'culture-2',
  'culture-3',
  'dev-1',
  'dev-2',
  'dev-3',
];

/**
 * 初見相当の解放順。ツリーの定義順＝UI の表示順に上から取るだけで、
 * どのブランチが有利かの知識を前提にしない。
 */
const EVOLUTION_ORDER_AS_LISTED = EVOLUTION_NODES.map((n) => n.id);

/** ブランチ接頭辞の並びから解放順を組む（各ブランチは 1→2→3 の順）。 */
const orderFromBranches = (branches: readonly string[]): readonly string[] =>
  branches.flatMap((b) => [1, 2, 3].map((n) => `${b}-${n}`));

const EVOLUTION_ORDER_AI_FIRST = orderFromBranches(['ai', 'dev', 'quality', 'review', 'culture']);
const EVOLUTION_ORDER_QUALITY_FIRST = orderFromBranches([
  'quality',
  'review',
  'culture',
  'dev',
  'ai',
]);

function evolutionOrder(mode: PolicySpec['evolve']): readonly string[] {
  switch (mode) {
    case 'reviewFirst':
      return EVOLUTION_ORDER_REVIEW_FIRST;
    case 'aiFirst':
      return EVOLUTION_ORDER_AI_FIRST;
    case 'qualityFirst':
      return EVOLUTION_ORDER_QUALITY_FIRST;
    default:
      return EVOLUTION_ORDER_AS_LISTED;
  }
}

/** ドラフト選好に合うカード ID を選ぶ（無ければ先頭）。 */
const DRAFT_PREFERENCE: Record<'ai' | 'quality', readonly string[]> = {
  ai: ['copilot', 'claude-code', 'devin', 'ai-guideline'],
  quality: ['auto-test', 'pr-size-limit', 'docs', 'review-bot', 'hire-senior'],
};

function pickDraft(offer: readonly string[], mode: PolicySpec['draft']): string {
  if (!mode || mode === 'first') return offer[0];
  const prefer = DRAFT_PREFERENCE[mode];
  return offer.find((id) => prefer.includes(id)) ?? offer[0];
}

function skilledBase(): PolicySpec {
  return {
    actions: SKILLED_ACTIONS,
    stepMs: 300,
    cards: 'always',
    evolve: 'reviewFirst',
    beat: 'stateAware',
    recruit: 'skip',
  };
}

/**
 * 単一介入だけを打つ方針。介入構成**以外**は比較対象の `skilledNoHire` と揃える。
 * 進化順（`reviewFirst`）とビート選択（`stateAware`）を揃えないと、勝率差に進化順や
 * イベント判断の巧拙が混入し、F-1 の判定を介入構成へ帰属できない。
 */
const single = (id: ActionId): PolicySpec => ({
  actions: [{ id }],
  stepMs: 300,
  cards: 'always',
  evolve: 'reviewFirst',
  beat: 'stateAware',
  recruit: 'skip',
});

/** 方針一覧（SPEC 第19.1.3 の観測に対応）。 */
export const POLICY_DEFS: Record<string, PolicySpec> = {
  /** 介入もカードも一切使わない完全放置（下限ベースライン）。 */
  idle: { actions: [], stepMs: 1_000_000, cards: 'none', evolve: 'none', recruit: 'skip' },
  /** 介入なし・カードのみ（F-5 の無介入ベースライン）。 */
  passive: { actions: [], stepMs: 1_000_000, cards: 'always', evolve: 'none', recruit: 'skip' },
  /** 初見想定。異常が目立ってから反応する。 */
  naive: {
    actions: [
      { id: 'firefight', when: (c) => c.burning >= 2 },
      { id: 'interruptReview', when: (c) => c.reviewLen >= 12 },
    ],
    stepMs: 600,
    cards: 'always',
    evolve: 'asListed',
    recruit: 'skip',
  },
  /** 上級者想定。閾値低め＋andon＋差配、採用あり。 */
  skilled: {
    actions: SKILLED_ACTIONS,
    stepMs: 300,
    cards: 'always',
    evolve: 'reviewFirst',
    beat: 'stateAware',
    recruit: 'hire',
  },
  /** skilled から採用だけを外した統制条件。 */
  skilledNoHire: skilledBase(),
  /** skilled から採用とカードを外した統制条件。 */
  skilledNoCards: { ...skilledBase(), cards: 'none' },
  /** 単一介入だけを打ち続ける（F-1 の固定強手検出）。 */
  onlyFirefight: single('firefight'),
  onlyInterrupt: single('interruptReview'),
  onlyOvertime: single('overtime'),
  onlyAndon: single('andon'),
  onlyAssign: single('assignTask'),
  onlySplit: single('splitPr'),
  onlyPair: single('pairReview'),
  onlyThrottle: single('aiThrottle'),
  /**
   * ビルド差分（F-10）。
   *
   * **ビート選択は `stateAware` に揃えてある。** 既定の `firstChoice` のままだと、
   * 比較対象の `skilledNoHire`（`stateAware`）との差へビルド構成だけでなく
   * イベント判断の巧拙が混ざる。実際、揃える前は予算10で `postmortem-culture` が出ると
   * この3方針だけが予算-10（＝残高0で即敗北）の先頭選択肢を取っており、
   * `budgetExhausted` 敗北8件すべてがこの経路だった（RI-90）。
   */
  aiFullBet: {
    actions: SKILLED_ACTIONS.filter((a) => a.id !== 'andon'),
    stepMs: 300,
    cards: 'always',
    evolve: 'aiFirst',
    draft: 'ai',
    ai: 'all',
    beat: 'stateAware',
    recruit: 'hire',
  },
  noAi: {
    actions: SKILLED_ACTIONS.filter((a) => a.id !== 'andon'),
    stepMs: 300,
    cards: 'always',
    evolve: 'qualityFirst',
    draft: 'quality',
    ai: 'none',
    beat: 'stateAware',
    recruit: 'hire',
  },
  reviewHeavy: {
    actions: [{ id: 'firefight', when: (c) => c.burning >= 1 }, { id: 'assignTask' }],
    stepMs: 300,
    cards: 'always',
    evolve: 'reviewFirst',
    formation: 'reviewHeavy',
    beat: 'stateAware',
    recruit: 'hire',
  },
  /**
   * F-5 用の統制条件。`skilledNoHire` から介入だけを外し、
   * カード・進化・採用は揃える（進化条件が違うと分散差を介入に帰属できない）。
   */
  noInterventionCtl: { ...skilledBase(), actions: [] },
  /**
   * RI-77 用の統制条件。`skilledNoHire` から **AI 配布だけ**を外す。
   *
   * ビルド差分の `noAi` は AI に加えて andon の有無・進化ブランチ（`qualityFirst`）・
   * ドラフト選好（`quality`）・採用（`hire`）まで同時に違うため、出荷や勝率の差を
   * AI へ帰属できない。AI の因果を見るにはこちらを使う。
   */
  noAiCtl: { ...skilledBase(), ai: 'none' },
  /** カードを状況に応じて選ぶ方針（無差別発動との比較用。RI-78）。 */
  skilledSelectiveCards: { ...skilledBase(), cards: 'selective' },
  /**
   * 目標修正の選択別の後続差分を見る統制条件（F-2 第4層）。
   * 提示されないときだけ提示順の先頭へフォールバックする。
   */
  adjCutScope: { ...skilledBase(), goalAdjustment: 'cut_scope' },
  adjExtendDeadline: { ...skilledBase(), goalAdjustment: 'extend_deadline' },
  adjQualityPivot: { ...skilledBase(), goalAdjustment: 'quality_pivot' },
  adjRequestBudget: { ...skilledBase(), goalAdjustment: 'request_budget' },
  adjPauseAiRollout: { ...skilledBase(), goalAdjustment: 'pause_ai_rollout' },
  adjReorgTeams: { ...skilledBase(), goalAdjustment: 'reorg_teams' },
  adjStakeholderCare: { ...skilledBase(), goalAdjustment: 'stakeholder_care' },
  /**
   * 採用の第3の条件（欠員があるときだけ採る）。`skilled`（無差別採用）・
   * `skilledNoHire`（一切採らない）と3点で比較する。
   */
  skilledSelectiveHire: { ...skilledBase(), recruit: 'selective' },
  /**
   * ショップでカード・レリックを買う方針（F-2 のスプリント間投資）。
   * 統制先は同条件で買わない `skilledNoHire`。
   */
  skilledShopBuy: { ...skilledBase(), shop: 'buy' },
  /**
   * 休息の選択肢を回復以外にも振る（F-2 のスプリント間投資）。
   * 統制先は常に回復する `skilledNoHire`。
   */
  skilledRestRepay: { ...skilledBase(), rest: 'stateAware' },
  skilledRestUpgrade: { ...skilledBase(), rest: 'upgrade' },
  /**
   * 全介入を 1 tick ごとに試行する（RI-78）。
   *
   * これは「発動可能回数の上限」ではない。8種を順に実際に発動するため、先行アクションが
   * 集中力・盤面を消費して後続の機会を消す。試行順は tick ごとに回転させて順序バイアスを
   * 平準化しているが、あくまで**全介入を同時に撃ち続けた場合の成立数**として読むこと。
   * アクション単体の対象不足は、順序の影響を受けない `onlyXxx` 方針の `no-target` で見る。

   */
  probe: {
    actions: ALL_ACTION_IDS.map((id) => ({ id })),
    stepMs: MS_PER_TICK,
    rotateActions: true,
    cards: 'none',
    evolve: 'reviewFirst',
    recruit: 'skip',
  },
};

/** 介入の試行結果内訳（RI-78 の「発動可能だった回数」測定用）。 */
export type DispatchReason = 'ok' | 'cooldown' | 'no-focus' | 'no-target' | 'complete' | 'other';

export interface SprintLog {
  quarter: number;
  index: number;
  kind: string;
  ticks: number;
  focusMax: number;
  focusRemaining: number;
  /** 方針が実際に成立させた介入回数。 */
  interventions: number;
  /** 介入 ID ごとの試行結果内訳（probe 方針では発動可能性の上限測定になる）。 */
  attempts: Record<string, Partial<Record<DispatchReason, number>>>;
  delivered: number;
  reviewQueueMax: number;
  incidents: number;
  contained: number;
  spread: number;
  rework: number;
  aiPct: number;
  grade: string;
  hpDelta: number;
  seniorHpAfter: number;
  moraleAfter: number;
  techDebtAfter: number;
  aiDepAfter: number;
  budgetAfter: number;
}

/** 四半期レビュー到達時のスナップショット（RI-79 の発火要因分解用）。 */
export interface QuarterLog {
  quarter: number;
  outcome: string;
  bossCleared: boolean;
  trustManagement: number;
  trustCustomers: number;
  trustTeam: number;
  minTrust: number;
  budget: number;
  missedCount: number;
  /** `missed_crisis` を発火させうる条件のうち、実際に成立していたもの。 */
  crisisTriggers: string[];
  /** `shutdown` を発火させうる条件のうち、実際に成立していたもの。 */
  shutdownTriggers: string[];
  /** シニアHP（`shutdown` 判定の入力）。 */
  seniorHp: number;
  /** 士気（`shutdown` 判定の入力）。 */
  morale: number;
  chosenAdjustment?: string;
}

export interface RunLog {
  seed: string;
  difficulty: string;
  policy: string;
  /** メタ進行の解放状態（`fresh`=初見相当 / `full`=全解放）。 */
  meta: MetaProfile;
  /** 進化ノードの解放イベント（F-11「Q1 で方向が決まるか」の判定用）。 */
  evolutionUnlocks: { id: string; quarter: number; sprintIndex: number }[];
  /** 敗北したフェーズ（`sprint`=スプリント終了時 / それ以外=スプリント間）。 */
  lostPhase?: string;
  /**
   * 敗北がビートで確定したときの、そのビートの内訳。
   * `judgment` は選択不能、`decision` はプレイヤーが選べる。混ぜると
   * 「操作の余地がない画面で敗北」かどうかを判定できない。
   */
  lostBeat?: { eventId: string; kind: string; choiceIndex?: number };
  /**
   * `lostPhase === 'sprint'` のとき、敗北したスプリントが結果を残したか。
   *
   * `true` なら `sprints` の末尾が敗北スプリントそのもの、
   * `false` ならスプリント中に即時敗北してログが残っていない。
   *
   * 直前状態の参照先を決めるために入れたフィールドだが、その用途は `lostPrevState` が
   * 引き継いだ。現在は「敗北したスプリントが結果を残したか」の分類にだけ使う。
   */
  lostSprintCompleted?: boolean;
  /**
   * **敗北を確定させた処理に入る直前**の組織状態。
   *
   * 以前は「最後に完了したスプリントの終了時点」を直前状態として読んでいたが、
   * スプリント終了とその敗北の間にはビート・ショップ・休息・setup が挟まる。
   * 例えば `giant-pr` の士気 -6 で負けたランでは、レポートには**その手前の休息で
   * 回復した後の値**ではなく前スプリント末尾の値が出ており、「敗北直前の士気」が
   * 実際より高くも低くも出ていた。ループの各反復で処理前の状態を控え、
   * 敗北を検知した反復の控えをそのまま残す。
   */
  lostPrevState?: {
    seniorHp: number;
    morale: number;
    techDebt: number;
    aiDependency: number;
    budget: number;
    /**
     * ステークホルダー信頼の最小値と3者の内訳。
     *
     * `trustExhausted` は敗因の多数（実測25件中20件が信頼閾値由来）を占めるのに、
     * 組織値と予算だけでは**その敗因を起こした指標が「直前」に出ない**。
     * 他の敗因が自分の指標を表示できるのと揃えるため、最小値と内訳の両方を残す
     * （`outcomeFor` の判定は最小値だが、どのステークホルダーが落ちたかは内訳でしか分からない）。
     */
    minTrust: number;
    trustManagement: number;
    trustCustomers: number;
    trustTeam: number;
    /** 控えを取った時点のフェーズ（どの処理の直前かを読めるようにする）。 */
    phase: string;
  };
  status: string;
  winType?: string;
  loseReason?: string;
  quarterNumber: number;
  sprintsPlayed: number;
  diagnosis: string;
  sprints: SprintLog[];
  quarters: QuarterLog[];
  finalOrg: Record<string, number | boolean>;
  totalDelivered: number;
  budget: number;
  relics: number;
  deckSize: number;
  evolutionUnlocked: number;
  goalAdjustments: string[];
  /**
   * 最終敗因に対応する危険域で発動可能だった介入の和集合（RI-89）。
   * その敗因の危険域を一度も観測していなければ省略。
   * 観測したが打てる手がゼロなら空配列（未観測とは区別する）。
   * `canApplyAction` による盤面非破壊観測。attempts（実際に試した手）とは別。
   */
  availableActionsInDanger?: string[];
  /**
   * 最終敗因の危険域で、非空の機械的発動可能手が最後に見えた時点。
   * 危険域は観測したが一度も非空が無ければ省略（その場合は firstSample を参照）。
   */
  availableActionsInDangerLastNonEmpty?: {
    sprintsPlayed: number;
    quarter: number;
    index: number;
    actions: string[];
  };
  /** 最終敗因の危険域で最初に取ったサンプル（常時空集合ランの打ち切り起点）。 */
  availableActionsInDangerFirstSample?: {
    sprintsPlayed: number;
    quarter: number;
    index: number;
    actions: string[];
  };
  /** 最終敗因の危険域で最後に取ったサンプル（空集合もありうる）。 */
  availableActionsInDangerLastSample?: {
    sprintsPlayed: number;
    quarter: number;
    index: number;
    actions: string[];
  };
}

/**
 * オートプレイ用のビート選択肢 index。
 * 明示指定がなければ即時採用（`grantRecruit`）を避け、決定論シードの安定を保つ。
 */
/**
 * ビート評価が参照する現在状態。
 *
 * 組織値だけでなく**予算とステークホルダー信頼**も要る。予算0は即敗北であり、
 * 信頼はどれか1つでも10以下になると次の四半期レビューで `shutdown` が確定するためである
 * （`outcomeFor`、`src/sim/run/quarterReview.ts`）。信頼を入れないと、残量に関係なく
 * 固定点で採点されて確定敗北を安全候補として選ぶ。
 */
interface BeatCtx {
  org: RunState['org'];
  budget: number;
  trust: StakeholderTrust;
  /**
   * 士気減少の軽減倍率（レリックの `moraleDamageMul` を畳んだ値）。
   * `applyEventOutcome` は**負の**士気差分にだけこれを掛けるので、素の差分で敗北判定すると
   * 実際には生き残る選択肢を確定敗北として外してしまう
   * （士気6・`expectation-mgmt` 所持で `giant-pr` の -6 は -4.5 になり士気1.5で生存する）。
   */
  moraleDamageMul: number;
  /**
   * この方針が休息フェーズで実際に選ぶ内容。`leadsTo: 'rest'` の価値は選ぶ内容で変わる。
   * `upgrade` はカードを強化するだけでシニアHPも士気も回復しない。
   */
  rest: PolicySpec['rest'];
  /**
   * 個体メンバーの状態。`restChoose('heal')` は組織値だけでなく
   * `recoverStamina(..., REST_STAMINA_RECOVER)` も実行し、休職者を復帰させる。
   * 組織HP・士気が高くても休職者や低スタミナ要員がいれば休息の価値は大きいので、
   * ロスターを見ないと休息の主要な利益を0点として攻め続ける側を選んでしまう。
   */
  roster: RunState['roster'];
  /**
   * 所持レリックと枠数。`RunEngine.grantRelic()` は**既に持っている／枠が満杯**なら
   * 何もせず終了する（`src/sim/run/engine.ts`）。無条件に加点すると、実際には得られない
   * レリックの架空の価値で代償（信頼低下など）を上書きしてしまう。
   * 例: `expectation-mgmt` を所持した状態で `urgent-demo` が再登場すると、
   * レリックを得られないのに管理信頼-8 の選択肢が高得点になる。
   */
  relics: readonly string[];
  relicSlots: number;
  /** 休息の回復量に乗るレリックボーナス（`foldPassives(relics).restHealBonus`）。 */
  restHealBonus: number;
}

/**
 * 選択肢を現在の状態で評価する。減らされたくない資源ほど強く嫌う。
 * 実プレイヤーが「シニアが限界なら残業を選ばない」程度の判断をする想定。
 *
 * **選ぶと即敗北する選択肢は候補から外す**（`INSTANT_LOSS`）。`evaluateLose`
 * （`src/sim/outcome.ts`）は `budget <= 0` / `seniorHp <= 1` / `morale <= 1` /
 * `techDebt >= 90` で敗北を返す。組織値だけを見ていたころは、たとえば残予算10で
 * `postmortem-culture`（予算 -10・レリック付与）が出るとレリックの加点が予算の減点を上回り、
 * 予算0＝`budgetExhausted` を自分から選んでいた。避けられる自滅が熟練方針の勝率と
 * 敗因分布に混ざるため、状態を見て選ぶ `stateAware` では取らない。
 */
const INSTANT_LOSS = -1e6;
/**
 * 四半期レビューで `shutdown`（＝敗北）が確定する信頼の下限。
 * `outcomeFor` の `minTrust <= 10`（`src/sim/run/quarterReview.ts`）に対応する。
 */
const TRUST_SHUTDOWN = 10;
/** `missed_crisis` になる信頼の下限。ここを割ると立て直しが難しくなる。 */
const TRUST_CRISIS = 15;
/**
 * 高負荷スプリントを受けてよい最低体力（シニアHPと士気の低い方）。
 * これを上回るぶんは出荷機会、下回るぶんは渋滞・炎上のリスクとして評価する。
 */
const ELITE_HEADROOM_MIN = 45;
/** 体力1あたりの重み。上の閾値との差にこれを掛ける。 */
const ELITE_HEADROOM_WEIGHT = 0.15;
/** 技術的負債（0〜100 を 0〜1 に正規化）1あたりの重み。負債が高いほど手戻りへ回る。 */
const ELITE_DEBT_WEIGHT = 4;

/**
 * `recoverStamina`（`src/sim/member/roster.ts`）の非公開定数の写し。
 * 休職者は回復量が `LEAVE_RECOVERY_MUL` 倍になり、`staminaMax * RETURN_RATIO` を超えると復帰する。
 * export されていないため複製している。ロスター側を変えたらここも合わせること。
 */
const RETURN_RATIO = 0.4;
const LEAVE_RECOVERY_MUL = 1.25;

/** 選択肢のうち評価に必要な部分。`leadsTo` を見るため `outcome` だけでは足りない。 */
interface ScorableChoice {
  outcome: Record<string, unknown>;
  leadsTo?: string;
}

/** `EventChoice` を評価用の形へ落とす（`EventOutcome` に index signature が無いため）。 */
const scorable = (c: { outcome: unknown; leadsTo?: string }): ScorableChoice => ({
  outcome: (c.outcome ?? {}) as Record<string, unknown>,
  leadsTo: c.leadsTo,
});

function scoreChoice(choice: ScorableChoice, ctx: BeatCtx): number {
  const outcome = choice.outcome;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const scarcity = (current: number): number => 1 + (100 - current) / 50;
  const trust = (outcome.trust ?? {}) as Record<string, number>;

  // 適用後の信頼（最小値）。信頼は3者それぞれに差分が乗るので最小値で見る。
  // `applyTrust` は 0〜100 に丸めるので、閾値判定も丸めた後の値で見る。
  const clamp100 = (v: number): number => Math.min(100, Math.max(0, v));
  const trustAfter = Math.min(
    clamp100(ctx.trust.management + num(trust.management)),
    clamp100(ctx.trust.customers + num(trust.customers)),
    clamp100(ctx.trust.team + num(trust.team)),
  );

  // 士気の減少はレリックで軽減される。実際に適用される量で判定する。
  const moraleRaw = num(outcome.morale);
  const moraleEff = moraleRaw < 0 ? moraleRaw * ctx.moraleDamageMul : moraleRaw;

  // **確定敗北の選択肢だけを外す。**
  //
  // ここに挙げた4条件は `evaluateLose`（`src/sim/outcome.ts`）が状態を見て即座に返すもので、
  // 踏んだ時点で敗北が確定する。
  //
  // **信頼はここに含めない。** 信頼が効くのは四半期 outcome の判定で、
  // `evaluateQuarterOutcome`（`src/sim/run/quarterReview.ts`）は
  // **ボス突破かつ全KPI達成なら `met` / `exceeded` を先に返してから** `minTrust <= 10` の
  // `shutdown` を見る。つまり信頼10以下でも、次のレビューで目標を達成すれば勝てる。
  // 確定敗北として候補から外すと、勝ち得る選択肢を落として方針比較を歪める。
  // 危険域はリスクとして重く減点するにとどめる（下の `TRUST_SHUTDOWN` の項）。
  if (
    ctx.budget + num(outcome.budget) <= 0 ||
    ctx.org.seniorHp + num(outcome.seniorHp) <= 1 ||
    ctx.org.morale + moraleEff <= 1 ||
    ctx.org.techDebt + num(outcome.techDebt) >= 90
  ) {
    return INSTANT_LOSS;
  }

  let score = 0;
  score += num(outcome.delivered) * 0.05;

  /**
   * **クランプ後に実際に動く量で採点する。**
   *
   * `applyEventOutcome`（`src/sim/run/events.ts`）は組織指標を 0..100 にクランプするので、
   * 上限に張り付いた指標への加算は効かない。素の差分で採点すると、たとえば士気100 の
   * `standup-acronym-storm` で「士気+4・負債+2」が加点され、実際には負債だけが増える
   * 選択肢を選んでしまう。
   */
  const applied = (current: number, delta: number): number =>
    Math.min(100, Math.max(0, current + delta)) - current;

  // 予算もシニアHP・士気と同じく、残量が少ないほど減少を重く見る。
  // 予算は 0..100 のクランプが無い（`budgetDelta` として engine が加減する）ので素の差分。
  const budget = num(outcome.budget);
  score += budget >= 0 ? budget * 0.2 : budget * scarcity(Math.min(ctx.budget, 100)) * 0.5;
  const hp = applied(ctx.org.seniorHp, num(outcome.seniorHp));
  score += hp >= 0 ? hp * 0.5 : hp * scarcity(ctx.org.seniorHp) * 1.5;
  const morale = applied(ctx.org.morale, moraleEff);
  score += morale >= 0 ? morale * 0.3 : morale * scarcity(ctx.org.morale) * 0.8;
  // 負債は下限0のみ（`Math.max(0, ...)`）。上限クランプは無い。
  score -= (Math.max(0, ctx.org.techDebt + num(outcome.techDebt)) - ctx.org.techDebt) * 0.4;
  score -= applied(ctx.org.aiDependency, num(outcome.aiDependency)) * 0.2;

  // **品質系の指標も採点する。** ここが未評価だと、品質・テスト・AIリテラシーを上げる
  // 選択肢が一律0点になり、士気や出荷の小さな加点に必ず負ける。品質ビルドと AI ビルドの
  // 比較（F-10）に、方針と無関係な固定選択が混ざる。
  score += applied(ctx.org.quality, num(outcome.quality)) * 0.3;
  score += applied(ctx.org.testCoverage, num(outcome.testCoverage)) * 0.25;
  // AI リテラシーは `aiDependency` 敗北（依存95以上かつリテラシー30以下）の回避軸なので、
  // 低いときほど重く見る。
  score +=
    applied(ctx.org.aiLiteracy, num(outcome.aiLiteracy)) * 0.25 * scarcity(ctx.org.aiLiteracy);
  // 信頼も予算・シニアHP・士気と同じく、残量が少ないほど減少を重く見る。
  // 危機域（`missed_crisis` の閾値）へ踏み込む場合はさらに重くする。
  //
  // **差分はクランプ後の実効値で見る。** `applyTrust` は各信頼値を 0〜100 に丸めるので、
  // 残量2で -8 を受けても実際には -2 しか動かない。素の差分で採点すると、
  // 実害の小さい選択肢を過大に嫌って負債や消耗を増やす側を選びうる。
  const trustDelta =
    applied(ctx.trust.management, num(trust.management)) +
    applied(ctx.trust.customers, num(trust.customers)) +
    applied(ctx.trust.team, num(trust.team));
  const trustMin = Math.min(ctx.trust.management, ctx.trust.customers, ctx.trust.team);
  score +=
    trustDelta >= 0 ? trustDelta * 0.2 : trustDelta * scarcity(Math.min(trustMin, 100)) * 0.5;
  // 危険域へ踏み込むぶんは重く減点する。`shutdown` の閾値（10以下）は
  // 「次のレビューで目標を達成できなければ敗北」なので、危機域（15以下）よりさらに重い。
  if (trustAfter <= TRUST_CRISIS && trustMin > TRUST_CRISIS) score -= 6;
  if (trustAfter <= TRUST_SHUTDOWN && trustMin > TRUST_SHUTDOWN) score -= 25;
  // 実際に獲得できるときだけ加点する（重複・枠満杯では `grantRelic` が no-op になる）。
  if (
    typeof outcome.grantRelic === 'string' &&
    !ctx.relics.includes(outcome.grantRelic) &&
    ctx.relics.length < ctx.relicSlots
  ) {
    score += 4;
  }
  // カード付与もデッキが太る分の価値がある。レリック（恒久パッシブ・枠が有限）より軽く見る。
  if (outcome.grantCard) score += 2;

  // **遷移先スプリントの負荷も見る。** `outcome` だけを採点すると `leadsTo` を認識できない。
  // `elite-offer` は高負荷側の `outcome` が空（=0点）、通常側が信頼-4（=負点）なので、
  // 組織がどれだけ消耗していても常に高負荷側を選んでしまっていた。実際の高負荷スプリントは
  // タスク量が `ELITE_TASK_MUL`（=1.6）倍で、余力があれば出荷機会、消耗していれば
  // 渋滞と炎上の増幅になる。この固定選択が熟練系方針の勝率と敗因へ混ざる。
  if (choice.leadsTo === 'sprint-elite') {
    const load = ELITE_TASK_MUL - 1;
    const worst = Math.min(ctx.org.seniorHp, ctx.org.morale);
    score += load * (worst - ELITE_HEADROOM_MIN) * ELITE_HEADROOM_WEIGHT;
    score -= load * (ctx.org.techDebt / 100) * ELITE_DEBT_WEIGHT;
  }

  // **`nextSprint` の一時効果も採点する。** `rest-offer` は「休む」が
  // `nextSprint.taskCountMul=0.7`、「攻め続ける」が空の `outcome` で、どちらも0点だったため
  // 提示順の先頭（＝常に休む）が無条件に選ばれていた。組織状態や四半期目標に関係なく
  // 毎回タスクを30%減らす固定選択が、F-4 の所要時間と方針別勝率へ混ざる。
  const next = (outcome.nextSprint ?? {}) as Record<string, unknown>;
  if (next.taskCountMul !== undefined) {
    // タスク減は消耗しているほど価値があり、余力があるなら出荷機会を捨てる損になる。
    // 高負荷スプリントの評価と符号を揃える（あちらは増加、こちらは減少）。
    const relief = 1 - num(next.taskCountMul);
    const worst = Math.min(ctx.org.seniorHp, ctx.org.morale);
    score += relief * (ELITE_HEADROOM_MIN - worst) * ELITE_HEADROOM_WEIGHT;
    score += relief * (ctx.org.techDebt / 100) * ELITE_DEBT_WEIGHT;
  }
  // レビュー初期負荷・手戻り率・集中力上限は、いずれも次スプリントを直接苦しくする。
  score -= num(next.reviewLoadAdd) * 0.3;
  score -= num(next.reworkRateAdd) * 10;
  score += num(next.focusMaxAdd) * 0.3;

  // **休息の価値は方針が実際に選ぶ内容で決まる。** `leadsTo: 'rest'` へ一律に回復価値を
  // 与えると、カードを強化するだけの `skilledRestUpgrade` や負債を返す `skilledRestRepay` に
  // 存在しない回復を期待することになり、ショップ・休息投資の比較が歪む。
  if (choice.leadsTo === 'rest') {
    const choiceAtRest = restChoiceFor(ctx.rest, ctx.org.techDebt);
    if (choiceAtRest === 'heal') {
      // クランプ後に実際に回復する量で見る（満タンに近ければ価値は小さい）。
      // `restChoose('heal')` は `REST_HEAL` に `restHealBonus`（`flow-first` で +10）を足す。
      score += applied(ctx.org.seniorHp, REST_HEAL + ctx.restHealBonus) * 0.5;
      score += applied(ctx.org.morale, REST_MORALE_HEAL) * 0.3;
      // **個体スタミナの回復と復職も採点する。** `recoverStamina` は休職者に
      // `LEAVE_RECOVERY_MUL` 倍を与え、`staminaMax * RETURN_RATIO` を超えたら復帰させる。
      for (const m of ctx.roster.members) {
        const gain = Math.round(REST_STAMINA_RECOVER * (m.onLeave ? LEAVE_RECOVERY_MUL : 1));
        const after = Math.min(m.staminaMax, m.stamina + gain);
        score += (after - m.stamina) * 0.02;
        // 復職は戦力が1人戻るので、スタミナ量とは別枠で重く見る。
        if (m.onLeave && after >= m.staminaMax * RETURN_RATIO) score += 5;
      }
    } else if (choiceAtRest === 'repay') {
      score += Math.min(REST_REPAY, ctx.org.techDebt) * 0.4;
    } else {
      // カード強化。盤面の状態には依らない一定の投資価値として置く。
      score += 2;
    }
  }
  return score;
}

export function autoplayBeatChoiceIndex(
  eventId: string,
  kind: 'judgment' | 'decision',
  takeRecruit = false,
  mode: PolicySpec['beat'] = 'firstChoice',
  ctx?: BeatCtx,
): number | undefined {
  if (kind === 'judgment') return undefined;
  const choices = getEvent(eventId)?.choices ?? [];
  if (choices.length === 0) return 0;
  // この盤面で採用すると決めたときだけ即時採用の選択肢を取る。そうでなければ避ける
  // （避けないと「採用なし」「必要なときだけ採用」群に無条件の採用が混ざる）。
  //
  // ただし即敗北する採用は取らない。採用の可否はイベントの `outcome` だけでは判定できない。
  // `grantRecruit` は解決時に `tryRecruit` が**さらに** `RECRUIT_COST` を引くため、
  // 予算がちょうど `RECRUIT_COST` のとき outcome 上は予算差分0でも、実際には予算0＝
  // `budgetExhausted` になる。採用費を引いた後の予算で評価する。
  // 採用費を引いた後の予算で敗北しないか。`grantRecruit` の選択肢はこれで判定する。
  const afterRecruit = ctx && { ...ctx, budget: ctx.budget - RECRUIT_COST };
  const recruitIsSafe = (c: (typeof choices)[number]): boolean =>
    !afterRecruit || scoreChoice(scorable(c), afterRecruit) > INSTANT_LOSS;
  if (takeRecruit) {
    const grant = choices.findIndex((c) => c.outcome.grantRecruit && recruitIsSafe(c));
    if (grant >= 0) return grant;
  }
  // 安全判定に落ちた採用肢は、後続の候補集合からも外す。
  // ここで `takeRecruit` だけを理由に通すと、上で弾いた同じ選択肢が
  // 「見送りより高得点」として選び直され、`tryRecruit` の控除で `budgetExhausted` になる。
  const allowed = choices
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.outcome.grantRecruit || (takeRecruit && recruitIsSafe(c)));
  const pool = allowed.length > 0 ? allowed : choices.map((c, i) => ({ c, i }));
  if (mode !== 'stateAware' || !ctx) return pool[0].i;
  // 状態依存: 現在いちばん減らしたくない資源を削る選択肢を避ける。
  let best = pool[0];
  let bestScore = scoreChoice(scorable(pool[0].c), ctx);
  for (const cand of pool.slice(1)) {
    const sc = scoreChoice(scorable(cand.c), ctx);
    if (sc > bestScore) {
      best = cand;
      bestScore = sc;
    }
  }
  return best.i;
}

/**
 * `selective` の発動条件。
 * 介入用の集中力を残し、盤面が切迫していないときだけカードを切る。
 */
function shouldPlaySelective(e: RunEngine): boolean {
  const s = e.snapshot();
  const sp = s.sprint;
  if (!sp) return false;
  const focusRatio = sp.config.focusMax > 0 ? sp.focus / sp.config.focusMax : 0;
  const reviewLen = sp.tasks.filter((t) => t.lane === 'review').length;
  const burning = sp.tasks.filter((t) => t.lane === 'rework' && t.incident).length;
  // 集中力を6割以上残していて、渋滞も炎上も起きていないときだけ投資に回す。
  return focusRatio >= 0.6 && reviewLen < 6 && burning === 0;
}

function playHand(e: RunEngine, mode: PolicySpec['cards'], onPlayed?: () => void): void {
  if (mode === 'none') return;
  let guard = 0;
  while (guard < 24 && e.snapshot().phase === 'sprint') {
    guard += 1;
    if (mode === 'selective' && !shouldPlaySelective(e)) break;
    const hand = e.snapshot().sprint?.cardPiles.hand ?? [];
    if (hand.length === 0) break;
    let played = false;
    for (const deckIndex of [...hand]) {
      if (e.playCard(deckIndex).ok) {
        played = true;
        // カード間でも介入可能な局面を危険域サンプルへ残す（一括発動の欠測防止）。
        onPlayed?.();
        break;
      }
    }
    if (!played) break;
  }
}

function boardCtx(s: RunState): BoardCtx | null {
  const sp = s.sprint;
  if (!sp || sp.complete) return null;
  return {
    reviewLen: sp.tasks.filter((t) => t.lane === 'review').length,
    burning: sp.tasks.filter((t) => t.lane === 'rework' && t.incident).length,
    codingLen: sp.tasks.filter((t) => t.lane === 'coding').length,
    reworkLen: sp.tasks.filter((t) => t.lane === 'rework').length,
    tick: s.sprintTick,
  };
}

/** 敗北直前の参照に使う組織状態の控え（`RunLog.lostPrevState`）。 */
function orgSnapshot(s: RunState): NonNullable<RunLog['lostPrevState']> {
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    seniorHp: r1(s.org.seniorHp),
    morale: r1(s.org.morale),
    techDebt: r1(s.org.techDebt),
    aiDependency: r1(s.org.aiDependency),
    budget: r1(s.budget),
    minTrust: r1(
      Math.min(
        s.stakeholderTrust.management,
        s.stakeholderTrust.customers,
        s.stakeholderTrust.team,
      ),
    ),
    trustManagement: r1(s.stakeholderTrust.management),
    trustCustomers: r1(s.stakeholderTrust.customers),
    trustTeam: r1(s.stakeholderTrust.team),
    phase: s.phase,
  };
}

/**
 * F-9 / RI-89: 敗因予兆の危険域（HUD・四半期閾値の手前）。
 * 指標ごとに対応する敗因へ紐づけ、最終敗因の窓だけを報告できるようにする。
 */
type DangerLoseReason = Extract<
  LoseReason,
  | 'seniorBurnout'
  | 'moraleCollapse'
  | 'techDebt'
  | 'aiDependency'
  | 'budgetExhausted'
  | 'trustExhausted'
  | 'kpiMissed'
  | 'reviewFreeze'
  | 'incidentCascade'
  | 'bossFailed'
  | 'reorgRequired'
>;

/** 敗因ごとの危険域観測トラック（和集合＋時系列）。 */
type DangerTrack = {
  actions: Set<string>;
  firstSample: {
    sprintsPlayed: number;
    quarter: number;
    index: number;
    actions: string[];
  };
  lastSample: {
    sprintsPlayed: number;
    quarter: number;
    index: number;
    actions: string[];
  };
  lastNonEmpty: {
    sprintsPlayed: number;
    quarter: number;
    index: number;
    actions: string[];
  } | null;
};

function activeDangerReasons(e: RunEngine): DangerLoseReason[] {
  const s = e.snapshot();
  const minTrust = Math.min(
    s.stakeholderTrust.management,
    s.stakeholderTrust.customers,
    s.stakeholderTrust.team,
  );
  // 完了時と同じく、選択中 live＋非選択の粗粒度進行を合成した KPI。
  const liveKpi = e.previewLiveQuarterKpi();
  const out: DangerLoseReason[] = [];
  if (s.org.seniorHp < 50) out.push('seniorBurnout');
  if (s.org.morale < 40) out.push('moraleCollapse');
  // techDebt: 四半期ハード敗北は全社平均負債を見るため、投影 org も危険域へ含める。
  const liveTechDebt = liveKpi?.org.techDebt ?? s.org.techDebt;
  if (s.org.techDebt >= 60 || liveTechDebt >= 60) out.push('techDebt');
  if (s.org.aiDependency >= 50 && s.org.aiLiteracy <= 30) out.push('aiDependency');
  if (s.budget <= 15) out.push('budgetExhausted');
  // trustExhausted: trust / budget / HP 経路（missed_crisis・shutdown 前兆）。
  // KPI 未達だけの missed_crisis は loseReasonForOutcome が kpiMissed を返すため分離する。
  const lateInQuarter = s.sprintIndexInQuarter >= Math.ceil(s.sprintsPerQuarter / 2);
  const kpiMissCount = liveKpi
    ? measureGoalProgress({
        goal: s.quarterGoal,
        org: liveKpi.org,
        totals: liveKpi.totals,
      }).filter((p) => p.status === 'missed').length
    : 0;
  if (minTrust <= 25 || s.budget <= 5 || s.org.seniorHp <= 10) out.push('trustExhausted');
  // kpiMissed: 未達4件以上に加え、missed_crisis フォールバック（trust/budget 枯渇・ハード非該当）の前兆。
  // 例: 予算1〜5・信頼はまだ閾値超・未達が少なくても loseReasonForOutcome は kpiMissed を返しうる。
  if (lateInQuarter && kpiMissCount >= 4) out.push('kpiMissed');
  if (s.budget > 0 && s.budget <= 5 && minTrust > 15) out.push('kpiMissed');
  // reviewFreeze: ラン累計・選択中スプリント・投影した非選択ピークの最大を見る。
  // イベント抽選は seniorHpLow >= 0.55（seniorHp <= 45）のみで、Review 件数条件は無い。
  const liveReviewPeak = Math.max(
    s.totals.reviewQueuePeak,
    s.sprint?.metrics.reviewQueueMax ?? 0,
    liveKpi?.totals.reviewQueuePeak ?? 0,
  );
  const reviewQueueDanger = liveReviewPeak >= Math.round(REVIEW_FREEZE_PEAK * 0.75);
  const reviewFreezeEventRisk = s.org.seniorHp <= 45;
  if (reviewQueueDanger || reviewFreezeEventRisk) out.push('reviewFreeze');
  if ((s.totals.consecutiveIncidentSprints ?? 0) >= CONSECUTIVE_INCIDENT_SPRINT_CAP - 2)
    out.push('incidentCascade');
  if (s.currentSprintKind === 'boss') out.push('bossFailed');
  // reorgRequired: trust+quarter 条件に加え、Q2 以降の遅延中スプリントで多 KPI 未達リスクが高い場合。
  // missedCount >= 3 の代替プロキシ: lateInQuarter かつ kpiMissCount（出荷含む複数 KPI）が 3 以上。
  if (
    (minTrust <= 20 && s.quarterNumber >= 2) ||
    (s.quarterNumber >= 2 && lateInQuarter && kpiMissCount >= 3)
  )
    out.push('reorgRequired');
  return out;
}

/** 対象省略で不可でも、明示 target（Backlog→Coding ドラッグ）なら差配できるか。 */
function canApplyAssignTaskWithExplicitTarget(
  sprint: NonNullable<RunState['sprint']>,
  org: RunState['org'],
  tick: number,
): boolean {
  for (const task of assignableTasks(sprint)) {
    const target = { taskId: task.id, lane: 'coding' as const };
    if (canApplyAction('assignTask', sprint, org, tick, target).ok) return true;
  }
  return false;
}

/** アクティブな危険種別ごとの発動可能介入を和集合・最終サンプルへ追記する（盤面非破壊）。 */
function sampleAvailableInDanger(e: RunEngine, byReason: Map<DangerLoseReason, DangerTrack>): void {
  const s = e.snapshot();
  if (s.phase !== 'sprint' || !s.sprint || s.sprint.complete) return;
  const dangers = activeDangerReasons(e);
  if (dangers.length === 0) return;
  const available: string[] = [];
  for (const id of ALL_ACTION_IDS) {
    if (canApplyAction(id, s.sprint, s.org, s.sprintTick).ok) {
      available.push(id);
      continue;
    }
    // UI は Coding 空でも Backlog ドラッグ可なら assignTask を武装するため、明示 target も試す。
    if (
      id === 'assignTask' &&
      canApplyAssignTaskWithExplicitTarget(s.sprint, s.org, s.sprintTick)
    ) {
      available.push(id);
    }
  }
  const sample = {
    sprintsPlayed: s.sprintsPlayed,
    quarter: s.quarterNumber,
    index: s.sprintIndexInQuarter,
    actions: [...available].sort(),
  };
  for (const reason of dangers) {
    let track = byReason.get(reason);
    if (!track) {
      // 空集合も「危険域を観測した」印として残す。初回サンプルは常時空集合の起点にも使う。
      track = {
        actions: new Set(),
        firstSample: sample,
        lastSample: sample,
        lastNonEmpty: null,
      };
      byReason.set(reason, track);
    }
    for (const id of available) track.actions.add(id);
    track.lastSample = sample;
    if (available.length > 0) track.lastNonEmpty = sample;
  }
}

function bump(
  attempts: Record<string, Partial<Record<DispatchReason, number>>>,
  id: string,
  reason: DispatchReason,
): void {
  const slot = (attempts[id] ??= {});
  slot[reason] = (slot[reason] ?? 0) + 1;
}

function intervene(
  e: RunEngine,
  spec: PolicySpec,
  attempts: Record<string, Partial<Record<DispatchReason, number>>>,
  onSuccess?: () => void,
): number {
  const first = boardCtx(e.snapshot());
  if (!first) return 0;
  let n = 0;
  // 固定順だと先頭のアクションが集中力を独占するため、probe では tick ごとに順を回す。
  const order = spec.rotateActions
    ? spec.actions.map((_, i) => spec.actions[(i + first.tick) % spec.actions.length])
    : spec.actions;
  for (const a of order) {
    // **各 dispatch の直前に盤面を取り直す。** 同じ tick 内でも先行の介入がレーンを変える。
    // 例: `firefight` が炎上タスクを Review へ戻すとキューが増え、`interruptReview` が
    // 抜くとキューが減る。ループ開始時の盤面で `when` を評価すると、増えたのに見送ったり
    // 減ったのに andon を撃ったりして、方針定義どおりの挙動にならない。
    const ctx = boardCtx(e.snapshot());
    if (!ctx) break;
    if (a.when && !a.when(ctx)) continue;
    const outcome = e.dispatch(a.id);
    if (outcome.ok) {
      bump(attempts, a.id, 'ok');
      n += 1;
      // バッチ後一度ではなく、各成功直後に危険域を再観測する（一時的な選択肢の欠落防止）。
      onSuccess?.();
    } else {
      const reason = (outcome.reason ?? 'other') as DispatchReason;
      bump(attempts, a.id, reason);
    }
    if (e.snapshot().phase !== 'sprint') break;
  }
  return n;
}

/**
 * ベンチにいるメンバーを実働レーンへ配置する。レビュー適性が実装適性以上なら review、
 * それ以外は coding。
 *
 * ベンチに来る経路は2つあり、**どちらも全方針で配置する**。
 * - 採用（`recruitMember` は採用直後を必ず `bench` に置く）
 * - 休職からの復帰（`recoverStamina` は `onLeave` を外すだけで `assignment` は `bench` のまま）
 *
 * 採用方針でのみ配置すると、復職者を戦力に戻すかどうかが採用の比較へ混入する。
 */
function assignBenchMembers(e: RunEngine): void {
  for (const m of e.snapshot().roster.members) {
    if (m.assignment !== 'bench' || m.onLeave) continue;
    e.assignMember(m.id, m.stats.review >= m.stats.implementation ? 'review' : 'coding');
  }
}

/**
 * 稼働中のコーダーが0人にならないようにする。**方針を問わず適用する。**
 *
 * `foldFormationEffects()` はコーダー不在で coding slot を0・速度を0.15 へ落とすので、
 * 健常なレビュー担当が残っているのにほぼ無人のスプリントを始めてしまう。実プレイヤーなら
 * 編成画面で1人戻せる局面なので、これは方針の違いではなく自動再配置の欠落である。
 *
 * **当初 `reviewHeavy` 専用の補正として入れたが、それでは足りなかった。**
 * `assignBenchMembers` はレビュー適性が実装適性以上のメンバーを review へ置くため、
 * coding にいた全員が休職すると、どの方針でもコーダーが0人になりうる。
 * 実測では easy/normal/hard の `noAiCtl`/`pt-4` と normal の `noAi`/`pt-9` で
 * 実際に `setup` へ到達しており、**RI-77 の AI 統制比較（`noAiCtl`）に混ざっていた**。
 */
function ensureAtLeastOneCoder(e: RunEngine): void {
  const members = e.snapshot().roster.members;
  if (members.some((m) => m.assignment === 'coding' && !m.onLeave)) return;
  const candidate = members
    .filter((m) => !m.onLeave && m.assignment === 'review')
    // 実装適性が高い方を戻す（レビュー適性の高い担当をレビューに残す）。
    .sort((a, b) => b.stats.implementation - a.stats.implementation)[0];
  if (candidate) e.assignMember(candidate.id, 'coding');
}

/**
 * ベンチ配置に加えて、**方針固有の AI 配布・編成も適用する**。
 *
 * `applySetup` を `setup` フェーズだけで呼ぶと、復職者に方針が反映されない。
 * `resolveBeat()` は既定の `leadsTo === 'sprint'` で `launchSprint()` を直接呼んで
 * `setup` を通らないためである。方針どおりでない編成が F-10 のビルド比較や
 * RI-77 の AI 統制へ混ざるので、ベンチを戻すのと同じタイミングで方針も掛け直す。
 *
 * **この修正で動いた数値は無い**（現行1,240ランでは復職者に方針が掛かり直す経路が
 * 実際には踏まれていない）。経路の穴自体は実在するので予防として残す。
 * なお `noAiCtl` に AI 利用が残るのはこれが原因ではなく、`assignTask` 介入が
 * `defaultAssignee` 経由で個別タスクを AI へ回すためである（`org.aiEnabled` は true のまま）。
 * `aiFullBet` が100%に届かないのも `AI_ADOPTION`（=0.85）の確率抽選のばらつきで、仕様どおり。
 *
 * 順序は「ベンチ配置 → 編成 → AI」。`reviewHeavy` は coding のメンバーを見て動かすため
 * ベンチ配置の後でなければ復職者を拾えず、AI 配布はレーンに依らないので最後でよい。
 */
function applyRosterPolicy(e: RunEngine, spec: PolicySpec): void {
  assignBenchMembers(e);
  if (spec.formation === 'reviewHeavy') {
    let coders = 0;
    for (const m of e.snapshot().roster.members) {
      if (m.assignment !== 'coding' || m.onLeave) continue;
      coders += 1;
      if (coders > 1) e.assignMember(m.id, 'review');
    }
  }
  ensureAtLeastOneCoder(e);
  if (spec.ai) {
    for (const m of e.snapshot().roster.members) e.setMemberAi(m.id, spec.ai === 'all');
  }
}

/**
 * この盤面で採用するか。`selective` は「欠員があり、かつ**採用後も**予算が残る」ときだけ採る。
 *
 * 欠員の定義: 休職者がいる、または実働（bench でも onLeave でもない）が2名以下。
 * 予算条件は**採用費を引いた残額**で判定する。`tryRecruit` はこの後さらに `RECRUIT_COST` を
 * 引くので、引く前の額で見ると「採用後に◯◯残る」という条件にならない。
 *
 * 残額の下限は `RECRUIT_COST` 1回分（=25）。当初は2回分にしていたが、それだと
 * 採用時点で予算75が要る一方、**実測の予算は p50=45 / p90=60 / 最大68 で75へ到達しない**。
 * 条件が一度も成立せず、この方針が `skilledNoHire` と完全に同一のランになっていた
 * （40ラン全部が一致）。到達可能な水準へ下げた。下限を置く理由自体は変わらず、
 * 採用で予算を使い切ると直後の四半期レビューで `budget<=5` の危機条件へ落ちるため。
 */
function wantsRecruit(s: RunState, spec: PolicySpec): boolean {
  if (spec.recruit === 'skip') return false;
  // **採用後に予算が残ることまで見る。** `tryRecruit` は `budget >= RECRUIT_COST` なら通し、
  // 差し引いた後で `applyImmediateLose()` を呼ぶ（`src/sim/run/engine.ts`）。予算がちょうど
  // `RECRUIT_COST` だと残高0＝`budget <= BUDGET_EXHAUSTED_CAP` で `budgetExhausted` になる。
  //
  // **介入（`dispatch`）と違い、採用は本当に即時敗北を判定する。** 実測でも
  // `budgetExhausted` 14件中6件が予算ちょうど25からの採用で、いずれも shop / rest / recruit
  // フェーズだった。ビートの `grantRecruit` 経路は既に採用費を引いた額で評価しているので、
  // ここを見ないと**同じ採用でも経路によって自滅したりしなかったり**する。
  const roomAndCash = s.roster.members.length < ROSTER_CAP && s.budget - RECRUIT_COST > 0;
  if (!roomAndCash) return false;
  if (spec.recruit === 'hire') return true;
  const onLeave = s.roster.members.some((m) => m.onLeave);
  // 復職直後は `onLeave=false` でも `assignment` は `bench` のままで、実働へ戻るのは次の
  // `setup` である。`bench` を除いて数えると、その間のビート・ショップ・休息・採用フェーズで
  // 復職者が欠員に見え、不要な採用を打ってしまう。ハーネスは全方針で健常なベンチを
  // 次の `setup` に必ず配置するので、**休職していないメンバーは戦力として数える**。
  const working = s.roster.members.filter((m) => !m.onLeave).length;
  return (onLeave || working <= 2) && s.budget - RECRUIT_COST >= RECRUIT_COST;
}

/**
 * 休息フェーズで採用しないときの選択。
 *
 * `stateAware` の閾値（負債50以上で返済）は決めた値。敗北条件は `techDebt >= 90`
 * （`src/sim/outcome.ts`）で、`REST_REPAY` 1回では 90 から安全域まで戻らないため、
 * 危険域へ入る前に返すという想定で中間に置いた。
 * `upgrade` は強化対象があるときだけ成立するので、デッキが空なら回復へ落とす。
 */
const REST_REPAY_DEBT_THRESHOLD = 50;
function restChoice(s: RunState, spec: PolicySpec): 'heal' | 'repay' | 'upgrade' {
  return restChoiceFor(spec.rest, s.org.techDebt, s.deck.length > 0);
}

/**
 * 休息フェーズで選ぶ内容を、方針と負債から決める。
 *
 * `restChoice` と**同じ判断をビート評価からも参照する**ために切り出してある。
 * 評価側が `leadsTo: 'rest'` へ一律の回復価値を与えていると、カード強化しかしない方針にも
 * 回復を期待してしまい、実際の挙動と乖離する。
 */
function restChoiceFor(
  rest: PolicySpec['rest'],
  techDebt: number,
  hasDeck = true,
): 'heal' | 'repay' | 'upgrade' {
  if (rest === 'upgrade') return hasDeck ? 'upgrade' : 'heal';
  if (rest === 'stateAware' && techDebt >= REST_REPAY_DEBT_THRESHOLD) return 'repay';
  return 'heal';
}

/**
 * 強化するデッキ位置。**最もレベルの低いカード**を選ぶ（同率は先頭）。
 *
 * `deckIndex` を 0 固定にすると、ドラフトやショップで後から入ったカードが一度も強化候補に
 * ならず、同じ1枚だけが繰り返しレベルアップする。実画面では任意の位置を選べるので、
 * 固定のままでは「休息でカードを強化しても寄与しない」の根拠にならない。
 * どのカードを伸ばすかの選好（効果種別など）までは見ておらず、これも決めた基準である。
 */
function restUpgradeIndex(s: RunState): number {
  let best = 0;
  for (let i = 1; i < s.deck.length; i += 1) {
    if (s.deck[i].level < s.deck[best].level) best = i;
  }
  return best;
}

/**
 * 四半期レビューの危機条件（`budget<=5`）に対して残す安全余裕。
 * 採用しない方針はこれだけ残せばよく、`RECRUIT_COST`（=25）を残すのは過剰に保守的。
 */
const SHOP_BUDGET_FLOOR = 10;

/**
 * ショップでカード・レリックを買う。レリックを先にするのは枠が有限で買い逃しが効くため。
 *
 * 残す予算は**採用方針で変える**。採用する方針は次の採用機会のために `RECRUIT_COST` を残すが、
 * 採用しない方針（`skilledShopBuy` は `recruit: 'skip'`）にその予約は要らない。
 * 一律に25を残すと、たとえば予算30で8のカードが出ても買えず（買っても22残り、
 * 危機条件の5には十分余裕がある）、「ショップへ投資する」条件が実際には
 * 多くの機会を見送る保守方針になってしまう。
 */
function buyShopItems(e: RunEngine, spec: PolicySpec): void {
  const reserve = spec.recruit === 'skip' ? SHOP_BUDGET_FLOOR : RECRUIT_COST;
  const relic = e.snapshot().shop?.relic;
  if (relic && !relic.bought && e.snapshot().budget - relic.cost >= reserve) {
    e.buyShopRelic();
  }
  // 陳列は購入で `bought` が立つので、毎回取り直して安い順に買えるだけ買う。
  for (;;) {
    const s = e.snapshot();
    // カード購入は `applyImmediateLose` を呼ぶ。敗北したらフェーズが外れるので抜ける。
    if (s.phase !== 'shop') break;
    const affordable = (s.shop?.cards ?? [])
      .filter((c) => !c.bought && s.budget - c.cost >= reserve)
      .sort((a, b) => a.cost - b.cost);
    if (affordable.length === 0) break;
    e.buyShopCard(affordable[0].defId);
    // 予算不足などで `bought` が立たなければ無限ループになるため、変化が無ければ抜ける。
    if (!e.snapshot().shop?.cards.find((c) => c.defId === affordable[0].defId)?.bought) break;
  }
}

/**
 * `setup` フェーズの編成。中身は `applyRosterPolicy` と同じで、
 * 「setup でしか掛からない方針」を作らないために一本化してある。
 */
function applySetup(e: RunEngine, spec: PolicySpec): void {
  applyRosterPolicy(e, spec);
}

/**
 * `missed_crisis` を発火させうる条件のうち、実際に成立していたものを列挙する。
 * `evaluateQuarterOutcome` / `buildQuarterReview`（`src/sim/run/quarterReview.ts`）と対応させる。
 */
function crisisTriggers(minTrust: number, budget: number, missedCount: number): string[] {
  const hit: string[] = [];
  if (minTrust <= 15) hit.push('trust<=15');
  if (budget <= 5) hit.push('budget<=5');
  if (missedCount >= 4) hit.push('missed>=4');
  return hit;
}

/**
 * `shutdown` を発火させうる条件のうち、実際に成立していたものを列挙する。
 * RI-79 以降は `loseReasonForOutcome` が信頼/予算/シニアへ分解するが、
 * 発火条件の生データとしても両方を残す。
 *
 * エンジンは `companyOrgFromTeams(this.teams, this.org)` の全社集約値で判定するが、
 * ここで使う `morale` / `seniorHp` は再現できている。`companyOrgFromTeams` はこの2つだけ
 * 平均を取らず `fallback`（＝選択中チームの `this.org`）をそのまま返す仕様であり
 * （`src/sim/orgscale/teamState.ts`。粗粒度チームの消耗で Q1 勝率が潰れるのを避けるため）、
 * `snapshot().org` は同じ `this.org` の複製だからである。`trust` と `budget` はラン単位で
 * チーム別の値を持たない。したがって shutdown の3条件はすべて判定時と同じ入力で再現される。
 *
 * 平均を取る `aiDependency` などは選択中チームの値と乖離しうるが、shutdown の判定には
 * 使われないため、ここには影響しない。
 */
function shutdownTriggers(
  minTrust: number,
  budget: number,
  morale: number,
  seniorHp: number,
  missedCount: number,
): string[] {
  const hit: string[] = [];
  if (minTrust <= 10) hit.push('trust<=10');
  if (budget <= 0 && morale <= 15) hit.push('budget<=0&morale<=15');
  if (seniorHp <= 5 && missedCount >= 2) hit.push('seniorHp<=5&missed>=2');
  return hit;
}

/** 1ランを最後まで自動プレイし、計測ログを返す。 */
export function runOnce(
  seed: string,
  difficulty: string,
  policy: string,
  meta: MetaProfile = 'fresh',
): RunLog {
  const spec = POLICY_DEFS[policy];
  if (!spec) throw new Error(`unknown policy: ${policy}`);
  const unlocked = unlockedFor(meta);
  const e = new RunEngine({
    seed,
    difficulty: difficulty as RunState['difficulty'],
    allowedCards: unlocked.cards,
    allowedRelics: unlocked.relics,
  });
  e.startRun();
  const sprints: SprintLog[] = [];
  const quarters: QuarterLog[] = [];
  const evolutionUnlocks: RunLog['evolutionUnlocks'] = [];
  /** 危険種別ごとの発動可能介入トラック（RI-89）。キーがある＝その危険域を観測。 */
  const availableInDangerByReason = new Map<DangerLoseReason, DangerTrack>();
  /** 敗北を検知した時点のフェーズ（直前状態をどこから取るかの判定に使う）。 */
  let lostPhase: string | undefined;
  /**
   * 敗北したスプリントが結果を残したか。
   *
   * `sprint` フェーズでの敗北には2通りある。スプリントを完走して結果が敗北条件を満たした場合と、
   * カード発動（`playCard` は `applyImmediateLose` を呼ぶ）などで結果を残さずスプリント中に
   * 終わる場合である。ログは `sprintsPlayed` が増えたときだけ push するので、後者では
   * `sprints` の末尾が敗北スプリントではなく**最後に完了したスプリント**になる。
   * 直前状態をどこから取るかが変わるため区別して記録する。
   */
  let lostSprintCompleted: boolean | undefined;
  /** 直近に解決したビート（敗北がビートで確定したときに残す）。 */
  let lastBeat: { eventId: string; kind: string; choiceIndex?: number } | undefined;
  let lostBeat: typeof lastBeat;
  /**
   * 敗北を確定させた処理の直前状態。ループの各反復の冒頭で控え、
   * その反復で敗北を検知したらその控えを採用する。
   */
  let lostPrevState: RunLog['lostPrevState'];
  let guard = 0;
  let s = e.snapshot();
  while (s.status === 'playing' && guard < 60_000) {
    guard += 1;
    s = e.snapshot();
    const beforeAction = orgSnapshot(s);
    const loggedBefore = sprints.length;
    // 採用・復職どちらのベンチ滞留も、方針に関係なく実働へ戻し、方針固有の編成も掛け直す。
    //
    // `setup` だけで適用すると、復職者がベンチのまま・方針の AI 配布や編成が未適用のまま
    // 次スプリントを迎える経路が残る。`resolveBeat()` は既定の `leadsTo === 'sprint'` で
    // `launchSprint()` を直接呼び、`setup` を通らないためである。復帰は `resolveSprint` の
    // `recoverStamina` で起きるので、「スプリント終了 → ビート → 次スプリント」の間に
    // 適用の機会が無い。`assignMember` は `sprint` フェーズでは何もしないので、
    // それ以外の全フェーズで呼ぶ。
    if (s.phase !== 'sprint') applyRosterPolicy(e, spec);
    switch (s.phase) {
      case 'setup':
        applySetup(e, spec);
        e.beginSetupSprint();
        break;
      case 'sprint': {
        const kind = s.currentSprintKind ?? 'normal';
        const quarter = s.quarterNumber;
        const index = s.sprintIndexInQuarter;
        const focusMax = s.sprint?.config.focusMax ?? 0;
        const before = s.sprintsPlayed;
        const attempts: Record<string, Partial<Record<DispatchReason, number>>> = {};
        let interventions = 0;
        const sampleDanger = (): void => sampleAvailableInDanger(e, availableInDangerByReason);
        sampleDanger();
        playHand(e, spec.cards, sampleDanger);
        let inner = 0;
        while (e.snapshot().phase === 'sprint' && inner < 20_000) {
          inner += 1;
          sampleDanger();
          const n = intervene(e, spec, attempts, sampleDanger);
          interventions += n;
          if (e.snapshot().phase !== 'sprint') break;
          // selective は盤面が落ち着いた瞬間にだけ切るので、スプリント中も判断する。
          if (spec.cards === 'selective') playHand(e, 'selective', sampleDanger);
          if (e.snapshot().phase !== 'sprint') break;
          // stepMs を固定 tick に分割し、各 tick 後に危険域を観測（tick 間の一時的な手を拾う）。
          const ticks = Math.max(1, Math.floor(spec.stepMs / MS_PER_TICK));
          for (let t = 0; t < ticks; t += 1) {
            e.step(MS_PER_TICK);
            if (e.snapshot().phase !== 'sprint') break;
            sampleDanger();
          }
        }
        const after = e.snapshot();
        if (after.sprintsPlayed > before) {
          const r = after.lastResult;
          sprints.push({
            quarter,
            index,
            kind,
            ticks: after.sprintTick,
            focusMax,
            focusRemaining: r?.focusRemaining ?? 0,
            interventions,
            attempts,
            delivered: r?.delivered ?? 0,
            reviewQueueMax: r?.reviewQueueMax ?? 0,
            incidents: r?.incidents ?? 0,
            contained: r?.contained ?? 0,
            spread: r?.spread ?? 0,
            rework: r?.rework ?? 0,
            aiPct: Math.round(r?.aiAssistedPct ?? 0),
            grade: r?.grade ?? '',
            hpDelta: Math.round((r?.seniorHpDelta ?? 0) * 10) / 10,
            seniorHpAfter: Math.round(after.org.seniorHp * 10) / 10,
            moraleAfter: Math.round(after.org.morale * 10) / 10,
            techDebtAfter: Math.round(after.org.techDebt * 10) / 10,
            aiDepAfter: Math.round(after.org.aiDependency * 10) / 10,
            budgetAfter: Math.round(after.budget * 10) / 10,
          });
        }
        break;
      }
      case 'result':
        e.acknowledgeResult();
        break;
      case 'draft':
        if (s.draft && s.draft.length > 0) e.chooseCard(pickDraft(s.draft, spec.draft));
        else e.skipDraft();
        break;
      case 'evolution': {
        // 使えるポイントは使い切る（プレイヤーは持ち越さない）。順序は方針で変える。
        if (spec.evolve !== 'none') {
          const order = evolutionOrder(spec.evolve);
          let spent = 0;
          while (e.snapshot().evolution.points > 0 && spent < 16) {
            const before = e.snapshot().evolution.points;
            const beforeIds = new Set(Object.keys(e.snapshot().evolution.unlocked));
            for (const id of order) {
              e.unlockEvolution(id);
              if (e.snapshot().evolution.points < before) break;
            }
            const after = e.snapshot();
            if (after.evolution.points >= before) break;
            // どのノードをいつ解放したかを残す（F-11 はタイミングが判定対象）。
            for (const id of Object.keys(after.evolution.unlocked)) {
              if (beforeIds.has(id)) continue;
              evolutionUnlocks.push({
                id,
                quarter: after.quarterNumber,
                sprintIndex: after.sprintIndexInQuarter,
              });
            }
            spent += 1;
          }
        }
        e.finishEvolution();
        break;
      }
      case 'beat': {
        if (!s.beat) {
          guard = 60_000;
          break;
        }
        const choice = autoplayBeatChoiceIndex(
          s.beat.eventId,
          s.beat.kind,
          wantsRecruit(s, spec),
          spec.beat,
          {
            org: s.org,
            budget: s.budget,
            trust: s.stakeholderTrust,
            moraleDamageMul: foldPassives(s.relics).moraleDamageMul,
            rest: spec.rest,
            roster: s.roster,
            relics: s.relics,
            relicSlots: foldPassives(s.relics).relicSlots,
            restHealBonus: foldPassives(s.relics).restHealBonus,
          },
        );
        lastBeat = { eventId: s.beat.eventId, kind: s.beat.kind, choiceIndex: choice };
        e.resolveBeat(choice);
        break;
      }
      case 'shop':
        // 採用方針は専用フェーズだけでなくショップの採用枠にも適用する。
        // 適用しないと「採用あり」群に採用機会を見送ったランが混ざる。
        if (s.shop?.recruit && !s.shop.recruit.bought && wantsRecruit(s, spec)) {
          e.buyShopRecruit();
        }
        // カード・レリックはスプリント間投資（F-2）の一部。買う方針だけ買う。
        if (spec.shop === 'buy') buyShopItems(e, spec);
        e.leaveShop();
        break;
      case 'rest':
        // 採用方針は休息の選択肢にも適用する（RestScreen に採用がある）。
        // ただし満員・予算不足では実画面のボタンが無効なので、他の選択へフォールバックする。
        e.restChoose(wantsRecruit(s, spec) ? 'recruit' : restChoice(s, spec), restUpgradeIndex(s));
        break;
      case 'recruit':
        e.recruitChoose(wantsRecruit(s, spec) ? 'hire' : 'skip');
        break;
      case 'quarterReview': {
        const qr = s.quarterReview;
        if (qr) {
          const minTrust = Math.min(qr.trust.management, qr.trust.customers, qr.trust.team);
          const missedCount = qr.progress.filter((p) => p.status === 'missed').length;
          const log: QuarterLog = {
            quarter: s.quarterNumber,
            outcome: qr.outcome,
            bossCleared: qr.bossCleared,
            trustManagement: Math.round(qr.trust.management),
            trustCustomers: Math.round(qr.trust.customers),
            trustTeam: Math.round(qr.trust.team),
            minTrust: Math.round(minTrust),
            budget: Math.round(s.budget),
            missedCount,
            crisisTriggers: crisisTriggers(minTrust, s.budget, missedCount),
            shutdownTriggers: shutdownTriggers(
              minTrust,
              s.budget,
              s.org.morale,
              s.org.seniorHp,
              missedCount,
            ),
            seniorHp: Math.round(s.org.seniorHp),
            morale: Math.round(s.org.morale),
          };
          if (qr.outcome === 'missed_adjustable') {
            const want = spec.goalAdjustment;
            const pick =
              want && qr.availableAdjustments.includes(want)
                ? want
                : (qr.availableAdjustments[0] ?? 'cut_scope');
            log.chosenAdjustment = pick;
            quarters.push(log);
            e.chooseGoalAdjustment(pick);
            break;
          }
          quarters.push(log);
        }
        e.acknowledgeQuarterReview();
        break;
      }
      default:
        guard = 60_000;
        break;
    }
    const next = e.snapshot();
    if (next.status !== 'playing' && lostPhase === undefined) {
      lostPhase = s.phase;
      lostPrevState = beforeAction;
      if (s.phase === 'beat') lostBeat = lastBeat;
      // 同じ反復でログが増えていれば、その末尾が敗北スプリントそのもの。
      if (s.phase === 'sprint') lostSprintCompleted = sprints.length > loggedBefore;
    }
    s = next;
  }
  const f = e.snapshot();
  return {
    seed,
    difficulty,
    policy,
    meta,
    evolutionUnlocks,
    ...(f.status === 'lost' ? { lostPhase } : {}),
    ...(f.status === 'lost' && lostBeat ? { lostBeat } : {}),
    ...(f.status === 'lost' && lostSprintCompleted !== undefined ? { lostSprintCompleted } : {}),
    ...(f.status === 'lost' && lostPrevState ? { lostPrevState } : {}),
    status: f.status,
    winType: f.winType,
    loseReason: f.loseReason,
    quarterNumber: f.quarterNumber,
    sprintsPlayed: f.sprintsPlayed,
    diagnosis: f.diagnosis,
    sprints,
    quarters,
    ...(f.loseReason && availableInDangerByReason.has(f.loseReason as DangerLoseReason)
      ? (() => {
          const track = availableInDangerByReason.get(f.loseReason as DangerLoseReason)!;
          return {
            availableActionsInDanger: [...track.actions].sort(),
            availableActionsInDangerFirstSample: track.firstSample,
            availableActionsInDangerLastSample: track.lastSample,
            ...(track.lastNonEmpty
              ? { availableActionsInDangerLastNonEmpty: track.lastNonEmpty }
              : {}),
          };
        })()
      : {}),
    finalOrg: {
      aiEnabled: f.org.aiEnabled,
      aiDependency: Math.round(f.org.aiDependency),
      aiLiteracy: Math.round(f.org.aiLiteracy),
      testCoverage: Math.round(f.org.testCoverage),
      documentation: Math.round(f.org.documentation),
      quality: Math.round(f.org.quality),
      morale: Math.round(f.org.morale),
      seniorHp: Math.round(f.org.seniorHp),
      techDebt: Math.round(f.org.techDebt),
    },
    totalDelivered: Math.round(f.totals.delivered ?? 0),
    budget: Math.round(f.budget),
    relics: f.relics.length,
    deckSize: f.deck.length,
    evolutionUnlocked: Object.keys(f.evolution.unlocked).length,
    goalAdjustments: f.goalAdjustmentsTaken,
  };
}

/** 難易度 × 方針 × seed の総当たりを実行する。 */
export function runMatrix(
  difficulties: readonly string[],
  policies: readonly string[],
  seeds: readonly string[],
  meta: MetaProfile = 'fresh',
): RunLog[] {
  const out: RunLog[] = [];
  for (const d of difficulties) {
    for (const p of policies) {
      for (const seed of seeds) out.push(runOnce(seed, d, p, meta));
    }
  }
  return out;
}
