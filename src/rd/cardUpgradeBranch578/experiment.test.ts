import { describe, expect, it } from 'vitest';
import { FIXED_SEED, formatReport, generateJobs, runCell, runMatrix } from './experiment';

describe('#578 R&D card upgrade branch prototype', () => {
  it('同じ seed なら 4 セルの数値が再現する', () => {
    const first = runMatrix(FIXED_SEED);
    const second = runMatrix(FIXED_SEED);
    expect(second).toEqual(first);
    expect(formatReport(second)).toBe(formatReport(first));
  });

  it('同じ状況の仕事列は A と B で同一', () => {
    expect(generateJobs('volume', FIXED_SEED)).toEqual(generateJobs('volume', FIXED_SEED));
    expect(generateJobs('bottleneck', FIXED_SEED)).toEqual(generateJobs('bottleneck', FIXED_SEED));
    expect(generateJobs('volume', FIXED_SEED)).not.toEqual(generateJobs('bottleneck', FIXED_SEED));
  });

  it('4 セルを同じ seed で走らせて比較表を出す', () => {
    const report = runMatrix(FIXED_SEED);
    const text = formatReport(report);
    console.log(`\n${text}\n`);
    expect(runCell('A', 'volume').seed).toBe(FIXED_SEED);
    expect(runCell('B', 'volume').seed).toBe(FIXED_SEED);
    expect(runCell('A', 'bottleneck').seed).toBe(FIXED_SEED);
    expect(runCell('B', 'bottleneck').seed).toBe(FIXED_SEED);
    expect(text).toContain('branch A');
    expect(text).toContain('branch B');
    expect(text).toContain('## volume');
    expect(text).toContain('## bottleneck');
    expect(text).toContain('foregoneIfPickA');
    expect(text).toContain('foregoneIfPickB');
  });
});
