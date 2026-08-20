/**
 * 業界ランキングの決定論生成（SPEC 第4.10）。
 *
 * 自社（全社集約）と、同じ seed から派生した他組織を並べてシーズン制
 * リーダーボードを作る。ランキング種別ごとに評価軸が変わり、「見かけの出荷だけ
 * 高い組織」は総合では上位でも健全経営では沈む（第13章の良し悪しが順位に出る）。
 */
import { diagnosisView } from '../diagnosis';
import { createRng } from '../rng';
import type { DiagnosisType } from '../run/types';
import { COARSE_TEAM_BALANCE } from '../../data/balance';
import { companyScore, healthRank } from './aggregate';
import type {
  IndustryState,
  LeaderboardEntry,
  OrgScaleState,
  RankingKind,
  RivalOrg,
} from './types';
import { clamp } from '../clamp';

/** 他組織の社名候補（現実の比喩。実在企業を避けた一般名）。 */
const RIVAL_NAMES = [
  'アサヒ技研',
  'ノヴァソフト',
  'みどりデジタル',
  'クラウドワークス社',
  'ハヤテ開発',
  'うみねこラボ',
  'こだまシステムズ',
  'すばるテック',
  'やまびこ工房',
  'あおぞらAI',
  'つばさデータ',
  'ひかりプラットフォーム',
  'かなでソフト',
];

/** 全ランキング種別。 */
export const RANKING_KINDS: readonly RankingKind[] = ['overall', 'healthy', 'ai', 'growth'];

/** ランキング種別の表示名。 */
export const RANKING_LABEL: Record<RankingKind, string> = {
  overall: '総合出荷',
  healthy: '健全経営',
  ai: 'AI活用',
  growth: '急成長',
};

/** 評価軸の入力（自社・他社で共通）。 */
interface ScoreInput {
  shipping: number;
  morale: number;
  techDebt: number;
  aiDependency: number;
  aiGuideline: number;
  onFire: number;
}

/** 共通の評価軸でランキング種別ごとのスコアを計算する。 */
export function computeScores(m: ScoreInput): Record<RankingKind, number> {
  const overall = companyScore({ shipping: m.shipping, onFire: m.onFire, techDebt: m.techDebt });
  const healthy = Math.max(
    COARSE_TEAM_BALANCE.scoreMinimum.value,
    Math.round(
      m.morale * COARSE_TEAM_BALANCE.rankingHealthyMoraleWeight.value -
        Math.min(COARSE_TEAM_BALANCE.rankingHealthyTechDebtCap.value, m.techDebt) *
          COARSE_TEAM_BALANCE.rankingHealthyTechDebtWeight.value -
        Math.max(
          0,
          m.aiDependency - COARSE_TEAM_BALANCE.rankingHealthyAiDependencyThreshold.value,
        ) *
          COARSE_TEAM_BALANCE.rankingHealthyAiDependencyWeight.value,
    ),
  );
  const ai = Math.max(
    COARSE_TEAM_BALANCE.scoreMinimum.value,
    Math.round(
      m.shipping * COARSE_TEAM_BALANCE.rankingAiShippingWeight.value +
        m.aiGuideline * COARSE_TEAM_BALANCE.rankingAiGuidelineWeight.value -
        Math.max(0, m.aiDependency - COARSE_TEAM_BALANCE.rankingAiDependencyThreshold.value) *
          COARSE_TEAM_BALANCE.rankingAiDependencyWeight.value,
    ),
  );
  const growth = Math.max(
    COARSE_TEAM_BALANCE.scoreMinimum.value,
    Math.round(
      m.shipping * COARSE_TEAM_BALANCE.rankingGrowthShippingWeight.value +
        m.morale * COARSE_TEAM_BALANCE.rankingGrowthMoraleWeight.value,
    ),
  );
  return { overall, healthy, ai, growth };
}

/** seed から決め打ちのシーズン番号（1..4）。 */
function seasonFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % COARSE_TEAM_BALANCE.industrySeasonCount.value) + 1;
}

/** 直近四半期の自社順位と現在順位から趨勢を決める（RI-128）。履歴なしは横ばい。 */
export function selfRankTrend(
  previousSelfRank: number | undefined,
  currentRank: number,
): -1 | 0 | 1 {
  if (previousSelfRank === undefined) return 0;
  if (currentRank < previousSelfRank) return 1;
  if (currentRank > previousSelfRank) return -1;
  return 0;
}

