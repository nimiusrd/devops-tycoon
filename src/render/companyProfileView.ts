import { BRANCH_LABEL, EVOLUTION_NODES, getEvolutionNode } from '../data/evolution';
import type { RelicDef } from '../data/relics';
import { rankLabel } from '../sim/member';
import { canUnlock, isUnlocked } from '../sim/run/evolution';
import type { EvolutionState, RunState } from '../sim/run/types';
import type { CardDef } from '../sim/types';
import {
  formatCardTagsAtLevel,
  formatEvolutionNodeTags,
  formatRelicDefTags,
} from './eventOutcomeView';

export type CompanyProfileState = Pick<
  RunState,
  'evolution' | 'deck' | 'relics' | 'roster' | 'activeTeamId' | 'teams'
>;

const NODE_STATUS = {
  unlocked: '解放済み',
  available: '解放可能',
  prerequisite: '前提未達',
  points: 'ポイント不足',
} as const;

function evolutionBranches(evolution: EvolutionState) {
  return Object.entries(BRANCH_LABEL).map(([branch, label]) => {
    const nodes = EVOLUTION_NODES.filter((node) => node.branch === branch).map((node) => {
      const unlocked = isUnlocked(evolution, node.id);
      const missingPrerequisite = node.requires && !isUnlocked(evolution, node.requires);
      const status = unlocked
        ? NODE_STATUS.unlocked
        : canUnlock(evolution, node.id)
          ? NODE_STATUS.available
          : missingPrerequisite
            ? NODE_STATUS.prerequisite
            : NODE_STATUS.points;

      return {
        id: node.id,
        name: node.name,
        description: node.description,
        tags: formatEvolutionNodeTags(node),
        unlocked,
        status,
        prerequisite: node.requires
          ? {
              name: getEvolutionNode(node.requires)?.name ?? node.requires,
              met: !missingPrerequisite,
            }
          : null,
        cost: node.cost,
        shortfall: Math.max(0, node.cost - evolution.points),
      };
    });
    return {
      branch,
      label,
      nodes,
      unlockedCount: nodes.filter((node) => node.unlocked).length,
      next: nodes.find((node) => !node.unlocked),
    };
  });
}

export function companyProfileView(
  state: CompanyProfileState,
  content: { resolveCard: (id: string) => CardDef; resolveRelic: (id: string) => RelicDef },
) {
  const branches = evolutionBranches(state.evolution);
  return {
    branches,
    unlockedCount: branches.reduce((count, branch) => count + branch.unlockedCount, 0),
    evolutionCount: EVOLUTION_NODES.length,
    points: state.evolution.points,
    cards: state.deck.map(({ defId, level }) => {
      const def = content.resolveCard(defId);
      return {
        id: defId,
        name: def.name,
        level,
        description: def.description.join(' / '),
        tags: formatCardTagsAtLevel(def, level),
      };
    }),
    relics: state.relics.map((id) => {
      const def = content.resolveRelic(id);
      return { id, name: def.name, description: def.description, tags: formatRelicDefTags(def) };
    }),
    // 公開状態の個人データは支援中チームのロスター。全社HUDの稼働人数とは別の範囲。
    teamName: state.teams.find((team) => team.id === state.activeTeamId)?.name,
    members: state.roster.members.map(({ id, name, rank, level, onLeave }) => ({
      id,
      name,
      rank: rankLabel(rank),
      level,
      onLeave,
    })),
  };
}
