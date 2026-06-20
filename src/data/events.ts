/**
 * ランダムイベント（分岐選択）の宣言的定義（SPEC 第9章）。
 *
 * マップの◇ノードで提示する、トレードオフのある選択イベント。
 * 選択結果は組織値・予算・レリック/カード付与の差分（`EventOutcome`）で表す。
 * 効果の適用は `src/sim/run/events.ts`（純TS）。データ駆動（architecture §4.3）。
 */

/** 選択肢の結果（指定キーのみ適用。Morale 減少はレリックで緩和されうる）。 */
export interface EventOutcome {
  /** 出荷ポイント（org.deliveryScore へ加算）。 */
  delivered?: number;
  /** Morale 増減（負はレリックの moraleDamageMul で緩和）。 */
  morale?: number;
  seniorHp?: number;
  techDebt?: number;
  budget?: number;
  quality?: number;
  testCoverage?: number;
  aiLiteracy?: number;
  aiDependency?: number;
  /** 付与するレリック ID。 */
  grantRelic?: string;
  /** デッキに加えるカード定義 ID。 */
  grantCard?: string;
}

export interface EventChoice {
  label: string;
  /** 結果の説明（プレイヤー向け）。 */
  description: string;
  outcome: EventOutcome;
}

export interface EventDef {
  id: string;
  title: string;
  prompt: string;
  /** 演出分類（良い/悪い/ネタ。第9.1〜9.3）。 */
  tone: 'good' | 'bad' | 'joke';
  choices: EventChoice[];
}

export const EVENT_DEFS: EventDef[] = [
  {
    id: 'urgent-demo',
    title: '緊急のお願い',
    prompt: '経営から「来週デモがある」と連絡が来た。どう捌く？',
    tone: 'bad',
    choices: [
      {
        label: '残業して間に合わせる',
        description: '出荷 +30 / Morale -15 / シニアHP -10',
        outcome: { delivered: 30, morale: -15, seniorHp: -10 },
      },
      {
        label: 'スコープを削って出す',
        description: '出荷 +10 / Tech Debt +5',
        outcome: { delivered: 10, techDebt: 5 },
      },
      {
        label: '正直に延期を交渉する',
        description: 'レリック「期待値マネジメント」を獲得',
        outcome: { grantRelic: 'expectation-mgmt' },
      },
    ],
  },
  {
    id: 'ai-test-gen',
    title: 'AI がテストを大量生成',
    prompt: 'AI がテストケースを大量に生成した。どう扱う？',
    tone: 'good',
    choices: [
      {
        label: 'レビューして取り込む',
        description: 'Test Coverage +12 / シニアHP -6',
        outcome: { testCoverage: 12, seniorHp: -6 },
      },
      {
        label: 'そのまま全部マージ',
        description: 'Test Coverage +6 / Tech Debt +4',
        outcome: { testCoverage: 6, techDebt: 4 },
      },
    ],
  },
  {
    id: 'giant-pr',
    title: '巨大 AI 生成 PR が投下された',
    prompt: '1,200 行の "軽微な修正" がレビュー待ちに積まれた。',
    tone: 'bad',
    choices: [
      {
        label: 'シニアが気合いでレビュー',
        description: '品質 +4 / シニアHP -14',
        outcome: { quality: 4, seniorHp: -14 },
      },
      {
        label: '分割を依頼する',
        description: 'Morale -6 / レリック「小さく出す文化」を獲得',
        outcome: { morale: -6, grantRelic: 'small-pr' },
      },
    ],
  },
  {
    id: 'junior-awaken',
    title: 'ジュニアが AI 活用に覚醒',
    prompt: 'ジュニアが AI の使いどころを掴み始めた。',
    tone: 'good',
    choices: [
      {
        label: '権限を任せる',
        description: 'AI Literacy +12 / Morale +8',
        outcome: { aiLiteracy: 12, morale: 8 },
      },
      {
        label: 'ガイドラインを整備',
        description: 'AI Literacy +8 / カード「AI利用ガイドライン」を獲得',
        outcome: { aiLiteracy: 8, grantCard: 'ai-guideline' },
      },
    ],
  },
  {
    id: 'kpi-trap',
    title: 'AI 利用率が KPI になった',
    prompt: '「AI 利用率だけ」を追う号令が下りた。',
    tone: 'bad',
    choices: [
      {
        label: '号令に従う',
        description: '出荷 +20 / AI依存度 +12 / 品質 -6',
        outcome: { delivered: 20, aiDependency: 12, quality: -6 },
      },
      {
        label: '健全な指標を提案する',
        description: 'Morale +6 / レリック「一次情報主義」を獲得',
        outcome: { morale: 6, grantRelic: 'primary-source' },
      },
    ],
  },
  {
    id: 'postmortem-culture',
    title: 'ポストモーテムを始めるか',
    prompt: '障害を責めずに学ぶ場を作る提案が出た。',
    tone: 'good',
    choices: [
      {
        label: '導入する',
        description: '予算 -10 / レリック「ポストモーテム文化」を獲得',
        outcome: { budget: -10, grantRelic: 'postmortem' },
      },
      {
        label: '今は見送る',
        description: '予算 +8',
        outcome: { budget: 8 },
      },
    ],
  },
];

const BY_ID = new Map(EVENT_DEFS.map((e) => [e.id, e]));

/** イベント定義を ID で取得する（未知は undefined）。 */
export function getEvent(id: string): EventDef | undefined {
  return BY_ID.get(id);
}
