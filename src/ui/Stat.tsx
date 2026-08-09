/** 指標タイルの色調。CSS の `.org-stat.tone-*` と対応する。 */
export type StatTone = 'good' | 'warn' | 'bad' | 'budget';

/**
 * 定義リスト内の指標 1 件（ラベル＋値）。
 *
 * 部門画面と全社画面で同一実装が重複していたため集約した。
 */
export function Stat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: number | string;
  tone?: StatTone;
  testid?: string;
}) {
  return (
    <div className={`org-stat${tone ? ` tone-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd data-testid={testid}>{value}</dd>
    </div>
  );
}
