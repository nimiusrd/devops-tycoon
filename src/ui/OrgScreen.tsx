/**
 * 全社マップ（全社俯瞰モード。SPEC 第4.8）。
 *
 * 部門ゾーン・チーム島（健全度で色分け）・共通基盤ハブ・全社HUD・全社レバーを表示する。
 * チーム島をタップすると現場へドリルダウンし、部門ヘッダから部署ビューへ寄る。
 * 状態は読むだけ（第22.2）。盤面は `orgBoardScene` + `OrgBoard` で等角描画する。
 */
import { lazy, Suspense, useCallback, useMemo, useRef } from 'react';
import { COMPANY_LEVERS } from '../data/levers';
import { diagnosisTheme } from '../render/diagnosisTheme';
import { diagnosisView } from '../sim/diagnosis';
import { ORG_VIEW } from '../render/orgBoardScene';
import type { OrgScaleState, ZoomState } from '../sim/orgscale/types';
import { formatLeverDefTags, formatLeverTooltip } from '../render/eventOutcomeView';
import { AspectStage } from './AspectStage';
import { EffectTagList } from './EffectTagList';
import { OrgBoard } from './OrgBoard';
import { OrgInfraHubPill } from './OrgHub';
import type { OrgPixiFieldHandle } from './OrgPixiField';
import { usePixiRenderer } from './usePixiRenderer';
import { Stat } from './Stat';

/** Pixi 全社マップは動的 import（RI-12）。usePixi 時のみチャンクを取得する。 */
const OrgPixiField = lazy(() =>
  import('./OrgPixiField').then((m) => ({ default: m.OrgPixiField })),
);

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
  const { usePixi, onWebglError } = usePixiRenderer();
  const pixiFieldRef = useRef<OrgPixiFieldHandle>(null);
  const deptColorMap = useMemo(
    () => Object.fromEntries(org.departments.map((d) => [d.def.id, d.def.color])),
    [org.departments],
  );
  const deptColor = useCallback((id: string) => deptColorMap[id] ?? '#6b4a9e', [deptColorMap]);
  const diagnosis = diagnosisView(org.diagnosis);
  const theme = diagnosisTheme(org.diagnosis);

  const handleFocusDept = useCallback(
    (deptId: string) => {
      // Pixi チャンク未ロード時は ref が null。カメラ演出を待たず遷移する。
      const field = pixiFieldRef.current;
      if (usePixi && field) {
        void field.focusDepartment(deptId).then(() => {
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
        <span
          className={`org-diagnosis diag-${org.diagnosis}`}
          data-testid="org-diagnosis"
          data-diagnosis={org.diagnosis}
          title={diagnosis.description}
        >
          <span aria-hidden="true">{theme.icon}</span> {diagnosis.label}
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

      <AspectStage ratio={ORG_VIEW.w / ORG_VIEW.h} className="org-field" data-testid="org-field">
        {usePixi ? (
          <>
            <OrgInfraHubPill
              ci={org.infra.ci}
              docs={org.infra.docs}
              aiGuideline={org.infra.aiGuideline}
            />
            <Suspense fallback={null}>
              <OrgPixiField
                ref={pixiFieldRef}
                teams={teams}
                zoom={zoom}
                departments={org.departments}
                onFocusTeam={onFocusTeam}
                deptColor={deptColor}
                onWebglError={onWebglError}
              />
            </Suspense>
          </>
        ) : (
          <OrgBoard org={org} onFocusTeam={onFocusTeam} />
        )}
      </AspectStage>

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
