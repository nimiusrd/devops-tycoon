/**
 * 全社マップの PixiJS 描画領域（`?renderer=pixi` 時のみ OrgScreen からマウント）。
 *
 * DOM の HUD / 部門チップ / レバー / 共通基盤ハブは親が描き、ここはチーム島だけ。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CIではPlaywrightで検証する）。
 */
import { beginWebglLoading } from '../render/webglStatus';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { DepartmentState, Team, ZoomState } from '../sim/orgscale/types';
import { PixiOrgRenderer } from '../render/adapters/pixiOrgRenderer';
import { ORG_ISO, ORG_PAD, ORG_SPRITE_BUDGET, orgLayoutFingerprint } from '../render/orgView';

/** Playwright Pixi 視覚回帰向け（dev のみ。ドリルダウンせずカメラだけ動かす）。 */
declare global {
  interface Window {
    __orgPixiTest?: {
      focusTeamCamera(teamId: string): Promise<void>;
      getZoomScale(): number | null;
      freezeForScreenshot(): void;
      isFocusRingActive(): boolean;
    };
  }
}

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
  /** WebGL 初期化失敗時に呼ぶ（再試行の案内を表示する）。 */
  onWebglError?: () => void;
}

export const OrgPixiField = forwardRef<OrgPixiFieldHandle, OrgPixiFieldProps>(function OrgPixiField(
  { teams, zoom, onFocusTeam, deptColor, onWebglError },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiOrgRenderer | null>(null);
  const teamsRef = useRef(teams);
  const zoomRef = useRef(zoom);
  const prevZoomRef = useRef(zoom);
  const onFocusTeamRef = useRef(onFocusTeam);
  const deptColorRef = useRef(deptColor);
  const onWebglErrorRef = useRef(onWebglError);
  const initDoneRef = useRef(false);
  /** init / fitToContent と同期した layout 指紋（teams 更新時の refit 判定）。 */
  const layoutFingerprintRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    onFocusTeamRef.current = onFocusTeam;
  }, [onFocusTeam]);

  useLayoutEffect(() => {
    deptColorRef.current = deptColor;
  }, [deptColor]);

  useLayoutEffect(() => {
    onWebglErrorRef.current = onWebglError;
  }, [onWebglError]);

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
          // RI-04: 島タップ → フォーカスリング（遷移先の炎上/渋滞トーン）→
          // カメラが寄る → 完了後に状態遷移（App が zoom-overlay を外して現場へ着地）。
          // engine.focusTeam は非アクティブを department 止まりにするため、
          // カメラも着地先と一致させる（isPlayer/isActive=詳細シミュレーション対象）。
          const team = teamsRef.current.find((t) => t.id === id);
          r.playFocusRing(teamsRef.current, id);
          const camera =
            team && !team.isActive
              ? r.focusDepartment(teamsRef.current, team.deptId, true)
              : r.focusTeamCamera(teamsRef.current, id, true);
          void camera.then(() => {
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
      onRenderMetrics: (metrics) => {
        const el = mountRef.current;
        if (!el) return;
        el.dataset.orgAvatarAssetsLoaded = String(metrics.avatarAssetsLoaded);
        el.dataset.orgAvatarAssetsRequired = String(metrics.avatarAssetsRequired);
      },
    });
    rendererRef.current = renderer;

    const scrollHost = mount.closest<HTMLElement>('.org-field');
    renderer.setScrollHost(scrollHost ?? null);

    const syncLayout = (): void => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r) return;
      const host = scrollHost ?? el;
      r.setFieldView({
        scrollX: host.scrollLeft,
        scrollY: host.scrollTop,
        // AspectStage の contain 後に実際に canvas が占める可視窓を使う。
        // 外側の .org-field はスロット全体なので、幅広/縦長 viewport では
        // canvas より大きくなり、カリング範囲を過大にしてしまう。
        width: el.clientWidth,
        height: el.clientHeight,
      });
      r.resize(el.clientWidth, el.clientHeight);
      r.renderTeams(teamsRef.current);
    };

    let cancelled = false;
    const finishLoading = beginWebglLoading();
    void renderer
      .init(mount)
      .then(() => {
        if (cancelled) return;
        initDoneRef.current = true;
        const fp = orgLayoutFingerprint(teamsRef.current, ORG_ISO, ORG_PAD);
        layoutFingerprintRef.current = fp;
        renderer.fitToContent(teamsRef.current);
        syncLayout();
        finishLoading();
        if (import.meta.env.DEV) {
          window.__orgPixiTest = {
            focusTeamCamera: (teamId) => renderer.focusTeamCamera(teamsRef.current, teamId, false),
            getZoomScale: () => renderer.getZoomScale(),
            freezeForScreenshot: () => renderer.freezeForScreenshot(),
            isFocusRingActive: () => renderer.focusRingActive,
          };
        }
      })
      .catch((err: unknown) => {
        // WebGL失敗は共有の案内へ通知し、自動進行を止める。
        console.warn('PixiOrgRenderer init failed; WebGL is unavailable', err);
        if (!cancelled) onWebglErrorRef.current?.();
        finishLoading();
      });

    const ro = new ResizeObserver(() => syncLayout());
    ro.observe(mount);
    if (scrollHost) ro.observe(scrollHost);

    scrollHost?.addEventListener('scroll', syncLayout, { passive: true });

    return () => {
      cancelled = true;
      finishLoading();
      initDoneRef.current = false;
      layoutFingerprintRef.current = null;
      delete window.__orgPixiTest;
      scrollHost?.removeEventListener('scroll', syncLayout);
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
    // mount/unmount のみ。onFocusTeam / deptColor は ref 経由（deps に入れると WebGL 再生成）。
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady) return;

    const fp = orgLayoutFingerprint(teams, ORG_ISO, ORG_PAD);
    if (layoutFingerprintRef.current !== fp) {
      layoutFingerprintRef.current = fp;
      renderer.invalidateFitCache();
      renderer.fitToContent(teams);
    }

    const mount = mountRef.current;
    const scrollHost = mount?.closest<HTMLElement>('.org-field') ?? mount;
    if (scrollHost) {
      renderer.setFieldView({
        scrollX: scrollHost.scrollLeft,
        scrollY: scrollHost.scrollTop,
        width: mount?.clientWidth ?? 0,
        height: mount?.clientHeight ?? 0,
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
