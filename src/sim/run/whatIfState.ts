/**
 * setup / draft 向け what-if 状態の純関数生成（RI-46 / RI-13）。
 *
 * RunEngine から切り出し、Web Worker（+Comlink）でも同じ決定論結果を得られるようにする。
 */
import { getCard } from '../../data/cards';
import { applyDeckBaseline, dealHand, scaleEffects } from '../cards';
import type { RosterState } from '../member/types';
import { evaluateLose } from '../outcome';
import { createRng } from '../rng';
import type { OrgState, SprintConfig } from '../types';
import {
  applyTrialAiDependencyPressure,
  BETWEEN_SPRINT_RECOVERY,
  buildSprintBaselineInput,
  type SprintBaselineBuildContext,
} from './sprintBaselineBuild';
import { withTeamBoardPressure } from './sprintBaseline';
import { previewNextSprint } from './whatIf';
import type {
  DifficultyId,
  EvolutionState,
  RunTotals,
  SprintKind,
  SprintModifierDelta,
  WhatIfPreview,
  WhatIfState,
} from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Worker / メインスレッドで共有するシリアライズ可能な what-if 入力。 */
export interface WhatIfComputeInput {
  phase: 'setup' | 'draft';
  seed: string;
  quarterNumber: number;
  sprintIndexInQuarter: number;
  sprintsPerQuarter: number;
  pendingSprintKind: SprintKind;
  pendingSprintModifiers: SprintModifierDelta;
  deck: { defId: string; level: number }[];
  draft: string[] | null;
  roster: RosterState;
  org: OrgState;
  budget: number;
  totals: RunTotals;
  relics: string[];
  evolution: EvolutionState;
  difficulty: DifficultyId;
  trials: string[];
  bossId: string;
  pauseAiDebuffQuarter: number | null;
  baseConfig: SprintConfig;
  /** 選択中チーム正本のレビュー待ち（本番 beginSprint と共有）。 */
  teamReviewQueue?: number;
  /** 選択中チーム正本の炎上件数（本番 beginSprint と共有）。 */
  teamIncidents?: number;
}

function baselineContext(input: WhatIfComputeInput): SprintBaselineBuildContext {
  return {
    relics: input.relics,
    evolution: input.evolution,
    difficulty: input.difficulty,
    trials: input.trials,
    bossId: input.bossId,
    pauseAiDebuffQuarter: input.pauseAiDebuffQuarter,
    quarterNumber: input.quarterNumber,
    baseConfig: input.baseConfig,
  };
}

/** setup / draft の試算入力を指紋化し、同一条件の再計算を避ける。 */
export function whatIfCacheKey(input: WhatIfComputeInput): string {
  // 編成効果（能力・トレイト・ランク）まで含める。切替後の古いプレビュー再利用を防ぐ。
  const rosterKey = input.roster.members
    .map((m) =>
      [
        m.id,
        m.assignment,
        m.aiAssigned ? 1 : 0,
        m.onLeave ? 1 : 0,
        m.rank,
        m.level,
        m.stats.implementation,
        m.stats.review,
        m.stats.aiMastery,
        m.traits.join('+'),
      ].join(':'),
    )
    .join(',');
  const deckKey = input.deck.map((c) => `${c.defId}:${c.level}`).join(',');
  const draftKey = input.draft?.join(',') ?? '';
  const mod = input.pendingSprintModifiers;
  const org = input.org;
  return [
    input.phase,
    input.seed,
    input.quarterNumber,
    input.sprintIndexInQuarter,
    input.pendingSprintKind,
    deckKey,
    draftKey,
    rosterKey,
    org.seniorHp,
    org.aiDependency,
    org.morale,
    org.techDebt,
    org.quality,
    org.testCoverage,
    org.aiLiteracy,
    org.documentation,
    org.aiEnabled ? 1 : 0,
    input.budget,
    mod.reviewLoadAdd ?? 0,
    mod.reworkRateAdd ?? 0,
    mod.taskCountMul ?? 1,
    mod.focusMaxAdd ?? 0,
    input.teamReviewQueue ?? 0,
    input.teamIncidents ?? 0,
  ].join('|');
}

