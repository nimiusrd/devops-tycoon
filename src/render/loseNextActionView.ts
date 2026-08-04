/**
 * 敗北画面の「次の一手」と現場示唆（RI-82 / SPEC 第19.1 F-6）。
 *
 * 敗因ラベル（何が起きたか）とは別に、次のランで変える具体操作と
 * 現実の開発現場への示唆を返す。描画・状態は知らない純関数。
 *
 * 四半期レビュー由来の敗北は RI-79 で原因別 loseReason へ分解済み。
 * 助言は `quarterOutcome` と終了時スナップショットでもさらに細分化する。
 */
import type { LoseReason, QuarterOutcome, StakeholderId, StakeholderTrust } from '../sim/run/types';

export interface LoseNextActionView {
  /** 次のランで変える具体的な一手。 */
  nextAction: string;
  /** 現実の現場への示唆。 */
  insight: string;
}

/** 終了時点の観測値（経路別の助言に使う。任意）。 */
export interface LoseNextActionSnapshot {
  trust?: StakeholderTrust;
  budget?: number;
  morale?: number;
  seniorHp?: number;
  missedKpiCount?: number;
  /** 未達 KPI の id（delivery / quality / techDebt / morale / incident / aiAdoption）。 */
  missedKpiIds?: readonly string[];
  reviewQueuePeak?: number;
  /** 終了時の四半期番号（reorg_required の Q2+ 条件用）。 */
  quarterNumber?: number;
}

export interface LoseNextActionOptions {
  /** 四半期レビュー由来の継続不能 outcome（ある場合のみ）。 */
  quarterOutcome?: QuarterOutcome;
  /** 終了時点の信頼・予算・組織などの観測値。 */
  snapshot?: LoseNextActionSnapshot;
}

const LOSE_NEXT_ACTIONS: Record<LoseReason, LoseNextActionView> = {
  seniorBurnout: {
    nextAction:
      '炎上は自動鎮火でシニアHPが大きく削られる前に緊急対応で消し、アンドンやAIスロットルで流入を抑えてから休息でHPを戻す。',
    insight: 'レビューを1人に依存させると、速度ではなくその1人が壊れる。',
  },
  techDebt: {
    nextAction:
      '休息で負債を返済し、標準化レバーや品質系カードで負債の増加を抑えてから出荷を伸ばす。',
    insight: '後回しにした負債は、ある時点から開発速度そのものを奪い返す。',
  },
  moraleCollapse: {
    nextAction:
      '残業号令や偏ったタスク差配を控え、休息で士気を戻し、火消し部隊など士気が上がるレバーだけを使ってから負荷を上げる。',
    insight: '短期のスループットのために士気を削ると、チームは一気に機能しなくなる。',
  },
  reviewFreeze: {
    nextAction:
      'AIスロットル・PR分割・レビュー応援で渋滞を抑え、割り込みレビューや炎上放置でシニアHPを削らず、休息でHPを戻して低HPからの凍結も避ける。',
    insight: '実装量だけ増やすと、ボトルネックは必ずレビュー側へ移る。',
  },
  incidentCascade: {
    nextAction: '炎上タイマーが切れる前に緊急対応で鎮火し、連続する障害スプリントを途切れさせる。',
    insight: '障害は単発より、放置して連鎖させたときの方が組織を止める。',
  },
  aiDependency: {
    nextAction:
      'AIリテラシーが30以下のまま依存度が95に達すると敗北する。ペアレビューでリテラシーを上げて条件を外すか、AI利用ガイドライン（カード）や全社AIガイドライン・部門／チームのAIスロットル（レバー）で依存度を下げる。',
    insight: 'AIに任せきりだと、仕様を説明・検証できる人がいなくなり判断が止まる。',
  },
  budgetExhausted: {
    nextAction:
      'ショップのAIツール買い足しや採用・レバー支出を抑え、目標修正の追加予算申請で残高を増やしてから投資する。',
    insight: 'ツール費用を見ずに導入を広げると、成果の前に運用自体が止まる。',
  },
  bossFailed: {
    nextAction:
      'ボス直前のスプリントで出荷・延焼・品質の突破条件を確認し、足りない軸へ介入とカードを寄せる。',
    insight: '期末の試練は日々の積み上げで決まり、直前の気合いだけでは覆せない。',
  },
  trustExhausted: {
    nextAction:
      '四半期レビュー前に未達KPIを見極め、スコープ削減や期限延長などの目標修正で継続条件を守る。',
    insight: 'ステークホルダーの信頼は、未達を放置した回数で削られていく。',
  },
  reorgRequired: {
    nextAction:
      '連続未達を避けるため、品質・士気・障害の下限を先に立て直し、信頼を削る目標修正に頼らない。',
    insight: '同じ未達を繰り返すと、現場改善ではなく組織再編という外からの決着になる。',
  },
  kpiMissed: {
    nextAction:
      '未達KPIを四半期の早い段階で特定し、スコープ削減やステークホルダーケアで継続条件を守ってから伸ばす。',
    insight: '未達の件数そのものが継続不能条件になる。原因と違う手を打っても件数は減らない。',
  },
};

