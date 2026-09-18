/**
 * 用語チップ（#469）。定義の正本は `src/data/glossary.ts`。
 *
 * native の details/summary で開き、フォーカス中の Escape で閉じる。
 * ボタンの中には置かない（入れ子の interactive を避ける）。
 */
import { GLOSSARY, type GlossaryTermId } from '../data/glossary';

export interface TermTipProps {
  termId: GlossaryTermId;
  /** トリガー文言。省略時は glossary の見出し。 */
  children?: string;
  /** 省略時は `term-tip-${termId}`。同一画面に同じ語が複数あるときだけ上書きする。 */
  testId?: string;
}

export function TermTip({ termId, children, testId }: TermTipProps) {
  const entry = GLOSSARY[termId];
  const triggerId = testId ?? `term-tip-${termId}`;
  return (
    <details
      className="term-tip"
      data-testid={triggerId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        const root = event.currentTarget;
        if (!root.open) return;
        event.preventDefault();
        event.stopPropagation();
        root.open = false;
        root.querySelector('summary')?.focus();
      }}
    >
      <summary className="term-tip-summary">{children ?? entry.term}</summary>
      <p className="term-tip-panel" data-testid={`${triggerId}-panel`} role="note">
        {entry.definition}
      </p>
    </details>
  );
}
