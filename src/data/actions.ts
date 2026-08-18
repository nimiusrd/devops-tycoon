/**
 * 介入アクションの宣言的定義（SPEC 第6.1 の表 / 第4.3 のアクションバー）。
 *
 * ラベル・アイコン・説明・副作用文などのコンテンツをデータとして持つ。
 * 数値バランスは `src/data/balance/actions.ts` から合成する。
 * 効果の実装本体は `src/sim/actions.ts`（描画非依存の純TS）。
 */
import { ACTION_BALANCE_BY_ID } from './balance/actions';
import type { ActionDef } from '../sim/actions';

type ActionContentDef = Omit<ActionDef, 'cost' | 'cooldownTicks' | 'gauge'>;

/** アクションバーに並べる順（旧モック main-screen 由来）。 */
const ACTION_CONTENT_DEFS: ActionContentDef[] = [
  {
    id: 'interruptReview',
    label: '割り込みレビュー',
    icon: '🛂',
    stabilizesFlow: true,
    description: 'Review キューから複数 PR を即座に捌く',
    sideEffect: 'シニアHPを少量消費',
  },
  {
    id: 'splitPr',
    label: 'PR分割',
    icon: '✂️',
    stabilizesFlow: true,
    description: '巨大PRをドラッグして割り、レビューしやすくする（手戻り率↓）',
    sideEffect: '処理が一旦巻き戻る。士気とシニアHPを消費。運用安定なし',
  },
  {
    id: 'firefight',
    label: '緊急対応',
    icon: '🔥',
    // RI-73 / F-1: 安定付与は猶予が短い／複数炎上のときだけ（actions.ts）。
    stabilizesFlow: true,
    tone: 'danger',
    description: '炎上タスクを延焼前に鎮火する',
    sideEffect: '余裕のある先消しは高コスト。緊急時だけ安く安定も付く',
  },
  {
    id: 'assignTask',
    label: 'タスク差配',
    icon: '🎯',
    stabilizesFlow: true,
    description: 'タスクをレーンへドラッグ差配して一気に前進させる',
    sideEffect: '偏らせると士気が下がる',
  },
  {
    id: 'aiThrottle',
    label: 'AIスロットル',
    icon: '🎚️',
    stabilizesFlow: true,
    description: 'AI出力レートを絞り、Review渋滞を抑える',
    sideEffect: '出荷速度が一時的に低下',
  },
  {
    id: 'pairReview',
    label: 'ペアレビュー',
    icon: '👥',
    stabilizesFlow: true,
    description: '詰まったPRをペアで処理。AI Literacy が上がる',
    sideEffect: '一時的に2人を拘束',
  },
  {
    id: 'overtime',
    label: '残業号令',
    icon: '📣',
    tone: 'heavy',
    description: '当スプリントのスループットを大幅ブースト',
    sideEffect: 'Morale・シニアHPが減少',
  },
  {
    id: 'andon',
    label: 'アンドン',
    icon: '⏸️',
    // RI-73 / F-1: 運用安定は付けない。薄いキューでは士気追加＋シニアHP（actions.ts）。
    // 渋滞時は士気のみ。毎スプリント先止めは薄キュー罰で高くつく。
    stabilizesFlow: true,
    tone: 'heavy',
    description: 'タスク流入を止め、溜まったキューを捌き切る',
    sideEffect: '出荷機会を失う。士気を消費。薄いキューではシニアHPも消費。運用安定なし',
  },
];

/** 表示用コンテンツへバランスレジストリの実行値を合成する。 */
export const ACTION_DEFS: ActionDef[] = ACTION_CONTENT_DEFS.map((content) => {
  const balance = ACTION_BALANCE_BY_ID[content.id];
  return {
    ...content,
    cost: balance.focusCost.value,
    cooldownTicks: balance.cooldownTicks.value,
    gauge: balance.gauge.value,
  };
});

const BY_ID = new Map<string, ActionDef>(ACTION_DEFS.map((a) => [a.id, a]));

/** アクション定義を ID で取得する（未知は undefined）。 */
export function getAction(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}
