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
import { healthRank } from './aggregate';
import type {
  IndustryState,
  LeaderboardEntry,
  OrgScaleState,
  RankingKind,
  RivalOrg,
} from './types';
import { clamp } from '../clamp';

/** 他組織の数（自社を加えて total = RIVAL_COUNT + 1）。 */
const RIVAL_COUNT = 11;

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
  const overall = Math.max(
    0,
    Math.round(m.shipping - m.onFire * 40 - Math.min(300, m.techDebt) * 0.5),
  );
  const healthy = Math.max(
    0,
    Math.round(
      m.morale * 5 - Math.min(200, m.techDebt) * 0.3 - Math.max(0, m.aiDependency - 50) * 2,
    ),
  );
  const ai = Math.max(
    0,
    Math.round(m.shipping * 0.5 + m.aiGuideline * 3 - Math.max(0, m.aiDependency - 60) * 3),
  );
  const growth = Math.max(0, Math.round(m.shipping * 0.4 + m.morale * 2));
  return { overall, healthy, ai, growth };
}

/** seed から決め打ちのシーズン番号（1..4）。 */
function seasonFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 4) + 1;
}

/** 自社を `RivalOrg` 形へ写し取る。 */
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
    trend: 1,
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
  const shipping = 200 + Math.round(rng() * 1600);
  const morale = clamp(30 + Math.round(rng() * 60), 0, 100);
  const techDebt = Math.round(rng() * 260);
  const aiDependency = clamp(Math.round(rng() * 100), 0, 100);
  const aiGuideline = clamp(Math.round(rng() * 100), 0, 100);
  const onFire = Math.floor(rng() * 4);
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
  if (pct <= 0.2) return 'プラチナリーグ';
  if (pct <= 0.45) return 'ゴールドリーグ';
  if (pct <= 0.75) return 'シルバーリーグ';
  return 'ブロンズリーグ';
}

/**
 * 業界ランキングを生成する。指定のランキング種別で降順ソートし、自社の順位を返す。
 * 同点は自社を上位に寄せ、それ以外は id で安定ソートする（決定論）。
 */
export function generateIndustry(
  company: OrgScaleState,
  kind: RankingKind = 'overall',
): IndustryState {
  const self = selfRival(company);
  const rivals = Array.from({ length: RIVAL_COUNT }, (_, i) => makeRival(company.seed, i));
  const all = [self, ...rivals];
  all.sort((a, b) => {
    const d = b.scores[kind] - a.scores[kind];
    if (d !== 0) return d;
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  const entries: LeaderboardEntry[] = all.map((org, i) => ({ rank: i + 1, org }));
  const selfRank = entries.find((e) => e.org.isSelf)?.rank ?? all.length;
  return {
    kind,
    season: seasonFor(company.seed),
    league: leagueFor(selfRank, all.length),
    entries,
    selfRank,
    total: all.length,
  };
}
