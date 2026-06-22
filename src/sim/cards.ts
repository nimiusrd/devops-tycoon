/**
 * デッキ＝カード効果の集約とドラフト抽選（SPEC 第7章）。
 *
 * カード定義（`src/data/cards`）を読み、強化レベルでスケールし、
 * デッキ全体を 1 つの `CardEffects` に畳み込む純TS。乱数はドラフト抽選にのみ使い、
 * 引数の seed付きPRNG から消費する（決定論。第22.3）。
 */
import { CARD_DEFS, RARITY_WEIGHT, getCard } from '../data/cards';
import { IDENTITY_CARD_EFFECTS } from './model';
import type { Rng } from './rng';
import type { CardEffects, CardInstance, OrgState } from './types';

const EFFECT_KEYS = Object.keys(IDENTITY_CARD_EFFECTS) as (keyof CardEffects)[];

/** 乗算フィールド（無効果 = 1）かどうか。残りは加算フィールド（無効果 = 0）。 */
function isMul(key: keyof CardEffects): boolean {
  return IDENTITY_CARD_EFFECTS[key] === 1;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 効果フィールドを健全な範囲へ収める（暴走・逆転防止）。 */
function clampEffect(key: keyof CardEffects, value: number): number {
  if (isMul(key)) return clamp(value, 0.3, 3);
  if (key === 'reworkRateAdd') return clamp(value, -0.5, 0.5);
  return clamp(value, -50, 50);
}

/**
 * カード定義の `base` を強化レベルでスケールした `CardEffects` を返す。
 * 乗算フィールドは 1 からの乖離を、加算フィールドは大きさをレベルで増やす。
 */
export function scaleEffects(base: Partial<CardEffects>, level: number): CardEffects {
  const k = 1 + 0.5 * Math.max(0, level - 1);
  const out: CardEffects = { ...IDENTITY_CARD_EFFECTS };
  for (const key of EFFECT_KEYS) {
    const b = base[key];
    if (b === undefined) continue;
    out[key] = isMul(key) ? 1 + (b - 1) * k : b * k;
  }
  return out;
}

/** 2 つの効果を合成する（乗算は掛け算、加算は足し算）。 */
export function combineEffects(a: CardEffects, b: CardEffects): CardEffects {
  const out: CardEffects = { ...IDENTITY_CARD_EFFECTS };
  for (const key of EFFECT_KEYS) {
    out[key] = isMul(key) ? a[key] * b[key] : a[key] + b[key];
  }
  return out;
}

/** デッキ全体を 1 つの `CardEffects` に畳み込む（範囲クランプ込み）。 */
export function deckEffects(deck: CardInstance[]): CardEffects {
  let acc: CardEffects = { ...IDENTITY_CARD_EFFECTS };
  for (const inst of deck) {
    const def = getCard(inst.defId);
    if (!def) continue;
    acc = combineEffects(acc, scaleEffects(def.base, inst.level));
  }
  for (const key of EFFECT_KEYS) {
    acc[key] = clampEffect(key, acc[key]);
  }
  return acc;
}

/**
 * デッキ効果のうち「スプリント開始時に組織値へ足し込む」分を org に反映する。
 * 乗算系（速度・レビュー・障害率）は確率モデル側で都度掛けるためここでは触れない。
 */
export function applyDeckBaseline(org: OrgState, effects: CardEffects): void {
  org.aiLiteracy = clamp(org.aiLiteracy + effects.aiLiteracyAdd, 0, 100);
  org.aiDependency = clamp(org.aiDependency + effects.aiDependencyAdd, 0, 100);
  org.quality = clamp(org.quality + effects.qualityAdd, 0, 100);
  org.testCoverage = clamp(org.testCoverage + effects.testCoverageAdd, 0, 100);
}

/** カードを 1 段強化したデッキを返す（コスト減・効果増の枠組み。第7.1）。 */
export function upgradeCard(deck: CardInstance[], defId: string): CardInstance[] {
  let upgraded = false;
  return deck.map((inst) => {
    if (!upgraded && inst.defId === defId) {
      upgraded = true;
      return { ...inst, level: inst.level + 1 };
    }
    return inst;
  });
}

/**
 * ドラフト候補をレアリティ重み付きで `count` 枚、重複なく抽選する（第7.1）。
 * 乱数は引数の PRNG から消費するため、同一 seed・同一スプリント番号で再現する。
 */
export function drawDraft(rng: Rng, count = 3, allowed?: ReadonlySet<string>): string[] {
  const defs = allowed ? CARD_DEFS.filter((c) => allowed.has(c.id)) : CARD_DEFS;
  const pool = defs.map((c) => ({ id: c.id, weight: RARITY_WEIGHT[c.rarity] }));
  const picked: string[] = [];
  for (let n = 0; n < count && pool.length > 0; n += 1) {
    const total = pool.reduce((s, c) => s + c.weight, 0);
    let r = rng() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i += 1) {
      r -= pool[i].weight;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picked;
}
