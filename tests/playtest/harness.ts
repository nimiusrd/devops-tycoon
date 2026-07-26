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
  /** 手札を発動するか。 */
  playCards: boolean;
  /** 進化ポイントを使うか。 */
  evolve: boolean;
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
 * 進化ノードの解放優先順（レビュー容量 → 品質 → AI → 文化 → 開発速度）。
 * 前提ノードのある上位も含め、解放できるものを順に取る。
 */
const EVOLUTION_PICK_ORDER = [
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

function skilledBase(): PolicySpec {
  return {
    actions: SKILLED_ACTIONS,
    stepMs: 300,
    playCards: true,
    evolve: true,
    recruit: 'skip',
  };
}

const single = (id: ActionId): PolicySpec => ({
  actions: [{ id }],
  stepMs: 300,
  playCards: true,
  evolve: true,
  recruit: 'skip',
});

/** 方針一覧（SPEC 第19.1.3 の観測に対応）。 */
export const POLICY_DEFS: Record<string, PolicySpec> = {
  /** 介入もカードも一切使わない完全放置（下限ベースライン）。 */
  idle: { actions: [], stepMs: 1_000_000, playCards: false, evolve: false, recruit: 'skip' },
  /** 介入なし・カードのみ（F-5 の無介入ベースライン）。 */
  passive: { actions: [], stepMs: 1_000_000, playCards: true, evolve: false, recruit: 'skip' },
  /** 初見想定。異常が目立ってから反応する。 */
  naive: {
    actions: [
      { id: 'firefight', when: (c) => c.burning >= 2 },
      { id: 'interruptReview', when: (c) => c.reviewLen >= 12 },
    ],
    stepMs: 600,
    playCards: true,
    evolve: true,
    recruit: 'skip',
  },
  /** 上級者想定。閾値低め＋andon＋差配、採用あり。 */
  skilled: {
    actions: SKILLED_ACTIONS,
    stepMs: 300,
    playCards: true,
    evolve: true,
    recruit: 'hire',
  },
  /** skilled から採用だけを外した統制条件。 */
  skilledNoHire: skilledBase(),
  /** skilled から採用とカードを外した統制条件。 */
  skilledNoCards: { ...skilledBase(), playCards: false },
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
    playCards: true,
    evolve: true,
    ai: 'all',
    recruit: 'hire',
  },
  noAi: {
    actions: SKILLED_ACTIONS.filter((a) => a.id !== 'andon'),
    stepMs: 300,
    playCards: true,
    evolve: true,
    ai: 'none',
    recruit: 'hire',
  },
  reviewHeavy: {
    actions: [{ id: 'firefight', when: (c) => c.burning >= 1 }, { id: 'assignTask' }],
    stepMs: 300,
    playCards: true,
    evolve: true,
    formation: 'reviewHeavy',
    recruit: 'hire',
  },
  /**
   * 目標修正の選択別の後続差分を見る統制条件（F-2 第4層）。
   * 提示されないときだけ提示順の先頭へフォールバックする。
   */
  adjCutScope: { ...skilledBase(), goalAdjustment: 'cut_scope' },
  adjExtendDeadline: { ...skilledBase(), goalAdjustment: 'extend_deadline' },
  adjQualityPivot: { ...skilledBase(), goalAdjustment: 'quality_pivot' },
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
    playCards: false,
    evolve: true,
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
): number | undefined {
  if (kind === 'judgment') return undefined;
  const choices = getEvent(eventId)?.choices ?? [];
  let choice = 0;
  if (choices[choice]?.outcome.grantRecruit) {
    const alt = choices.findIndex((c) => !c.outcome.grantRecruit);
    if (alt >= 0) choice = alt;
  }
  return choice;
}

function playHand(e: RunEngine): void {
  let guard = 0;
  while (guard < 24 && e.snapshot().phase === 'sprint') {
    guard += 1;
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
        if (spec.playCards) playHand(e);
        let inner = 0;
        while (e.snapshot().phase === 'sprint' && inner < 20_000) {
          inner += 1;
          interventions += intervene(e, spec, attempts);
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
        if (s.draft && s.draft.length > 0) e.chooseCard(s.draft[0]);
        else e.skipDraft();
        break;
      case 'evolution': {
        // 使えるポイントは使い切る（プレイヤーは持ち越さない）。
        if (spec.evolve) {
          let spent = 0;
          while (e.snapshot().evolution.points > 0 && spent < 16) {
            const before = e.snapshot().evolution.points;
            for (const id of EVOLUTION_PICK_ORDER) {
              e.unlockEvolution(id);
              if (e.snapshot().evolution.points < before) break;
            }
            if (e.snapshot().evolution.points >= before) break;
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
        e.resolveBeat(autoplayBeatChoiceIndex(s.beat.eventId, s.beat.kind));
        break;
      }
      case 'shop':
        e.leaveShop();
        break;
      case 'rest':
        e.restChoose('heal');
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
    s = e.snapshot();
  }
  const f = e.snapshot();
  return {
    seed,
    difficulty,
    policy,
    meta,
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
