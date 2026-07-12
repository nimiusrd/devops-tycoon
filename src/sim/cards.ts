/**
 * デッキ＝カード効果の集約とドラフト抽選・手札配布（SPEC 第7章 / RI-30）。
 *
 * カード定義（`src/data/cards`）を読み、強化レベルでスケールし、
 * 効果を畳み込む純TS。スプリント中は手札から発動した分だけ係数に入る。
 * 乱数はドラフト抽選・手札シャッフルにのみ使い、引数の seed付きPRNG から
 * 消費する（決定論。第22.3）。
 */
import { CARD_DEFS, RARITY_WEIGHT, getCard } from '../data/cards';
import { IDENTITY_CARD_EFFECTS } from './model';
import type { Rng } from './rng';
import type {
  CardEffects,
  CardInstance,
  CardPlayOutcome,
  OrgState,
  SprintCardPiles,
  SprintState,
} from './types';

/** スプリント開始時に配る手札枚数（SPEC 第7.1）。 */
export const HAND_SIZE = 3;

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

/** 効果を範囲クランプする。 */
export function clampCardEffects(effects: CardEffects): CardEffects {
  const out: CardEffects = { ...effects };
  for (const key of EFFECT_KEYS) {
    out[key] = clampEffect(key, out[key]);
  }
  return out;
}

/**
 * カード群を 1 つの `CardEffects` に畳み込む（範囲クランプ込み）。
 * 手札発動・what-if 試算・レガシー検証で使う。全デッキ常時 ON はしない（RI-30）。
 */
export function deckEffects(deck: CardInstance[]): CardEffects {
  let acc: CardEffects = { ...IDENTITY_CARD_EFFECTS };
  for (const inst of deck) {
    const def = getCard(inst.defId);
    if (!def) continue;
    acc = combineEffects(acc, scaleEffects(def.base, inst.level));
  }
  return clampCardEffects(acc);
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

/**
 * 手札発動の集中力コスト（ショップ用 `cost` からスケール。RI-30）。
 * 強化レベルごとに -1（下限 1）。
 */
export function playCost(defCost: number, level: number): number {
  const base = Math.max(1, Math.round(defCost / 4));
  return Math.max(1, base - (level - 1));
}

/** Fisher–Yates でインデックス配列をシャッフル（決定論）。 */
export function shuffleIndices(indices: number[], rng: Rng): number[] {
  const out = [...indices];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** 空の手札山。 */
export function emptyCardPiles(): SprintCardPiles {
  return { drawOrder: [], hand: [], discard: [], played: [] };
}

/**
 * デッキから手札を配る。`drawOrder` をシャッフルし、先頭から `HAND_SIZE` 枚を hand へ。
 */
export function dealHand(deckSize: number, rng: Rng, handSize = HAND_SIZE): SprintCardPiles {
  const drawOrder = shuffleIndices(
    Array.from({ length: deckSize }, (_, i) => i),
    rng,
  );
  const hand: number[] = [];
  while (hand.length < handSize && drawOrder.length > 0) {
    hand.push(drawOrder.shift()!);
  }
  return { drawOrder, hand, discard: [], played: [] };
}

/**
 * 手札 1 枚を発動する。成功時は `sprint.cardEffects` に合成し、加算系を org へ反映する。
 * `passiveEffects` はレリック等の常時パッシブ（発動前の基準効果）。
 */
export function playCardFromHand(
  sprint: SprintState,
  org: OrgState,
  deck: CardInstance[],
  handIndex: number,
  passiveEffects: CardEffects = IDENTITY_CARD_EFFECTS,
): CardPlayOutcome {
  if (sprint.complete) return { ok: false, reason: 'complete' };
  const deckIndex = sprint.cardPiles.hand[handIndex];
  if (deckIndex === undefined) return { ok: false, reason: 'no-card' };
  const inst = deck[deckIndex];
  if (!inst) return { ok: false, reason: 'invalid' };
  const def = getCard(inst.defId);
  if (!def) return { ok: false, reason: 'invalid' };

  const cost = playCost(def.cost, inst.level);
  if (sprint.focus < cost) return { ok: false, reason: 'no-focus' };

  sprint.focus -= cost;
  sprint.metrics.focusSpent += cost;
  sprint.cardPiles.hand.splice(handIndex, 1);
  sprint.cardPiles.played.push(deckIndex);

  const cardFx = scaleEffects(def.base, inst.level);
  // 加算系はラン中 1 回だけ（旧・獲得時適用と同等）。乗算系は毎スプリントの発動で効く。
  if (!inst.baselineApplied) {
    applyDeckBaseline(org, cardFx);
    inst.baselineApplied = true;
  }

  let acc = { ...passiveEffects };
  for (const idx of sprint.cardPiles.played) {
    const played = deck[idx];
    if (!played) continue;
    const playedDef = getCard(played.defId);
    if (!playedDef) continue;
    acc = combineEffects(acc, scaleEffects(playedDef.base, played.level));
  }
  sprint.cardEffects = clampCardEffects(acc);

  return { ok: true, focusCost: cost, deckIndex };
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

/** デッキ内の指定位置のカードを 1 段強化したデッキを返す。 */
export function upgradeCardAt(deck: CardInstance[], index: number): CardInstance[] {
  if (index < 0 || index >= deck.length) return deck;
  return deck.map((inst, i) => (i === index ? { ...inst, level: inst.level + 1 } : inst));
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
