/**
 * 全社マップ（全社俯瞰モード。SPEC 第4.8 / mockups/org-screen）。
 *
 * 部門ゾーン・チーム島（健全度で色分け）・共通基盤ハブ・全社HUD・全社レバーを表示する。
 * チーム島をタップすると現場へドリルダウンし、部門ヘッダから部署ビューへ寄る。
 * 状態は読むだけ（第22.2）。盤面は `orgBoardScene` + `OrgBoard` で等角描画する。
 */
import { useCallback, useMemo, useRef } from 'react';
import { COMPANY_LEVERS } from '../data/levers';
import { diagnosisView } from '../sim/diagnosis';
import type { OrgScaleState, ZoomState } from '../sim/orgscale/types';
import { getRendererKind } from '../render/adapters/selectRenderer';
import { formatLeverDefTags, formatLeverTooltip } from '../render/eventOutcomeView';
import { EffectTagList } from './EffectTagList';
import { OrgBoard } from './OrgBoard';
import { OrgInfraHubPill } from './OrgHub';
import { OrgPixiField, type OrgPixiFieldHandle } from './OrgPixiField';

export interface OrgScreenProps {
  org: OrgScaleState;
  budget: number;
  zoom: ZoomState;
  onFocusDept: (id: string) => void;
  onFocusTeam: (id: string) => void;
  onApplyLever: (leverId: string) => void;
}

export function OrgScreen({
  org,
  budget,
  zoom,
  onFocusDept,
  onFocusTeam,
  onApplyLever,
}: OrgScreenProps) {
  const teams = org.departments.flatMap((d) => d.teams);
  const usePixi = getRendererKind(window.location.search) === 'pixi';
  const pixiFieldRef = useRef<OrgPixiFieldHandle>(null);
  const deptColorMap = useMemo(
    () => Object.fromEntries(org.departments.map((d) => [d.def.id, d.def.color])),
    [org.departments],
  );
  const deptColor = useCallback((id: string) => deptColorMap[id] ?? '#6b4a9e', [deptColorMap]);

  const handleFocusDept = useCallback(
    (deptId: string) => {
      if (usePixi) {
        void pixiFieldRef.current?.focusDepartment(deptId).then(() => {
          onFocusDept(deptId);
        });
        return;
      }
      onFocusDept(deptId);
    },
    [onFocusDept, usePixi],
  );

  return (
    <div className="org-screen" data-testid="org-screen">
      <header className="org-head">
        <h2>🗺 全社マップ</h2>
        <span className="org-diagnosis" data-testid="org-diagnosis">
          {diagnosisView(org.diagnosis).label}
        </span>
        <span className="org-rank">健全度 {org.healthRank}</span>
      </header>

      <dl className="org-hud" data-testid="org-hud">
        <Stat label="全社出荷" value={org.shipping} />
        <Stat label="部門 / チーム" value={`${org.deptCount} / ${org.teamCount}`} />
        <Stat label="エンジニア" value={org.engineers} />
        <Stat
          label="AI依存度"
          value={`${org.aiDependency}`}
          tone={org.aiDependency >= 70 ? 'warn' : undefined}
        />
        <Stat label="技術的負債" value={org.techDebt} />
        <Stat label="全社士気" value={org.morale} />
        <Stat
          label="炎上中チーム"
          value={org.onFire}
          tone={org.onFire > 0 ? 'bad' : 'good'}
          testid="org-onfire"
        />
        <Stat label="四半期予算" value={budget} tone="budget" />
      </dl>

      <div className="org-depts" data-testid="org-depts">
        {org.departments.map((d) => (
          <button
            type="button"
            key={d.def.id}
            className="org-dept-chip"
            data-testid={`dept-chip-${d.def.id}`}
            style={{ borderColor: d.def.color }}
            onClick={() => handleFocusDept(d.def.id)}
            title="部署ビューへ寄る"
          >
            <span className="dot" style={{ background: d.def.color }} />
            <b>{d.def.name}</b>
            <span className="org-dept-meta">
              出荷 {d.shipping} ・ 炎上 {d.onFire} ・ 耐性 {d.reviewResilience}
            </span>
          </button>
        ))}
      </div>

      <div className="org-field" data-testid="org-field">
        {usePixi ? (
          <div className="org-field-board org-field-pixi">
            <OrgInfraHubPill
              ci={org.infra.ci}
              docs={org.infra.docs}
              aiGuideline={org.infra.aiGuideline}
            />
            <OrgPixiField
              ref={pixiFieldRef}
              teams={teams}
              zoom={zoom}
              departments={org.departments}
              onFocusTeam={onFocusTeam}
              deptColor={deptColor}
            />
          </div>
        ) : (
          <OrgBoard org={org} onFocusTeam={onFocusTeam} />
        )}
      </div>

      <div className="org-levers" data-testid="org-levers">
        <span className="org-levers-title">全社レバー</span>
        {COMPANY_LEVERS.map((l) => (
          <button
            type="button"
            key={l.id}
            className="org-lever"
            data-testid={`lever-${l.id}`}
            disabled={budget < l.cost}
            onClick={() => onApplyLever(l.id)}
            title={formatLeverTooltip(l)}
          >
            <span className="org-lever-head">
              <b>{l.name}</b>
              <span className="org-lever-cost">💰{l.cost}</span>
            </span>
            <EffectTagList tags={formatLeverDefTags(l)} testId={`lever-tags-${l.id}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: number | string;
  tone?: 'good' | 'warn' | 'bad' | 'budget';
  testid?: string;
}) {
  return (
    <div className={`org-stat${tone ? ` tone-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd data-testid={testid}>{value}</dd>
    </div>
  );
}
