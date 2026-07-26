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
import { ACTION_DEFS } from '../../src/data/actions';
import { CARD_DEFS } from '../../src/data/cards';
import { RELIC_DEFS } from '../../src/data/relics';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../src/data/unlocks';
import { FIXED_STEP_MS } from '../../src/sim/engine';
import { RunEngine } from '../../src/sim/run/engine';
import type { GoalAdjustmentId, RunState } from '../../src/sim/run/types';
import type { ActionId } from '../../src/sim/types';

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
  /** step 幅（ms）。大きいほど反応が鈍い＝初見寄り。 */
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
  /** 採用フェーズの選択。 */
  recruit: 'hire' | 'skip';
  /** 目標修正の選択（固定）。未指定は提示順の先頭。 */
  goalAdjustment?: GoalAdjustmentId;
  /** 試行順を tick ごとに回転させる（probe の順序バイアス平準化用）。 */
  rotateActions?: boolean;
}

/** `RunEngine.step` の 1 tick 相当（ms）。最小刻みで試行するにはこの値を渡す。 */
export const MS_PER_TICK = FIXED_STEP_MS;

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

const ALL_ACTION_IDS = ACTION_DEFS.map((d) => d.id);

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
    recruit: 'skip',
  };
}

/**
 * 単一介入だけを打つ方針。進化順は比較対象の `skilledNoHire` と同じ `reviewFirst` に揃える
 * （揃えないと介入構成と進化順が同時に変わり、F-1 の判定を帰属できない）。
 */
