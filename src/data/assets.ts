import { publicUrl } from '../utils/publicUrl';

export type GameAsset = {
  id: string;
  name: string;
  type:
    | 'architecture'
    | 'character'
    | 'currency'
    | 'hazard'
    | 'item'
    | 'maintenance'
    | 'mascot'
    | 'observability'
    | 'reward'
    | 'safety';
  path: string;
  recommendedUse: string;
};

export const gameAssets = [
  {
    id: 'ci-bot',
    name: 'CI Bot',
    type: 'mascot',
    path: publicUrl('assets/game/ci-bot.svg'),
    recommendedUse: 'team member, helper, tutorial avatar',
  },
  {
    id: 'deploy-crate',
    name: 'Deploy Crate',
    type: 'reward',
    path: publicUrl('assets/game/deploy-crate.svg'),
    recommendedUse: 'sprint reward, unlock, loot marker',
  },
  {
    id: 'incident-flame',
    name: 'Incident Flame',
    type: 'hazard',
    path: publicUrl('assets/game/incident-flame.svg'),
    recommendedUse: 'incident event, production fire, alert marker',
  },
  {
    id: 'pipeline-token',
    name: 'Pipeline Token',
    type: 'currency',
    path: publicUrl('assets/game/pipeline-token.svg'),
    recommendedUse: 'automation currency, pipeline score, upgrade token',
  },
  {
    id: 'observability-orb',
    name: 'Observability Orb',
    type: 'observability',
    path: publicUrl('assets/game/observability-orb.svg'),
    recommendedUse: 'monitoring upgrade, metrics panel, health insight',
  },
  {
    id: 'cache-shield',
    name: 'Cache Shield',
    type: 'safety',
    path: publicUrl('assets/game/cache-shield.svg'),
    recommendedUse: 'resilience buff, cache strategy, defensive upgrade',
  },
  {
    id: 'chaos-monkey',
    name: 'Chaos Monkey',
    type: 'hazard',
    path: publicUrl('assets/game/chaos-monkey.svg'),
    recommendedUse: 'chaos event, random outage, stress test marker',
  },
  {
    id: 'feature-flag',
    name: 'Feature Flag',
    type: 'item',
    path: publicUrl('assets/game/feature-flag.svg'),
    recommendedUse: 'release control, experiment, rollout action',
  },
  {
    id: 'refactor-wrench',
    name: 'Refactor Wrench',
    type: 'maintenance',
    path: publicUrl('assets/game/refactor-wrench.svg'),
    recommendedUse: 'maintenance action, code quality upgrade, repair task',
  },
  {
    id: 'runbook-scroll',
    name: 'Runbook Scroll',
    type: 'item',
    path: publicUrl('assets/game/runbook-scroll.svg'),
    recommendedUse: 'operations checklist, incident mitigation, onboarding aid',
  },
  {
    id: 'service-mesh-node',
    name: 'Service Mesh Node',
    type: 'architecture',
    path: publicUrl('assets/game/service-mesh-node.svg'),
    recommendedUse: 'platform architecture, dependency map, network upgrade',
  },
  {
    id: 'tech-debt-anvil',
    name: 'Tech Debt Anvil',
    type: 'hazard',
    path: publicUrl('assets/game/tech-debt-anvil.svg'),
    recommendedUse: 'technical debt, slowdown debuff, refactor target',
  },

  {
    id: 'release-captain',
    name: 'Release Captain',
    type: 'character',
    path: publicUrl('assets/game/release-captain.svg'),
    recommendedUse: 'release specialist, launch leader, deployment phase avatar',
  },
  {
    id: 'incident-commander',
    name: 'Incident Commander',
    type: 'character',
    path: publicUrl('assets/game/incident-commander.svg'),
    recommendedUse: 'incident response lead, crisis event, mitigation avatar',
  },
  {
    id: 'sre-ranger',
    name: 'SRE Ranger',
    type: 'character',
    path: publicUrl('assets/game/sre-ranger.svg'),
    recommendedUse: 'reliability specialist, monitoring action, resilience avatar',
  },
  {
    id: 'platform-architect',
    name: 'Platform Architect',
    type: 'character',
    path: publicUrl('assets/game/platform-architect.svg'),
    recommendedUse: 'architecture specialist, platform upgrade, dependency planning avatar',
  },
  {
    id: 'qa-alchemist',
    name: 'QA Alchemist',
    type: 'character',
    path: publicUrl('assets/game/qa-alchemist.svg'),
    recommendedUse: 'quality specialist, testing action, bug reduction avatar',
  },
  {
    id: 'product-oracle',
    name: 'Product Oracle',
    type: 'character',
    path: publicUrl('assets/game/product-oracle.svg'),
    recommendedUse: 'roadmap specialist, product event, prioritization avatar',
  },
] as const satisfies readonly GameAsset[];
