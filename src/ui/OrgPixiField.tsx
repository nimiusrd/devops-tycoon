/**
 * 全社マップの PixiJS 描画領域（`?renderer=pixi` 時のみ OrgScreen からマウント）。
 *
 * DOM の HUD / 部門チップ / レバー / 共通基盤ハブは親が描き、ここはチーム島だけ。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { DepartmentState, Team, ZoomState } from '../sim/orgscale/types';
import { PixiOrgRenderer } from '../render/adapters/pixiOrgRenderer';
import { ORG_ISO, ORG_PAD, ORG_SPRITE_BUDGET } from '../render/orgView';

/** 親から imperative にカメラ操作するためのハンドル。 */
export interface OrgPixiFieldHandle {
  focusCompany(): Promise<void>;
  focusDepartment(deptId: string): Promise<void>;
  focusTeam(teamId: string): Promise<void>;
}

export interface OrgPixiFieldProps {
  teams: readonly Team[];
  zoom: ZoomState;
  departments: readonly DepartmentState[];
  onFocusTeam: (id: string) => void;
  deptColor: (deptId: string) => string;
}

export const OrgPixiField = forwardRef<OrgPixiFieldHandle, OrgPixiFieldProps>(function OrgPixiField(
  { teams, zoom, onFocusTeam, deptColor },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiOrgRenderer | null>(null);
  const teamsRef = useRef(teams);
  const zoomRef = useRef(zoom);
  const prevZoomRef = useRef(zoom);
  const onFocusTeamRef = useRef(onFocusTeam);
  const deptColorRef = useRef(deptColor);
  const initDoneRef = useRef(false);

  useLayoutEffect(() => {
    onFocusTeamRef.current = onFocusTeam;
  }, [onFocusTeam]);

  useLayoutEffect(() => {
    deptColorRef.current = deptColor;
  }, [deptColor]);

  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useImperativeHandle(
    ref,
    () => ({
      focusCompany: () =>
        rendererRef.current?.focusCompany(teamsRef.current, true) ?? Promise.resolve(),
      focusDepartment: (deptId: string) =>
        rendererRef.current?.focusDepartment(teamsRef.current, deptId, true) ?? Promise.resolve(),
      focusTeam: (teamId: string) =>
        rendererRef.current?.focusTeamCamera(teamsRef.current, teamId, true) ?? Promise.resolve(),
    }),
    [],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiOrgRenderer({
      isoBase: ORG_ISO,
      pad: ORG_PAD,
      spriteBudget: ORG_SPRITE_BUDGET,
      cullMargin: ORG_ISO.tileW / 2,
      deptColor: (id) => deptColorRef.current(id),
      onFocusTeam: (id) => {
        const r = rendererRef.current;
        if (r?.isReady) {
          void r.focusTeamCamera(teamsRef.current, id, true).then(() => {
            onFocusTeamRef.current(id);
          });
        } else {
          onFocusTeamRef.current(id);
        }
      },
      onPlanMetrics: (plan) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.orgSprites = String(plan.sprites.length);
        el.dataset.orgCulled = String(plan.culled);
        el.dataset.orgOverBudget = String(plan.overBudget);
        el.dataset.orgTotal = String(plan.total);
      },
    });
    rendererRef.current = renderer;

    const field = mount.closest<HTMLElement>('.org-field');
    renderer.setScrollHost(field ?? null);

    const syncLayout = (): void => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r) return;
      const scrollHost = field ?? el;
      r.setFieldView({
        scrollX: scrollHost.scrollLeft,
        scrollY: scrollHost.scrollTop,
        width: scrollHost.clientWidth,
        height: scrollHost.clientHeight,
      });
      r.resize(el.clientWidth, el.clientHeight);
      r.renderTeams(teamsRef.current);
    };

    let cancelled = false;
    void renderer.init(mount).then(() => {
      if (cancelled) return;
      initDoneRef.current = true;
      renderer.fitToContent(teamsRef.current);
      syncLayout();
    });

    const ro = new ResizeObserver(() => syncLayout());
    ro.observe(mount);
    if (field) ro.observe(field);

    field?.addEventListener('scroll', syncLayout, { passive: true });

    return () => {
      cancelled = true;
      initDoneRef.current = false;
      field?.removeEventListener('scroll', syncLayout);
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.fitToContent(teams);
    const mount = mountRef.current;
    const field = mount?.closest<HTMLElement>('.org-field');
    const scrollHost = field ?? mount;
    if (scrollHost) {
      renderer.setFieldView({
        scrollX: scrollHost.scrollLeft,
        scrollY: scrollHost.scrollTop,
        width: scrollHost.clientWidth,
        height: scrollHost.clientHeight,
      });
    }
    if (mount) renderer.resize(mount.clientWidth, mount.clientHeight);
    renderer.renderTeams(teams);
  }, [teams]);

  /** パンくず等で全社階層へ戻ったとき viewport を全体 fit へ同期する。 */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady || !initDoneRef.current) return;

    const prev = prevZoomRef.current;
    prevZoomRef.current = zoom;

    if (zoom.level === 'company' && prev.level !== 'company') {
      void renderer.focusCompany(teamsRef.current, true);
    }
  }, [zoom]);

  return (
    <div
      ref={mountRef}
      className="org-pixi-mount"
      data-testid="org-pixi-mount"
      aria-label="全社マップ（WebGL）"
    />
  );
});
