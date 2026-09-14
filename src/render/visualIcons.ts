/**
 * HTML 判断アイコンの意味キーと SVG 実体の契約（#474）。
 *
 * サイズは `VISUAL_TOKENS.dimensions.icon`、色は既存 `--visual-color-*` を塗る。
 * 絵文字文字はキーにしない。Pixi 盤面の絵文字は対象外。
 */
import { publicUrl } from '../utils/publicUrl';

export const ICON_KEYS = [
  'fire',
  'focus',
  'pace',
  'stability',
  'delivery',
  'quality',
  'security',
  'seniorHp',
  'aiDependency',
  'techDebt',
  'morale',
  'department',
  'sprintNormal',
  'contain',
  'autoContain',
  'comboBreak',
  'tip',
  'ceremonyPromote',
  'ceremonyLeave',
  'ceremonyLevelUp',
  'victory',
  'defeat',
  'warning',
  'reorg',
  'shutdown',
  'interruptReview',
  'splitPr',
  'firefight',
  'assignTask',
  'aiThrottle',
  'pairReview',
  'overtime',
  'andon',
  'healthyAcceleration',
  'reviewHell',
  'aiOverproduction',
  'reworkSpiral',
  'seniorSacrifice',
  'documentationKingdom',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

/** 既存 VISUAL_TOKENS.colors の意味色。新しい色は増やさない。 */
export type IconTone =
  | 'fire'
  | 'sun'
  | 'mint'
  | 'sky'
  | 'lav'
  | 'coral'
  | 'cream'
  | 'text'
  | 'text-dim';

export interface IconCatalogEntry {
  readonly file: string;
  readonly tone: IconTone;
}

export const ICON_CATALOG: Record<IconKey, IconCatalogEntry> = {
  fire: { file: 'fire.svg', tone: 'fire' },
  focus: { file: 'focus.svg', tone: 'sun' },
  pace: { file: 'pace.svg', tone: 'sky' },
  stability: { file: 'stability.svg', tone: 'mint' },
  delivery: { file: 'delivery.svg', tone: 'sky' },
  quality: { file: 'quality.svg', tone: 'mint' },
  security: { file: 'security.svg', tone: 'lav' },
  seniorHp: { file: 'strength.svg', tone: 'coral' },
  aiDependency: { file: 'ai.svg', tone: 'lav' },
  techDebt: { file: 'bricks.svg', tone: 'text-dim' },
  morale: { file: 'sparkle.svg', tone: 'sun' },
  department: { file: 'department.svg', tone: 'lav' },
  sprintNormal: { file: 'monitor.svg', tone: 'sky' },
  contain: { file: 'contain.svg', tone: 'mint' },
  autoContain: { file: 'extinguisher.svg', tone: 'sky' },
  comboBreak: { file: 'combo-break.svg', tone: 'coral' },
  tip: { file: 'tip.svg', tone: 'sun' },
  ceremonyPromote: { file: 'promote.svg', tone: 'sun' },
  ceremonyLeave: { file: 'leave.svg', tone: 'text-dim' },
  ceremonyLevelUp: { file: 'strength.svg', tone: 'mint' },
  victory: { file: 'victory.svg', tone: 'sun' },
  defeat: { file: 'defeat.svg', tone: 'coral' },
  warning: { file: 'warning.svg', tone: 'sun' },
  reorg: { file: 'reorg.svg', tone: 'lav' },
  shutdown: { file: 'shutdown.svg', tone: 'coral' },
  interruptReview: { file: 'interrupt-review.svg', tone: 'sky' },
  splitPr: { file: 'split-pr.svg', tone: 'lav' },
  firefight: { file: 'fire.svg', tone: 'fire' },
  assignTask: { file: 'assign-task.svg', tone: 'mint' },
  aiThrottle: { file: 'ai-throttle.svg', tone: 'lav' },
  pairReview: { file: 'pair-review.svg', tone: 'sky' },
  overtime: { file: 'overtime.svg', tone: 'coral' },
  andon: { file: 'andon.svg', tone: 'sun' },
  healthyAcceleration: { file: 'healthy.svg', tone: 'mint' },
  reviewHell: { file: 'siren.svg', tone: 'coral' },
  aiOverproduction: { file: 'ai.svg', tone: 'lav' },
  reworkSpiral: { file: 'spiral.svg', tone: 'coral' },
  seniorSacrifice: { file: 'battery.svg', tone: 'coral' },
  documentationKingdom: { file: 'books.svg', tone: 'sky' },
};

const ICON_KEY_SET: ReadonlySet<string> = new Set(ICON_KEYS);

export function isIconKey(value: string): value is IconKey {
  return ICON_KEY_SET.has(value);
}

/** 未知キーは集中力へ寄せ、絵文字フォールバックを出さない。 */
export function resolveIconKey(value: string | undefined, fallback: IconKey = 'focus'): IconKey {
  return value && isIconKey(value) ? value : fallback;
}

export function getIconUrl(key: IconKey): string {
  return publicUrl(`assets/icons/${ICON_CATALOG[key].file}`);
}
