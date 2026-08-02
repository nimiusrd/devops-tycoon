/**
 * 敗北画面の「次の一手」と現場示唆（RI-82 / SPEC 第19.1 F-6）。
 *
 * 敗因ラベル（何が起きたか）とは別に、次のランで変える具体操作と
 * 現実の開発現場への示唆を返す。描画・状態は知らない純関数。
 *
 * 四半期レビュー由来の敗北は `loseReason` が粗い（missed_crisis / shutdown が
 * ともに trustExhausted）ため、`quarterOutcome` があればそちらを優先する。
 */
import type { LoseReason, QuarterOutcome } from '../sim/run/types';

export interface LoseNextActionView {
  /** 次のランで変える具体的な一手。 */
  nextAction: string;
  /** 現実の現場への示唆。 */
  insight: string;
}

export interface LoseNextActionOptions {
  /** 四半期レビュー由来の継続不能 outcome（ある場合のみ）。 */
  quarterOutcome?: QuarterOutcome;
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
      '割り込みレビューとAIスロットルで渋滞を崩し、レビュー応援やPR分割でピークを先に抑える。',
    insight: '実装量だけ増やすと、ボトルネックは必ずレビュー側へ移る。',
  },
  incidentCascade: {
    nextAction: '炎上タイマーが切れる前に緊急対応で鎮火し、連続する障害スプリントを途切れさせる。',
    insight: '障害は単発より、放置して連鎖させたときの方が組織を止める。',
  },
  aiDependency: {
    nextAction:
      'ペアレビューでAIリテラシーを上げるか、AIガイドライン／AIスロットルで依存度を下げる。',
    insight: 'AIに任せきりだと、仕様を説明・検証できる人がいなくなり判断が止まる。',
  },
  budgetExhausted: {
    nextAction:
      'ショップのAIツール買い足しを抑え、目標修正の追加予算申請やAI導入一時停止で余力を作ってから投資する。',
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
      '連続未達を避けるため、早い四半期で目標修正を選び、品質・士気・障害の下限を先に立て直す。',
    insight: '同じ未達を繰り返すと、現場改善ではなく組織再編という外からの決着になる。',
  },
};

/** 四半期 outcome 固有の次の一手（loseReason の粗い写像を補う）。 */
const QUARTER_OUTCOME_ACTIONS: Partial<Record<QuarterOutcome, LoseNextActionView>> = {
  missed_crisis: {
    nextAction:
      'KPI未達・予算下限・信頼低下のどれが危機かを見極め、スコープ削減・追加予算申請・期限延長など原因に合う目標修正で継続条件を守る。',
    insight: '深刻な未達は信頼だけでなく、予算や複数KPIの崩れでも同じ終了になる。',
  },
  shutdown: {
    nextAction:
      '信頼・予算・士気・シニアHPの下限を同時に監視し、休息と目標修正で継続資源を先に立て直してから負荷を上げる。',
    insight: '継続不能は単一KPIではなく、信頼と現場資源が同時に底をついたときに決まる。',
  },
  reorg_required: {
    nextAction:
      '連続未達を避けるため、早い四半期で目標修正を選び、品質・士気・障害の下限を先に立て直す。',
    insight: '同じ未達を繰り返すと、現場改善ではなく組織再編という外からの決着になる。',
  },
};

/** 敗因に対応する次の一手と現場示唆を返す。 */
export function loseNextActionView(
  reason: LoseReason,
  options: LoseNextActionOptions = {},
): LoseNextActionView {
  const fromOutcome = options.quarterOutcome
    ? QUARTER_OUTCOME_ACTIONS[options.quarterOutcome]
    : undefined;
  return fromOutcome ?? LOSE_NEXT_ACTIONS[reason];
}