const KPI_HINTS: Record<string, { label: string; tip: string }> = {
  delivery: { label: 'Delivery', tip: '介入とカードで出荷を伸ばす' },
  quality: { label: 'Quality', tip: '手戻り抑制と品質系カードで品質を上げる' },
  techDebt: { label: 'Tech Debt', tip: '休息返済と標準化で負債を下げる' },
  morale: { label: 'Morale', tip: '休息と残業抑制で士気を守る' },
  incident: { label: 'Incident', tip: '緊急対応で障害を抑える' },
  aiAdoption: { label: 'AI Adoption', tip: 'AI利用率の底上げを優先する' },
};

function minTrustOf(snapshot: LoseNextActionSnapshot): number | undefined {
  if (snapshot.trust === undefined) return undefined;
  return Math.min(snapshot.trust.management, snapshot.trust.customers, snapshot.trust.team);
}

/** 閾値以下に落ちた信頼先を返す（複数なら multiple）。 */
export type ExhaustedStakeholder = StakeholderId | 'multiple' | 'unknown';

export function classifyExhaustedStakeholder(
  trust: StakeholderTrust | undefined,
  threshold: number,
): ExhaustedStakeholder {
  if (!trust) return 'unknown';
  const hit = (['management', 'customers', 'team'] as const).filter((id) => trust[id] <= threshold);
  if (hit.length === 0) return 'unknown';
  if (hit.length > 1) return 'multiple';
  return hit[0];
}

function trustStakeholderAction(
  stakeholder: ExhaustedStakeholder,
  insight: string,
): LoseNextActionView {
  switch (stakeholder) {
    case 'management':
      return {
        nextAction:
          '延期交渉や案件見送りなど経営信頼を削る選択を避け、信頼をさらに削る目標修正に頼らない。',
        insight,
      };
    case 'customers':
      return {
        nextAction:
          'スコープ削減や品質ピボットなど顧客信頼を削る目標修正を避け、顧客向けの未達を先に立て直す。',
        insight,
      };
    case 'team':
      return {
        nextAction:
          '急募の見送りや採用失敗でチーム信頼を削らず、予算があるときだけ採用して期待を裏切らない。',
        insight,
      };
    case 'multiple':
      return {
        nextAction:
          '経営・顧客・チームのどれも削る目標修正とイベントを避け、信頼コストの高い選択を重ねない。',
        insight,
      };
    case 'unknown':
      return {
        nextAction:
          '信頼を削る目標修正やイベントを避け、未達が出る前にKPIを達成して信頼の下限に近づかない。',
        insight,
      };
  }
}

function missedKpiAction(
  snapshot: LoseNextActionSnapshot,
  fallback: LoseNextActionView,
  prefix: string,
  insight: string,
): LoseNextActionView {
  const ids = snapshot.missedKpiIds ?? [];
  const hints = ids
    .map((id) => KPI_HINTS[id])
    .filter((h): h is { label: string; tip: string } => !!h);
  if (hints.length === 0) return fallback;
  const labels = hints.map((h) => h.label).join('・');
  const tips = hints.map((h) => h.tip).join('／');
  return {
    nextAction: `${prefix}未達の${labels}を立て直す（${tips}）。`,
    insight,
  };
}

