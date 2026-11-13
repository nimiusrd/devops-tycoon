import { describe, expect, it } from 'vitest';
import {
  noteAnnouncedLeaveReturnSpeech,
  readAnnouncedLeaveReturnSpeech,
  resetLeaveReturnSpeech,
} from '../../../src/ui/leaveReturnSpeech';

describe('leaveReturnSpeech', () => {
  it('チーム A→B→A でも A の読み上げ済みを覚えている', () => {
    resetLeaveReturnSpeech();
    const teamA = '0:["seed",1,0,"product-t0"]:product-t0';
    const teamB = '0:["seed",1,0,"product-t1"]:product-t1';
    const speech = 'アオイが復帰しました（ベンチ）';
    noteAnnouncedLeaveReturnSpeech(teamA, speech);
    noteAnnouncedLeaveReturnSpeech(teamB, 'ハルキが復帰しました（ベンチ）');
    expect(readAnnouncedLeaveReturnSpeech(teamA)).toBe(speech);
    expect(readAnnouncedLeaveReturnSpeech(teamB)).toBe('ハルキが復帰しました（ベンチ）');
  });
});
