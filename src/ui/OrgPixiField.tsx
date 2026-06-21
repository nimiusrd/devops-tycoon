/**
 * 全社マップの PixiJS 描画領域（`?renderer=pixi` 時のみ OrgScreen からマウント）。
 *
 * DOM の HUD / 部門チップ / レバー / 共通基盤ハブは親が描き、ここはチーム島だけ。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Team } from '../sim/orgscale/types';
import { PixiOrgRenderer } from '../render/adapters/pixiOrgRenderer';
import { ORG_ISO, ORG_PAD, ORG_SPRITE_BUDGET } from '../render/orgView';

export interface OrgPixiFieldProps {
  teams: readonly Team[];
  onFocusTeam: (id: string) => void;
  deptColor: (deptId: string) => string;
}

export function OrgPixiField({ teams, onFocusTeam, deptColor }: OrgPixiFieldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiOrgRenderer | null>(null);
  const teamsRef = useRef(teams);
  const onFocusTeamRef = useRef(onFocusTeam);
  const deptColorRef = useRef(deptColor);

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
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new PixiOrgRenderer({
      isoBase: ORG_ISO,
      pad: ORG_PAD,
      spriteBudget: ORG_SPRITE_BUDGET,
      cullMargin: ORG_ISO.tileW / 2,
      deptColor: (id) => deptColorRef.current(id),
      onFocusTeam: (id) => onFocusTeamRef.current(id),
    });
    rendererRef.current = renderer;

    const field = mount.closest<HTMLElement>('.org-field');

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
      renderer.fitToContent(teamsRef.current);
      syncLayout();
    });

    const ro = new ResizeObserver(() => syncLayout());
    ro.observe(mount);
    if (field) ro.observe(field);

    field?.addEventListener('scroll', syncLayout, { passive: true });

    return () => {
      cancelled = true;
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

  return (
    <div
      ref={mountRef}
      className="org-pixi-mount"
      data-testid="org-pixi-mount"
      aria-label="全社マップ（WebGL）"
    />
  );
}
