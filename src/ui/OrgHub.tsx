/**
 * 全社マップの共通基盤ハブ（サーバーラック + AI ボット）。
 * レイアウトは旧モック org-screen（git 履歴の mockups/）由来。
 */
import type { OrgHubPlan } from '../render/orgBoardScene';

/** 盤面の外に置く共通基盤ハブ。Canvasと同じ値と tone を残す（DS-05 / DS-06）。 */
export function OrgInfraHubPill({
  ci,
  docs,
  aiGuideline,
  tone,
}: {
  ci: number;
  docs: number;
  aiGuideline: number;
  tone: OrgHubPlan['tone'];
}) {
  const warn = tone === 'warn';
  return (
    <div
      className={`org-infra-hub tone-${tone}`}
      data-testid="org-infra-hub"
      data-tone={tone}
      title={warn ? '共通基盤ハブ（CI が低下しています）' : '共通基盤ハブ（全チームへ波及）'}
    >
      <span aria-hidden>🛰</span>
      <span className="org-infra-title">共通基盤</span>
      {warn ? <span className="org-infra-warn">注意</span> : null}
      <span className="org-infra-meta">
        CI {ci} / Docs {docs} / AI {aiGuideline}
      </span>
    </div>
  );
}
