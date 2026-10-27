/**
 * 用語チップ（#469）。定義の正本は `src/data/glossary.ts`。
 *
 * native の details/summary で開き、フォーカス中の Escape で閉じる。
 * 同じ `name` のチップは同時に一つだけ開く。
 * 編成の狭幅では、開いた定義を画面内へ寄せる（#950）。
 * ボタンの中には置かない（入れ子の interactive を避ける）。
 */
import { Fragment } from 'react';
import { GLOSSARY, type GlossaryTermId } from '../data/glossary';
import { revealSetupTermPanel } from './termTipLayout';

export type TermTipPlacement = 'inline' | 'up';

export interface TermTipProps {
  termId: GlossaryTermId;
  /** トリガー文言。省略時は glossary の見出し。 */
  children?: string;
  /** 省略時は `term-tip-${termId}`。同一画面に同じ語が複数あるときだけ上書きする。 */
  testId?: string;
  /** `up` は介入バーなど下端で、定義をトリガーの上へ出す。 */
  placement?: TermTipPlacement;
}

export function TermTip({ termId, children, testId, placement = 'inline' }: TermTipProps) {
  const entry = GLOSSARY[termId];
  const triggerId = testId ?? `term-tip-${termId}`;
  return (
    <details
      className="term-tip"
      name="glossary-term-tip"
      data-testid={triggerId}
      data-placement={placement}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        const root = event.currentTarget;
        if (!root.open) return;
        event.preventDefault();
        event.stopPropagation();
        root.open = false;
        // toggle イベントは閉じた後のタスクで届く。余白はその場で戻す。
        revealSetupTermPanel(root);
        root.querySelector('summary')?.focus();
      }}
      onToggle={(event) => {
        revealSetupTermPanel(event.currentTarget);
      }}
    >
      <summary
        className="term-tip-summary"
        onClick={(event) => {
          const root = event.currentTarget.parentElement;
          if (!(root instanceof HTMLDetailsElement)) return;
          // 開閉の既定動作のあと、描画前にパネルの余白を合わせる。
          root.ownerDocument.defaultView?.requestAnimationFrame(() => revealSetupTermPanel(root));
        }}
      >
        {children ?? entry.term}
      </summary>
      <p className="term-tip-panel" data-testid={`${triggerId}-panel`} role="note">
        {entry.phrases
          ? entry.phrases.map((phrase, index) => (
              <Fragment key={phrase}>
                {index > 0 && <wbr />}
                <span className="setup-text-phrase">{phrase}</span>
              </Fragment>
            ))
          : entry.definition}
      </p>
    </details>
  );
}
