/** 対象構え・解除時の山押し広げの補間（#982）。sim と山の静的配置には触らない。 */
import { VISUAL_TOKENS } from './visualTokens';

export const PILE_PRESENTATION = {
  travelMs: VISUAL_TOKENS.dimensions.sprint.dotArmedPresentation.durationMs,
} as const;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** 0 = 構え前の計画座標、1 = 武装後の提示座標。 */
export class BoardPilePresentation {
  private from = 0;
  private to = 0;
  private startedAt = 0;

  strengthAt(now: number): number {
    if (this.from === this.to) return this.to;
    const elapsed = Math.max(0, now - this.startedAt);
    const t = Math.max(0, Math.min(1, elapsed / PILE_PRESENTATION.travelMs));
    return this.from + (this.to - this.from) * easeOutCubic(t);
  }

  /** 補間の目標（武装中なら 1）。 */
  targetStrength(): number {
    return this.to;
  }

  settledAt(now: number): boolean {
    return this.from === this.to || now >= this.startedAt + PILE_PRESENTATION.travelMs;
  }

  sync(selectionActive: boolean, now: number, immediate: boolean): void {
    const target = selectionActive ? 1 : 0;
    if (immediate) {
      this.from = target;
      this.to = target;
      this.startedAt = now;
      return;
    }
    if (target === this.to) return;
    this.from = this.strengthAt(now);
    this.to = target;
    this.startedAt = now;
  }

  clear(): void {
    this.from = 0;
    this.to = 0;
    this.startedAt = 0;
  }
}
