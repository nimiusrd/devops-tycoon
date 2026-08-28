/**
 * 難易度プリセットと試練（ランモディファイア）の宣言的定義（SPEC 第16章）。
 *
 * 難易度は組織の初期パラメータ・タスク量・全体係数・初期予算を、
 * 試練はスコア倍率と引き換えの追加ルールを表す。データ駆動（architecture §4.3）。
 */
import type { ScenarioOrg } from '../sim/scenarios';
import type { CardEffects } from '../sim/run/types';
import type { DifficultyId } from '../sim/run/types';

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  description: string;
  /** 組織の初期パラメータ（0..100）。 */
  org: ScenarioOrg;
  /** スプリントのタスク量倍率。 */
  taskCountMul: number;
  /** 全スプリントに掛かる全体係数（難易度の手触り）。 */
  globalEffects?: Partial<CardEffects>;
  /** ラン開始時の予算。 */
  startBudget: number;
  /** ボス突破目標の倍率（高難度ほど厳しい）。 */
  bossTargetMul: number;
  /**
   * AI 割当タスク 1 件あたりの依存度上昇（未指定時は `AI_DEP_PER_TASK`）。
   * Nightmare は S1 即死を避けるためグローバル既定より低くする（RI-74）。
   * Easy は default シナリオの通常床 58 の序盤で cap に張り付かないよう既定より低くする（#359）。
   */
  aiDependencyPerTask?: number;
}

/** タイトル表示と勝利時の次難易度解放に使う順。 */
export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];

/** デイリーランの固定難易度（全員同一条件）。正本は `balance/meta.ts`。 */
export { DAILY_RUN_DIFFICULTY, DAILY_RUN_TRIALS } from './balance/meta';

export const DIFFICULTY_DEFS: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy',
    label: 'Easy: モダンなプロダクトチーム',
    description: 'テストもドキュメントもある。PR が小さく AI が効きやすい。',
    org: {
      aiDependencyBase: 25,
      aiLiteracy: 60,
      testCoverage: 70,
      documentation: 65,
      quality: 70,
      securityLevel: 70,
      morale: 75,
      seniorHp: 100,
    },
    // RI-75: F-4 代表方針でも通常 p50 が60秒帯に入るよう底上げ。
    taskCountMul: 1.85,
    /**
     * Issue #359: 通常床 58 × 採用率およそ 43% で約 25 件/スプリント。
     * 既定 2.2 だと 2 本目で cap に張り付く。単価 1.1 なら熟練でも S2 終端は cap 未満。
     * default シナリオ限定（`resolveAiDependencyPerTask`）。Copilot 等のツール開始は
     * 既定 2.2 のまま（#387）。F-7 の勝率つまみ seniorHpCostMul も据え置き。
     */
    aiDependencyPerTask: 1.1,
    // RI-73/F-7: 手戻り抑制は RI-75 値を維持。seniorHpCostMul で消耗だけ下げて勝率帯を作る。
    // 平均HP上昇によるレビュー加速は eliteTaskMul（sprintBaselineBuild）側で相殺する。
    // RI-134 後も naive easy の初見10 seedが 2〜3勝となる ≈20% 帯を維持する。
    globalEffects: {
      reworkRateAdd: -0.04,
      reviewEfficiencyMul: 1.05,
      seniorHpCostMul: 0.74,
    },
    startBudget: 60,
    bossTargetMul: 0.85,
  },
  normal: {
    id: 'normal',
    label: 'Normal: 普通の開発組織',
    description: '一部にテスト、属人的レビュー、古いドキュメント。AI 効果にばらつき。',
    org: {
      aiDependencyBase: 35,
      aiLiteracy: 45,
      testCoverage: 58,
      documentation: 52,
      quality: 62,
      securityLevel: 60,
      morale: 70,
      seniorHp: 100,
    },
    // RI-75: F-4 代表方針の通常 p50 を60秒帯へ。
    taskCountMul: 1.65,
    // RI-73/F-7: テンポ係数は触らず、シニア消耗だけ緩和して導入難易度の勝率帯を作る。
    globalEffects: {
      seniorHpCostMul: 0.8,
    },
    startBudget: 45,
    bossTargetMul: 1,
  },
  hard: {
    id: 'hard',
    label: 'Hard: レガシー業務システム',
    description: '仕様がコードにしかなく、巨大 PR とシニア依存。AI が自信満々に間違える。',
    org: {
      aiDependencyBase: 45,
      aiLiteracy: 35,
      testCoverage: 35,
      documentation: 30,
      quality: 45,
      securityLevel: 60,
      morale: 60,
      seniorHp: 90,
    },
    // RI-75: F-4 でも通常帯を維持（elite は別倍率で長尾抑制）。
    taskCountMul: 1.4,
    globalEffects: { reworkRateAdd: 0.05, reviewEfficiencyMul: 0.92 },
    startBudget: 35,
    bossTargetMul: 1.15,
  },
  nightmare: {
    id: 'nightmare',
    label: 'Nightmare: すべてが暗黙知',
    description: 'ドキュメントもテストもない。AI がもっともらしい嘘をつく。経営は倍速を期待。',
    org: {
      aiDependencyBase: 42,
      aiLiteracy: 25,
      testCoverage: 20,
      documentation: 15,
      quality: 35,
      securityLevel: 55,
      morale: 55,
      seniorHp: 80,
    },
    // RI-75: 非効率で長くなりやすい。床は低め、倍率はベース相当。
    taskCountMul: 1,
    /**
     * RI-74: S1 全AI割当でも cap 未満になる上昇量（他難易度は既定 2.2 のまま）。
     * 低リテラシー時のライバル上限（ホーム+10）と `frontier-dependency` の開始時 +5 を
     * S1・S2 に織り込み、最悪 52+5+29×0.8+5 = 85.2 で介入余地を残す。
     */
    aiDependencyPerTask: 0.8,
    globalEffects: { reworkRateAdd: 0.1, incidentRateMul: 1.25, reviewEfficiencyMul: 0.85 },
    startBudget: 25,
    bossTargetMul: 1.3,
  },
};