const single = (id: ActionId): PolicySpec => ({
  actions: [{ id }],
  stepMs: 300,
  cards: 'always',
  evolve: 'reviewFirst',
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
  /** ビルド差分（F-10）。 */
  aiFullBet: {
    actions: SKILLED_ACTIONS.filter((a) => a.id !== 'andon'),
    stepMs: 300,
    cards: 'always',
    evolve: 'aiFirst',
    draft: 'ai',
    ai: 'all',
    recruit: 'hire',
  },
  noAi: {
    actions: SKILLED_ACTIONS.filter((a) => a.id !== 'andon'),
    stepMs: 300,
    cards: 'always',
    evolve: 'qualityFirst',
    draft: 'quality',
    ai: 'none',
    recruit: 'hire',
  },
  reviewHeavy: {
    actions: [{ id: 'firefight', when: (c) => c.burning >= 1 }, { id: 'assignTask' }],
    stepMs: 300,
    cards: 'always',
    evolve: 'reviewFirst',
    formation: 'reviewHeavy',
    recruit: 'hire',
  },
  /**
   * F-5 用の統制条件。`skilledNoHire` から介入だけを外し、
   * カード・進化・採用は揃える（進化条件が違うと分散差を介入に帰属できない）。
   */
  noInterventionCtl: { ...skilledBase(), actions: [] },
  /** カードを状況に応じて選ぶ方針（無差別発動との比較用。RI-77）。 */
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
  /**
   * 全介入を 1 tick ごとに試行する（RI-77）。
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

/** 介入の試行結果内訳（RI-77 の「発動可能だった回数」測定用）。 */
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

/** 四半期レビュー到達時のスナップショット（RI-78 の発火要因分解用）。 */
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
}

/**
 * オートプレイ用のビート選択肢 index。
 * 明示指定がなければ即時採用（`grantRecruit`）を避け、決定論シードの安定を保つ。
 */
export function autoplayBeatChoiceIndex(
  eventId: string,
  kind: 'judgment' | 'decision',
  recruit: PolicySpec['recruit'] = 'skip',
): number | undefined {
  if (kind === 'judgment') return undefined;
  const choices = getEvent(eventId)?.choices ?? [];
  // 採用方針が hire なら即時採用の選択肢を取る。skip のときだけ避ける
  // （避けないと「採用なし」群に採用が混ざる）。
  if (recruit === 'hire') {
    const grant = choices.findIndex((c) => c.outcome.grantRecruit);
    if (grant >= 0) return grant;
    return 0;
  }
  let choice = 0;
  if (choices[choice]?.outcome.grantRecruit) {
    const alt = choices.findIndex((c) => !c.outcome.grantRecruit);
    if (alt >= 0) choice = alt;
  }
  return choice;
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

function playHand(e: RunEngine, mode: PolicySpec['cards']): void {
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
): number {
  const ctx = boardCtx(e.snapshot());
  if (!ctx) return 0;
  let n = 0;
  // 固定順だと先頭のアクションが集中力を独占するため、probe では tick ごとに順を回す。
  const order = spec.rotateActions
    ? spec.actions.map((_, i) => spec.actions[(i + ctx.tick) % spec.actions.length])
    : spec.actions;
  for (const a of order) {
    if (a.when && !a.when(ctx)) continue;
    const outcome = e.dispatch(a.id);
    if (outcome.ok) {
      bump(attempts, a.id, 'ok');
      n += 1;
    } else {
      const reason = (outcome.reason ?? 'other') as DispatchReason;
      bump(attempts, a.id, reason);
    }
    if (e.snapshot().phase !== 'sprint') break;
  }
  return n;
}

function applySetup(e: RunEngine, spec: PolicySpec): void {
  if (spec.ai) {
    for (const m of e.snapshot().roster.members) e.setMemberAi(m.id, spec.ai === 'all');
  }
  if (spec.formation === 'reviewHeavy') {
    let coders = 0;
    for (const m of e.snapshot().roster.members) {
      if (m.assignment !== 'coding') continue;
      coders += 1;
      if (coders > 1) e.assignMember(m.id, 'review');
    }
  }
}

/**
 * `missed_crisis` を発火させうる条件のうち、実際に成立していたものを列挙する。
 * `evaluateQuarterOutcome`（`src/sim/run/quarterReview.ts`）の判定と対応させる。
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
 * `shutdown` も `loseReasonForOutcome` で `trustExhausted` に変換されるため、
 * 信頼枯渇ラベルの実態を見るには両方を分解する必要がある。
 *
 * 注意: エンジンは `companyOrgFromTeams` の全社集約値で判定するが、ここで読めるのは
 * 選択中チームの `state.org` である。複数チームの状態が乖離したランでは条件を
 * 再現できないことがあり、その場合は空配列（レポート上は `none`）になる。
 * `none` が出た件数は、この再現の限界として読むこと。
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
  /** 敗北を検知した時点のフェーズ（直前状態をどこから取るかの判定に使う）。 */
  let lostPhase: string | undefined;
  let guard = 0;
  let s = e.snapshot();
  while (s.status === 'playing' && guard < 60_000) {
    guard += 1;
    s = e.snapshot();
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
        playHand(e, spec.cards);
        let inner = 0;
        while (e.snapshot().phase === 'sprint' && inner < 20_000) {
          inner += 1;
          interventions += intervene(e, spec, attempts);
          if (e.snapshot().phase !== 'sprint') break;
          // selective は盤面が落ち着いた瞬間にだけ切るので、スプリント中も判断する。
          if (spec.cards === 'selective') playHand(e, 'selective');
          if (e.snapshot().phase !== 'sprint') break;
          e.step(spec.stepMs);
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
        e.resolveBeat(autoplayBeatChoiceIndex(s.beat.eventId, s.beat.kind, spec.recruit));
        break;
      }
      case 'shop':
        // 採用方針は専用フェーズだけでなくショップの採用枠にも適用する。
        // 適用しないと「採用あり」群に採用機会を見送ったランが混ざる。
        if (spec.recruit === 'hire' && s.shop?.recruit && !s.shop.recruit.bought) {
          e.buyShopRecruit();
        }
        e.leaveShop();
        break;
      case 'rest':
        // 採用方針は休息の選択肢にも適用する（RestScreen に採用がある）。
        e.restChoose(spec.recruit === 'hire' ? 'recruit' : 'heal');
        break;
      case 'recruit':
        e.recruitChoose(spec.recruit);
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
    if (next.status !== 'playing' && lostPhase === undefined) lostPhase = s.phase;
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
    status: f.status,
    winType: f.winType,
    loseReason: f.loseReason,
    quarterNumber: f.quarterNumber,
    sprintsPlayed: f.sprintsPlayed,
    diagnosis: f.diagnosis,
    sprints,
    quarters,
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
