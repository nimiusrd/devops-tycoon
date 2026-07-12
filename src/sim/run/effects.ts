/**
 * ラン中の係数・パッシブの集約（SPEC 第7 / 第8 / 第11 / 第16章）。
 *
 * レリック・進化ノード・難易度・試練を 1 つの `CardEffects`
 * （スプリントの確率モデルに掛かる係数）と、集中力/実装枠の補正、ラン全体の
 * 数値パッシブに畳み込む純TS。カードは手札発動（RI-30）のためここでは含めない。
 * 加算系（aiLiteracyAdd 等）は取得/発動時に組織へ反映する想定（engine 側で適用）。
 */
import { getBoss } from '../../data/bosses';
import { getDifficulty, getTrial } from '../../data/difficulties';
import { getEvolutionNode } from '../../data/evolution';
import { getRelic } from '../../data/relics';
import { combineEffects } from '../cards';
import { IDENTITY_CARD_EFFECTS } from '../model';
import type {
  CardEffects,
  CardInstance,
  DifficultyId,
  EvolutionState,
  RunEffects,
  RunPassives,
} from './types';

/** 部分指定の効果を完全な `CardEffects` に補完する。 */
export function toEffects(partial: Partial<CardEffects>): CardEffects {
  return { ...IDENTITY_CARD_EFFECTS, ...partial };
}

/** 無効果のパッシブ（既定値）。 */
export const IDENTITY_PASSIVES: RunPassives = {
  moraleDamageMul: 1,
  restHealBonus: 0,
  shopDiscount: 0,
  relicSlots: 6,
};

export interface RunModifierInput {
  /** @deprecated RI-30: デッキは手札発動のため fold に含めない。後方互換で受け取るのみ。 */
  deck: CardInstance[];
  relics: string[];
  evolution: EvolutionState;
  difficulty: DifficultyId;
  trials: string[];
}

/**
 * このスプリントに掛かる乗算系係数と、集中力/実装枠の補正を畳み込む。
 * 難易度の全体係数・試練・レリック・進化を合成する（カードは含まない。RI-30）。
 */
export function foldRunEffects(input: RunModifierInput): RunEffects {
  let effects: CardEffects = { ...IDENTITY_CARD_EFFECTS };
  let focusBonus = 0;
  let codingSlotBonus = 0;
  let aiDependencyDriftPerSprint = 0;
  let frontierModelCostPerDependency = 0;

  const diff = getDifficulty(input.difficulty);
  if (diff.globalEffects) effects = combineEffects(effects, toEffects(diff.globalEffects));

  for (const trialId of input.trials) {
    const trial = getTrial(trialId);
    if (!trial) continue;
    if (trial.effects) effects = combineEffects(effects, toEffects(trial.effects));
    if (trial.focusDelta) focusBonus += trial.focusDelta;
    aiDependencyDriftPerSprint += trial.aiDependencyDriftPerSprint ?? 0;
    frontierModelCostPerDependency += trial.frontierModelCostPerDependency ?? 0;
  }

  // RI-30: デッキカードは手札発動のためここでは合成しない。
  void input.deck;

  for (const relicId of input.relics) {
    const relic = getRelic(relicId);
    if (relic?.effects) effects = combineEffects(effects, toEffects(relic.effects));
  }

  for (const nodeId of Object.keys(input.evolution.unlocked)) {
    const node = getEvolutionNode(nodeId);
    if (!node) continue;
    if (node.effects) effects = combineEffects(effects, toEffects(node.effects));
    if (node.focusBonus) focusBonus += node.focusBonus;
    if (node.codingSlotBonus) codingSlotBonus += node.codingSlotBonus;
  }

  return {
    effects,
    focusBonus,
    codingSlotBonus,
    aiDependencyDriftPerSprint,
    frontierModelCostPerDependency,
  };
}

/** ラン全体の数値パッシブ（レリックの合算）を求める。 */
export function foldPassives(relics: string[]): RunPassives {
  const out: RunPassives = { ...IDENTITY_PASSIVES };
  for (const relicId of relics) {
    const relic = getRelic(relicId);
    if (!relic?.passives) continue;
    const p = relic.passives;
    if (p.moraleDamageMul !== undefined) out.moraleDamageMul *= p.moraleDamageMul;
    if (p.restHealBonus !== undefined) out.restHealBonus += p.restHealBonus;
    if (p.shopDiscount !== undefined)
      out.shopDiscount = Math.min(0.8, out.shopDiscount + p.shopDiscount);
    if (p.relicSlots !== undefined) out.relicSlots = p.relicSlots;
  }
  return out;
}

/** ボスの障害率倍率を、スプリント係数へ掛ける（タスク量は config 側で扱う）。 */
export function withBossEffects(base: CardEffects, bossId: string | null): CardEffects {
  if (!bossId) return base;
  const boss = getBoss(bossId);
  if (!boss) return base;
  return { ...base, incidentRateMul: base.incidentRateMul * boss.incidentMul };
}
