/**
 * DOM/SVG と Pixi が共有する表示用トークン（RI-99）。
 *
 * 盤面の設計空間、盤面上の主要寸法、状態トーンの色はここを正本にする。
 * CSS は起動時に `visualTokenCssVariables()` の値を custom property として受け取り、
 * Pixi と純 TS の描画計画はこの定義を直接参照する。ゲームバランスの値は含めない。
 */

export type VisualTone = 'ok' | 'warn' | 'hell';

export interface DesignSpace {
  readonly w: number;
  readonly h: number;
}

/** DOM/Pixi で使う設計空間の一覧。部署は全社と同じ盤面比率を使うが、名前は分けて公開する。 */
export const DESIGN_SPACES = {
  sprint: { w: 1404, h: 573 },
  organization: { w: 1404, h: 573 },
  department: { w: 1404, h: 573 },
  industry: { w: 740, h: 360 },
} as const satisfies Record<string, DesignSpace>;

export const VISUAL_TOKENS = {
  spaces: DESIGN_SPACES,
  colors: {
    text: '#fdf6ec',
    textDim: '#b9add0',
    panel: '#2a2350',
    line: '#4a3d7a',
    cream: '#ffefd6',
    coral: '#ff7e8b',
    mint: '#58e0b0',
    sun: '#ffd45c',
    lav: '#b39dff',
    sky: '#6cc6ff',
    fire: '#ff7a2f',
    ink: '#33285c',
    health: {
      healthy: '#58e0b0',
      congested: '#ffd45c',
      reviewHell: '#ff5f1f',
    },
    flow: {
      normal: '#cdbff0',
      hot: '#ff9a93',
    },
    task: {
      normal: '#cdbff0',
      ai: '#9a6bff',
      rework: '#e04b40',
      incident: '#ff5f1f',
      gold: '#f5b400',
      debt: '#14161f',
    },
    taskGlow: {
      ai: '#b388ff',
      gold: '#ffd45c',
      incident: '#ff7a2f',
    },
    interaction: {
      drag: '#7bdcff',
      focusHell: '#ff5f57',
    },
    aiBot: {
      body: '#eef0ff',
      bodyStroke: '#b9c4ff',
      screen: '#1b2350',
      eye: '#7bdcff',
      antenna: '#b39dff',
      indicator: '#ffd45c',
    },
    bannerTone: {
      ok: {
        border: '#58e0b0',
        borderAlpha: 0.6,
        backgroundAlpha: 0.93,
        bg: '#1f1942',
        text: '#ffefd6',
        tagBg: '#16402f',
        tagText: '#7df0bf',
      },
      warn: {
        border: '#ffd45c',
        borderAlpha: 1,
        backgroundAlpha: 0.93,
        bg: '#1f1942',
        text: '#ffefd6',
        tagBg: '#4a3a14',
        tagText: '#ffe08a',
      },
      hell: {
        border: '#ff5f57',
        borderAlpha: 1,
        backgroundAlpha: 0.93,
        bg: '#3a1414',
        text: '#ffd0cb',
        tagBg: '#5a1410',
        tagText: '#ffb0ac',
      },
    },
    actor: {
      body: {
        backlog: '#7a6cc0',
        coding: '#4fb3a0',
        review: '#5b6b8c',
        rework: '#c0728a',
        done: '#3fa86e',
      },
      hair: {
        backlog: '#4a3530',
        coding: '#5a3a2a',
        review: '#3a3340',
        rework: '#3a2a40',
        done: '#4a3020',
      },
      skin: '#ffe0c4',
      desk: {
        woodTop: '#caa06a',
        woodLeft: '#9a7440',
        woodRight: '#75561f',
        darkTop: '#5a4a86',
        darkLeft: '#3a2f66',
        darkRight: '#2b2050',
        leg: '#5a3f18',
      },
    },
    board: {
      backgroundTop: '#2b1f52',
      backgroundMiddle: '#241a47',
      backgroundBottom: '#1c1438',
      heatOverlay: '#5a0f0f',
    },
    organization: {
      cardBackground: '#1b1438',
      cardText: '#f0e8ff',
      cardFireStroke: '#ff5f1f',
    },
    department: {
      plateFloor: '#2f1b44',
      plateEdgeLeft: '#21112c',
      plateEdgeRight: '#190c22',
      floorHealthy: '#3a2f68',
      floorWarn: '#3f3470',
      floorHell: '#4a2b45',
      hellOverlay: '#ff5a45',
      glowHealthy: '#57e08f',
      glowHell: '#ff3b30',
      miniFlowNormal: '#b388ff',
      miniFlowHot: '#ff9a93',
      miniFlowDone: '#ffd45c',
      gridLine: '#ffffff',
    },
    industry: {
      rivalGradientTop: '#75d0ff',
      rivalGradientBottom: '#3364c8',
      selfGradientTop: '#ffe27a',
      selfGradientBottom: '#ff9d45',
      leaderGradientTop: '#8df4c2',
      leaderGradientBottom: '#2aa578',
    },
  },
  dimensions: {
    sprint: {
      stationWidthPercent: 13,
      actor: {
        local: { w: 220, h: 200 },
        dom: { w: 210, h: 190 },
        statusOffset: { xRatio: 0.36, yRatio: -0.47 },
      },
      flowDash: { dash: 6, gap: 9 },
      pile: { dx: 22, dy: 16 },
      flowSpread: 14,
      dotTexturePadding: 20,
      dotHitMargin: 6,
      taskDiameter: { small: 16, medium: 26, large: 34 },
    },
    organization: {
      iso: { tileW: 264, tileH: 176 },
      padding: 64,
      card: { width: 116, paddingX: 10, paddingY: 8, radius: 12, lineGap: 2 },
      island: {
        badgeAbove: 46,
        badgeHeight: 56,
        actorHalfHeight: 65,
        margin: 8,
        badgeFontSize: 11,
        badgeMetaSize: 10,
        badgeTagSize: 9,
        /** phone 盤面で `--org-board-scale` が ~0.28 になっても本文が潰されない CSS px 下限。 */
        badgeMinFontSize: 10,
        badgeMinMetaSize: 9,
        badgeMinTagSize: 8,
        badgePaddingX: 10,
        badgePaddingY: 5,
      },
      /** 部門ラベル帯。島バッジ（チームカード）の上に置き、縮小盤面でも重ならない。 */
      zoneLabel: {
        y: 88,
        height: 48,
        gap: 16,
        fontSize: 12,
        subtitleSize: 10,
        paddingX: 12,
        paddingY: 6,
      },
      /** Pixi 盤面の上端に重ねる共通基盤ピル、および DOM ハブバッジの寸法。 */
      hubOverlay: {
        height: 44,
        top: 8,
        fontSize: 12,
        metaSize: 10,
        minFontSize: 11,
        minMetaSize: 10,
        paddingX: 14,
        paddingY: 6,
      },
    },
    department: {
      teamMini: {
        layoutW: 380,
        layoutH: 220,
        svgW: 380,
        svgH: 240,
        pivotX: 190,
        pivotY: 120,
        pile: { cap: 12, perRow: 4, dx: 10, dy: 9, largeThreshold: 8, largeRadius: 5, radius: 6 },
      },
      bannerAbove: 118,
      banner: {
        paddingX: 12,
        paddingTop: 5,
        paddingBottom: 6,
        radius: 13,
        lineGap: 2,
        tagPaddingX: 8,
        tagPaddingY: 1,
      },
      plate: {
        floor: [702, 104, 1262, 384, 702, 664, 142, 384],
        edgeL: [142, 384, 702, 664, 702, 694, 142, 414],
        edgeR: [702, 664, 1262, 384, 1262, 414, 702, 694],
        grid: { originX: 702, originY: 104, stepX: 80, stepY: 40, count: 7 },
      },
      flowDash: { dash: 6, gap: 9 },
    },
    industry: {
      skylineLimit: 8,
      building: {
        minHeight: 52,
        maxHeight: 190,
        width: 54,
        depth: 28,
        baseY: 292,
      },
    },
  },
} as const;

