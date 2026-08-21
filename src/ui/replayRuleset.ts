import type { ReplayRulesetIdentity } from '../state/replay';

/** リプレイ一覧・閲覧バナーで共通表示するルールセット表記。 */
export function formatReplayRuleset(ruleset: ReplayRulesetIdentity | null): string {
  return ruleset ? 'v' + ruleset.version + ' / ' + ruleset.fingerprint : 'ルールセット不明';
}
