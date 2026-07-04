/**
 * スプリント間イベント（ビート）の宣言的定義（SPEC 第9章）。
 *
 * 固定トラックのスプリントの合間に出る「判定イベント（自動適用）」と
 * 「選択イベント（リスク/リターンの 2〜3 択）」をデータ駆動で表す。
 * 効果の適用は `src/sim/run/events.ts`（純TS）。組織状態による重み付けは
 * `triggers`（信号→重み倍率）で表す（architecture §4.3 / SPEC 第9章）。
 */
import type {
  EventSignal,
  LoseReason,
  SprintModifierDelta,
  StakeholderTrust,
} from '../sim/run/types';

/** 選択肢の結果（指定キーのみ適用。Morale 減少はレリックで緩和されうる）。 */
export interface EventOutcome {
  /** 出荷ポイント（org.deliveryScore と当期 quarterTotals.delivered へ加算）。 */
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
  /** 次スプリント限定の一時効果（一回消費。org の恒久変化とは別軸）。 */
  nextSprint?: SprintModifierDelta;
  /** ステークホルダー信頼の増減（安全側の代償に使う。負で低下）。 */
  trust?: Partial<StakeholderTrust>;
  /** 判定イベントが直接ハード敗北を起こす場合の理由（例: 'reviewFreeze'）。 */
  forceLose?: LoseReason;
}

export interface EventChoice {
  label: string;
  /** 結果の説明（プレイヤー向け）。 */
  description: string;
  outcome: EventOutcome;
  /**
   * 画面遷移を伴う選択の遷移先（旧 shop/rest/elite の統合）。
   * 既定（未指定）は通常スプリントへ進む。resolveBeat はこれで分岐する。
   */
  leadsTo?: 'sprint' | 'sprint-elite' | 'shop' | 'rest';
}

export interface EventDef {
  id: string;
  title: string;
  prompt: string;
  /** 演出分類（良い/悪い/ネタ。第9.1〜9.3）。 */
  tone: 'good' | 'bad' | 'joke';
  /**
   * 種別。未指定なら effectiveKind で既定解決（choices 長 1→judgment / 2 以上→decision）。
   * judgment 定義は契約として必ず 'judgment' を明示する（SPEC 第9章）。
   */
  kind?: 'judgment' | 'decision';
  /** 抽選のベース重み（既定 1）。 */
  weight?: number;
  /** 信号→重み倍率（組織状態で重みをスケールする。第4節）。 */
  triggers?: Partial<Record<EventSignal, number>>;
  /**
   * 抽選対象になるための信号下限（0..1）。指定した全信号が下限以上のときのみプールに入る。
   * ハード敗北など、健全な組織で起きてはならない事象を「組織が荒れたときだけ」に限定する。
   */
  minSignal?: Partial<Record<EventSignal, number>>;
  choices: EventChoice[];
}

/**
 * 種別の正規化（既定を解決）。フィルタ/分類はこれを通す（生の kind を直接見ない）。
 * 既定: choices 長 1 → 'judgment'、2 以上 → 'decision'。
 */
export function effectiveKind(def: EventDef): 'judgment' | 'decision' {
  return def.kind ?? (def.choices.length <= 1 ? 'judgment' : 'decision');
}

