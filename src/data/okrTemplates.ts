/**
 * 四半期 OKR テンプレート（RI-129 / SPEC 第23章）。
 *
 * 既存 `QuarterGoal` KPI を Objective / Key Results として束ねる表示用データ。
 * 数値・閾値は持たない。生成は `buildQuarterGoal`、評価は `measureGoalProgress` /
 * `evaluateQuarterOutcome` のまま。テンプレート ID は保存せず、ボス ID から導出する。
 */

/** 既存四半期 KPI の安定 ID。評価ロジックの id と一致させる。 */
export const OKR_KPI_IDS = [
  'delivery',
  'quality',
  'techDebt',
  'morale',
  'incident',
  'aiAdoption',
] as const;

export type OkrKpiId = (typeof OKR_KPI_IDS)[number];

export type OkrTemplateId = 'ship-on-time' | 'contain-incidents' | 'audit-ready' | 'ai-with-health';

export interface OkrTemplateFocus {
  title: string;
  description: string;
  /** フォーカス Objective に載せる KR。目標に無い ID は表示側で落とす。 */
  keyResultIds: readonly OkrKpiId[];
}

export interface OkrTemplateDef {
  id: OkrTemplateId;
  bossId: string;
  focus: OkrTemplateFocus;
}

/** 未知のボスは大型リリース相当のテンプレートへフォールバックする（表示のみ）。 */
export const FALLBACK_OKR_TEMPLATE_ID: OkrTemplateId = 'ship-on-time';

/** フォーカスに入らなかった KPI を束ねるガードレール Objective。 */
export const OKR_GUARDRAIL = {
  id: 'guardrail',
  title: '組織の持続可能性を守る',
  description: '品質・負債・士気など、次四半期も戦える状態を残す。',
} as const;

export const OKR_FOCUS_OBJECTIVE_ID = 'focus' as const;

export const OKR_KPI_SHORT_LABELS: Record<OkrKpiId, string> = {
  delivery: 'Delivery',
  quality: 'Quality',
  techDebt: 'Tech Debt',
  morale: 'Morale',
  incident: 'Incident',
  aiAdoption: 'AI Adoption',
};

export const OKR_TEMPLATES: readonly OkrTemplateDef[] = [
  {
    id: 'ship-on-time',
    bossId: 'big-release',
    focus: {
      title: '大型リリースを期限内に届ける',
      description: '約束した出荷を止めず、障害で予定を崩さない。',
      keyResultIds: ['delivery', 'incident'],
    },
  },
  {
    id: 'contain-incidents',
    bossId: 'major-incident',
    focus: {
      title: '本番障害を封じ、延焼させない',
      description: '障害件数を抑え、出荷を止めない。',
      keyResultIds: ['incident', 'delivery'],
    },
  },
  {
    id: 'audit-ready',
    bossId: 'security-audit',
    focus: {
      title: '監査に耐える品質基盤を残す',
      description: '品質を保ち、技術的負債を許容範囲に収める。',
      keyResultIds: ['quality', 'techDebt'],
    },
  },
  {
    id: 'ai-with-health',
    bossId: 'exec-review',
    focus: {
      title: '健全性を崩さず AI 導入の成果を示す',
      description: '利用率だけでなく、士気と品質も経営に見せる。',
      keyResultIds: ['aiAdoption', 'morale', 'quality'],
    },
  },
];

const BY_BOSS_ID = new Map(OKR_TEMPLATES.map((template) => [template.bossId, template]));
const BY_ID = new Map(OKR_TEMPLATES.map((template) => [template.id, template]));

export function getOkrTemplateByBossId(bossId: string): OkrTemplateDef {
  return BY_BOSS_ID.get(bossId) ?? BY_ID.get(FALLBACK_OKR_TEMPLATE_ID)!;
}

export function isOkrKpiId(id: string): id is OkrKpiId {
  return (OKR_KPI_IDS as readonly string[]).includes(id);
}