/** `evaluateQuarterOutcome` と同じ優先順で shutdown の主因を分類する。 */
export type ShutdownCause = 'trust' | 'budgetMorale' | 'seniorHpMissed' | 'unknown';

export function classifyShutdownCause(snapshot: LoseNextActionSnapshot = {}): ShutdownCause {
  const minTrust = minTrustOf(snapshot);
  if (minTrust !== undefined && minTrust <= 10) return 'trust';
  if (
    snapshot.budget !== undefined &&
    snapshot.morale !== undefined &&
    snapshot.budget <= 0 &&
    snapshot.morale <= 15
  ) {
    return 'budgetMorale';
  }
  if (
    snapshot.seniorHp !== undefined &&
    snapshot.missedKpiCount !== undefined &&
    snapshot.seniorHp <= 5 &&
    snapshot.missedKpiCount >= 2
  ) {
    return 'seniorHpMissed';
  }
  return 'unknown';
}

/** `evaluateQuarterOutcome` と同じ優先順で missed_crisis の主因を分類する。 */
export type MissedCrisisCause = 'trust' | 'budget' | 'kpiMissed' | 'unknown';

export function classifyMissedCrisisCause(
  snapshot: LoseNextActionSnapshot = {},
): MissedCrisisCause {
  const minTrust = minTrustOf(snapshot);
  if (minTrust !== undefined && minTrust <= 15) return 'trust';
  if (snapshot.budget !== undefined && snapshot.budget <= 5) return 'budget';
  if (snapshot.missedKpiCount !== undefined && snapshot.missedKpiCount >= 4) return 'kpiMissed';
  return 'unknown';
}

/** `evaluateQuarterOutcome` と同じ優先順で reorg_required の主因を分類する。 */
export type ReorgCause = 'kpiMissed' | 'trust' | 'unknown';

export function classifyReorgCause(snapshot: LoseNextActionSnapshot = {}): ReorgCause {
  const minTrust = minTrustOf(snapshot);
  const missed = snapshot.missedKpiCount;
  if (
    snapshot.quarterNumber !== undefined &&
    snapshot.quarterNumber >= 2 &&
    missed !== undefined &&
    missed >= 3
  ) {
    return 'kpiMissed';
  }
  if (minTrust !== undefined && minTrust <= 20 && missed !== undefined && missed >= 2) {
    return 'trust';
  }
  return 'unknown';
}

const SHUTDOWN_FALLBACK: Record<Exclude<ShutdownCause, 'trust'>, LoseNextActionView> = {
  budgetMorale: {
    nextAction: '予算を使い切る前に追加予算申請で残高を確保し、休息で士気を戻してから投資する。',
    insight: '予算ゼロと士気低下が重なると、現場を休ませる余力すら残らない。',
  },
  seniorHpMissed: {
    nextAction: '緊急対応と休息でシニアHPを守りつつ、未達KPIを減らして継続不能の条件を同時に外す。',
    insight: 'シニアが枯れ、未達が重なると、現場も評価も立て直せなくなる。',
  },
  unknown: {
    nextAction:
      '信頼・予算・士気・シニアHPのどの下限が先に危ないかを見極め、信頼を削る選択を避けつつ足りない資源だけを立て直す。',
    insight: '継続不能の条件は複数あり、原因と違う手を打つと悪化することがある。',
  },
};

const MISSED_CRISIS_FALLBACK: Record<
  Exclude<MissedCrisisCause, 'trust' | 'kpiMissed'>,
  LoseNextActionView
> = {
  budget: {
    nextAction:
      'ショップやレバーの支出を抑え、予算が底をつく前に追加予算申請で残高を確保してから投資する。',
    insight: '予算下限での継続不能は、成果不足ではなく運用費の先食いでも起きる。',
  },
  unknown: {
    nextAction:
      '信頼・予算・KPI未達のどれが危機かを見極め、信頼由来なら修正を避け、予算やKPI由来なら対応する手段だけを使う。',
    insight: '深刻な未達は複数経路があり、原因と違う手を打つと悪化することがある。',
  },
};

