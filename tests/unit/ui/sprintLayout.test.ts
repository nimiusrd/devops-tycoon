import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SprintLayout } from '../../../src/ui/SprintLayout';
import { ResponsiveModeContext, type ResponsiveMode } from '../../../src/ui/responsiveModeCore';

function render(mode: ResponsiveMode, withOverlay: boolean) {
  return renderToStaticMarkup(
    createElement(ResponsiveModeContext.Provider, {
      value: mode,
      children: createElement(SprintLayout, {
        header: createElement('h1', null, 'ヘッダー'),
        status: 'ステータス',
        stage: createElement('main', null, 'ステージ'),
        deck: 'デッキ',
        controls: createElement('button', { type: 'button' }, '操作'),
        overlays: withOverlay ? createElement('aside', null, 'オーバーレイ') : undefined,
      }),
    }),
  );
}

describe('SprintLayout の公開スロット', () => {
  it.each([
    { width: 'wide', height: 'normal' },
    { width: 'wide', height: 'short' },
    { width: 'narrow', height: 'normal' },
    { width: 'narrow', height: 'short' },
  ] satisfies ResponsiveMode[])(
    'レスポンシブモード %o を反映して全スロットを順番どおり出力する',
    (mode) => {
      const html = render(mode, false);
      expect(html).toContain('data-testid="sprint-layout"');
      expect(html).toContain(`data-responsive-width="${mode.width}"`);
      expect(html).toContain(`data-responsive-height="${mode.height}"`);
      const slots = [
        ...html.matchAll(
          /data-sprint-slot="([^"]+)" data-testid="sprint-slot-[^"]+">(.*?)<\/div>/g,
        ),
      ];
      expect(slots.map((slot) => slot[1])).toEqual([
        'header',
        'status',
        'stage',
        'deck',
        'controls',
      ]);
      expect(slots.map((slot) => slot[2])).toEqual([
        '<h1>ヘッダー</h1>',
        'ステータス',
        '<main>ステージ</main>',
        'デッキ',
        '<button type="button">操作</button>',
      ]);
      for (const slot of slots)
        expect(html).toContain(`sprint-layout-slot sprint-layout-slot-${slot[1]} `);
      expect(html).not.toContain('<aside>');
    },
  );

  it('オーバーレイをスロットへ入れず、操作スロットの後へ出力する', () => {
    const html = render({ width: 'wide', height: 'normal' }, true);
    expect(html).toContain('</button></div><aside>オーバーレイ</aside></div>');
  });
});