export const EVENT_DEFS: EventDef[] = [
  // --- 選択イベント（decision）：旧 ◇イベント ---
  {
    id: 'urgent-demo',
    title: '緊急のお願い',
    prompt: '経営から「来週デモがある」と連絡が来た。どう捌く？',
    tone: 'bad',
    choices: [
      {
        label: '残業して間に合わせる',
        description: '短期間でデモ用の成果を積み上げる',
        outcome: { delivered: 30, morale: -15, seniorHp: -10 },
      },
      {
        label: 'スコープを削って出す',
        description: '機能を絞って最低限のデモを出す',
        outcome: { delivered: 10, techDebt: 5 },
      },
      {
        label: '正直に延期を交渉する',
        description: '期待値を下げ、長期的な信頼を取りに行く',
        outcome: { grantRelic: 'expectation-mgmt', trust: { management: -8 } },
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
        description: '品質を担保しつつテスト資産を増やす',
        outcome: { testCoverage: 12, seniorHp: -6 },
      },
      {
        label: 'そのまま全部マージ',
        description: 'スピード優先で取り込み、後から直す',
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
        description: '一気にレビューを片付けるが消耗が激しい',
        outcome: { quality: 4, seniorHp: -14 },
      },
      {
        label: '分割を依頼する',
        description: '小さく出す文化をチームに浸透させる',
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
        description: '現場の裁量を広げ、学習を加速させる',
        outcome: { aiLiteracy: 12, morale: 8 },
      },
      {
        label: 'ガイドラインを整備',
        description: 'ルールを整え、安全に AI を使える土台を作る',
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
        description: '数字だけ追い、品質リスクを抱え込む',
        outcome: { delivered: 20, aiDependency: 12, quality: -6 },
      },
      {
        label: '健全な指標を提案する',
        description: '一次情報を重視する文化を根付かせる',
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
        description: '学びの場を設け、同じ失敗を繰り返さない',
        outcome: { budget: -10, grantRelic: 'postmortem' },
      },
      {
        label: '今は見送る',
        description: '予算を温存し、当面は現状維持する',
        outcome: { budget: 8 },
      },
    ],
  },
  {
    id: 'emoji-policy-summit',
    title: 'Slack 絵文字命名会議',
    prompt: '「:done_done: と :really_done: の違いを決めたい」と全社から相談が来た。',
    tone: 'joke',
    weight: 0.7,
    choices: [
      {
        label: '命名規約をちゃんと決める',
        description: '小さな混乱を整え、コミュニケーションの手戻りを減らす',
        outcome: { morale: 3, quality: 2 },
      },
      {
        label: 'リアクション芸として受け流す',
        description: '場は和むが、絵文字だけで意思決定する文化が少し育つ',
        outcome: { morale: 6, techDebt: 2 },
      },
    ],
  },
  {
    id: 'standup-acronym-storm',
    title: '朝会が略語だらけになった',
    prompt: '朝会で KPI、OKR、WIP、ADR が飛び交い、新人が静かにメモを取り続けている。',
    tone: 'joke',
    weight: 0.55,
    choices: [
      {
        label: '用語集を作る',
        description: '略語の意味をそろえ、オンボーディングのつまずきを減らす',
        outcome: { quality: 2, aiLiteracy: 2 },
      },
      {
        label: '勢いで乗り切る',
        description: '場は盛り上がるが、後で「それ何の略でしたっけ？」が増える',
        outcome: { morale: 4, techDebt: 2 },
      },
    ],
  },

  // --- 選択イベント（decision）：旧 elite / shop / rest を統合 ---
  {
    id: 'elite-offer',
    title: '大型案件を前倒しするか',
    prompt: '大口顧客から「前倒しで出せないか」と打診が来た。',
    tone: 'bad',
    weight: 2,
    choices: [
      {
        label: '前倒しで引き受ける（高負荷スプリント）',
        description: '大きな出荷チャンスだが、渋滞・炎上リスクも高い',
        outcome: {},
        leadsTo: 'sprint-elite',
      },
      {
        label: '通常スプリントで進める',
        description: '無理をせず、四半期目標とのバランスを取る',
        outcome: { trust: { management: -4 } },
        leadsTo: 'sprint',
      },
    ],
  },
  {
    id: 'shop-offer',
    title: '予算で補強するか',
    prompt: '四半期予算に余裕がある。ツール・採用で補強できる。',
    tone: 'good',
    weight: 2,
    choices: [
      {
        label: '補強する（ショップを開く）',
        description: 'カード購入・強化やレリック獲得・採用ができる',
        outcome: {},
        leadsTo: 'shop',
      },
      {
        label: '予算を温存する',
        description: '補強機会を逃すが予算は手元に残る',
        outcome: {},
        leadsTo: 'sprint',
      },
    ],
  },
  {
    id: 'rest-offer',
    title: '一息つくか',
    prompt: 'チームに疲れが見える。回復に充てるか、攻め続けるか。',
    tone: 'good',
    weight: 2,
    choices: [
      {
        label: '休む（回復するが当期出荷を手放す）',
        description: 'シニアHP回復・負債返済・カード強化などが選べる',
        outcome: { nextSprint: { taskCountMul: 0.7 } },
        leadsTo: 'rest',
      },
      {
        label: '攻め続ける',
        description: '回復しない（出荷機会は取りに行く）',
        outcome: {},
        leadsTo: 'sprint',
      },
    ],
  },

  // --- 判定イベント（judgment）：組織状態依存・自動適用 ---
  {
    id: 'debt-incident',
    title: '"動いているように見える" 障害',
    prompt: '本番で潜在バグが顕在化した。技術的負債のツケが回ってきた。',
    tone: 'bad',
    kind: 'judgment',
    weight: 0.6,
    triggers: { techDebtHigh: 3 },
    choices: [
      {
        label: '了解',
        description: '潜在バグが顕在化し、品質と士気が揺らぐ',
        outcome: { quality: -8, techDebt: 6, morale: -4 },
      },
    ],
  },
  {
    id: 'giant-ai-pr-judgment',
    title: '巨大 AI 生成 PR が投下された',
    prompt: 'AI が一気に大量のコードを生成し、レビュー待ちが膨れ上がった。',
    tone: 'bad',
    kind: 'judgment',
    weight: 0.6,
    triggers: { aiDependencyHigh: 3 },
    choices: [
      {
        label: '了解',
        description: 'レビュー待ちが膨れ上がり、次スプリントにも負荷が残る',
        outcome: { seniorHp: -6, nextSprint: { reviewLoadAdd: 4 } },
      },
    ],
  },
  {
    id: 'hallucinated-api',
    title: '存在しない API を使っていた',
    prompt: 'AI が幻覚した API でコードが書かれ、動かないことが発覚した。',
    tone: 'bad',
    kind: 'judgment',
    weight: 0.5,
    triggers: { aiLiteracyLow: 3 },
    choices: [
      {
        label: '了解',
        description: '幻覚 API の修正で手戻りが増える',
        outcome: { quality: -4, nextSprint: { reworkRateAdd: 0.15 } },
      },
    ],
  },
  {
    id: 'senior-burnout',
    title: 'シニアがレビューで燃え尽きた',
    prompt: '積み上がったレビューでシニアの消耗が限界に近づいた。',
    tone: 'bad',
    kind: 'judgment',
    weight: 0.5,
    triggers: { seniorHpLow: 3 },
    // シニアHP が下がってきたとき（HP <= 約65）だけ起きる。健全な組織には起きない。
    minSignal: { seniorHpLow: 0.35 },
    choices: [
      {
        label: '了解',
        description: 'レビュー負荷が限界に達し、チーム全体が消耗する',
        outcome: { seniorHp: -28, morale: -6 },
      },
    ],
  },
  {
    id: 'review-freeze',
    title: 'レビューが完全に停止した',
    prompt: 'レビュー担当が機能停止し、出荷ラインが止まった。',
    tone: 'bad',
    kind: 'judgment',
    weight: 0.25,
    triggers: { seniorHpLow: 4 },
    // ハード敗北。シニアHP が枯渇寸前（HP <= 約45）のときだけ抽選対象にする。
    // 健全なランがビートの乱数だけで回避不能に終了しないようにする。
    minSignal: { seniorHpLow: 0.55 },
    choices: [
      {
        label: '了解',
        description: 'レビューが完全に止まり、出荷ラインが機能停止する',
        outcome: { forceLose: 'reviewFreeze' },
      },
    ],
  },
  {
    id: 'ci-improved',
    title: 'CI 改善で手戻りが激減',
    prompt: '整備したテストと CI が効き、壊れる前に気づけるようになった。',
    tone: 'good',
    kind: 'judgment',
    weight: 0.5,
    triggers: { testCoverageHigh: 2 },
    choices: [
      {
        label: '了解',
        description: 'CI とテスト整備の成果が出始める',
        outcome: { quality: 6, testCoverage: 4 },
      },
    ],
  },
  {
    id: 'docs-hit-ai',
    title: 'ドキュメントが AI に刺さった',
    prompt: '整備したドキュメントを AI がよく参照し、生成精度が上がった。',
    tone: 'good',
    kind: 'judgment',
    weight: 0.5,
    triggers: { documentationHigh: 2 },
    choices: [
      {
        label: '了解',
        description: '整備したドキュメントが AI の精度向上に効く',
        outcome: { aiLiteracy: 6, delivered: 8 },
      },
    ],
  },
  {
    id: 'readme-haiku',
    title: 'README が俳句になった',
    prompt: 'AI が README の要約を頼まれ、「五七五なら読みやすい」と判断した。',
    tone: 'joke',
    kind: 'judgment',
    weight: 0.35,
    choices: [
      {
        label: '了解',
        description: 'なぜかチームの空気が少し和み、AI へのツッコミ力も上がる',
        outcome: { morale: 4, aiLiteracy: 2 },
      },
    ],
  },
  {
    id: 'meeting-title-refactor',
    title: '会議名だけリファクタされた',
    prompt: 'AI がカレンダー整理を手伝い、「定例」をすべて「戦略同期セッション」に改名した。',
    tone: 'joke',
    kind: 'judgment',
    weight: 0.3,
    choices: [
      {
        label: '了解',
        description: '会議の中身は変わらないが、少しだけドキュメント文化を見直すきっかけになる',
        outcome: { morale: 2, quality: 1 },
      },
    ],
  },
];

const BY_ID = new Map(EVENT_DEFS.map((e) => [e.id, e]));

/** イベント定義を ID で取得する（未知は undefined）。 */
export function getEvent(id: string): EventDef | undefined {
  return BY_ID.get(id);
}
