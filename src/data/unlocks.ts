/**
 * メタ進行で永続解放するコンテンツ定義（SPEC 第17章）。
 *
 * ドラフト／ショップのプールにのみ影響する購入対象。イベント等で直接付与される
 * ID はここに含めない（plan spec-mapping.md §2 M7）。
 * メンバー／トレイト／開始キット（初期カード等）のメタ解放は RI-24 でスコープ外。
 */
import { CARD_DEFS } from './cards';
import { EVENT_DEFS } from './events';
import { RELIC_DEFS } from './relics';

export type UnlockKind = 'card' | 'relic';

export interface UnlockDef {
  /** 解放エントリ ID（購入 API に渡す）。 */
  id: string;
  kind: UnlockKind;
  /** 解放されるカード／レリックの定義 ID。 */
  contentId: string;
  cost: number;
  /** 前提実績 ID（任意）。 */
  requires?: string;
  label: string;
  description: string;
}

/** メタショップで購入可能な解放一覧。 */
export const UNLOCK_DEFS: UnlockDef[] = [
  {
    id: 'unlock-claude-code',
    kind: 'card',
    contentId: 'claude-code',
    cost: 25,
    label: 'Claude Code 研修',
    description: 'Claude Code を組織標準ツールとして解禁する。',
  },
  {
    id: 'unlock-devin',
    kind: 'card',
    contentId: 'devin',
    cost: 50,
    requires: 'review-exceeded',
    label: 'Devin パイロット',
    description: '自律エージェント Devin の導入枠を確保する。',
  },
  {
    id: 'unlock-hire-senior',
    kind: 'card',
    contentId: 'hire-senior',
    cost: 40,
    requires: 'review-survivor',
    label: 'シニア採用枠',
    description: '次ランからシニア採用カードがドラフト／ショップに登場する。',
  },
  {
    id: 'unlock-review-bot',
    kind: 'card',
    contentId: 'review-bot',
    cost: 30,
    label: 'レビュー Bot 導入',
    description: 'レビュー Bot 導入カードを恒久解禁する。',
  },
  {
    id: 'unlock-psych-safety',
    kind: 'relic',
    contentId: 'psych-safety',
    cost: 35,
    label: '心理的安全性プログラム',
    description: 'レリック「心理的安全性」をショッププールへ追加する。',
  },
  {
    id: 'unlock-doc-driven',
    kind: 'relic',
    contentId: 'doc-driven',
    cost: 30,
    label: 'ドキュメント駆動研修',
    description: 'レリック「ドキュメント駆動」をショッププールへ追加する。',
  },
  {
    id: 'unlock-strong-ci',
    kind: 'relic',
    contentId: 'strong-ci',
    cost: 35,
    label: 'CI 強化プロジェクト',
    description: 'レリック「強い CI」をショッププールへ追加する。',
  },
  {
    id: 'unlock-flow-first',
    kind: 'relic',
    contentId: 'flow-first',
    cost: 30,
    label: 'フロー重視ワークショップ',
    description: 'レリック「フロー重視」をショッププールへ追加する。',
  },
  {
    id: 'unlock-no-friday-deploy',
    kind: 'relic',
    contentId: 'no-friday-deploy',
    cost: 25,
    label: '金曜デプロイ禁止ルール',
    description: 'レリック「金曜デプロイ禁止」をショッププールへ追加する。',
  },
  {
    id: 'unlock-budget-discipline',
    kind: 'relic',
    contentId: 'budget-discipline',
    cost: 30,
    label: 'コスト意識トレーニング',
    description: 'レリック「コスト意識」をショッププールへ追加する。',
  },
];

const UNLOCK_BY_ID = new Map(UNLOCK_DEFS.map((u) => [u.id, u]));

const CARD_UNLOCK_BY_CONTENT_ID = new Map(
  UNLOCK_DEFS.filter((u) => u.kind === 'card').map((u) => [u.contentId, u]),
);

const META_LOCKED_CARD_IDS = new Set(CARD_UNLOCK_BY_CONTENT_ID.keys());
const META_LOCKED_RELIC_IDS = new Set(
  UNLOCK_DEFS.filter((u) => u.kind === 'relic').map((u) => u.contentId),
);

/** 最初からドラフト／ショップに出るカード ID。 */
export function defaultUnlockedCardIds(): ReadonlySet<string> {
  return new Set(CARD_DEFS.filter((c) => !META_LOCKED_CARD_IDS.has(c.id)).map((c) => c.id));
}

/** 最初からショップに出うるレリック ID。 */
export function defaultUnlockedRelicIds(): ReadonlySet<string> {
  return new Set(RELIC_DEFS.filter((r) => !META_LOCKED_RELIC_IDS.has(r.id)).map((r) => r.id));
}

/** 解放定義を ID で取得する。 */
export function getUnlock(id: string): UnlockDef | undefined {
  return UNLOCK_BY_ID.get(id);
}

/** カード contentId からメタ解放定義を取得する（既定解放カードは undefined）。 */
export function getCardUnlockByContentId(contentId: string): UnlockDef | undefined {
  return CARD_UNLOCK_BY_CONTENT_ID.get(contentId);
}

/** イベント等で直接付与されるカード／レリック ID（常時解放扱い）。 */
export function eventDirectGrantIds(): { cards: string[]; relics: string[] } {
  const cards = new Set<string>();
  const relics = new Set<string>();
  for (const ev of EVENT_DEFS) {
    for (const choice of ev.choices) {
      if (choice.outcome.grantCard) cards.add(choice.outcome.grantCard);
      if (choice.outcome.grantRelic) relics.add(choice.outcome.grantRelic);
    }
  }
  return { cards: [...cards], relics: [...relics] };
}

/** メタ解放対象がイベント直接付与 ID と重複していないか（テスト用）。 */
export function metaUnlockContentIds(): { cards: string[]; relics: string[] } {
  return {
    cards: [...META_LOCKED_CARD_IDS],
    relics: [...META_LOCKED_RELIC_IDS],
  };
}
