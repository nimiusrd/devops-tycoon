/** 同じ文を、同じランの再マウントで空に戻して、もう一度読み上げない。 */
let announced: { epoch: number; speech: string } | null = null;

export function readAnnouncedLeaveReturnSpeech(epoch: number): string {
  return announced?.epoch === epoch ? announced.speech : '';
}

export function noteAnnouncedLeaveReturnSpeech(epoch: number, speech: string): void {
  announced = { epoch, speech };
}

/** テスト間で読み上げ済みの文を捨てる。 */
export function resetLeaveReturnSpeech(): void {
  announced = null;
}