/** 難易度定義を取得する（未知は normal にフォールバック）。 */
export function getDifficulty(id: DifficultyId): DifficultyDef {
  return DIFFICULTY_DEFS[id] ?? DIFFICULTY_DEFS.normal;
}

export interface TrialDef {
  id: string;
  label: string;
  description: string;
  /** 集中力上限への加算（負で減る）。 */
  focusDelta?: number;
  /** 初期予算の倍率。 */
  budgetMul?: number;
  /** 全体係数（炎上が燃え広がりやすい等）。 */
  effects?: Partial<CardEffects>;
  /** スプリント開始時の AI依存度自然増加量。 */
  aiDependencyDriftPerSprint?: number;
  /** AI依存度 1% あたりのフロンティアモデル利用コスト。 */
  frontierModelCostPerDependency?: number;
  /** スコア倍率（メタ進行で使用。高いほど高得点）。 */
  scoreMul: number;
}

export const TRIAL_DEFS: TrialDef[] = [
  {
    id: 'low-focus',
    label: '集中力 -1',
    description: '介入の余裕が減る。',
    focusDelta: -1,
    scoreMul: 1.15,
  },
  {
    id: 'half-budget',
    label: '予算半減',
    description: '採用も施策も渋い。',
    budgetMul: 0.5,
    scoreMul: 1.15,
  },
  {
    id: 'flammable',
    label: '炎上が燃え広がりやすい',
    description: 'Incident 率が上がる。',
    effects: { incidentRateMul: 1.3 },
    scoreMul: 1.2,
  },
  {
    id: 'review-cap',
    label: 'レビュー容量に上限キャップ',
    description: 'レビュー効率が落ちる。',
    effects: { reviewEfficiencyMul: 0.85 },
    scoreMul: 1.2,
  },
  {
    id: 'frontier-dependency',
    label: 'フロンティアモデル依存',
    description: 'AI依存度が自然増加し、利用コストが予算を圧迫する。',
    aiDependencyDriftPerSprint: 5,
    // ベース 0.01 との合計が旧試練単価 0.05 になるよう上乗せする（RI-88）。
    frontierModelCostPerDependency: 0.04,
    scoreMul: 1.25,
  },
];

const TRIAL_BY_ID = new Map(TRIAL_DEFS.map((t) => [t.id, t]));

/** 試練定義を ID で取得する（未知は undefined）。 */
export function getTrial(id: string): TrialDef | undefined {
  return TRIAL_BY_ID.get(id);
}