export type VisualTokens = typeof VISUAL_TOKENS;

/** 設計空間の比率。DOM の aspect-ratio と Pixi の contain-fit の両方で使う。 */
export function designSpaceRatio(space: DesignSpace): number {
  return space.h > 0 ? space.w / space.h : 0;
}

/** 破線アニメーションの 1 周期（dash + gap）。DOM と Pixi の位相を揃える。 */
export function flowDashPeriod(flowDash: { readonly dash: number; readonly gap: number }): number {
  return flowDash.dash + flowDash.gap;
}

/** 設計 px を DOM の相対配置へ写像する。 */
export function designPxToPercent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

/** 設計空間の点を DOM の left/top へ写像する。 */
export function designPointToCss(
  point: { x: number; y: number },
  space: DesignSpace,
): { left: string; top: string } {
  return {
    left: designPxToPercent(point.x, space.w),
    top: designPxToPercent(point.y, space.h),
  };
}

export interface DesignToHostTransform {
  scale: number;
  x: number;
  y: number;
}

/** 設計空間を Pixi の host へ contain 配置する変換。 */
export function designToHostTransform(
  hostW: number,
  hostH: number,
  space: DesignSpace,
): DesignToHostTransform {
  if (hostW <= 0 || hostH <= 0 || space.w <= 0 || space.h <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = Math.min(hostW / space.w, hostH / space.h);
  return {
    scale,
    x: (hostW - space.w * scale) / 2,
    y: (hostH - space.h * scale) / 2,
  };
}

/** 6桁/3桁の CSS hex color を Pixi の数値色へ変換する。アルファは Pixi の alpha で扱う。 */
export function hexToPixiColor(hex: string): number {
  const raw = hex.trim().replace(/^#/, '');
  if (raw.length !== 3 && raw.length !== 6) {
    throw new Error(`Invalid visual color: ${hex}`);
  }
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => part + part)
          .join('')
      : raw;
  if (!/^[\da-f]{6}$/i.test(expanded)) {
    throw new Error(`Invalid visual color: ${hex}`);
  }
  return Number.parseInt(expanded, 16);
}

/**
 * CSS custom property への写像。DOM/CSS の値を別ファイルへ複製せず、
 * `applyVisualTokenCssVariables` がこの結果を `:root` へ反映する。
 */
export function visualTokenCssVariables(): Readonly<Record<string, string>> {
  const { colors, dimensions, spaces } = VISUAL_TOKENS;
  return {
    '--visual-space-sprint-w': String(spaces.sprint.w),
    '--visual-space-sprint-h': String(spaces.sprint.h),
    '--visual-space-organization-w': String(spaces.organization.w),
    '--visual-space-organization-h': String(spaces.organization.h),
    '--visual-space-department-w': String(spaces.department.w),
    '--visual-space-department-h': String(spaces.department.h),
    '--visual-space-industry-w': String(spaces.industry.w),
    '--visual-space-industry-h': String(spaces.industry.h),
    '--visual-sprint-station-width': `${dimensions.sprint.stationWidthPercent}%`,
    '--visual-sprint-flow-dash': String(dimensions.sprint.flowDash.dash),
    '--visual-sprint-flow-gap': String(dimensions.sprint.flowDash.gap),
    '--visual-sprint-flow-period': `${flowDashPeriod(dimensions.sprint.flowDash)}px`,
    '--visual-sprint-pile-dx': `${dimensions.sprint.pile.dx}px`,
    '--visual-sprint-pile-dy': `${dimensions.sprint.pile.dy}px`,
    '--visual-org-card-width': `${dimensions.organization.card.width}px`,
    '--visual-org-card-padding-x': `${dimensions.organization.card.paddingX}px`,
    '--visual-org-card-padding-y': `${dimensions.organization.card.paddingY}px`,
    '--visual-org-card-radius': `${dimensions.organization.card.radius}px`,
    '--visual-org-card-line-gap': `${dimensions.organization.card.lineGap}px`,
    '--visual-org-zone-label-font-size': `${dimensions.organization.zoneLabel.fontSize}px`,
    '--visual-org-zone-label-subtitle-size': `${dimensions.organization.zoneLabel.subtitleSize}px`,
    '--visual-org-zone-label-padding-x': `${dimensions.organization.zoneLabel.paddingX}px`,
    '--visual-org-zone-label-padding-y': `${dimensions.organization.zoneLabel.paddingY}px`,
    '--visual-org-island-badge-font-size': `${dimensions.organization.island.badgeFontSize}px`,
    '--visual-org-island-badge-meta-size': `${dimensions.organization.island.badgeMetaSize}px`,
    '--visual-org-island-badge-tag-size': `${dimensions.organization.island.badgeTagSize}px`,
    '--visual-org-island-badge-min-font-size': `${dimensions.organization.island.badgeMinFontSize}px`,
    '--visual-org-island-badge-min-meta-size': `${dimensions.organization.island.badgeMinMetaSize}px`,
    '--visual-org-island-badge-min-tag-size': `${dimensions.organization.island.badgeMinTagSize}px`,
    '--visual-org-island-badge-padding-x': `${dimensions.organization.island.badgePaddingX}px`,
    '--visual-org-island-badge-padding-y': `${dimensions.organization.island.badgePaddingY}px`,
    '--visual-org-hub-overlay-height': `${dimensions.organization.hubOverlay.height}px`,
    '--visual-org-hub-overlay-top': `${dimensions.organization.hubOverlay.top}px`,
    '--visual-org-hub-overlay-font-size': `${dimensions.organization.hubOverlay.fontSize}px`,
    '--visual-org-hub-overlay-meta-size': `${dimensions.organization.hubOverlay.metaSize}px`,
    '--visual-org-hub-overlay-min-font-size': `${dimensions.organization.hubOverlay.minFontSize}px`,
    '--visual-org-hub-overlay-min-meta-size': `${dimensions.organization.hubOverlay.minMetaSize}px`,
    '--visual-org-hub-overlay-padding-x': `${dimensions.organization.hubOverlay.paddingX}px`,
    '--visual-org-hub-overlay-padding-y': `${dimensions.organization.hubOverlay.paddingY}px`,
    '--visual-dept-mini-width': `${dimensions.department.teamMini.layoutW}px`,
    '--visual-dept-flow-dash': String(dimensions.department.flowDash.dash),
    '--visual-dept-flow-gap': String(dimensions.department.flowDash.gap),
    '--visual-dept-flow-period': `${flowDashPeriod(dimensions.department.flowDash)}px`,
    '--visual-dept-banner-padding-x': `${dimensions.department.banner.paddingX}px`,
    '--visual-dept-banner-padding-top': `${dimensions.department.banner.paddingTop}px`,
    '--visual-dept-banner-padding-bottom': `${dimensions.department.banner.paddingBottom}px`,
    '--visual-dept-banner-radius': `${dimensions.department.banner.radius}px`,
    '--visual-dept-banner-line-gap': `${dimensions.department.banner.lineGap}px`,
    '--visual-dept-banner-tag-padding-x': `${dimensions.department.banner.tagPaddingX}px`,
    '--visual-dept-banner-tag-padding-y': `${dimensions.department.banner.tagPaddingY}px`,
    '--visual-color-text': colors.text,
    '--visual-color-text-dim': colors.textDim,
    '--visual-color-panel': colors.panel,
    '--visual-color-line': colors.line,
    '--visual-color-cream': colors.cream,
    '--visual-color-coral': colors.coral,
    '--visual-color-mint': colors.mint,
    '--visual-color-sun': colors.sun,
    '--visual-color-lav': colors.lav,
    '--visual-color-sky': colors.sky,
    '--visual-color-fire': colors.fire,
    '--visual-color-ink': colors.ink,
    '--visual-color-health-healthy': colors.health.healthy,
    '--visual-color-health-congested': colors.health.congested,
    '--visual-color-health-review-hell': colors.health.reviewHell,
    '--visual-color-flow-normal': colors.flow.normal,
    '--visual-color-flow-hot': colors.flow.hot,
    '--visual-color-task-ai': colors.task.ai,
    '--visual-color-task-gold': colors.task.gold,
    '--visual-color-task-incident': colors.task.incident,
    '--visual-color-task-glow-ai': colors.taskGlow.ai,
    '--visual-color-task-glow-gold': colors.taskGlow.gold,
    '--visual-color-task-glow-incident': colors.taskGlow.incident,
    '--visual-color-banner-ok-bg': colors.bannerTone.ok.bg,
    '--visual-color-banner-ok-bg-alpha': `${colors.bannerTone.ok.backgroundAlpha * 100}%`,
    '--visual-color-banner-ok-border': colors.bannerTone.ok.border,
    '--visual-color-banner-ok-border-alpha': `${colors.bannerTone.ok.borderAlpha * 100}%`,
    '--visual-color-banner-ok-text': colors.bannerTone.ok.text,
    '--visual-color-banner-ok-tag-bg': colors.bannerTone.ok.tagBg,
    '--visual-color-banner-ok-tag-text': colors.bannerTone.ok.tagText,
    '--visual-color-banner-warn-bg': colors.bannerTone.warn.bg,
    '--visual-color-banner-warn-bg-alpha': `${colors.bannerTone.warn.backgroundAlpha * 100}%`,
    '--visual-color-banner-warn-border': colors.bannerTone.warn.border,
    '--visual-color-banner-warn-border-alpha': `${colors.bannerTone.warn.borderAlpha * 100}%`,
    '--visual-color-banner-warn-text': colors.bannerTone.warn.text,
    '--visual-color-banner-warn-tag-bg': colors.bannerTone.warn.tagBg,
    '--visual-color-banner-warn-tag-text': colors.bannerTone.warn.tagText,
    '--visual-color-banner-hell-bg-alpha': `${colors.bannerTone.hell.backgroundAlpha * 100}%`,
    '--visual-color-banner-hell-border': colors.bannerTone.hell.border,
    '--visual-color-banner-hell-border-alpha': `${colors.bannerTone.hell.borderAlpha * 100}%`,
    '--visual-color-banner-hell-bg': colors.bannerTone.hell.bg,
    '--visual-color-banner-hell-text': colors.bannerTone.hell.text,
    '--visual-color-banner-hell-tag-bg': colors.bannerTone.hell.tagBg,
    '--visual-color-banner-hell-tag-text': colors.bannerTone.hell.tagText,
    '--visual-color-interaction-drag': colors.interaction.drag,
    '--visual-color-interaction-focus-hell': colors.interaction.focusHell,
    '--visual-color-ai-bot-body': colors.aiBot.body,
    '--visual-color-ai-bot-body-stroke': colors.aiBot.bodyStroke,
    '--visual-color-ai-bot-screen': colors.aiBot.screen,
    '--visual-color-ai-bot-eye': colors.aiBot.eye,
    '--visual-color-ai-bot-antenna': colors.aiBot.antenna,
    '--visual-color-ai-bot-indicator': colors.aiBot.indicator,
    '--visual-color-board-background-top': colors.board.backgroundTop,
    '--visual-color-board-background-middle': colors.board.backgroundMiddle,
    '--visual-color-board-background-bottom': colors.board.backgroundBottom,
    '--visual-color-board-heat-overlay': colors.board.heatOverlay,
    '--visual-color-org-card-background': colors.organization.cardBackground,
    '--visual-color-dept-hell-overlay': colors.department.hellOverlay,
  };
}

/** ブラウザの `:root` へ共有トークンを設定する DOM アダプタ。 */
export function applyVisualTokenCssVariables(root: HTMLElement): void {
  for (const [name, value] of Object.entries(visualTokenCssVariables())) {
    root.style.setProperty(name, value);
  }
}
