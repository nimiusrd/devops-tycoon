import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { calculateAspectStageSize } from './aspectStageLayout';

export interface AspectStageProps {
  /** 維持する幅 / 高さの比率。 */
  ratio: number;
  children: ReactNode;
  /** 外側のスロットへ追加するクラス。 */
  className?: string;
  /** 外側のスロットに付けるテストID。 */
  'data-testid'?: string;
}

function applyAspectStageSize(
  stage: HTMLDivElement,
  slotWidth: number,
  slotHeight: number,
  ratio: number,
): void {
  const size = calculateAspectStageSize(slotWidth, slotHeight, ratio);
  stage.style.width = `${size.width}px`;
  stage.style.height = `${size.height}px`;
}

/**
 * レイアウトスロットと、実際に描画・演出を載せるステージを分離する。
 * ResizeObserver は外側のスロットだけを監視し、子要素の内容量による循環を避ける。
 */
export function AspectStage({
  ratio,
  children,
  className,
  'data-testid': testId,
}: AspectStageProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const stage = stageRef.current;
    if (!slot || !stage) return;

    let active = true;
    const apply = (width = slot.clientWidth, height = slot.clientHeight): void => {
      if (!active) return;
      applyAspectStageSize(stage, width, height, ratio);
    };

    apply();
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      apply(rect?.width ?? slot.clientWidth, rect?.height ?? slot.clientHeight);
    });
    observer.observe(slot);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [ratio]);

  return (
    <div
      ref={slotRef}
      className={className ? `aspect-stage ${className}` : 'aspect-stage'}
      data-testid={testId}
    >
      <div
        ref={stageRef}
        className="aspect-stage-content"
        data-testid="aspect-stage-content"
        style={{ aspectRatio: ratio > 0 && Number.isFinite(ratio) ? ratio : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