function shutdownAction(snapshot: LoseNextActionSnapshot): LoseNextActionView {
  const cause = classifyShutdownCause(snapshot);
  if (cause === 'trust') {
    return trustStakeholderAction(
      classifyExhaustedStakeholder(snapshot.trust, 10),
      '信頼だけが底をついてもプロジェクトは止まり、その局面で信頼をさらに削る選択は逆効果になる。',
    );
  }
  return SHUTDOWN_FALLBACK[cause];
}

function missedCrisisAction(snapshot: LoseNextActionSnapshot): LoseNextActionView {
  const cause = classifyMissedCrisisCause(snapshot);
  if (cause === 'trust') {
    return trustStakeholderAction(
      classifyExhaustedStakeholder(snapshot.trust, 15),
      '信頼が先に枯れる深刻な未達では、さらに信頼を削る目標修正は危機を深めるだけになる。',
    );
  }
  if (cause === 'kpiMissed') {
    return missedKpiAction(
      snapshot,
      {
        nextAction:
          '四半期中に未達KPIを立て直し、修正に頼る回数を減らして複数KPIの同時未達を避ける。',
        insight: '未達が重なると、どの修正を選んでも信頼コストを払い続けることになる。',
      },
      '四半期中に',
      '未達が重なると、どの修正を選んでも信頼コストを払い続けることになる。',
    );
  }
  return MISSED_CRISIS_FALLBACK[cause];
}

function reorgRequiredAction(snapshot: LoseNextActionSnapshot): LoseNextActionView {
  const cause = classifyReorgCause(snapshot);
  if (cause === 'kpiMissed') {
    return missedKpiAction(
      snapshot,
      {
        nextAction: 'Q2 以降に未達KPIが3件以上重ならないよう、四半期中に未達軸を立て直す。',
        insight: '未達が積み上がると、組織再編という外からの決着になる。',
      },
      'Q2 以降に未達が3件以上重ならないよう、四半期中に',
      '未達が積み上がると、組織再編という外からの決着になる。',
    );
  }
  if (cause === 'trust') {
    return trustStakeholderAction(
      classifyExhaustedStakeholder(snapshot.trust, 20),
      '信頼が低いときの目標修正は、同じ未達数でも再編条件へ押し込みやすい。',
    );
  }
  return LOSE_NEXT_ACTIONS.reorgRequired;
}

function quarterOutcomeAction(
  outcome: QuarterOutcome,
  snapshot: LoseNextActionSnapshot,
): LoseNextActionView | undefined {
  if (outcome === 'shutdown') return shutdownAction(snapshot);
  if (outcome === 'missed_crisis') return missedCrisisAction(snapshot);
  if (outcome === 'reorg_required') return reorgRequiredAction(snapshot);
  return undefined;
}

function reviewFreezeAction(snapshot: LoseNextActionSnapshot): LoseNextActionView {
  const peak = snapshot.reviewQueuePeak;
  const hp = snapshot.seniorHp;
  const queuePath = peak !== undefined && peak >= 48;
  const hpPath = hp !== undefined && hp <= 45;

  if (hpPath && !queuePath) {
    return {
      nextAction:
        '割り込みレビューでシニアHPを削らず、緊急対応と休息でHPを戻し、AIスロットルで流入を抑えて低HPからのレビュー凍結を避ける。',
      insight: 'レビュー担当が枯れると、キューがまだでも出荷ライン自体が止まる。',
    };
  }
  if (queuePath && !hpPath) {
    return {
      nextAction:
        'AIスロットル・PR分割・レビュー応援で渋滞ピークを先に下げ、割り込みレビューに頼ってシニアHPを削らない。',
      insight: '実装量だけ増やすと、ボトルネックは必ずレビュー側へ移る。',
    };
  }
  return LOSE_NEXT_ACTIONS.reviewFreeze;
}

/** 敗因に対応する次の一手と現場示唆を返す。 */
export function loseNextActionView(
  reason: LoseReason,
  options: LoseNextActionOptions = {},
): LoseNextActionView {
  const snapshot = options.snapshot ?? {};
  if (options.quarterOutcome) {
    const fromOutcome = quarterOutcomeAction(options.quarterOutcome, snapshot);
    if (fromOutcome) return fromOutcome;
  }
  if (reason === 'reviewFreeze') return reviewFreezeAction(snapshot);
  return LOSE_NEXT_ACTIONS[reason];
}
