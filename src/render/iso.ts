/**
 * アイソメトリック描画の基礎プリミティブ（SPEC 第22.2 / 第22.5）。
 *
 * 投影（格子→画面）・深度ソート（画家順）・画面外カリング・スプライトプールを
 * 純TS で提供する。GPU を使わないため Vitest で数値検証でき（カリング数 /
 * プール再利用 / 生成上限）、DOM/SVGとPixiJSへ同じ計画を供給できる。
 * 描画ライブラリに依存しないので DOM/SVG でも Pixi でも同じ座標系で描ける。
 */

/** アイソメ投影のパラメータ（タイル寸法と原点）。 */
export interface IsoOptions {
  /** タイル幅 px。 */
  tileW: number;
  /** タイル高 px。 */
  tileH: number;
  /** 画面原点 X（既定 0）。 */
  originX?: number;
  /** 画面原点 Y（既定 0）。 */
  originY?: number;
}

/** 格子座標を持つ最小要素（深度ソート/カリングの対象）。 */
export interface DepthItem {
  gridX: number;
  gridY: number;
}

/** 画面空間の矩形（カメラ可視範囲）。 */
export interface CameraRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 格子座標 (gx, gy) をアイソメ画面座標へ投影する。
 * X は (gx - gy)、Y は (gx + gy) に比例する標準の 2:1 アイソメ。
 */
export function isoProject(gx: number, gy: number, o: IsoOptions): { x: number; y: number } {
  const ox = o.originX ?? 0;
  const oy = o.originY ?? 0;
  return {
    x: ox + (gx - gy) * (o.tileW / 2),
    y: oy + (gx + gy) * (o.tileH / 2),
  };
}

/**
 * 画家順（奥→手前）に並べ替えた新しい配列を返す。
 * 深度キーは (gridX + gridY)。同値は gridX で安定化する（決定論）。
 */
export function depthSort<T extends DepthItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => a.gridX + a.gridY - (b.gridX + b.gridY) || a.gridX - b.gridX || a.gridY - b.gridY,
  );
}

/** カリング結果（可視要素と除外数）。 */
export interface CullResult<T> {
  visible: T[];
  /** 画面外として除外した数（カリング数）。 */
  culled: number;
}

/**
 * カメラ矩形に入る要素だけを残す（画面外カリング）。
 * 投影点が矩形（±margin）に含まれるかで判定する。`culled` は除外数。
 */
export function cullVisible<T extends DepthItem>(
  items: readonly T[],
  camera: CameraRect,
  iso: IsoOptions,
  margin = 0,
): CullResult<T> {
  const visible: T[] = [];
  for (const it of items) {
    const p = isoProject(it.gridX, it.gridY, iso);
    if (
      p.x >= camera.x - margin &&
      p.x <= camera.x + camera.w + margin &&
      p.y >= camera.y - margin &&
      p.y <= camera.y + camera.h + margin
    ) {
      visible.push(it);
    }
  }
  return { visible, culled: items.length - visible.length };
}

/** スプライトプールの設定。 */
export interface PoolOptions<T> {
  /** 同時アクティブ数の上限（生成スプライト数の上限）。 */
  max: number;
  /** 解放時に状態を初期化するフック（任意）。 */
  reset?: (obj: T) => void;
}

/**
 * スプライトの生成プール。再利用で生成数を抑える（第22.2）。
 * `acquire` は上限に達すると null を返し、無制限な生成を防ぐ。
 * テストから `createdCount` / `reuseCount` / `activeCount` を検証できる。
 */
export class SpritePool<T> {
  private free: T[] = [];
  private active = new Set<T>();
  /** これまでに新規生成した総数。 */
  createdCount = 0;
  /** これまでに再利用した総数。 */
  reuseCount = 0;

  constructor(
    private readonly factory: () => T,
    private readonly opts: PoolOptions<T>,
  ) {}

  /** 1 つ取得する（空きがなく上限なら null）。 */
  acquire(): T | null {
    if (this.active.size >= this.opts.max) return null;
    let obj = this.free.pop();
    if (obj !== undefined) {
      this.reuseCount += 1;
    } else {
      obj = this.factory();
      this.createdCount += 1;
    }
    this.active.add(obj);
    return obj;
  }

  /** 1 つ返却して再利用待ちにする。 */
  release(obj: T): void {
    if (this.active.delete(obj)) {
      this.opts.reset?.(obj);
      this.free.push(obj);
    }
  }

  /** アクティブを全て返却する（フレーム末の一括解放）。 */
  releaseAll(): void {
    for (const obj of this.active) {
      this.opts.reset?.(obj);
      this.free.push(obj);
    }
    this.active.clear();
  }

  /**
   * プールが保持する全インスタンス（active + free）を取り出して空にする。
   * レンダラ破棄時に、画面から外れて free に残ったスプライトも含めて確実に
   * destroy するための後始末用（reset は呼ばない）。
   */
  drain(): T[] {
    const all = [...this.active, ...this.free];
    this.active.clear();
    this.free.length = 0;
    return all;
  }

  /** アクティブ数。 */
  get activeCount(): number {
    return this.active.size;
  }

  /** 再利用待ち数。 */
  get freeCount(): number {
    return this.free.length;
  }

  /** プールが保持するインスタンス総数（active + free）。 */
  get size(): number {
    return this.active.size + this.free.length;
  }
}
