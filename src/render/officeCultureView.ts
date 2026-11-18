import type { RelicDef } from '../data/relics';
import { formatRelicTooltip } from './eventOutcomeView';

export interface OfficeCultureView {
  readonly id: 'small-pr';
  readonly name: string;
  readonly description: string;
}

/**
 * 初回の掲示枠は small-pr 専用。他文化の所持順や数で入れ替えず、重ねない。
 * 所持は表示中の RunState、説明はその時点の resolver だけを正本にする。
 * 記録定義のない旧リプレイは、現行定義を読まず欠損を明示する。
 */
export function officeCultureView(
  relics: readonly string[],
  resolveRelic: (id: string) => RelicDef | undefined,
  legacyReplay = false,
): OfficeCultureView | null {
  if (!relics.includes('small-pr')) return null;
  const relic = legacyReplay ? undefined : resolveRelic('small-pr');
  return {
    id: 'small-pr',
    name: relic?.name ?? '不明なレリック（small-pr）',
    description: relic ? formatRelicTooltip(relic) : '記録時のレリック定義が見つかりません。',
  };
}