/** setup / draft における、次スプリントのリスク幅プレビューを生成する。 */
export function computeWhatIfState(input: WhatIfComputeInput): WhatIfState | null {
  if (input.phase !== 'setup' && input.phase !== 'draft') return null;

  const ctx = baselineContext(input);
  const nextIndex = input.sprintIndexInQuarter + 1;
  const kind: SprintKind = nextIndex >= input.sprintsPerQuarter ? 'boss' : input.pendingSprintKind;
  // draft 中の入り込みペナルティ等も次スプリントに載るので、試算でも同じ modifiers を使う。
  const modifiers = input.pendingSprintModifiers;
  const baseSeed = `${input.seed}:what-if:q${input.quarterNumber}:s${nextIndex}`;

  const previewFor = (
    deck: { defId: string; level: number }[],
    org: OrgState,
    playedCards: { defId: string; level: number }[] = [],
  ): WhatIfPreview => {
    const previewOrg = structuredClone(org);
    previewOrg.seniorHp = clamp(
      previewOrg.seniorHp + (100 - previewOrg.seniorHp) * BETWEEN_SPRINT_RECOVERY,
      0,
      100,
    );
    applyTrialAiDependencyPressure(previewOrg, input.budget, {
      deck: input.deck,
      relics: input.relics,
      evolution: input.evolution,
      difficulty: input.difficulty,
      trials: input.trials,
    });
    for (const played of playedCards) {
      const playedDef = getCard(played.defId);
      if (!playedDef) continue;
      applyDeckBaseline(previewOrg, scaleEffects(playedDef.base, played.level));
    }
    return previewNextSprint(
      withTeamBoardPressure(
        buildSprintBaselineInput(ctx, {
          deck,
          roster: input.roster,
          org: previewOrg,
          kind,
          modifiers,
          seed: baseSeed,
          playedCards,
        }),
        {
          reviewQueue: input.teamReviewQueue ?? 0,
          incidents: input.teamIncidents ?? 0,
        },
      ),
    );
  };

  const current = previewFor(input.deck, input.org);

  const startOrg = structuredClone(input.org);
  startOrg.seniorHp = clamp(
    startOrg.seniorHp + (100 - startOrg.seniorHp) * BETWEEN_SPRINT_RECOVERY,
    0,
    100,
  );
  const budgetAfterPressure = applyTrialAiDependencyPressure(startOrg, input.budget, {
    deck: input.deck,
    relics: input.relics,
    evolution: input.evolution,
    difficulty: input.difficulty,
    trials: input.trials,
  });
  const sprintStartLose = evaluateLose(startOrg, input.totals, budgetAfterPressure);
  if (sprintStartLose) {
    const immediate: WhatIfPreview = {
      trials: 0,
      delivered: { mean: 0, min: 0, max: 0 },
      spread: { mean: 0, min: 0, max: 0 },
      immediateLose: sprintStartLose,
    };
    const draftCandidates: Record<string, WhatIfPreview> = {};
    if (input.phase === 'draft' && input.draft) {
      for (const defId of input.draft) {
        draftCandidates[defId] = { ...immediate };
      }
    }
    return { current: immediate, draftCandidates };
  }

  const draftCandidates: Record<string, WhatIfPreview> = {};
  if (input.phase === 'draft' && input.draft) {
    for (const defId of input.draft) {
      const card = getCard(defId);
      if (!card) continue;
      const nextDeck = [...input.deck, { defId, level: 1 }];
      const nextSprintId = `q${input.quarterNumber}-s${nextIndex}`;
      const dealRng = createRng(`${input.seed}:deal:${nextSprintId}`);
      const piles = dealHand(nextDeck.length, dealRng);
      const newCardIndex = nextDeck.length - 1;
      const inHand = piles.hand.includes(newCardIndex);

      if (!inHand) {
        draftCandidates[defId] = previewFor(nextDeck, input.org, []);
        continue;
      }

      const playOrg = structuredClone(input.org);
      playOrg.seniorHp = clamp(
        playOrg.seniorHp + (100 - playOrg.seniorHp) * BETWEEN_SPRINT_RECOVERY,
        0,
        100,
      );
      const budgetAfterCardPressure = applyTrialAiDependencyPressure(playOrg, input.budget, {
        deck: input.deck,
        relics: input.relics,
        evolution: input.evolution,
        difficulty: input.difficulty,
        trials: input.trials,
      });
      applyDeckBaseline(playOrg, scaleEffects(card.base, 1));
      const loseOnPlay = evaluateLose(playOrg, input.totals, budgetAfterCardPressure);
      if (loseOnPlay) {
        draftCandidates[defId] = {
          trials: 0,
          delivered: { mean: 0, min: 0, max: 0 },
          spread: { mean: 0, min: 0, max: 0 },
          loseOnPlay,
        };
        continue;
      }
      draftCandidates[defId] = previewFor(nextDeck, input.org, [{ defId, level: 1 }]);
    }
  }
  return { current, draftCandidates };
}
