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
  readonly body: string;
  readonly seniorHpPct: number;
  readonly flags: readonly ResumeRiskFlag[];
}

export interface ResumeRiskInput {
  readonly org: OrgState;
  readonly totals: RunTotals;
  readonly budget: number;
}

const LOSE_DETAIL: Record<LoseReason, string> = {
  seniorBurnout: 'シニア体力が尽きており、再開するとゲームオーバーになります。',
  moraleCollapse: '士気が尽きており、再開するとゲームオーバーになります。',
  techDebt: '技術的負債が上限に達しており、再開するとゲームオーバーになります。',
  reviewFreeze: 'レビュー待ちが限界に達しており、再開するとゲームオーバーになります。',
  incidentCascade: '障害が連鎖しており、再開するとゲームオーバーになります。',
  aiDependency: 'AI 依存が限界に達しており、再開するとゲームオーバーになります。',
  budgetExhausted: '予算が尽きており、再開するとゲームオーバーになります。',
  bossFailed: 'ボス突破に失敗しており、再開するとゲームオーバーになります。',
  trustExhausted: 'ステークホルダーの信頼が尽きており、再開するとゲームオーバーになります。',
  reorgRequired: '組織再編が必要になっており、再開するとゲームオーバーになります。',
  kpiMissed: '四半期目標の未達が重なっており、再開するとゲームオーバーになります。',
};

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

/** セーブ状態から再開前の警告を組み立てる。リスクがなければ null。 */
export function assessResumeRisk(input: ResumeRiskInput): ResumeRisk | null {
  const seniorHpPct = Math.round(input.org.seniorHp);
  const lose = evaluateLose(input.org, input.totals, input.budget);
  const flags: ResumeRiskFlag[] = [];

  if (lose) {
    flags.push({
      id: lose,
      tone: 'danger',
      chip: LOSE_CHIP[lose],
      detail:
        lose === 'seniorBurnout'
          ? `シニア体力は ${seniorHpPct}% です。${LOSE_DETAIL.seniorBurnout}`
          : LOSE_DETAIL[lose],
    });
  }

  if (lose !== 'seniorBurnout') {
    const hpCopy = seniorHpHudCopy(seniorHpPct, {
      firefightUrgent: false,
      reviewCongested: false,
    });
    if (hpCopy.warningChip) {
      const tone: ResumeRiskTone = seniorHpPct < 25 ? 'danger' : 'watch';
      const continuation =
        tone === 'danger'
          ? '休息で回復しない限り、再開後に継続不能になる恐れがあります。'
          : '次のスプリントでは体力を守りながら進めてください。';
      flags.push({
        id: 'seniorHp',
        tone,
        chip: hpCopy.warningChip,
        detail: `シニア体力は ${seniorHpPct}% です。${hpCopy.detail}。${continuation}`,
      });
    }
  }

  if (flags.length === 0) return null;

  const tone: ResumeRiskTone = flags.some((flag) => flag.tone === 'danger') ? 'danger' : 'watch';
  const requiresConfirm = tone === 'danger';
  const headline = lose
    ? '再開するとゲームオーバーになります'
    : tone === 'danger'
      ? '燃え尽き寸前のセーブです'
      : '体力に注意が必要なセーブです';
  const body = flags.map((flag) => flag.detail).join(' ');

  return {
    tone,
    requiresConfirm,
    headline,
    body,
    seniorHpPct,
    flags,
  };
}
