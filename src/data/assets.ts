export type GameAsset = {
  id: string;
  name: string;
  type: 'currency' | 'hazard' | 'mascot' | 'reward';
  path: string;
  recommendedUse: string;
};

export const gameAssets = [
  {
    id: 'ci-bot',
    name: 'CI Bot',
    type: 'mascot',
    path: '/assets/game/ci-bot.svg',
    recommendedUse: 'team member, helper, tutorial avatar',
  },
  {
    id: 'deploy-crate',
    name: 'Deploy Crate',
    type: 'reward',
    path: '/assets/game/deploy-crate.svg',
    recommendedUse: 'sprint reward, unlock, loot marker',
  },
  {
    id: 'incident-flame',
    name: 'Incident Flame',
    type: 'hazard',
    path: '/assets/game/incident-flame.svg',
    recommendedUse: 'incident event, production fire, alert marker',
  },
  {
    id: 'pipeline-token',
    name: 'Pipeline Token',
    type: 'currency',
    path: '/assets/game/pipeline-token.svg',
    recommendedUse: 'automation currency, pipeline score, upgrade token',
  },
] as const satisfies readonly GameAsset[];
