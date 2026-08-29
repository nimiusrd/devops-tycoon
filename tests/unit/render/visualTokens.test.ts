import { describe, expect, it } from 'vitest';
import {
  applyVisualTokenCssVariables,
  DESIGN_SPACES,
  designPointToCss,
  designPxToPercent,
  designSpaceRatio,
  designToHostTransform,
  flowDashPeriod,
  hexToPixiColor,
  orgBoardCompactMaxWidthPx,
  orgBoardIsCompact,
  orgIslandBadgeLayoutHeight,
  orgIslandBadgeMinCssHeight,
  orgIslandBadgeMinCssWidth,
  VISUAL_TOKENS,
  visualTokenCssVariables,
} from '../../../src/render/visualTokens';

describe('visual tokens', () => {
  it('主要画面の設計空間を一覧化する', () => {
    expect(DESIGN_SPACES).toEqual({
      sprint: { w: 1404, h: 573 },
      organization: { w: 1404, h: 573 },
      department: { w: 1404, h: 573 },
      industry: { w: 740, h: 360 },
    });
    expect(designSpaceRatio(DESIGN_SPACES.sprint)).toBeCloseTo(1404 / 573);
    expect(designSpaceRatio(DESIGN_SPACES.industry)).toBeCloseTo(740 / 360);
  });

  it('設計 px を CSS の相対座標へ変換する', () => {
    expect(designPxToPercent(702, DESIGN_SPACES.sprint.w)).toBe('50%');
    expect(designPointToCss({ x: 702, y: 286.5 }, DESIGN_SPACES.sprint)).toEqual({
      left: '50%',
      top: '50%',
    });
  });

  it('Review演出の共有寸法と上限を一元管理する', () => {
    expect(VISUAL_TOKENS.dimensions.sprint.reviewEffects).toMatchObject({
      heatField: { radiusX: 130, radiusY: 85, maxAlpha: 0.3 },
      trail: { budget: 24, length: 22, width: 4, aiLengthMul: 1.35 },
    });
  });

  it('設計空間を Pixi host へ contain 配置する', () => {
    expect(designToHostTransform(2808, 573, DESIGN_SPACES.sprint)).toEqual({
      scale: 1,
      x: 702,
      y: 0,
    });
    expect(designToHostTransform(702, 573, DESIGN_SPACES.sprint)).toEqual({
      scale: 0.5,
      x: 0,
      y: 143.25,
    });
    expect(designToHostTransform(0, 573, DESIGN_SPACES.sprint)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it('CSS custom property をトークンから生成して DOM へ反映する', () => {
    const values = visualTokenCssVariables();
    expect(values['--visual-space-sprint-w']).toBe('1404');
    expect(values['--visual-space-organization-h']).toBe('573');
    expect(values['--visual-space-department-w']).toBe('1404');
    expect(values['--visual-space-industry-h']).toBe('360');
    expect(values['--visual-sprint-station-width']).toBe('13%');
    expect(values['--visual-sprint-flow-dash']).toBe('6');
    expect(values['--visual-sprint-flow-gap']).toBe('9');
    expect(values['--visual-sprint-flow-period']).toBe('15px');
    expect(values['--visual-color-flow-hot']).toBe(VISUAL_TOKENS.colors.flow.hot);
    expect(values['--visual-color-task-glow-ai']).toBe(VISUAL_TOKENS.colors.taskGlow.ai);
    expect(values['--visual-color-health-healthy']).toBe(VISUAL_TOKENS.colors.health.healthy);
    expect(values['--visual-color-health-congested']).toBe(VISUAL_TOKENS.colors.health.congested);
    expect(values['--visual-color-health-review-hell']).toBe(
      VISUAL_TOKENS.colors.health.reviewHell,
    );
    expect(values['--visual-dept-flow-dash']).toBe('6');
    expect(values['--visual-dept-flow-period']).toBe('15px');
    expect(values['--visual-org-card-line-gap']).toBe('2px');
    expect(values['--visual-dept-banner-padding-x']).toBe('12px');
    expect(values['--visual-color-banner-hell-text']).toBe(
      VISUAL_TOKENS.colors.bannerTone.hell.text,
    );
    expect(values['--visual-color-banner-warn-border-alpha']).toBe('100%');
    expect(values['--visual-color-banner-warn-text']).toBe(
      VISUAL_TOKENS.colors.bannerTone.warn.text,
    );
    expect(values['--visual-color-banner-ok-bg-alpha']).toBe('93%');
    expect(values['--visual-color-banner-warn-bg-alpha']).toBe('93%');
    expect(values['--visual-color-banner-hell-bg-alpha']).toBe('93%');
    expect(values['--visual-color-interaction-drag']).toBe(VISUAL_TOKENS.colors.interaction.drag);

    const applied = new Map<string, string>();
    const root = {
      style: {
        setProperty(name: string, value: string) {
          applied.set(name, value);
        },
      },
    } as unknown as HTMLElement;
    applyVisualTokenCssVariables(root);
    expect(applied.get('--visual-color-panel')).toBe(VISUAL_TOKENS.colors.panel);
    expect(applied.get('--visual-org-card-width')).toBe('116px');
    expect(applied.get('--visual-org-zone-label-font-size')).toBe('12px');
    expect(applied.get('--visual-org-hub-overlay-height')).toBe('44px');
    expect(applied.get('--visual-org-island-badge-min-font-size')).toBe('10px');
    expect(applied.get('--visual-org-island-badge-min-meta-size')).toBe('9px');
    expect(applied.get('--visual-org-island-badge-min-width')).toBe(
      `${orgIslandBadgeMinCssWidth()}px`,
    );
    expect(applied.get('--visual-org-island-badge-line-height')).toBe('1.2');
    expect(applied.get('--visual-org-board-compact-max-width')).toBe(
      `${orgBoardCompactMaxWidthPx()}px`,
    );
  });

  it('カード可読下限高から部門ラベル再表示幅を導出する', () => {
    const minHeight = orgIslandBadgeMinCssHeight();
    const layoutHeight = orgIslandBadgeLayoutHeight();
    const width = orgBoardCompactMaxWidthPx();
    const island = VISUAL_TOKENS.dimensions.organization.island;
    expect(minHeight).toBe(
      island.badgeMinFontSize * island.badgeLineHeight +
        island.badgeMinMetaSize * island.badgeLineHeight * island.badgeMetaLines +
        island.badgeMinTagSize * island.badgeLineHeight +
        4 +
        VISUAL_TOKENS.dimensions.organization.card.lineGap * 2 +
        island.badgePaddingY * 2 +
        4,
    );
    expect(layoutHeight).toBeGreaterThan(minHeight);
    expect(minHeight).toBeGreaterThan(island.badgeHeight * 0.5);
    expect(width).toBeGreaterThan(520);
    expect(width).toBe(Math.ceil((minHeight / layoutHeight) * DESIGN_SPACES.organization.w));
    expect(orgBoardIsCompact(width)).toBe(true);
    expect(orgBoardIsCompact(width + 1)).toBe(false);
  });

  it('狭幅カードの可読下限幅をメタ文字サイズから導出する', () => {
    const minWidth = orgIslandBadgeMinCssWidth();
    expect(minWidth).toBeGreaterThan(VISUAL_TOKENS.dimensions.organization.card.width * 0.5);
    expect(minWidth).toBe(
      VISUAL_TOKENS.dimensions.organization.island.badgeMinMetaSize * 8 +
        VISUAL_TOKENS.dimensions.organization.island.badgePaddingX * 2 +
        4,
    );
  });

  it('破線周期を dash と gap から導出する', () => {
    expect(flowDashPeriod({ dash: 6, gap: 9 })).toBe(15);
  });

  it('CSS hex 色を Pixi の RGB 数値へ変換する', () => {
    expect(hexToPixiColor('#58e0b0')).toBe(0x58e0b0);
    expect(hexToPixiColor('#abc')).toBe(0xaabbcc);
    expect(hexToPixiColor('  33285c  ')).toBe(0x33285c);
    expect(() => hexToPixiColor('#1234')).toThrow('Invalid visual color');
    expect(() => hexToPixiColor('#12345678')).toThrow('Invalid visual color');
    expect(() => hexToPixiColor('not-a-color')).toThrow('Invalid visual color');
  });
});
