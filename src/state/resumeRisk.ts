/**
 * タイトル「続きから再開」の事前警告（Issue #374）。
 *
 * HUD と同じ燃え尽き／注意帯と、evaluateLose の継続不能条件をセーブから読み、
 * 警告なしで即ゲームオーバーになる再開を防ぐ。
 */
import { seniorHpHudCopy } from '../render/status';
import { evaluateLose } from '../sim/outcome';
import type { OrgState } from '../sim/types';
import type { LoseReason, RunTotals } from '../sim/run/types';

export type ResumeRiskTone = 'watch' | 'danger';

export interface ResumeRiskFlag {
  readonly id: 'seniorHp' | LoseReason;
  readonly tone: ResumeRiskTone;
  readonly chip: string;
  readonly detail: string;
}

export interface ResumeRisk {
  readonly tone: ResumeRiskTone;
  readonly requiresConfirm: boolean;
  readonly headline: string;
  /** タイトルを語中で割らないための文節。連結すると headline になる。 */
  readonly headlinePhrases: readonly string[];
  readonly body: string;
  /** 本文を語中で割らないための文節。連結すると body になる。 */
  readonly bodyPhrases: readonly string[];
  readonly seniorHpPct: number;
  readonly flags: readonly ResumeRiskFlag[];
}

export interface ResumeRiskInput {
  readonly org: OrgState;
  readonly totals: RunTotals;
  readonly budget: number;
}

/** 狭幅でも語中で割れない文節。連結結果がプレイヤーに見せる文になる。 */
const LOSE_PHRASES: Record<LoseReason, readonly string[]> = {
  seniorBurnout: ['シニア体力が尽きており、', '再開すると', 'ゲームオーバーになります。'],
  moraleCollapse: ['士気が尽きており、', '再開すると', 'ゲームオーバーになります。'],
  techDebt: ['技術的負債が', '上限に達しており、', '再開すると', 'ゲームオーバーになります。'],
  reviewFreeze: [
    'レビュー待ちが',
    '限界に達しており、',
    '再開すると',
    'ゲームオーバーになります。',
  ],
  incidentCascade: ['障害が連鎖しており、', '再開すると', 'ゲームオーバーになります。'],
  aiDependency: ['AI 依存が', '限界に達しており、', '再開すると', 'ゲームオーバーになります。'],
  budgetExhausted: ['予算が尽きており、', '再開すると', 'ゲームオーバーになります。'],
  bossFailed: ['ボス突破に失敗しており、', '再開すると', 'ゲームオーバーになります。'],
  trustExhausted: [
    'ステークホルダーの',
    '信頼が尽きており、',
    '再開すると',
    'ゲームオーバーになります。',
  ],
  reorgRequired: ['組織再編が', '必要になっており、', '再開すると', 'ゲームオーバーになります。'],
  kpiMissed: ['四半期目標の', '未達が重なっており、', '再開すると', 'ゲームオーバーになります。'],
};

const HEADLINE_PHRASES = {
  lose: ['再開すると', 'ゲームオーバーに', 'なります'],
  danger: ['燃え尽き寸前の', 'セーブです'],
  watch: ['体力に注意が', '必要なセーブです'],
} as const;

const DANGER_HP_PHRASES = ['燃え尽き寸前・', 'AIスロットルや', '休息で守る。'] as const;
const WATCH_HP_PHRASES = ['低下中・', 'AIスロットルや', '休息で守る。'] as const;
const DANGER_CONTINUATION_PHRASES = [
  '休息で',
  '回復しない限り、',
  '再開後に',
  '継続不能になる',
  '恐れがあります。',
] as const;
const WATCH_CONTINUATION_PHRASES = [
  '次のスプリントでは',
  '体力を守りながら',
  '進めてください。',
] as const;

const LOSE_CHIP: Record<LoseReason, string> = {
  seniorBurnout: '継続不能',
  moraleCollapse: '継続不能',
  techDebt: '継続不能',
  reviewFreeze: '継続不能',
  incidentCascade: '継続不能',
  aiDependency: '継続不能',
  budgetExhausted: '継続不能',
  bossFailed: '継続不能',
  trustExhausted: '継続不能',
  reorgRequired: '継続不能',
  kpiMissed: '継続不能',
};

interface ResumeRiskFlagDraft extends ResumeRiskFlag {
  readonly detailPhrases: readonly string[];
}

function seniorHpFlagPhrases(seniorHpPct: number, tone: ResumeRiskTone): readonly string[] {
  return [
    `シニア体力は ${seniorHpPct}% です。`,
    ...(tone === 'danger' ? DANGER_HP_PHRASES : WATCH_HP_PHRASES),
    ...(tone === 'danger' ? DANGER_CONTINUATION_PHRASES : WATCH_CONTINUATION_PHRASES),
  ];
}

/** セーブ状態から再開前の警告を組み立てる。リスクがなければ null。 */
export function assessResumeRisk(input: ResumeRiskInput): ResumeRisk | null {
  const seniorHpPct = Math.round(input.org.seniorHp);
  const lose = evaluateLose(input.org, input.totals, input.budget);
  const flags: ResumeRiskFlagDraft[] = [];

  if (lose) {
    const detailPhrases =
      lose === 'seniorBurnout'
        ? [`シニア体力は ${seniorHpPct}% です。`, ...LOSE_PHRASES.seniorBurnout]
        : LOSE_PHRASES[lose];
    flags.push({
      id: lose,
      tone: 'danger',
      chip: LOSE_CHIP[lose],
      detail: detailPhrases.join(''),
      detailPhrases,
    });
  }

  if (lose !== 'seniorBurnout') {
    const hpCopy = seniorHpHudCopy(seniorHpPct, {
      firefightUrgent: false,
      reviewCongested: false,
    });
    if (hpCopy.warningChip) {
      const tone: ResumeRiskTone = seniorHpPct < 25 ? 'danger' : 'watch';
      const detailPhrases = seniorHpFlagPhrases(seniorHpPct, tone);
      flags.push({
        id: 'seniorHp',
        tone,
        chip: hpCopy.warningChip,
        detail: detailPhrases.join(''),
        detailPhrases,
      });
    }
  }

  if (flags.length === 0) return null;

  const tone: ResumeRiskTone = flags.some((flag) => flag.tone === 'danger') ? 'danger' : 'watch';
  const requiresConfirm = tone === 'danger';
  const headlinePhrases = lose
    ? HEADLINE_PHRASES.lose
    : tone === 'danger'
      ? HEADLINE_PHRASES.danger
      : HEADLINE_PHRASES.watch;
  const bodyPhrases = flags.flatMap((flag, index) =>
    index === 0 ? flag.detailPhrases : [' ', ...flag.detailPhrases],
  );

  return {
    tone,
    requiresConfirm,
    headline: headlinePhrases.join(''),
    headlinePhrases,
    body: flags.map((flag) => flag.detail).join(' '),
    bodyPhrases,
    seniorHpPct,
    flags,
  };
}
