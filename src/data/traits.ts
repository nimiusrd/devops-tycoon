/**
 * メンバーの性格特性（トレイト）の宣言的定義（SPEC 第12.1）。
 *
 * トレイトは個体メンバーの編成・成長・スタミナへ掛かる係数の集合で、データ駆動
 * （architecture §4.3）。`src/sim/member` の純関数がこの定義を読み、編成効果や
 * 成長・消耗の計算に反映する。バランス調整・トレイト追加はこのファイルで完結する。
 */

/** トレイトの識別子（SPEC 第12.1 の例）。 */
export type TraitId =
  | 'aiArtisan'
  | 'megaPrMaker'
  | 'reviewDemon'
  | 'docMaster'
  | 'juniorStar'
  | 'burnoutProne';

/**
 * トレイトが個体へ与える補正。指定キーのみ既定値（無効果）から上書きする。
 * 乗算系は 1 で無効果、加算系は 0 で無効果。
 */
export interface TraitModifiers {
  /** Coding 寄与（実装力）への倍率。 */
  implMul: number;
  /** Review 寄与（レビュー力）への倍率。 */
  reviewMul: number;
  /** AI を配ったときの追加 Rework 低減（負で手戻りを減らす）。 */
  aiReworkAdd: number;
  /** レビュー負荷の上乗せ（巨大PR等。Review 効率倍率へ乗算、<1 で渋滞増）。 */
  reviewLoadMul: number;
  /** スタミナ上限への倍率。 */
  staminaMaxMul: number;
  /** スプリントごとのスタミナ消費への倍率。 */
  staminaDrainMul: number;
  /** 経験値獲得への倍率（育成速度）。 */
  xpMul: number;
  /** 在籍中、毎スプリントに積むドキュメント量。 */
  docPerSprint: number;
}

export interface TraitDef {
  id: TraitId;
  name: string;
  description: string;
  /** 既定（無効果）からの差分。 */
  modifiers: Partial<TraitModifiers>;
}

/** トレイト補正の既定値（無効果）。 */
export const IDENTITY_TRAIT_MODIFIERS: TraitModifiers = {
  implMul: 1,
  reviewMul: 1,
  aiReworkAdd: 0,
  reviewLoadMul: 1,
  staminaMaxMul: 1,
  staminaDrainMul: 1,
  xpMul: 1,
  docPerSprint: 0,
};

export const TRAIT_DEFS: TraitDef[] = [
  {
    id: 'aiArtisan',
    name: 'AI職人',
    description: 'AIタスクの成功率が高い。AIを配ると手戻りが減る。',
    modifiers: { aiReworkAdd: -0.06 },
  },
  {
    id: 'megaPrMaker',
    name: '巨大PR製造機',
    description: '実装の出力は多いが、レビュー負荷を押し上げる。',
    modifiers: { implMul: 1.25, reviewLoadMul: 0.9 },
  },
  {
    id: 'reviewDemon',
    name: 'レビュー鬼',
    description: 'レビューが速いが、スタミナ消費が大きい。',
    modifiers: { reviewMul: 1.3, staminaDrainMul: 1.35 },
  },
  {
    id: 'docMaster',
    name: 'ドキュメント魔',
    description: '在籍するだけで Documentation を少しずつ積む。',
    modifiers: { docPerSprint: 3 },
  },
  {
    id: 'juniorStar',
    name: 'ジュニアの星',
    description: '育成・伝播が速く、経験値の伸びが大きい。',
    modifiers: { xpMul: 1.6 },
  },
  {
    id: 'burnoutProne',
    name: '燃え尽き気味',
    description: 'スタミナ上限が低く、無理が利かない。',
    modifiers: { staminaMaxMul: 0.72 },
  },
];

const TRAIT_BY_ID = new Map(TRAIT_DEFS.map((t) => [t.id, t]));

/** トレイト定義を ID で取得する（未知は undefined）。 */
export function getTrait(id: TraitId): TraitDef | undefined {
  return TRAIT_BY_ID.get(id);
}

/**
 * トレイト集合の補正を 1 つに畳み込む（乗算は掛け算、加算は足し算）。
 * 未指定キーは無効果のまま残る純関数。
 */
export function foldTraitModifiers(traits: TraitId[]): TraitModifiers {
  const out: TraitModifiers = { ...IDENTITY_TRAIT_MODIFIERS };
  for (const id of traits) {
    const def = getTrait(id);
    if (!def) continue;
    const m = def.modifiers;
    if (m.implMul !== undefined) out.implMul *= m.implMul;
    if (m.reviewMul !== undefined) out.reviewMul *= m.reviewMul;
    if (m.aiReworkAdd !== undefined) out.aiReworkAdd += m.aiReworkAdd;
    if (m.reviewLoadMul !== undefined) out.reviewLoadMul *= m.reviewLoadMul;
    if (m.staminaMaxMul !== undefined) out.staminaMaxMul *= m.staminaMaxMul;
    if (m.staminaDrainMul !== undefined) out.staminaDrainMul *= m.staminaDrainMul;
    if (m.xpMul !== undefined) out.xpMul *= m.xpMul;
    if (m.docPerSprint !== undefined) out.docPerSprint += m.docPerSprint;
  }
  return out;
}
