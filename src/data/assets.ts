import { publicUrl } from '../utils/publicUrl';

export type GameAssetDecision = 'maintain' | 'replace' | 'deprecate';
export type GameAssetSurface = 'board' | 'org' | 'dept';

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
  /** RI-92 の資産棚卸し結果。削除前に明示的な判断を残す。 */
  decision: GameAssetDecision;
  /** 現在画面へ組み込んでいる面。空配列は将来利用する保留資産。 */
  surfaces: readonly GameAssetSurface[];
};

export const gameAssets = [
  {
    id: 'ci-bot',
    name: 'CI Bot',
    type: 'mascot',
    path: publicUrl('assets/game/ci-bot.svg'),
    recommendedUse: 'team member, helper, tutorial avatar',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'deploy-crate',
    name: 'Deploy Crate',
    type: 'reward',
    path: publicUrl('assets/game/deploy-crate.svg'),
    recommendedUse: 'sprint reward, unlock, loot marker',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'incident-flame',
    name: 'Incident Flame',
    type: 'hazard',
    path: publicUrl('assets/game/incident-flame.svg'),
    recommendedUse: 'incident event, production fire, alert marker',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'pipeline-token',
    name: 'Pipeline Token',
    type: 'currency',
    path: publicUrl('assets/game/pipeline-token.svg'),
    recommendedUse: 'automation currency, pipeline score, upgrade token',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'observability-orb',
    name: 'Observability Orb',
    type: 'observability',
    path: publicUrl('assets/game/observability-orb.svg'),
    recommendedUse: 'monitoring upgrade, metrics panel, health insight',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'cache-shield',
    name: 'Cache Shield',
    type: 'safety',
    path: publicUrl('assets/game/cache-shield.svg'),
    recommendedUse: 'resilience buff, cache strategy, defensive upgrade',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'chaos-monkey',
    name: 'Chaos Monkey',
    type: 'hazard',
    path: publicUrl('assets/game/chaos-monkey.svg'),
    recommendedUse: 'chaos event, random outage, stress test marker',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'feature-flag',
    name: 'Feature Flag',
    type: 'item',
    path: publicUrl('assets/game/feature-flag.svg'),
    recommendedUse: 'release control, experiment, rollout action',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'refactor-wrench',
    name: 'Refactor Wrench',
    type: 'maintenance',
    path: publicUrl('assets/game/refactor-wrench.svg'),
    recommendedUse: 'maintenance action, code quality upgrade, repair task',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'runbook-scroll',
    name: 'Runbook Scroll',
    type: 'item',
    path: publicUrl('assets/game/runbook-scroll.svg'),
    recommendedUse: 'operations checklist, incident mitigation, onboarding aid',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'service-mesh-node',
    name: 'Service Mesh Node',
    type: 'architecture',
    path: publicUrl('assets/game/service-mesh-node.svg'),
    recommendedUse: 'platform architecture, dependency map, network upgrade',
    decision: 'maintain',
    surfaces: [],
  },
  {
    id: 'tech-debt-anvil',
    name: 'Tech Debt Anvil',
    type: 'hazard',
    path: publicUrl('assets/game/tech-debt-anvil.svg'),
    recommendedUse: 'technical debt, slowdown debuff, refactor target',
    decision: 'maintain',
    surfaces: [],
  },

  {
    id: 'release-captain',
    name: 'Release Captain',
    type: 'character',
    path: publicUrl('assets/game/release-captain.svg'),
    recommendedUse: 'release specialist, launch leader, deployment phase avatar',
    decision: 'maintain',
    surfaces: ['board'],
  },
  {
    id: 'incident-commander',
    name: 'Incident Commander',
    type: 'character',
    path: publicUrl('assets/game/incident-commander.svg'),
    recommendedUse: 'incident response lead, crisis event, mitigation avatar',
    decision: 'maintain',
    surfaces: ['board'],
  },
  {
    id: 'sre-ranger',
    name: 'SRE Ranger',
    type: 'character',
    path: publicUrl('assets/game/sre-ranger.svg'),
    recommendedUse: 'reliability specialist, monitoring action, resilience avatar',
    decision: 'maintain',
    surfaces: ['org'],
  },
  {
    id: 'platform-architect',
    name: 'Platform Architect',
    type: 'character',
    path: publicUrl('assets/game/platform-architect.svg'),
    recommendedUse: 'architecture specialist, platform upgrade, dependency planning avatar',
    decision: 'maintain',
    surfaces: ['board', 'org', 'dept'],
  },
  {
    id: 'qa-alchemist',
    name: 'QA Alchemist',
    type: 'character',
    path: publicUrl('assets/game/qa-alchemist.svg'),
    recommendedUse: 'quality specialist, testing action, bug reduction avatar',
    decision: 'maintain',
    surfaces: ['board', 'org', 'dept'],
  },
  {
    id: 'product-oracle',
    name: 'Product Oracle',
    type: 'character',
    path: publicUrl('assets/game/product-oracle.svg'),
    recommendedUse: 'roadmap specialist, product event, prioritization avatar',
    decision: 'maintain',
    surfaces: ['board', 'org'],
  },
] as const satisfies readonly GameAsset[];

export type GameAssetId = (typeof gameAssets)[number]['id'];

const GAME_ASSET_BY_ID = new Map<GameAssetId, (typeof gameAssets)[number]>(
  gameAssets.map((asset) => [asset.id, asset]),
);

/** IDを正本カタログから解決する。描画側はパス文字列を直接組み立てない。 */
export function getGameAsset(id: GameAssetId): (typeof gameAssets)[number] {
  const asset = GAME_ASSET_BY_ID.get(id);
  if (!asset) throw new Error(`Unknown game asset: ${id}`);
  return asset;
}

/** Viteのbaseを含む公開URLを返す共通アクセサー。 */
export function getGameAssetUrl(id: GameAssetId): string {
  return getGameAsset(id).path;
}
