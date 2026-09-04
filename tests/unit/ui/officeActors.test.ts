import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: 'loading' }));
// 画像の load/error 通知後だけ再描画する。人物・机・表情・アセット選択は実装を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [
    state.value,
    (next: string) => {
      state.value = next;
    },
  ],
}));

import { VISUAL_TOKENS } from '../../../src/render/visualTokens';
import type { StationMood } from '../../../src/render/boardScene';
import type { Lane } from '../../../src/sim/types';
import { StationActor, type StationActorProps } from '../../../src/ui/OfficeActors';

type ElementProps = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  if (typeof node.type === 'function') {
    return elements((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function mountActor(props: StationActorProps) {
  let tree = StationActor(props);
  const all = () => elements(tree);
  const image = () => all().find((node) => node.type === 'image')!;
  const layers = () => Children.toArray(tree.props.children).filter(isValidElement<ElementProps>);
  return {
    all,
    image,
    get svg() {
      return tree;
    },
    get assetLayer() {
      return layers()[0];
    },
    get fallbackLayer() {
      return layers()
        .filter((node) => String(node.props.className ?? '').startsWith('cbob'))
        .at(-1)!;
    },
    markers: () => all().filter((node) => node.props.className === 'station-game-asset-marker'),
    notify(event: 'onLoad' | 'onError') {
      (image().props[event] as () => void)();
      tree = StationActor(props);
    },
    update(next: Partial<StationActorProps>) {
      props = { ...props, ...next };
      tree = StationActor(props);
    },
  };
}

afterEach(() => {
  state.value = 'loading';
});

describe('StationActor の画像とフォールバック', () => {
  it.each([
    ['backlog', 'product-oracle'],
    ['coding', 'platform-architect'],
    ['review', 'qa-alchemist'],
    ['rework', 'incident-commander'],
    ['done', 'release-captain'],
  ] satisfies [Lane, string][])(
    '%s は担当アセットをロードするまで人物を残し、エラー後にも表示を保つ',
    (lane, assetId) => {
      const actor = mountActor({ lane, mood: 'neutral' });
      expect(actor.svg.props).toMatchObject({
        'aria-hidden': 'true',
        width: VISUAL_TOKENS.dimensions.sprint.actor.dom.w,
        height: VISUAL_TOKENS.dimensions.sprint.actor.dom.h,
      });
      expect(actor.image().props['data-asset-id']).toBe(assetId);
      expect(actor.image().props.href).toContain(assetId);
      expect(actor.assetLayer.props.opacity).toBe(0);
      expect(actor.fallbackLayer.props.opacity).toBe(1);
      expect(actor.markers()).toHaveLength(0);
      actor.notify('onError');
      expect(actor.assetLayer.props.opacity).toBe(0);
      expect(actor.fallbackLayer.props.opacity).toBe(1);
      actor.notify('onLoad');
      expect(actor.assetLayer.props.opacity).toBe(1);
      // 成功時にもフォールバックは残し、画像のエラー通知で即復帰できる。
      expect(actor.fallbackLayer.props.opacity).toBe(0);
      expect(actor.markers()).toHaveLength(0);
      actor.notify('onError');
      expect(actor.assetLayer.props.opacity).toBe(0);
      expect(actor.fallbackLayer.props.opacity).toBe(1);
    },
  );

  it.each([
    ['neutral', null, 1],
    ['happy', '✨', 1],
    ['cheer', '🎉', 1],
    ['tired', '💦', 0.84],
    ['exhausted', '💦', 0.68],
    ['panic', '💢', 0.95],
    ['sad', '😞', 0.78],
  ] satisfies [StationMood, string | null, number][])(
    '%s の状態はロード前後で維持され、状態印は画像の準備後に現れる',
    (mood, marker, alpha) => {
      const actor = mountActor({ lane: 'review', mood });
      expect(actor.image().props.className).toContain(`mood-${mood}`);
      expect(actor.fallbackLayer.props.className).toBe(mood === 'panic' ? 'cbob shake' : 'cbob');
      expect(actor.markers()).toHaveLength(0);
      actor.notify('onLoad');
      expect(actor.assetLayer.props.opacity).toBe(alpha);
      expect(actor.assetLayer.props.className).toBe(mood === 'panic' ? 'cbob shake' : 'cbob');
      expect(actor.markers().map((node) => node.props.children)).toEqual(marker ? [marker] : []);
      actor.update({ mood: 'neutral' });
      expect(actor.image().props.className).toContain('mood-neutral');
      expect(actor.assetLayer.props.opacity).toBe(1);
      expect(actor.markers()).toHaveLength(0);
    },
  );

  it('Coding の高速動作よりパニックを優先し、状態回復で通常の動作へ戻す', () => {
    const actor = mountActor({ lane: 'coding', mood: 'neutral' });
    expect(actor.fallbackLayer.props.className).toBe('cbob fast');
    expect(
      actor
        .all()
        .filter((node) => node.type === 'text')
        .map((node) => node.props.children),
    ).toEqual(['✨']);
    actor.notify('onLoad');
    expect(actor.assetLayer.props.className).toBe('cbob fast');
    actor.update({ mood: 'panic' });
    expect(actor.assetLayer.props.className).toBe('cbob shake');
    actor.update({ mood: 'happy' });
    expect(actor.assetLayer.props.className).toBe('cbob fast');
    expect(actor.markers().map((node) => node.props.children)).toEqual(['✨']);
  });

  it('Coding は暗い机、他工程は木の机を使い、モニターは Coding/Review に置く', () => {
    const actor = mountActor({ lane: 'coding', mood: 'neutral' });
    const desk = VISUAL_TOKENS.colors.actor.desk;
    expect(
      actor
        .all()
        .filter((node) => node.type === 'polygon')
        .slice(0, 3)
        .map((node) => node.props.fill),
    ).toEqual([desk.darkTop, desk.darkLeft, desk.darkRight]);
    expect(actor.all().filter((node) => node.type === 'polygon')).toHaveLength(5);
    actor.update({ lane: 'review' });
    expect(actor.all().filter((node) => node.type === 'polygon')).toHaveLength(5);
    expect(actor.all().filter((node) => node.type === 'text')).toHaveLength(0);
    actor.update({ lane: 'done', mood: 'cheer' });
    expect(
      actor
        .all()
        .filter((node) => node.type === 'polygon')
        .map((node) => node.props.fill),
    ).toEqual([desk.woodTop, desk.woodLeft, desk.woodRight]);
    expect(
      actor
        .all()
        .filter((node) => node.type === 'text')
        .map((node) => node.props.children),
    ).toEqual(['🎉']);
  });
});
