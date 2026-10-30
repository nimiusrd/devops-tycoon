/**
 * 用語チップ（#469）。定義の正本は `src/data/glossary.ts`。
 *
 * native の details/summary で開き、フォーカス中の Escape で閉じる。
 * 同じ `name` のチップは同時に一つだけ開く。
 * ボタンの中には置かない（入れ子の interactive を避ける）。
 */
import { Fragment } from 'react';
import { GLOSSARY, type GlossaryTermId } from '../data/glossary';

export type TermTipPlacement = 'inline' | 'up';

export interface TermTipProps {
  termId: GlossaryTermId;
  /** トリガー文言。省略時は glossary の見出し。 */
  children?: string;
  /** 省略時は `term-tip-${termId}`。同一画面に同じ語が複数あるときだけ上書きする。 */
  testId?: string;
  /** `up` は介入バーなど下端で、定義をトリガーの上へ出す。 */
  placement?: TermTipPlacement;
  /**
   * 開いた定義を画面内へ寄せる。
   * 狭幅の編成では、押したチップを動かさず定義を下段の全幅へ出す（#950）。
   */
  revealOnOpen?: boolean;
}

/** `.term-tip-panel` の上余白と同じ。開いている間だけ下段の空きに足す。 */
const SETUP_TERM_PANEL_GAP_PX = 6;
let setupTermPanelResizeBound = false;

function applySetupTermPanelSpace(host: HTMLElement, panel: HTMLElement | null): void {
  const narrow = document.documentElement.dataset.responsiveWidth === 'narrow';
  if (!narrow || panel === null) {
    host.style.removeProperty('--setup-term-panel-space');
    return;
  }
  host.style.setProperty(
    '--setup-term-panel-space',
    `${panel.offsetHeight + SETUP_TERM_PANEL_GAP_PX}px`,
  );
}

function openTermPanel(source: Element | null): HTMLElement | null {
  if (!(source instanceof HTMLDetailsElement) || !source.open) return null;
  const panel = source.querySelector('.term-tip-panel');
  return panel instanceof HTMLElement ? panel : null;
}

function syncSetupTermHost(host: HTMLElement): void {
  applySetupTermPanelSpace(host, openTermPanel(host.querySelector('details.term-tip[open]')));
}

function syncOpenSetupTermPanels(): void {
  for (const node of document.querySelectorAll('.setup-term-tips')) {
    if (!(node instanceof HTMLElement)) continue;
    syncSetupTermHost(node);
  }
}

/**
 * 幅や向きが変わったあと、開いている定義の空きだけを測り直す。
 * スクロールはしない。resize のたびに画面を動かすと、見ていた位置が引き戻される（#955）。
 * 幅モードの反映は resize より遅れることがあるので、属性の更新でも測り直す。
 */
function ensureSetupTermPanelResizeSync(): void {
  if (setupTermPanelResizeBound || typeof window === 'undefined') return;
  setupTermPanelResizeBound = true;
  window.addEventListener('resize', () => {
    requestAnimationFrame(syncOpenSetupTermPanels);
  });
  const observer = new MutationObserver(syncOpenSetupTermPanels);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-responsive-width'],
  });
}

function syncSetupTermPanelSpace(root: HTMLDetailsElement): void {
  if (typeof document === 'undefined' || typeof root.closest !== 'function') return;
  const host = root.closest('.setup-term-tips');
  if (!(host instanceof HTMLElement)) return;
  const source = root.open ? root : host.querySelector('details.term-tip[open]');
  applySetupTermPanelSpace(host, openTermPanel(source));
  ensureSetupTermPanelResizeSync();
}

function revealOpenTermPanel(root: HTMLDetailsElement): void {
  syncSetupTermPanelSpace(root);
  if (!root.open) return;
  const panel = root.querySelector('.term-tip-panel');
  if (panel === null || typeof panel.scrollIntoView !== 'function') return;
  panel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * `details` の開閉は summary の暗黙状態だけでは伝わらない環境がある（#950）。
 * `name` 付き details は summary の click で開いても toggle が来ないことがある。
 * クリックの既定動作のあと、開いている実体から読み上げ状態を写す。
 */
const boundTermTips = new WeakSet<HTMLDetailsElement>();

function syncTermTipExpanded(root: HTMLDetailsElement): void {
  if (typeof root.querySelector !== 'function') return;
  const summary = root.querySelector('summary');
  if (summary?.setAttribute === undefined) return;
  summary.setAttribute('aria-expanded', root.open ? 'true' : 'false');
}

function syncOpenTermTips(): void {
  if (typeof document === 'undefined') return;
  for (const node of document.querySelectorAll('details.term-tip')) {
    if (node instanceof HTMLDetailsElement) syncTermTipExpanded(node);
  }
}

function bindTermTipExpanded(node: HTMLDetailsElement | null): void {
  if (!node || boundTermTips.has(node)) return;
  boundTermTips.add(node);
  if (typeof node.addEventListener !== 'function') {
    syncTermTipExpanded(node);
    return;
  }
  node.addEventListener('toggle', syncOpenTermTips);
  const summary = node.querySelector('summary');
  if (summary && typeof summary.addEventListener === 'function') {
    summary.addEventListener('click', () => {
      queueMicrotask(syncOpenTermTips);
    });
  }
  syncTermTipExpanded(node);
}

export function TermTip({
  termId,
  children,
  testId,
  placement = 'inline',
  revealOnOpen = false,
}: TermTipProps) {
  const entry = GLOSSARY[termId];
  const triggerId = testId ?? `term-tip-${termId}`;
  return (
    <details
      className="term-tip"
      name="glossary-term-tip"
      data-testid={triggerId}
      data-placement={placement}
      ref={bindTermTipExpanded}
      onToggle={(event) => {
        syncTermTipExpanded(event.currentTarget);
        if (!revealOnOpen) return;
        revealOpenTermPanel(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        const root = event.currentTarget;
        if (!root.open) return;
        event.preventDefault();
        event.stopPropagation();
        root.open = false;
        syncTermTipExpanded(root);
        // open の直接更新は toggle が遅れることがある。空きの解消はここで確定する。
        if (revealOnOpen) revealOpenTermPanel(root);
        root.querySelector('summary')?.focus();
      }}
    >
      <summary className="term-tip-summary">{children ?? entry.term}</summary>
      <p className="term-tip-panel" data-testid={`${triggerId}-panel`} role="note">
        <span className="term-tip-term">{entry.term}：</span>
        {entry.phrases ? (
          entry.phrases.map((phrase, index) => (
            <Fragment key={`${index}:${phrase}`}>
              <wbr />
              <span className="setup-text-phrase">{phrase}</span>
            </Fragment>
          ))
        ) : (
          <>
            <wbr />
            {entry.definition}
          </>
        )}
      </p>
    </details>
  );
}
