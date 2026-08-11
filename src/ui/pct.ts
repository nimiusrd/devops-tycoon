/**
 * 設計座標を CSS の % へ変換するヘルパー。
 *
 * 等角盤面（Board / OrgBoard / DeptBoard / IndustrySkyline）は、いずれも
 * 固定の設計空間（例: 1404×573）で組んだシーン計画を `useContainFit` または
 * `AspectStage` がcontain配置した箱へ % 配置で重ねる。その変換だけを担う。
 *
 * 上記4ファイルに同一実装のコピーが散らばっていたため集約した。
 */
export function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}
