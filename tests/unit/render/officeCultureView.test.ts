import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getRelic } from '../../../src/data/relics';
import { officeCultureView } from '../../../src/render/officeCultureView';
import { OfficeRoom } from '../../../src/ui/OfficeRoom';
import { createReplayContentResolver } from '../../../src/ui/replayContent';

describe('所持文化の壁掲示', () => {
  it('未所持・別文化・未知IDは掲示せず、定義も引かない', () => {
    const resolve = vi.fn(getRelic);
    for (const relics of [[], ['psych-safety'], ['future-culture']]) {
      expect(officeCultureView(relics, resolve)).toBeNull();
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(createElement(OfficeRoom))).not.toContain('office-culture-marker');
  });

  it('small-prの実定義から名前・効果・説明を作り、SVGも同じモデルを読む', () => {
    const model = officeCultureView(['small-pr'], getRelic)!;
    expect(model.name).toBe(getRelic('small-pr')!.name);
    expect(model.description).toContain(getRelic('small-pr')!.description);
    expect(model.description).toContain('x1.15');
    const svg = renderToStaticMarkup(createElement(OfficeRoom, { culture: model }));
    expect(svg).toContain(`${model.name}：${model.description}`);
    expect(svg).toContain('data-culture-id="small-pr"');
  });

  it('複数文化の所持順によらずsmall-prだけを1枠に掲示し、入力を変えない', () => {
    const relics = Object.freeze(['psych-safety', 'small-pr', 'strong-ci', 'small-pr']);
    expect(officeCultureView(relics, getRelic)).toEqual(
      officeCultureView([...relics].reverse(), getRelic),
    );
    const svg = renderToStaticMarkup(
      createElement(OfficeRoom, { culture: officeCultureView(relics, getRelic) }),
    );
    expect(svg.match(/data-testid="office-culture-marker"/g)).toHaveLength(1);
    expect(relics).toEqual(['psych-safety', 'small-pr', 'strong-ci', 'small-pr']);
  });

  it('リプレイの表示時点の所持と記録定義を優先する', () => {
    const recorded = {
      ...getRelic('small-pr')!,
      name: '記録時の文化',
      description: '記録時の説明',
      effects: { reviewEfficiencyMul: 1.4 },
    };
    const { resolveRelic } = createReplayContentResolver({ cards: [], relics: [recorded] });
    const model = officeCultureView(['small-pr'], resolveRelic)!;
    expect(model.name).toBe('記録時の文化');
    expect(model.description).toContain('記録時の説明');
    expect(model.description).toContain('x1.4');
    expect(model.description).not.toContain('x1.15');
    expect(officeCultureView([], resolveRelic)).toBeNull();
  });

  it('記録定義欠損は現在の効果へ差し替えない', () => {
    const { resolveRelic } = createReplayContentResolver({ cards: [], relics: [] });
    for (const resolve of [resolveRelic, () => undefined]) {
      const model = officeCultureView(['small-pr'], resolve)!;
      expect(model.name).toContain('不明なレリック');
      expect(model.description).toBe('記録時のレリック定義が見つかりません。');
      expect(model.description).not.toContain('1.15');
    }
  });

  it('定義記録のない旧リプレイではlive resolverを呼ばず、新ランへ持ち越さない', () => {
    const resolve = vi.fn(getRelic);
    expect(officeCultureView(['small-pr'], resolve, true)?.name).toContain('不明');
    expect(resolve).not.toHaveBeenCalled();
    expect(officeCultureView(['small-pr'], getRelic)).not.toBeNull();
    expect(officeCultureView([], getRelic)).toBeNull();
  });
});
