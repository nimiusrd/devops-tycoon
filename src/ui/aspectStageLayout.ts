export interface AspectStageSize {
  width: number;
  height: number;
}

/**
 * スロット内へ両軸 contain で配置する実ステージの寸法を求める。
 * レイアウトがまだ確定していない状態も入力されるため、無効な値は 0×0 にする。
 */
export function calculateAspectStageSize(
  slotWidth: number,
  slotHeight: number,
  ratio: number,
): AspectStageSize {
  if (
    !Number.isFinite(slotWidth) ||
    !Number.isFinite(slotHeight) ||
    !Number.isFinite(ratio) ||
    slotWidth <= 0 ||
    slotHeight <= 0 ||
    ratio <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const width = Math.min(slotWidth, slotHeight * ratio);
  const height = width / ratio;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  return { width, height };
}
