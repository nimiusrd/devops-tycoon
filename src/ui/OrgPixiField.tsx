/**
 * 全社マップの PixiJS 描画領域（`?renderer=pixi` 時のみ OrgScreen からマウント）。
 *
 * DOM の HUD / 部門チップ / レバー / 共通基盤ハブは親が描き、ここはチーム島だけ。
 * 実 WebGL は init() 以降ブラウザ上でのみ動く（CI/Node ではマウントされない）。
 */
import { useEffect, useRef } from 'react';
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
      deptColor,
      onFocusTeam,
    });
    rendererRef.current = renderer;

    let cancelled = false;
    void renderer.init(mount).then(() => {
      if (cancelled) return;
      const current = teamsRef.current;
      renderer.fitToContent(current);
      renderer.renderTeams(current);
    });

    const ro = new ResizeObserver(() => {
      const el = mountRef.current;
      const r = rendererRef.current;
      if (!el || !r) return;
      r.resize(el.clientWidth, el.clientHeight);
      r.renderTeams(teamsRef.current);
    });
    ro.observe(mount);

    return () => {
      cancelled = true;
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [onFocusTeam, deptColor]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.fitToContent(teams);
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
