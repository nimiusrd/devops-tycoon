import { describe, expect, it } from 'vitest';
import {
  BOARD_PIXI_LAYER_ORDER,
  BOARD_RENDER_BUDGETS,
} from '../../../src/render/boardRenderBudget';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

describe('board render budget (RI-143)', () => {
  it('scene・timeline・pool が共有する上限を固定する', () => {
    expect(BOARD_RENDER_BUDGETS).toEqual({
      dots: 96,
      reviewTrails: 24,
      transientEffects: 20,
      auras: 4,
    });
    expect(BOARD_RENDER_BUDGETS.reviewTrails).toBe(
      VISUAL_TOKENS.dimensions.sprint.reviewEffects.trail.budget,
    );
    expect(BOARD_RENDER_BUDGETS.transientEffects).toBe(
      VISUAL_TOKENS.dimensions.sprint.boardEffects.budget,
    );
  });

  it('Pixi内部レイヤを奥から手前へ単調増加させる', () => {
    expect(Object.values(BOARD_PIXI_LAYER_ORDER)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });
});
