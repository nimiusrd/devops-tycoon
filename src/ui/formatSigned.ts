/**
 * 増減量を符号付き文字列にする（`+3` / `-2` / `0`）。
 *
 * 効果フィードバックのポップ（Hud / RunBar）で同一実装が重複していたため集約した。
 */
export function formatSigned(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** HUD 増減枠（4ch）に収める閾値。表示だけ縮め、凡例・読み上げは `formatSigned` を使う（#954）。 */
export const HUD_FEEDBACK_COMPACT_THRESHOLD = 1000;

/**
 * HUD の増減ポップ用。絶対値が {@link HUD_FEEDBACK_COMPACT_THRESHOLD} 以上は `+1.2k` 形式に縮める。
 */
export function formatSignedHudFeedback(delta: number): string {
  const abs = Math.abs(delta);
  if (abs < HUD_FEEDBACK_COMPACT_THRESHOLD) return formatSigned(delta);
  const sign = delta > 0 ? '+' : '-';
  const scaled = abs / HUD_FEEDBACK_COMPACT_THRESHOLD;
  const body = abs % HUD_FEEDBACK_COMPACT_THRESHOLD === 0 ? `${scaled}k` : `${scaled.toFixed(1)}k`;
  return `${sign}${body}`;
}
