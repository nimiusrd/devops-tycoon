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
}

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
      morale: 75,
      seniorHp: 100,
    },
    taskCountMul: 0.9,
    globalEffects: { reworkRateAdd: -0.04, reviewEfficiencyMul: 1.1 },
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
      testCoverage: 55,
      documentation: 50,
      quality: 60,
      morale: 70,
      seniorHp: 100,
    },
    taskCountMul: 1,
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
      morale: 60,
      seniorHp: 90,
    },
    taskCountMul: 1.1,
    globalEffects: { reworkRateAdd: 0.05, reviewEfficiencyMul: 0.92 },
    startBudget: 35,
    bossTargetMul: 1.15,
  },
  nightmare: {
    id: 'nightmare',
    label: 'Nightmare: すべてが暗黙知',
    description: 'ドキュメントもテストもない。AI がもっともらしい嘘をつく。経営は倍速を期待。',
    org: {
      aiDependencyBase: 55,
      aiLiteracy: 25,
      testCoverage: 20,
      documentation: 15,
      quality: 35,
      morale: 55,
      seniorHp: 80,
    },
    taskCountMul: 1.2,
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
];

const TRIAL_BY_ID = new Map(TRIAL_DEFS.map((t) => [t.id, t]));

/** 試練定義を ID で取得する（未知は undefined）。 */
export function getTrial(id: string): TrialDef | undefined {
  return TRIAL_BY_ID.get(id);
}