/** 自社を `RivalOrg` 形へ写し取る。趨勢は順位確定後に上書きする。 */
function selfRival(company: OrgScaleState): RivalOrg {
  const m: ScoreInput = {
    shipping: company.shipping,
    morale: company.morale,
    techDebt: company.techDebt,
    aiDependency: company.aiDependency,
    aiGuideline: company.infra.aiGuideline,
    onFire: company.onFire,
  };
  return {
    id: 'self',
    name: '自社',
    orgType: diagnosisView(company.diagnosis).label,
    scores: computeScores(m),
    healthRank: company.healthRank,
    trend: 0,
    isSelf: true,
  };
}

const DIAGNOSIS_POOL: DiagnosisType[] = [
  'healthyAcceleration',
  'reviewHell',
  'aiOverproduction',
  'reworkSpiral',
  'seniorSacrifice',
  'documentationKingdom',
];

/** 1 他組織を派生 seed から生成する。 */
function makeRival(seed: string, i: number): RivalOrg {
  const rng = createRng(`${seed}:rival:${i}`);
  const shipping =
    COARSE_TEAM_BALANCE.industryRivalShippingBase.value +
    Math.round(rng() * COARSE_TEAM_BALANCE.industryRivalShippingRange.value);
  const morale = clamp(
    COARSE_TEAM_BALANCE.industryRivalMoraleBase.value +
      Math.round(rng() * COARSE_TEAM_BALANCE.industryRivalMoraleRange.value),
    0,
    100,
  );
  const techDebt = Math.round(rng() * COARSE_TEAM_BALANCE.industryRivalTechDebtRange.value);
  const aiDependency = clamp(
    Math.round(rng() * COARSE_TEAM_BALANCE.industryRivalAiDependencyRange.value),
    0,
    100,
  );
  const aiGuideline = clamp(
    Math.round(rng() * COARSE_TEAM_BALANCE.industryRivalAiGuidelineRange.value),
    0,
    100,
  );
  const onFire = Math.floor(rng() * COARSE_TEAM_BALANCE.industryRivalOnFireRange.value);
  const diagnosis = DIAGNOSIS_POOL[Math.floor(rng() * DIAGNOSIS_POOL.length)];
  const trend = (Math.floor(rng() * 3) - 1) as -1 | 0 | 1;
  return {
    id: `rival-${i}`,
    name: RIVAL_NAMES[i % RIVAL_NAMES.length],
    orgType: diagnosisView(diagnosis).label,
    scores: computeScores({ shipping, morale, techDebt, aiDependency, aiGuideline, onFire }),
    healthRank: healthRank({ morale, techDebt, aiDependency }),
    trend,
    isSelf: false,
  };
}

/** 順位（selfRank=1 起点の百分位）からリーグ名を決める。 */
function leagueFor(selfRank: number, total: number): string {
  const pct = selfRank / total;
  if (pct <= COARSE_TEAM_BALANCE.leaguePlatinumMaximum.value) return 'プラチナリーグ';
  if (pct <= COARSE_TEAM_BALANCE.leagueGoldMaximum.value) return 'ゴールドリーグ';
  if (pct <= COARSE_TEAM_BALANCE.leagueSilverMaximum.value) return 'シルバーリーグ';
  return 'ブロンズリーグ';
}

/**
 * 業界ランキングを生成する。指定のランキング種別で降順ソートし、自社の順位を返す。
 * 同点は自社を上位に寄せ、それ以外は id で安定ソートする（決定論）。
 */
export function generateIndustry(
  company: OrgScaleState,
  kind: RankingKind = 'overall',
  previousSelfRank?: number,
): IndustryState {
  const self = selfRival(company);
  const rivals = Array.from({ length: COARSE_TEAM_BALANCE.industryRivalCount.value }, (_, i) =>
    makeRival(company.seed, i),
  );
  const all = [self, ...rivals];
  all.sort((a, b) => {
    const d = b.scores[kind] - a.scores[kind];
    if (d !== 0) return d;
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  const entries: LeaderboardEntry[] = all.map((org, i) => ({ rank: i + 1, org }));
  const selfRank = entries.find((e) => e.org.isSelf)?.rank ?? all.length;
  self.trend = selfRankTrend(previousSelfRank, selfRank);
  return {
    kind,
    season: seasonFor(company.seed),
    league: leagueFor(selfRank, all.length),
    entries,
    selfRank,
    total: all.length,
  };
}
