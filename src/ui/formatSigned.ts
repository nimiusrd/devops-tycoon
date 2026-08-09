/**
 * 増減量を符号付き文字列にする（`+3` / `-2` / `0`）。
 *
 * 効果フィードバックのポップ（Hud / RunBar）で同一実装が重複していたため集約した。
 */
export function formatSigned(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
