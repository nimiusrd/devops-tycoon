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
 * カードの加算系 baseline 適用済みレベルを返す。
 * チーム別マップがあればそれを優先し、無ければレガシー単一フィールドへフォールバックする。
 */
export function baselineAppliedLevelFor(inst: CardInstance, teamId?: string): number {
  if (teamId && inst.baselineAppliedByTeam) {
    return inst.baselineAppliedByTeam[teamId] ?? 0;
  }
  return inst.baselineAppliedLevel ?? 0;
}

/**
 * レガシー `baselineAppliedLevel` を全チームの `baselineAppliedByTeam` へ写経する。
 * v1 セーブ（マップ無し）復元後に別チームで全量再適用しないための移行。
 *
 * 既に部分マップがある場合は触らない。v2 で特定チームにだけ発動したカードを
 * 未訪問チームまで適用済み扱いにすると、恒久加算が二度と反映されなくなる。
 */
export function migrateBaselineAppliedByTeam(
  deck: CardInstance[],
  teamIds: readonly string[],
): CardInstance[] {
  if (teamIds.length === 0) return deck;
  return deck.map((inst) => {
    const legacy = inst.baselineAppliedLevel ?? 0;
    if (legacy <= 0) return inst;
    // 部分マップ（チーム別適用の正本）がある場合は欠損をレガシーで埋めない。
    if (inst.baselineAppliedByTeam) return inst;
    const baselineAppliedByTeam: Record<string, number> = {};
    for (const id of teamIds) baselineAppliedByTeam[id] = legacy;
    return { ...inst, baselineAppliedByTeam };
  });
}

/**
 * テンプレート（ホーム等）から派生した新チームへ、継承済みカード基準レベルを記録する。
 * 指標はテンプレート由来で既に加算済みのため、未記録のままだと二重適用になる。
 */
export function inheritBaselineAppliedForTeams(
  deck: CardInstance[],
  sourceTeamId: string,
  newTeamIds: readonly string[],
): CardInstance[] {
  if (newTeamIds.length === 0) return deck;
  return deck.map((inst) => {
    const inherited = baselineAppliedLevelFor(inst, sourceTeamId);
    if (inherited <= 0) return inst;
    const baselineAppliedByTeam = { ...(inst.baselineAppliedByTeam ?? {}) };
    for (const id of newTeamIds) {
      baselineAppliedByTeam[id] = Math.max(baselineAppliedByTeam[id] ?? 0, inherited);
    }
    return { ...inst, baselineAppliedByTeam };
  });
}

/**
 * 手札からデッキ位置 `deckIndex` のカードを発動する。
 * 成功時は `sprint.cardEffects` に合成し、加算系を org へ反映する。
 * `passiveEffects` はレリック等の常時パッシブ（発動前の基準効果）。
 * `teamId` 指定時はチーム別に適用レベルを追跡する（RI-64）。
 */
export function playCardFromHand(
  sprint: SprintState,
  org: OrgState,
  deck: CardInstance[],
  deckIndex: number,
  passiveEffects: CardEffects = IDENTITY_CARD_EFFECTS,
  teamId?: string,
): CardPlayOutcome {
  if (sprint.complete) return { ok: false, reason: 'complete' };
  // RI-75: minCompleteTick 待ち（盤面枯渇後のパディング）ではカード発動しない。
  if (!sprint.tasks.some((t) => t.lane !== 'done')) return { ok: false, reason: 'complete' };
  const handIndex = sprint.cardPiles.hand.indexOf(deckIndex);
  if (handIndex < 0) return { ok: false, reason: 'no-card' };
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

  const appliedLevel = baselineAppliedLevelFor(inst, teamId);
  if (appliedLevel < inst.level) {
    const next = scaleEffects(def.base, inst.level);
    const prev =
      appliedLevel > 0 ? scaleEffects(def.base, appliedLevel) : { ...IDENTITY_CARD_EFFECTS };
    // 加算系だけ差分適用（乗算系は sprint.cardEffects 側）。
    applyDeckBaseline(org, {
      ...IDENTITY_CARD_EFFECTS,
      aiLiteracyAdd: next.aiLiteracyAdd - prev.aiLiteracyAdd,
      aiDependencyAdd: next.aiDependencyAdd - prev.aiDependencyAdd,
      qualityAdd: next.qualityAdd - prev.qualityAdd,
      testCoverageAdd: next.testCoverageAdd - prev.testCoverageAdd,
    });
    if (teamId) {
      inst.baselineAppliedByTeam = {
        ...(inst.baselineAppliedByTeam ?? {}),
        [teamId]: inst.level,
      };
    }
    inst.baselineAppliedLevel = inst.level;
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
 * 研修方針の優先施策にかかるレアリティ重み倍率（RI-34⁗）。
 * 無料でデッキに入らず、ドラフト／ショップで出やすくするだけ。
 */
export const PREFERRED_DRAFT_WEIGHT_MUL = 3;

/**
 * ドラフト候補をレアリティ重み付きで `count` 枚、重複なく抽選する（第7.1）。
 * 乱数は引数の PRNG から消費するため、同一 seed・同一スプリント番号で再現する。
 * `preferred` に含まれる ID は重みを {@link PREFERRED_DRAFT_WEIGHT_MUL} 倍する（RI-34⁗）。
 */
export function drawDraft(
  rng: Rng,
  count = 3,
  allowed?: ReadonlySet<string>,
  preferred?: ReadonlySet<string>,
): string[] {
  const defs = allowed ? CARD_DEFS.filter((c) => allowed.has(c.id)) : CARD_DEFS;
  const pool = defs.map((c) => ({
    id: c.id,
    weight: RARITY_WEIGHT[c.rarity] * (preferred?.has(c.id) ? PREFERRED_DRAFT_WEIGHT_MUL : 1),
  }));
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
