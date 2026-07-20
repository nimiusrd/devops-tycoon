import { describe, expect, it } from 'vitest';
// 生成スクリプト本体から楽曲レンダラを import して波形品質を検証する（RI-63）。
// CLI 実行ガードがあるため import 時にファイル書き込みは起きない。
import {
  BGM_DEFS,
  bakeLoopCrossfade,
  renderSong,
  SAMPLE_RATE,
} from '../../scripts/generate-audio-assets.mjs';

describe('BGM アセット生成（RI-63）', () => {
  it('bakeLoopCrossfade は末尾を先頭へ等パワーで折り込む', () => {
    const loopN = 100;
    const fadeN = 10;
    const samples = new Float64Array(loopN + fadeN);
    samples.fill(0.5);
    const out = bakeLoopCrossfade(samples, loopN, fadeN);
    expect(out.length).toBe(loopN);
    // 定数信号は等パワー合成でほぼ振幅維持（sin+cos >= 1）。
    for (let i = 0; i < fadeN; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(out[i]).toBeLessThanOrEqual(0.5 * Math.SQRT2 + 1e-9);
    }
    expect(out[fadeN]).toBeCloseTo(0.5);
  });

  const tones = Object.entries(BGM_DEFS) as Array<[string, Parameters<typeof renderSong>[0]]>;

  it.each(tones)('%s: ループが 20〜30 秒でピーク正規化されている', (_tone, def) => {
    const samples = renderSong(def);
    const durationSec = samples.length / SAMPLE_RATE;
    expect(durationSec).toBeGreaterThanOrEqual(20);
    expect(durationSec).toBeLessThanOrEqual(30);

    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    expect(peak).toBeCloseTo(0.55, 2);
  });

  it.each(tones)('%s: ループ端にクリックノイズが出ない', (_tone, def) => {
    const samples = renderSong(def);
    // ループ端（末尾→先頭）の振幅ジャンプが曲中の最大隣接サンプル差を超えない
    // ＝継ぎ目が波形的に外れ値でないことを確認する。
    let maxAdjacent = 0;
    for (let i = 1; i < samples.length; i += 1) {
      maxAdjacent = Math.max(maxAdjacent, Math.abs(samples[i] - samples[i - 1]));
    }
    const seam = Math.abs(samples[0] - samples[samples.length - 1]);
    expect(seam).toBeLessThanOrEqual(maxAdjacent);
    // 絶対値でも十分小さいこと（フルスケール 0.55 に対し 2% 未満）。
    expect(seam).toBeLessThan(0.011);
  });
});
