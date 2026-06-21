/**
 * アイソメ基礎プリミティブの数値検証（SPEC 第22.5）。
 * 投影 / 深度ソート / カリング数 / プール再利用 / 生成上限を GPU 無しで検証する。
 */
import { describe, expect, it } from 'vitest';
import {
  cullVisible,
  depthSort,
  isoProject,
  SpritePool,
  type DepthItem,
} from '../../src/render/iso';

const ISO = { tileW: 64, tileH: 32 };

describe('isoProject', () => {
  it('原点は画面原点へ写る', () => {
    expect(isoProject(0, 0, ISO)).toEqual({ x: 0, y: 0 });
  });

  it('X は (gx-gy)、Y は (gx+gy) に比例する（2:1 アイソメ）', () => {
    expect(isoProject(1, 0, ISO)).toEqual({ x: 32, y: 16 });
    expect(isoProject(0, 1, ISO)).toEqual({ x: -32, y: 16 });
    expect(isoProject(2, 2, ISO)).toEqual({ x: 0, y: 64 });
  });

  it('原点オフセットを反映する', () => {
    expect(isoProject(0, 0, { ...ISO, originX: 100, originY: 50 })).toEqual({ x: 100, y: 50 });
  });
});

describe('depthSort', () => {
  it('奥→手前（gridX+gridY 昇順）に並べ、元配列を破壊しない', () => {
    const items: DepthItem[] = [
      { gridX: 2, gridY: 2 },
      { gridX: 0, gridY: 0 },
      { gridX: 1, gridY: 0 },
    ];
    const sorted = depthSort(items);
    expect(sorted.map((i) => i.gridX + i.gridY)).toEqual([0, 1, 4]);
    expect(items[0]).toEqual({ gridX: 2, gridY: 2 }); // 非破壊
  });

  it('同じ深度は gridX で安定化する（決定論）', () => {
    const items: DepthItem[] = [
      { gridX: 0, gridY: 2 },
      { gridX: 2, gridY: 0 },
      { gridX: 1, gridY: 1 },
    ];
    expect(depthSort(items).map((i) => i.gridX)).toEqual([0, 1, 2]);
  });
});

describe('cullVisible', () => {
  it('カメラ矩形外の要素を除外し、カリング数を返す', () => {
    const items: DepthItem[] = [
      { gridX: 0, gridY: 0 }, // (0,0) 可視
      { gridX: 1, gridY: 0 }, // (32,16) 可視
      { gridX: 20, gridY: 0 }, // (640,320) 範囲外
    ];
    const res = cullVisible(items, { x: -50, y: -50, w: 200, h: 200 }, ISO);
    expect(res.visible).toHaveLength(2);
    expect(res.culled).toBe(1);
  });

  it('margin を広げると取りこぼしを救える', () => {
    const items: DepthItem[] = [{ gridX: 4, gridY: 0 }]; // (128,64)
    const tight = cullVisible(items, { x: 0, y: 0, w: 100, h: 100 }, ISO);
    expect(tight.visible).toHaveLength(0);
    const loose = cullVisible(items, { x: 0, y: 0, w: 100, h: 100 }, ISO, 64);
    expect(loose.visible).toHaveLength(1);
  });
});

describe('SpritePool', () => {
  it('解放後は再利用し、新規生成数を増やさない', () => {
    let created = 0;
    const pool = new SpritePool(() => ({ id: created++ }), { max: 10 });
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    expect(pool.createdCount).toBe(2);
    expect(pool.activeCount).toBe(2);
    pool.release(a);
    expect(pool.freeCount).toBe(1);
    const c = pool.acquire()!;
    expect(c).toBe(a); // 再利用
    expect(pool.createdCount).toBe(2);
    expect(pool.reuseCount).toBe(1);
    expect(b).not.toBe(c);
  });

  it('上限に達すると acquire は null を返す（生成スプライト数の上限）', () => {
    const pool = new SpritePool(() => ({}), { max: 3 });
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
    expect(pool.activeCount).toBe(3);
  });

  it('releaseAll で全アクティブを再利用待ちへ戻し reset を呼ぶ', () => {
    const reset = (o: { hot: boolean }) => {
      o.hot = false;
    };
    const pool = new SpritePool(() => ({ hot: true }), { max: 5, reset });
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(2);
    expect(a.hot).toBe(false);
    expect(b.hot).toBe(false);
    // 再取得で生成は増えない。
    pool.acquire();
    pool.acquire();
    expect(pool.createdCount).toBe(2);
    expect(pool.reuseCount).toBe(2);
  });
});
